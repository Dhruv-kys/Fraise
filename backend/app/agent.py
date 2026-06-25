"""The agent — turns an utterance into a reply by calling MCP tools.

For now it routes math questions to the `calculate` tool (in-process via
`mcp.call_tool`) and echoes everything else. Single entry point: `run_agent`.
"""
import logging
import re

from app.mcp_server import mcp

logger = logging.getLogger(__name__)

# Spoken words people use instead of operator symbols.
_WORD_OPS = [
    (r"\b(?:plus|added to)\b", "+"),
    (r"\b(?:minus|subtract(?:ed by)?|less)\b", "-"),
    (r"\b(?:times|multiplied by|x)\b", "*"),
    (r"\b(?:divided by|over)\b", "/"),
    (r"\b(?:to the power of|power of|raised to)\b", "**"),
]


def _to_expression(text: str) -> str | None:
    """Turn a spoken math question into a bare arithmetic expression, or None."""
    s = text.lower().strip()
    s = re.sub(r"^(?:what'?s|what is|whats|how much is|calculate|compute|tell me)\b", " ", s)
    for pattern, sym in _WORD_OPS:
        s = re.sub(pattern, sym, s)
    s = s.replace("=", " ").replace("?", " ")
    s = re.sub(r"[^0-9+\-*/%.()\s]", " ", s)  # keep only arithmetic characters
    s = re.sub(r"\s+", " ", s).strip()
    if not s or not re.search(r"\d", s) or not re.search(r"[+\-*/%]", s):
        return None
    return s


async def run_agent(message: str) -> str:
    expr = _to_expression(message)
    if expr is None:
        return f'You said: "{message}". (Try a calculation, e.g. "what is 2 + 2".)'

    try:
        _, structured = await mcp.call_tool("calculate", {"expression": expr})
        result = structured["result"]
    except Exception:  # noqa: BLE001 - bad expressions surface as a friendly reply
        logger.exception("calculate tool failed for %r", expr)
        return f"I couldn't work that out ({expr})."

    # Speak whole numbers cleanly (4, not 4.0).
    if isinstance(result, float) and result.is_integer():
        result = int(result)
    return str(result)
