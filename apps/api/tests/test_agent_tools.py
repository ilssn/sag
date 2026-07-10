"""Agent 工具循环：桩 LLM 触发 tool_call → 派发工具 → 汇总 citations → 收尾。

用 FakeLLM（configured=True + 脚本化 stream_turn）在离线下确定性驱动循环；注册一个
测试用 echo 工具验证「派发 + 引用回填」。走**无状态的 OpenAI 端点**（thread_id=None）以
避免触发后台记忆任务（引擎构建）带来的 DB 争用。向后兼容由 test_agents/test_experience 覆盖。
"""

from types import SimpleNamespace

import httpx
import pytest

from sag_agent import ModelChunk, ToolCall
from sag_api.sag import RetrievedSection, SearchOutcome
from sag_api.services.agent_service import _enabled_tool_names
from sag_api.tools import registry
from sag_api.tools.base import Tool, ToolContext, ToolMeta, ToolResult
from sag_api.tools.builtin import SearchContextTool

ECHO_CITATION = {
    "n": 1,
    "chunk_id": "c1",
    "heading": "H",
    "snippet": "S",
    "score": 0.9,
    "source_id": "src",
    "source_name": "回声源",
}


class EchoTool(Tool):
    meta = ToolMeta(
        name="echo",
        description="测试工具：回显参数并附一条引用。",
        parameters={"type": "object", "properties": {"q": {"type": "string"}}},
    )

    async def invoke(self, args, ctx):
        return ToolResult(content=f"echoed:{args.get('q', '')}", citations=[ECHO_CITATION])


registry.register(EchoTool())


@pytest.mark.asyncio
async def test_search_tool_prefers_exact_body_window_over_semantic_boilerplate():
    class HybridEngine:
        async def search_many(self, targets, query, *, strategy=None, top_k=None):
            return SearchOutcome(
                query=query,
                sections=[
                    RetrievedSection(
                        chunk_id="nav",
                        heading="版权声明",
                        content="新浪首页 阅读排行榜 评论排行榜",
                        score=0.64,
                        source_config_id="sc-1",
                    )
                ],
            )

        async def grep_chunks(self, source_config_id, pattern, *, source=None, limit=20):
            assert pattern == "林俊杰"
            return [
                {
                    "chunk_id": "body",
                    "heading": "林俊杰官宣恋情",
                    "snippet": "12月29日晚林俊杰官宣恋情，与女友七七相差21岁。",
                }
            ]

    source = SimpleNamespace(id="source-1", name="娱乐新闻", sag_source_config_id="sc-1")
    result = await SearchContextTool().invoke(
        {"query": "关于林俊杰最新动态 2024 2025", "top_k": 4},
        ToolContext(engine_manager=HybridEngine(), sources=[source]),
    )

    assert result.citations[0]["chunk_id"] == "body"
    assert "12月29日晚" in result.content
    assert result.data["lexical_count"] == 1
    assert result.data["section_count"] == 1


def test_visible_sources_mount_builtin_knowledge_tools():
    agent = SimpleNamespace(persona={}, is_default=False)
    assert _enabled_tool_names(agent, has_sources=True)[:2] == [
        "search_context",
        "get_entity",
    ]


class FakeLLM:
    """脚本化：第一轮请求调 echo 工具，第二轮收尾；最终答案流式两 token。"""

    def __init__(self) -> None:
        self.calls = 0

    @property
    def configured(self) -> bool:
        return True

    async def stream_turn(self, request, cancellation):
        self.calls += 1
        if self.calls == 1 and request.tools:
            yield ModelChunk(
                tool_calls=(ToolCall(id="call_1", name="echo", arguments={"q": "hi"}),),
                finish_reason="tool_calls",
            )
            return
        for token in ["最终", "答案"]:
            cancellation.raise_if_cancelled()
            yield ModelChunk(text_delta=token)
        yield ModelChunk(finish_reason="stop")


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_agent_tool_loop_dispatch_and_citations():
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        app.state.llm = FakeLLM()  # 覆盖为桩（本用例范围内）
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "agenttools@t.com")
            # 开启额外工具 echo；不绑定信源 → 不触发引擎，循环仍运行
            agent = (
                await c.post(
                    "/api/v1/agents",
                    headers=A,
                    json={"name": "工具助手", "persona": {"tools": ["echo"]}},
                )
            ).json()

            r = await c.post(
                f"/api/v1/openai/{agent['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "user", "content": "你好"}]},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            # 工具循环跑完 → 最终答案
            assert body["choices"][0]["message"]["content"] == "最终答案"
            # 工具被派发（echo 执行）→ 其引用汇总进 sag.citations
            assert any(c.get("source_name") == "回声源" for c in body["sag"]["citations"])
            # 统一 provider 协议恰好两轮（工具决策 + 收尾）
            assert app.state.llm.calls == 2


@pytest.mark.asyncio
async def test_no_tools_agent_uses_one_model_turn():
    """No-tool agents use the same provider protocol with exactly one model turn."""
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        fake = FakeLLM()
        app.state.llm = fake
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "plainagent@t.com")
            agent = (await c.post("/api/v1/agents", headers=A, json={"name": "普通助手"})).json()
            r = await c.post(
                f"/api/v1/openai/{agent['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "user", "content": "在吗"}]},
            )
            assert r.status_code == 200, r.text
            assert r.json()["choices"][0]["message"]["content"] == "最终答案"
            assert fake.calls == 1
