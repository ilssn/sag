"""MCP 三件事，全程离线：

1. 信源即 MCP —— 经进程内内存客户端列出并调用 search/get_entity/get_chunk（空库 → 结构化结果）。
2. 远端 MCP 工具适配成 sag 的 `Tool`（命名空间前缀 + call_tool 往返）。
3. 绑定与描述端点 —— agent 挂载外部 MCP 的校验、信源的 MCP 连接描述。
"""

import httpx
import pytest
from mcp.server.fastmcp import FastMCP
from mcp.shared.memory import create_connected_server_and_client_session as connect

from sag_api.mcp.server import build_source_mcp, use_scope
from sag_api.tools import registry
from sag_api.tools.base import Tool, ToolContext, ToolMeta, ToolResult
from sag_api.tools.mcp import tools_from_session


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_source_mcp_lists_and_calls_tools_over_engine():
    """信源 MCP server：真实（空）引擎 + 作用域注入，三个工具可列出可调用。"""
    from sqlalchemy import select

    from sag_api.core.db import SessionLocal
    from sag_api.db.models import Source
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "mcpsrv@t.com")
            src = (await c.post("/api/v1/sources", headers=A, json={"name": "MCP 源"})).json()
            async with SessionLocal() as s:
                source = (
                    await s.execute(select(Source).where(Source.id == src["id"]))
                ).scalar_one()

            mcp = build_source_mcp()
            # 作用域须在 connect（起服务任务）之前设置，任务会复制含作用域的上下文
            with use_scope(app.state.engine_manager, source):
                async with connect(mcp) as client:
                    await client.initialize()
                    listed = await client.list_tools()
                    names = {t.name for t in listed.tools}
                    assert {"search", "get_entity", "get_chunk"} <= names

                    r_chunk = await client.call_tool("get_chunk", {"chunk_id": "does-not-exist"})
                    assert not r_chunk.isError
                    assert "未找到" in r_chunk.content[0].text

                    r_entity = await client.call_tool("get_entity", {"name": "查无此实体"})
                    assert not r_entity.isError
                    assert "未找到" in r_entity.content[0].text

                    # 检索走真实引擎（离线下 SAG 需 LLM 抽取实体 → 结构化报错）；
                    # 关键是工具正确派发并返回结构化 MCP 响应，不使 server 崩溃
                    r_search = await client.call_tool("search", {"query": "任意问题"})
                    assert r_search.content and isinstance(r_search.content[0].text, str)


@pytest.mark.asyncio
async def test_remote_mcp_tool_adapted_as_sag_tool():
    """远端 MCP 工具 → MCPTool：命名空间前缀 + invoke 往返回文本。"""
    stub = FastMCP("stub")

    @stub.tool(description="回显输入")
    async def echo(text: str) -> str:
        return f"echo:{text}"

    async with connect(stub) as client:
        await client.initialize()
        tools = await tools_from_session(client, namespace="stub")
        assert len(tools) == 1
        tool = tools[0]
        assert tool.meta.name == "mcp__stub__echo"
        assert tool.meta.parameters.get("type") == "object"
        result = await tool.invoke({"text": "hi"}, ToolContext(engine_manager=None))
        assert result.content == "echo:hi"


def test_registry_overlay_does_not_pollute_global():
    """叠加层含内置 + MCP 工具；全局单例不被污染。"""

    class _Stub(Tool):
        meta = ToolMeta(
            name="mcp__ext__ping",
            description="stub",
            parameters={"type": "object", "properties": {}},
        )

        async def invoke(self, args, ctx):
            return ToolResult(content="pong")

    child = registry.overlay([_Stub()])
    assert child.has("mcp__ext__ping")
    assert child.has("search_context")  # 内置工具继承
    assert not registry.has("mcp__ext__ping")  # 全局不受影响


@pytest.mark.asyncio
async def test_mcp_binding_validation_and_source_descriptor():
    """agent 挂载外部 MCP 的校验 + 信源 MCP 连接描述端点。"""
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "mcpbind@t.com")
            src = (await c.post("/api/v1/sources", headers=A, json={"name": "描述源"})).json()

            desc = await c.get(f"/api/v1/sources/{src['id']}/mcp", headers=A)
            assert desc.status_code == 200, desc.text
            body = desc.json()
            assert src["id"] in body["http"]["url"]
            assert body["stdio"]["env"]["SAG_MCP_SOURCE_ID"] == src["id"]
            assert set(body["tools"]) == {"search", "get_entity", "get_chunk"}

            agent = (await c.post("/api/v1/agents", headers=A, json={"name": "挂载助手"})).json()
            ok = await c.post(
                f"/api/v1/agents/{agent['id']}/bindings",
                headers=A,
                json={"target_type": "mcp_server", "config": {"name": "fs", "url": "http://x/mcp"}},
            )
            assert ok.status_code == 201, ok.text
            assert ok.json()["target_type"] == "mcp_server"
            assert ok.json()["config"]["url"] == "http://x/mcp"

            bad = await c.post(
                f"/api/v1/agents/{agent['id']}/bindings",
                headers=A,
                json={"target_type": "mcp_server", "config": {"name": "缺少连接"}},
            )
            assert bad.status_code == 422, bad.text
