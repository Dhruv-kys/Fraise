"""Tavily search, scoped to a source's domains.

Why not scrape LinkedIn/Naukri directly: neither exposes a public jobs API, both
auth-wall and actively block automated clients, and their ToS forbids scraping.
Domain-scoped search reads the same public pages a search engine already indexed,
which is both legitimate and far more robust than a scraper that breaks weekly.

Tavily is also registered as an MCP server (for the voice LLM's own ad-hoc
searches). We call its HTTP API directly here instead of routing back through
MCPManager — a capability server reaching into the host's router would be a
circular dependency, and this needs `include_domains`, which the MCP tool
doesn't expose.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class SearchUnavailable(RuntimeError):
    pass


async def search(query: str, domains: list[str], max_results: int = 5) -> list[dict]:
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise SearchUnavailable("TAVILY_API_KEY is not set")

    payload: dict = {
        "api_key": key,
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
        "include_answer": False,
    }
    if domains:
        payload["include_domains"] = domains

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post("https://api.tavily.com/search", json=payload)
        if r.status_code >= 400:
            raise SearchUnavailable(f"Tavily {r.status_code}: {r.text[:200]}")
        results = r.json().get("results", [])

    return [
        {
            "title": (x.get("title") or "").strip(),
            "url": x.get("url") or "",
            # Capped: this text is multiplied by every result and every agent, and
            # it all lands in one minute's token budget. Snippets, not pages.
            "content": (x.get("content") or "").strip()[:700],
        }
        for x in results
        if x.get("url")
    ]
