"""MCP 客户端适配 —— 把远端 MCP 工具适配成 zleap 的 `Tool`。

Agent 循环对「内置工具」与「远端 MCP 工具」一视同仁：本模块把一个远端 MCP
server 暴露的每个工具包成 `MCPTool`（命名空间前缀避免撞名），其 `invoke` 转成
一次 `session.call_tool`。连接生命周期由 `open_agent_mcp_tools` 的异步上下文托管
——在工具循环期间保持打开，循环结束即断开。传输（stdio / Streamable-HTTP）在
`_open_session` 内按绑定 config 选择，`MCPTool` 本身与传输无关（接一个就绪的
`ClientSession` 即可，便于用进程内内存传输做离线测试）。
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from zleap_api.core.logging import get_logger
from zleap_api.tools.base import Tool, ToolContext, ToolMeta, ToolResult

log = get_logger("mcp.client")


def _namespace(label: str) -> str:
    safe = "".join(c if c.isalnum() else "_" for c in (label or "mcp")).strip("_")
    return (safe or "mcp")[:32]


def _content_to_text(result: Any) -> str:
    parts = []
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip() or "（无返回）"


class MCPTool(Tool):
    """把某个远端 MCP 工具适配成 zleap 的 `Tool`。"""

    def __init__(
        self,
        session: ClientSession,
        *,
        remote_name: str,
        local_name: str,
        description: str,
        parameters: dict[str, Any],
    ) -> None:
        self._session = session
        self._remote_name = remote_name
        self.meta = ToolMeta(name=local_name, description=description, parameters=parameters)

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        result = await self._session.call_tool(self._remote_name, args or {})
        text = _content_to_text(result)
        if getattr(result, "isError", False):
            return ToolResult(content=f"工具执行失败：{text}")
        return ToolResult(content=text)


async def tools_from_session(session: ClientSession, *, namespace: str) -> list[MCPTool]:
    """列出远端工具并逐个适配（本地名 = mcp__<namespace>__<remote>）。"""
    listed = await session.list_tools()
    tools: list[MCPTool] = []
    for t in listed.tools:
        params = t.inputSchema or {"type": "object", "properties": {}}
        tools.append(
            MCPTool(
                session,
                remote_name=t.name,
                local_name=f"mcp__{namespace}__{t.name}",
                description=t.description or f"远端 MCP 工具 {t.name}",
                parameters=params,
            )
        )
    return tools


@contextlib.asynccontextmanager
async def _open_session(config: dict) -> AsyncIterator[ClientSession]:
    """按 config 选择传输并建立就绪的 ClientSession（url → HTTP；command → stdio）。"""
    url = config.get("url")
    command = config.get("command")
    if url:
        headers = config.get("headers") or None
        async with streamablehttp_client(url, headers=headers) as (read, write, _sid):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    elif command:
        params = StdioServerParameters(
            command=command,
            args=list(config.get("args") or []),
            env=config.get("env") or None,
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    else:
        raise ValueError("MCP 绑定缺少 url 或 command")


@contextlib.asynccontextmanager
async def open_agent_mcp_tools(specs: list[tuple[str, dict]]) -> AsyncIterator[list[MCPTool]]:
    """打开若干 MCP server 连接，产出适配后的工具集；退出即断开全部连接。

    `specs`：`[(label, config), …]`。单个 server 连接失败只记日志并跳过，不影响其余。
    """
    tools: list[MCPTool] = []
    async with AsyncExitStack() as stack:
        for label, config in specs:
            try:
                session = await stack.enter_async_context(_open_session(config))
                tools.extend(await tools_from_session(session, namespace=_namespace(label)))
            except Exception as e:  # noqa: BLE001
                log.warning("MCP 连接失败 %s：%s", label, e)
        yield tools
