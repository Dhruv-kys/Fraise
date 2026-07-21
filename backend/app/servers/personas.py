import json

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("personas", streamable_http_path="/")

@mcp.tool(description=(
    "Switch the active voice assistant to the one the user names.\n\n"
    "name: the assistant to switch to, e.g. \"Work\" or \"Personal\". Call this only "
    "when the user clearly asks to switch assistants or personas. Each assistant has "
    "its own separate memory and documents."
))
def switch_assistant(name: str) -> str:
    return json.dumps({
        "_action": {"type": "switch_assistant", "name": name, "once": True},
        "spoken": f"Okay, switching to {name}.",
    })
