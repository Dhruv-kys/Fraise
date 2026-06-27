"""Fraise MCP Host — connects to every server in mcp_servers.json.

Three server types:
  builtin — a FastMCP instance in this process (e.g. the calculator)
  stdio   — a local subprocess speaking the MCP stdio transport
  http    — a remote server speaking MCP streamable-HTTP

MCPManager aggregates all tools into one flat list and routes each voice
function call to the server that owns it. Adding a new server = one entry in
mcp_servers.json, no code changes here.
"""
import importlib
import json
import logging
import re
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parents[1] / "mcp_servers.json"
_UNSAFE = re.compile(r"[^a-zA-Z0-9_-]")


class MCPManager:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        # server_name -> {"handle": FastMCP | ClientSession, "tools": list, "builtin": bool}
        self._servers: dict[str, dict] = {}
        # exposed function name -> (server_name, real tool name)
        self._route: dict[str, tuple[str, str]] = {}

    async def connect_all(self) -> None:
        config = json.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
        for name, spec in config.get("mcpServers", {}).items():
            if spec.get("disabled"):
                continue
            try:
                await self._connect(name, spec)
            except Exception:
                logger.exception("skipping MCP server %r — failed to connect", name)
        self._build_routes()
        logger.info(
            "MCP host ready: %d server(s), %d tool(s)",
            len(self._servers), len(self._route),
        )

    async def _connect(self, name: str, spec: dict) -> None:
        kind = spec.get("type", "stdio")

        if kind == "builtin":
            module = importlib.import_module(spec["module"])
            handle = getattr(module, spec.get("attr", "mcp"))
            tools = await handle.list_tools()
            self._servers[name] = {"handle": handle, "tools": list(tools), "builtin": True}

        elif kind == "http":
            read, write, _ = await self._stack.enter_async_context(
                streamablehttp_client(spec["url"], headers=spec.get("headers"))
            )
            session = await self._stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            tools = (await session.list_tools()).tools
            self._servers[name] = {"handle": session, "tools": list(tools), "builtin": False}

        else:  # stdio
            params = StdioServerParameters(
                command=spec["command"],
                args=spec.get("args", []),
                env=spec.get("env"),
                cwd=spec.get("cwd"),
            )
            read, write = await self._stack.enter_async_context(stdio_client(params))
            session = await self._stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            tools = (await session.list_tools()).tools
            self._servers[name] = {"handle": session, "tools": list(tools), "builtin": False}

        count = len(self._servers[name]["tools"])
        logger.info("connected %r (%s) — %d tool(s)", name, kind, count)

    def _build_routes(self) -> None:
        # Count how many servers expose each tool name to detect collisions.
        counts: dict[str, int] = {}
        for s in self._servers.values():
            for t in s["tools"]:
                counts[t.name] = counts.get(t.name, 0) + 1

        self._route.clear()
        for sname, s in self._servers.items():
            for t in s["tools"]:
                # Prefix with server name only when the name collides.
                public = t.name if counts[t.name] == 1 else f"{sname}_{t.name}"
                public = _UNSAFE.sub("_", public)[:64]
                self._route[public] = (sname, t.name)

    def functions(self) -> list[dict]:
        """All tools as Deepgram-compatible function declarations."""
        out = []
        for public, (sname, tname) in self._route.items():
            tool = next(t for t in self._servers[sname]["tools"] if t.name == tname)
            out.append({
                "name": public,
                "description": tool.description or "",
                "parameters": tool.inputSchema,
            })
        return out

    async def call(self, public_name: str, arguments: dict[str, Any]) -> str:
        """Run a tool by its exposed name and return a string result."""
        if public_name not in self._route:
            raise KeyError(f"unknown tool: {public_name!r}")

        sname, tname = self._route[public_name]
        server = self._servers[sname]

        if server["builtin"]:
            _, structured = await server["handle"].call_tool(tname, arguments)
            return json.dumps(structured) if structured else ""

        result = await server["handle"].call_tool(tname, arguments)
        if getattr(result, "structuredContent", None):
            return json.dumps(result.structuredContent)
        return "".join(getattr(b, "text", "") for b in (result.content or [])).strip()

    async def aclose(self) -> None:
        await self._stack.aclose()
        self._servers.clear()
        self._route.clear()


manager = MCPManager()
