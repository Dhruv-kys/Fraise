import importlib
import json
import logging
import os
import re
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parents[2] / "mcp_servers.json"
_UNSAFE = re.compile(r"[^a-zA-Z0-9_-]")
_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")

_INJECTED_PARAMS = ("session_id",)

def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        def repl(m: re.Match) -> str:
            var = m.group(1)
            resolved = os.environ.get(var)
            if resolved is None:
                logger.warning("mcp_servers.json references unset env var %r", var)
                return ""
            return resolved
        return _VAR.sub(repl, value)
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    return value

def _flatten_structured(structured: dict | None) -> str | None:
    if not structured:
        return None
    if structured.keys() == {"result"}:
        result = structured["result"]
        return result if isinstance(result, str) else json.dumps(result)
    return json.dumps(structured)

def _hide_injected(schema: dict) -> dict:
    props = schema.get("properties")
    if not props or not any(p in props for p in _INJECTED_PARAMS):
        return schema
    out = dict(schema)
    out["properties"] = {k: v for k, v in props.items() if k not in _INJECTED_PARAMS}
    if "required" in out:
        out["required"] = [r for r in out["required"] if r not in _INJECTED_PARAMS]
    return out

class MCPManager:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        self._servers: dict[str, dict] = {}
        self._route: dict[str, tuple[str, str]] = {}
        self._functions_cache: list[dict] | None = None
        self._functions_by_server_cache: dict[str, list[dict]] | None = None

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

    def _register(self, name: str, handle: Any, tools: list, builtin: bool) -> None:
        tools = list(tools)
        self._servers[name] = {
            "handle": handle,
            "tools": tools,
            "by_name": {t.name: t for t in tools},
            "builtin": builtin,
        }

    async def _connect(self, name: str, spec: dict) -> None:
        spec = _expand_env(spec)
        kind = spec.get("type", "stdio")

        if kind == "builtin":
            module = importlib.import_module(spec["module"])
            handle = getattr(module, spec.get("attr", "mcp"))
            self._register(name, handle, await handle.list_tools(), builtin=True)
        else:
            async with AsyncExitStack() as scoped:
                if kind == "http":
                    read, write, _ = await scoped.enter_async_context(
                        streamablehttp_client(spec["url"], headers=spec.get("headers"))
                    )
                else:
                    params = StdioServerParameters(
                        command=spec["command"],
                        args=spec.get("args", []),
                        env=spec.get("env"),
                        cwd=spec.get("cwd"),
                    )
                    read, write = await scoped.enter_async_context(stdio_client(params))

                session = await scoped.enter_async_context(ClientSession(read, write))
                await session.initialize()
                tools = (await session.list_tools()).tools
                self._register(name, session, tools, builtin=False)
                self._stack.push_async_callback(scoped.pop_all().aclose)

        count = len(self._servers[name]["tools"])
        logger.info("connected %r (%s) — %d tool(s)", name, kind, count)

    def _build_routes(self) -> None:
        counts: dict[str, int] = {}
        for s in self._servers.values():
            for t in s["tools"]:
                counts[t.name] = counts.get(t.name, 0) + 1

        self._route.clear()
        for sname, s in self._servers.items():
            for t in s["tools"]:
                public = t.name if counts[t.name] == 1 else f"{sname}_{t.name}"
                public = _UNSAFE.sub("_", public)[:64]
                self._route[public] = (sname, t.name)

        self._functions_cache = None
        self._functions_by_server_cache = None

    def functions(self) -> list[dict]:
        if self._functions_cache is None:
            self._functions_cache = [
                {
                    "name": public,
                    "description": self._servers[sname]["by_name"][tname].description or "",
                    "parameters": _hide_injected(self._servers[sname]["by_name"][tname].inputSchema),
                }
                for public, (sname, tname) in self._route.items()
            ]
        return self._functions_cache

    def functions_by_server(self) -> dict[str, list[dict]]:
        if self._functions_by_server_cache is None:
            out: dict[str, list[dict]] = {}
            for public, (sname, tname) in self._route.items():
                tool = self._servers[sname]["by_name"][tname]
                stripped = (tool.description or "").strip()
                description = stripped.splitlines()[0] if stripped else ""
                out.setdefault(sname, []).append({"name": public, "description": description})
            self._functions_by_server_cache = out
        return self._functions_by_server_cache

    async def call(
        self, public_name: str, arguments: dict[str, Any], session_id: str | None = None
    ) -> str:
        if public_name not in self._route:
            raise KeyError(f"unknown tool: {public_name!r}")

        sname, tname = self._route[public_name]
        server = self._servers[sname]

        tool = server["by_name"][tname]
        if "session_id" in (tool.inputSchema.get("properties") or {}):
            arguments = {**arguments, "session_id": session_id or ""}

        if server["builtin"]:
            content, structured = await server["handle"].call_tool(tname, arguments)
            return _flatten_structured(structured) or "".join(
                getattr(b, "text", "") for b in (content or [])
            ).strip()

        result = await server["handle"].call_tool(tname, arguments)
        return _flatten_structured(getattr(result, "structuredContent", None)) or "".join(
            getattr(b, "text", "") for b in (result.content or [])
        ).strip()

    async def aclose(self) -> None:
        await self._stack.aclose()
        self._servers.clear()
        self._route.clear()
        self._functions_cache = None
        self._functions_by_server_cache = None

manager = MCPManager()
