"""Agent 工具循环：桩 LLM 触发 tool_call → 派发工具 → 汇总 citations → 收尾。

用 FakeLLM（configured=True + 脚本化 chat/stream）在离线下确定性驱动循环；注册一个
测试用 echo 工具验证「派发 + 引用回填」。走**无状态的 OpenAI 端点**（thread_id=None）以
避免触发后台记忆任务（引擎构建）带来的 DB 争用。向后兼容由 test_souls/test_experience 覆盖。
"""

import httpx
import pytest

from zleap_api.generation.llm import ChatTurn, ToolCall
from zleap_api.tools import registry
from zleap_api.tools.base import Tool, ToolMeta, ToolResult

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


class FakeLLM:
    """脚本化：第一轮请求调 echo 工具，第二轮收尾；最终答案流式两 token。"""

    def __init__(self) -> None:
        self.calls = 0

    @property
    def configured(self) -> bool:
        return True

    async def chat(self, messages, tools=None):
        self.calls += 1
        if self.calls == 1:
            return ChatTurn(
                content=None,
                tool_calls=[ToolCall(id="call_1", name="echo", arguments={"q": "hi"})],
            )
        return ChatTurn(content="done-deciding", tool_calls=[])

    async def stream(self, messages):
        for t in ["最终", "答案"]:
            yield t


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_agent_tool_loop_dispatch_and_citations():
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        app.state.llm = FakeLLM()  # 覆盖为桩（本用例范围内）
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "agenttools@t.com")
            # 开启额外工具 echo；不绑定信源 → 不触发引擎，循环仍运行
            soul = (
                await c.post(
                    "/api/v1/souls",
                    headers=A,
                    json={"name": "工具助手", "persona": {"tools": ["echo"]}},
                )
            ).json()

            r = await c.post(
                f"/api/v1/openai/{soul['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "user", "content": "你好"}]},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            # 工具循环跑完 → 最终答案
            assert body["choices"][0]["message"]["content"] == "最终答案"
            # 工具被派发（echo 执行）→ 其引用汇总进 zleap.citations
            assert any(c.get("source_name") == "回声源" for c in body["zleap"]["citations"])
            # chat 被调用两轮（工具决策 + 收尾），stream 产出最终答案
            assert app.state.llm.calls == 2


@pytest.mark.asyncio
async def test_no_tools_soul_skips_loop():
    """未开启工具的助手：不进循环（chat 从不调用），行为等价旧版单发。"""
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        fake = FakeLLM()
        app.state.llm = fake
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "plainagent@t.com")
            soul = (await c.post("/api/v1/souls", headers=A, json={"name": "普通助手"})).json()
            r = await c.post(
                f"/api/v1/openai/{soul['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "user", "content": "在吗"}]},
            )
            assert r.status_code == 200, r.text
            assert r.json()["choices"][0]["message"]["content"] == "最终答案"
            assert fake.calls == 0  # 未进工具循环（决策步未触发）
