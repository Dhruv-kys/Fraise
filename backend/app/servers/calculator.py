"""The MCP server — capabilities defined as `@mcp.tool` functions.

This `mcp` instance is the single source of truth for tools. It is mounted into
the FastAPI app (streamable HTTP at `/mcp`) for external MCP clients and called
in-process by the agent via `mcp.call_tool(...)`. Tool I/O is typed with
pydantic, which FastMCP uses to validate arguments and shape structured output.

Add a capability by writing another `@mcp.tool()` function here.
"""
import ast
import operator

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

# streamable_http_path="/" so mounting at "/mcp" yields the endpoint "/mcp".
mcp = FastMCP("calculator", streamable_http_path="/")


class CalcResult(BaseModel):
    expression: str
    result: float


_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def _eval(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        return _BIN_OPS[type(node.op)](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return _UNARY_OPS[type(node.op)](_eval(node.operand))
    raise ValueError("unsupported expression")


@mcp.tool()
def calculate(expression: str) -> CalcResult:
    """Evaluate a basic arithmetic expression.

    Supports + - * / // % ** and parentheses, e.g. "2 + 2" or "(3 + 4) * 5".
    Evaluated over a restricted AST (never `eval`), so only arithmetic runs.
    """
    return CalcResult(expression=expression, result=_eval(ast.parse(expression, mode="eval")))
