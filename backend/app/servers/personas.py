"""Personas MCP server — voice-native assistant switching.

The list of assistants lives entirely in the browser (localStorage); the host
never stores it. This tool doesn't switch anything itself — it returns an
`_action` envelope the host forwards to the browser, which then matches the
name against its local assistants and reconnects `/ws` as that persona.

`once: True` marks the action as fire-and-forget: the host notifies the browser
and returns immediately (the reconnect tears down this socket), unlike the
calendar's OAuth action which the host re-polls until it resolves.
"""
import json

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("personas", streamable_http_path="/")


@mcp.tool()
def switch_assistant(name: str) -> str:
    """Switch the active voice assistant to the one the user names.

    name: the assistant to switch to, e.g. "Work" or "Personal".
    Call this only when the user clearly asks to switch assistants or personas.
    Each assistant has its own separate memory and documents.
    """
    return json.dumps({
        "_action": {"type": "switch_assistant", "name": name, "once": True},
        "spoken": f"Okay, switching to {name}.",
    })
