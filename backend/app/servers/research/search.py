import logging
import os
from urllib.parse import urlparse

import httpx

from app.servers.research import llm

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

class SearchUnavailable(RuntimeError):
    pass

_VALID_TIME_RANGES = {"day", "week", "month", "year"}
_NEWS_RANGES = {"day", "week"}
_MAX_PER_DOMAIN = 2

def _domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")

async def search(
    query: str, domains: list[str], max_results: int = 5, time_range: str | None = None
) -> list[dict]:
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise SearchUnavailable("TAVILY_API_KEY is not set")

    payload: dict = {
        "api_key": key,
        "query": query,
        "max_results": max_results * 3 if not domains else max_results,
        "search_depth": "advanced",
        "include_answer": False,
        "topic": "news" if time_range in _NEWS_RANGES else "general",
    }
    if domains:
        payload["include_domains"] = domains
    if time_range in _VALID_TIME_RANGES:
        payload["time_range"] = time_range

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post("https://api.tavily.com/search", json=payload)
        if r.status_code >= 400:
            raise SearchUnavailable(f"Tavily {r.status_code}: {r.text[:200]}")
        results = r.json().get("results", [])

    cleaned = [
        {
            "title": llm.strip_markdown((x.get("title") or "").strip()),
            "url": x.get("url") or "",
            "content": (x.get("content") or "").strip()[:900],
            "score": x.get("score") or 0.0,
        }
        for x in results
        if x.get("url")
    ]
    cleaned = [c for c in cleaned if c["content"]]
    cleaned.sort(key=lambda c: c["score"], reverse=True)

    if not domains:
        per_domain: dict[str, int] = {}
        diverse = []
        for c in cleaned:
            d = _domain(c["url"])
            if per_domain.get(d, 0) >= _MAX_PER_DOMAIN:
                continue
            per_domain[d] = per_domain.get(d, 0) + 1
            diverse.append(c)
        cleaned = diverse

    return cleaned[:max_results]
