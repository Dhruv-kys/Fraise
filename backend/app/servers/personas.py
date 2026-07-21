import json

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("personas", streamable_http_path="/")

@mcp.tool()
def switch_assistant(name: str) -> str:
    return json.dumps({
        "_action": {"type": "switch_assistant", "name": name, "once": True},
        "spoken": f"Okay, switching to {name}.",
    })
