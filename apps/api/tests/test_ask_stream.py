"""/ask SSE 全链路：agentic 事件序、轨迹落库、坏 tools 网关降级直答（此前盲区）。"""

import httpx
import pytest

from sag_api.core.errors import UpstreamError
from sag_api.generation.llm import ChatTurn, ToolCall


class AgenticLLM:
    """一轮工具调用后收尾。"""

    def __init__(self):
        self.calls = 0

    @property
    def configured(self):
        return True

    async def chat(self, messages, tools=None):
        self.calls += 1
        if self.calls == 1:
            return ChatTurn(
                content=None,
                tool_calls=[ToolCall(id="c1", name="search_context", arguments={"query": "改写"})],
            )
        return ChatTurn(content="done", tool_calls=[])

    async def stream(self, messages):
        for t in ["答", "案"]:
            yield t

    async def complete(self, messages):
        return "摘要"


class BrokenToolsLLM(AgenticLLM):
    """网关不支持 tools：决策调用必抛。"""

    async def chat(self, messages, tools=None):
        raise UpstreamError("tools not supported")


class GreedyLLM(AgenticLLM):
    """每轮都要求调用工具 → 必然打满 agent_max_steps（复现「卡在第 N 轮」场景）。"""

    async def chat(self, messages, tools=None):
        self.calls += 1
        return ChatTurn(
            content=None,
            tool_calls=[ToolCall(id=f"c{self.calls}", name="search_context", arguments={"query": f"第{self.calls}轮"})],
        )


async def _setup(c):
    r = await c.post(
        "/api/v1/auth/register", json={"email": f"stream{id(c)}@t.com", "password": "password123"}
    )
    H = {"Authorization": f"Bearer {r.json()['access_token']}"}
    a = (await c.get("/api/v1/agents/default", headers=H)).json()
    th = (await c.post(f"/api/v1/agents/{a['id']}/threads", headers=H, json={})).json()
    return H, a, th


@pytest.mark.asyncio
async def test_ask_stream_agentic_events_and_trace():
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        app.state.llm = AgenticLLM()
        async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=60) as c:
            H, a, th = await _setup(c)
            ask = await c.post(
                f"/api/v1/agents/{a['id']}/threads/{th['id']}/ask",
                headers=H,
                json={"query": "深度测试", "mode": "agentic"},
            )
            body = ask.text
            assert ask.status_code == 200
            for marker in ["event: status", "event: tool", "event: tool_result", "event: token", "event: done"]:
                assert marker in body, marker
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            asst = [m for m in msgs if m["role"] == "assistant"][-1]
            kinds = [s["kind"] for s in asst["steps"]]
            assert "tool" in kinds and "thinking" in kinds   # 种子步 + 循环轨迹已持久化
            assert asst["steps"][0]["step"] == 0              # 首轮检索 step0


@pytest.mark.asyncio
async def test_ask_stream_degrades_when_gateway_rejects_tools():
    """坏 tools 网关：绝不无声死亡——降级直答，token/done 照常，答案落库。"""
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        app.state.llm = BrokenToolsLLM()
        async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=60) as c:
            H, a, th = await _setup(c)
            ask = await c.post(
                f"/api/v1/agents/{a['id']}/threads/{th['id']}/ask",
                headers=H,
                json={"query": "容错", "mode": "agentic"},
            )
            body = ask.text
            assert "event: token" in body and "event: done" in body
            assert ("event: done" in body) or ("event: error" in body)  # 无声死亡=两者皆无
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            assert any(m["role"] == "assistant" and m["content"] for m in msgs)


@pytest.mark.asyncio
async def test_ask_stream_exhausts_max_steps_then_answers(monkeypatch):
    """轮次耗尽（模型每轮都要工具）：强制收尾直答，绝不卡死——token/done 必达，答案落库。"""
    from sag_api.core.config import settings
    from sag_api.main import app

    monkeypatch.setattr(settings, "agent_max_steps", 2)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        llm = GreedyLLM()
        app.state.llm = llm
        async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=60) as c:
            H, a, th = await _setup(c)
            ask = await c.post(
                f"/api/v1/agents/{a['id']}/threads/{th['id']}/ask",
                headers=H,
                json={"query": "打满轮次", "mode": "agentic"},
            )
            body = ask.text
            assert llm.calls == 2                                   # 决策恰好打满上限，未越界
            assert "event: token" in body and "event: done" in body  # 收尾直答，未烂尾
            assert '"phase": "answering"' in body or "answering" in body  # 收尾阶段可见
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            asst = [m for m in msgs if m["role"] == "assistant"][-1]
            assert asst["content"] == "答案"
            kinds = [s["kind"] for s in asst["steps"]]
            assert kinds.count("thinking") == 2 and "answer" in kinds  # 轨迹完整：2 轮思考 + 收尾
