"""Groq calls for the research agents.

Deepgram's voice LLM is busy being the conversation — it can't also read twenty
search results out loud. So the sub-agents and the synthesizer run on Groq
(OpenAI-compatible, already keyed in .env): fast, cheap, and off the voice path.
"""
import asyncio
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")

# Deliberately NOT the voice model. Two reasons, both learned the hard way:
#   1. Groq's free tier caps tokens-per-minute *per model*. Fan-out multiplies
#      TPM — three agents each shipping a search corpus at once blew the 8k limit
#      on qwen3 and two of three agents died with a 429. A small, fast model has
#      a much larger bucket, and the voice model keeps its own bucket free.
#   2. qwen3 is a reasoning model: it spends output tokens (and TPM) thinking,
#      for a job that is summarize-what-you-were-given.
MODEL = os.environ.get("RESEARCH_MODEL", "llama-3.1-8b-instant")
# Synthesis is the one step where quality shows, and it runs once, not per-agent.
SYNTH_MODEL = os.environ.get("RESEARCH_SYNTH_MODEL", "llama-3.3-70b-versatile")

_TIMEOUT = httpx.Timeout(45.0, connect=10.0)
_RETRIES = 3

# The configured model (qwen3) is a reasoning model: it prepends its private
# chain-of-thought in a <think> block. That is not an answer — left in, it lands
# verbatim in the user's slides and gets read aloud by TTS. Strip it here so
# every caller is safe, including one added later by someone who never saw this.
_THINK = re.compile(r"<think>.*?</think>\s*", re.DOTALL | re.IGNORECASE)


def _clean(text: str) -> str:
    text = _THINK.sub("", text)
    # An unterminated <think> (hit the token cap mid-thought) leaves an open tag
    # and no answer at all — better to return nothing than to print the thoughts.
    if "<think>" in text.lower():
        return ""
    return text.strip()


# Everything these agents write ends up in two places that cannot take markdown:
# a TTS voice, which pronounces "**" as "star star" and spells a URL out loud
# character by character, and the artifact, which renders strings verbatim so
# "**[Title](https://…)**" shows up as literal asterisks and brackets. Telling the
# model "no markdown" helps but does not hold, so strip it on the way out.
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")       # [label](url) -> label
_MD_BOLD = re.compile(r"(\*{1,3}|_{2,3})(.+?)\1", re.S)
_MD_CODE = re.compile(r"`+([^`]*)`+")
_MD_HEAD = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
# Greedy to the end of the token, but never ending on punctuation, so a URL at the
# end of a sentence loses the URL and keeps the full stop. A lookahead on "." here
# would stop inside the hostname ("amazon.jobs" -> ".jobs") — which it did.
_BARE_URL = re.compile(r"<?(?:https?://|www\.)[^\s<>]*[^\s<>.,;:!?)\]'\"]>?", re.I)
_WS = re.compile(r"[ \t]{2,}")


def strip_markdown(text: str) -> str:
    if not text:
        return ""
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_HEAD.sub("", text)
    text = _MD_CODE.sub(r"\1", text)
    text = _MD_BOLD.sub(r"\2", text)
    # Bare URLs are never speakable and never useful in a bullet — the artifact
    # already carries every source as a real, clickable citation.
    text = _BARE_URL.sub("", text)
    text = _WS.sub(" ", text)
    # Tidy the punctuation a dropped link leaves behind: "the guide ( )." etc.
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return text.strip(" -–—•*\t")


class LLMUnavailable(RuntimeError):
    """No key configured, or Groq refused — callers degrade instead of crashing."""


async def complete(system: str, user: str, *, json_mode: bool = False, model: str = "") -> str:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise LLMUnavailable("GROQ_API_KEY is not set")

    payload: dict = {
        "model": model or MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for attempt in range(_RETRIES):
            r = await client.post(
                f"{BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
            # Even with a roomier model, N agents firing at once can clip the TPM
            # ceiling. Groq tells us how long to wait; honour it rather than
            # failing an agent that would have succeeded a second later.
            if r.status_code == 429 and attempt < _RETRIES - 1:
                wait = float(r.headers.get("retry-after", 0)) or 2 ** attempt
                logger.info("groq 429; retrying in %.1fs (attempt %d)", wait, attempt + 1)
                await asyncio.sleep(min(wait, 10))
                continue
            if r.status_code >= 400:
                raise LLMUnavailable(f"Groq {r.status_code}: {r.text[:160]}")
            return _clean(r.json()["choices"][0]["message"]["content"])
    raise LLMUnavailable("Groq rate limit — out of retries")


async def complete_json(system: str, user: str, *, model: str = "") -> dict:
    """Same, but the model is told to emit an object. A model that ignores that
    shouldn't take the whole run down, so a bad parse degrades to {}."""
    raw = await complete(system, user, json_mode=True, model=model)
    # A reasoning model can still wrap the object in prose or a fence even in
    # JSON mode; salvage the outermost object rather than losing the whole run.
    try:
        return json.loads(raw) if isinstance(json.loads(raw), dict) else {}
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(raw[start:end + 1])
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        logger.warning("synthesis returned non-JSON: %s", raw[:200])
        return {}
