"""/ask SSE full path: model turns, tools, terminal errors, and persistence."""

import asyncio

import httpx
import pytest

from sag_agent import Agent, AgentTool, EventType, ModelChunk, RunStatus, ToolCall, ToolResult, ToolSpec
from sag_api.core.errors import UpstreamError


class AgenticLLM:
    """一轮工具调用后收尾。"""

    def __init__(self):
        self.calls = 0

    @property
    def configured(self):
        return True

    async def stream_turn(self, request, cancellation):
        self.calls += 1
        if self.calls == 1:
            yield ModelChunk(
                tool_calls=(ToolCall(id="c1", name="search_context", arguments={"query": "改写"}),),
                finish_reason="tool_calls",
            )
            return
        for token in ["答", "案"]:
            cancellation.raise_if_cancelled()
            yield ModelChunk(text_delta=token)
        yield ModelChunk(finish_reason="stop")

    async def complete(self, messages):
        return "摘要"


class BrokenProviderLLM(AgenticLLM):
    """Provider failure must become a visible terminal error."""

    async def stream_turn(self, request, cancellation):
        raise UpstreamError("tools not supported")
        yield  # pragma: no cover


class GreedyLLM(AgenticLLM):
    """每轮都要求调用工具 → 必然打满 agent_max_steps（复现「卡在第 N 轮」场景）。"""

    def __init__(self):
        super().__init__()
        self.tool_turns = 0

    async def stream_turn(self, request, cancellation):
        self.calls += 1
        if not request.tools:
            for token in ["答", "案"]:
                yield ModelChunk(text_delta=token)
            return
        self.tool_turns += 1
        yield ModelChunk(
            tool_calls=(
                ToolCall(
                    id=f"c{self.tool_turns}",
                    name="search_context",
                    arguments={"query": f"第{self.tool_turns}轮"},
                ),
            ),
            finish_reason="tool_calls",
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
                json={"query": "深度测试"},
            )
            body = ask.text
            assert ask.status_code == 200
            for marker in [
                "event: run.started",
                "event: turn.started",
                "event: tool.started",
                "event: tool.completed",
                "event: message.delta",
                "event: run.completed",
            ]:
                assert marker in body, marker
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            asst = [m for m in msgs if m["role"] == "assistant"][-1]
            kinds = [s["kind"] for s in asst["steps"]]
            assert "tool" in kinds and "thinking" in kinds and "answer" in kinds  # 全程轨迹落库
            assert asst["steps"][0] == {**asst["steps"][0], "kind": "thinking", "step": 1}  # 无预置检索
            tool_step = next(step for step in asst["steps"] if step["kind"] == "tool")
            assert tool_step["arguments"] == {"query": "改写"}
            assert "details" in tool_step


@pytest.mark.asyncio
async def test_ask_stream_provider_failure_has_terminal_error():
    """Provider failures remain explicit instead of silently changing protocols."""
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        app.state.llm = BrokenProviderLLM()
        async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=60) as c:
            H, a, th = await _setup(c)
            ask = await c.post(
                f"/api/v1/agents/{a['id']}/threads/{th['id']}/ask",
                headers=H,
                json={"query": "容错"},
            )
            body = ask.text
            assert "event: run.failed" in body
            assert "event: run.completed" not in body
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            assert not any(m["role"] == "assistant" for m in msgs)


@pytest.mark.asyncio
async def test_ask_stream_exhausts_max_steps_then_answers(monkeypatch):
    """轮次耗尽（模型每轮都要工具）：强制收尾直答且终态必达。"""
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
                json={"query": "打满轮次"},
            )
            body = ask.text
            assert llm.tool_turns == 2                              # 工具轮恰好打满上限
            assert llm.calls == 3                                   # 2 工具轮 + 1 强制收尾轮
            assert "event: message.delta" in body and "event: run.completed" in body
            assert '"forced_final": true' in body
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            asst = [m for m in msgs if m["role"] == "assistant"][-1]
            assert asst["content"] == "答案"
            kinds = [s["kind"] for s in asst["steps"]]
            assert kinds.count("thinking") == 2 and "answer" in kinds  # 轨迹完整：2 轮思考 + 收尾


@pytest.mark.asyncio
async def test_ask_stream_greeting_skips_tools():
    """agent-first：模型判定无需检索（寒暄）→ 零工具调用直答，不再「打个招呼也 RAG」。"""
    from sag_api.main import app

    class DirectLLM(AgenticLLM):
        async def stream_turn(self, request, cancellation):
            self.calls += 1
            yield ModelChunk(text_delta="你好呀", finish_reason="stop")

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        llm = DirectLLM()
        app.state.llm = llm
        async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=60) as c:
            H, a, th = await _setup(c)
            ask = await c.post(
                f"/api/v1/agents/{a['id']}/threads/{th['id']}/ask",
                headers=H,
                json={"query": "你好"},
            )
            body = ask.text
            assert llm.calls == 1                       # 一轮决策即收
            assert "event: tool.started" not in body
            assert "event: message.delta" in body and "event: run.completed" in body
            msgs = (
                await c.get(f"/api/v1/agents/{a['id']}/threads/{th['id']}/messages", headers=H)
            ).json()
            asst = [m for m in msgs if m["role"] == "assistant"][-1]
            assert asst["content"] == "你好呀"
            kinds = [x["kind"] for x in asst["steps"]]
            assert kinds == ["answer"]  # 同一个模型 turn 直接产出答案，不再重复计一次 thinking


@pytest.mark.asyncio
async def test_cancel_endpoint_cancels_owned_active_run():
    from sag_api.main import app

    started = asyncio.Event()

    class BlockingModel:
        async def stream_turn(self, request, cancellation):
            started.set()
            await cancellation.wait()
            cancellation.raise_if_cancelled()
            if False:
                yield ModelChunk()

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            headers, agent, thread = await _setup(client)
            handle = app.state.agent_runtime.run(
                Agent(
                    name="blocking",
                    model=BlockingModel(),
                    metadata={"agent_id": agent["id"]},
                ),
                "wait",
                metadata={"thread_id": thread["id"]},
            )
            await started.wait()
            response = await client.post(
                f"/api/v1/agents/{agent['id']}/threads/{thread['id']}/runs/{handle.run_id}/cancel",
                headers=headers,
            )
            events = [event async for event in handle]
            result = await handle.result()

    assert response.status_code == 200
    assert result.status == RunStatus.CANCELLED
    assert events[-1].type.value == "run.cancelled"


@pytest.mark.asyncio
async def test_approve_endpoint_resumes_owned_tool_call():
    from sag_api.main import app

    waiting = asyncio.Event()

    class ApprovalModel:
        def __init__(self):
            self.turn = 0

        async def stream_turn(self, request, cancellation):
            self.turn += 1
            if self.turn == 1:
                yield ModelChunk(tool_calls=(ToolCall(id="write-1", name="write"),))
            else:
                yield ModelChunk(text_delta="approved")

    async def execute(arguments, context):
        return ToolResult(content="written")

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            headers, agent, thread = await _setup(client)

            def observe(event):
                if event.type == EventType.TOOL_APPROVAL_REQUIRED:
                    waiting.set()

            unsubscribe = app.state.agent_runtime.subscribe(observe)
            handle = app.state.agent_runtime.run(
                Agent(
                    name="approval",
                    model=ApprovalModel(),
                    tools=(
                        AgentTool(
                            ToolSpec(name="write", description="Write", requires_approval=True),
                            execute,
                        ),
                    ),
                    metadata={"agent_id": agent["id"]},
                ),
                "write",
                metadata={"thread_id": thread["id"]},
            )
            await waiting.wait()
            response = await client.post(
                f"/api/v1/agents/{agent['id']}/threads/{thread['id']}/runs/{handle.run_id}"
                "/tool-calls/write-1/approve",
                headers=headers,
            )
            events = [event async for event in handle]
            result = await handle.result()
            unsubscribe()

    assert response.status_code == 200
    assert result.status == RunStatus.COMPLETED
    assert result.output == "approved"
    assert any(event.type == EventType.TOOL_COMPLETED for event in events)
