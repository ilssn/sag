"""Agent 循环 —— 把「问答」从 RAG 单发升级为有界工具调用循环。

设计要点（对齐旧版 SAG 的解耦思路，但用原生 function-calling）：
- 检索不再是写死的必经步骤，而是工具（内置 `search_context` 或经 MCP 的 `search`）。
  默认（未开启额外工具）行为：meta → 流式 token → done。额外工具在 `persona.tools`
  开启时进入循环；最终答案始终走 `llm.stream()`，工具「决策」步走 `llm.chat(tools=)`。
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import async_sessionmaker

from sag_api.core.errors import ApiError
from sag_api.core.logging import get_logger
from sag_api.generation import LLMClient, build_prompt_preview
from sag_api.sag import EngineManager
from sag_api.services.agent_domain import (
    AskPlan,
    persist_answer,
    resolve_mcp_specs,
    resolve_sources,
)
from sag_api.tools import ToolContext, ToolRegistry
from sag_api.tools.mcp import open_agent_mcp_tools

log = get_logger("agent")

# 兜底步数（正常取 settings.agent_max_steps）；测试可 monkeypatch
AGENT_MAX_STEPS = 4

AgentEvent = tuple[str, dict]


def _args_preview(arguments: dict, limit: int = 60) -> str:
    """工具参数的单行预览（前端状态展示用）。"""
    try:
        text = "; ".join(f"{k}={v}" for k, v in arguments.items() if v is not None)
    except Exception:  # noqa: BLE001
        text = str(arguments)
    return text[:limit] + ("…" if len(text) > limit else "")


_DEFAULT_TOOLS = ["search_context", "get_entity"]


def _enabled_tool_names(agent) -> list[str]:
    """启用的工具：persona.tools 显式配置优先；默认 agent 缺省即开启内置检索/实体
    ——agentic 多轮检索是主对话的基础能力，无需用户配置。"""
    persona = agent.persona or {}
    names = persona.get("tools")
    if isinstance(names, list):
        return [n for n in names if isinstance(n, str)]
    if getattr(agent, "is_default", False):
        return list(_DEFAULT_TOOLS)
    return []


async def _run_tool_loop(
    *,
    agent,
    messages: list[dict],
    citations: list[dict],
    tool_names: list[str],
    engine_manager: EngineManager,
    llm: LLMClient,
    tool_registry: ToolRegistry,
    session_factory: async_sessionmaker,
) -> AsyncIterator[AgentEvent]:
    """就地驱动工具循环，改写 messages/citations，并 yield 透明化的 tool 事件。"""
    async with session_factory() as s:
        sources = await resolve_sources(s, agent)
    ctx = ToolContext(
        engine_manager=engine_manager, sources=sources, persona=agent.persona or {}, agent=agent
    )
    schemas = tool_registry.schemas(tool_names)
    if not schemas:
        return
    from sag_api.core.config import settings as _settings

    max_steps = max(1, getattr(_settings, "agent_max_steps", AGENT_MAX_STEPS))
    for _step in range(max_steps):
        yield ("status", {"phase": "thinking", "step": _step + 1})
        turn = await llm.chat(messages, tools=schemas)
        if not turn.tool_calls:
            break
        messages.append(
            {
                "role": "assistant",
                "content": turn.content or "",
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.name, "arguments": json.dumps(c.arguments, ensure_ascii=False)},
                    }
                    for c in turn.tool_calls
                ],
            }
        )
        for call in turn.tool_calls:
            args_preview = _args_preview(call.arguments)
            yield ("tool", {"name": call.name, "step": _step + 1, "args": args_preview})
            started = time.perf_counter()
            count = 0
            if not tool_registry.has(call.name):
                content = f"未知工具：{call.name}"
            else:
                try:
                    ctx.citation_offset = len(citations)
                    result = await tool_registry.get(call.name).invoke(call.arguments, ctx)
                    content = result.content
                    citations.extend(result.citations)
                    count = int(result.data.get("section_count") or len(result.citations) or 0)
                except Exception as e:  # noqa: BLE001
                    log.warning("工具执行失败 %s: %s", call.name, e)
                    content = f"工具执行失败：{e}"
            yield (
                "tool_result",
                {
                    "name": call.name,
                    "step": _step + 1,
                    "ms": int((time.perf_counter() - started) * 1000),
                    "count": count,
                },
            )
            messages.append({"role": "tool", "tool_call_id": call.id, "content": content})


async def generate_stream(
    session_factory: async_sessionmaker,
    *,
    plan: AskPlan,
    agent,
    thread_id: str | None,
    engine_manager: EngineManager,
    llm: LLMClient,
    tool_registry: ToolRegistry,
    agentic: bool = True,
) -> AsyncIterator[AgentEvent]:
    """驱动一次问答，产出事件流：meta → (status/tool/tool_result)* → token* → done / error。

    `agentic=False`（快速模式）跳过工具循环：仅用首轮检索种子直答，低延迟。

    `thread_id` 为 None 时（如 OpenAI 无状态端点）跳过落库。
    """
    # 防幻觉短路：检索为空且配置了兜底话术 → 不调用 LLM
    if plan.short_circuit is not None:
        yield ("meta", {"citations": plan.citations, "prompt_preview": plan.prompt_preview})
        yield ("token", {"text": plan.short_circuit})
        mid = None
        if thread_id is not None:
            mid = await persist_answer(session_factory, thread_id, plan.short_circuit, plan.citations)
        yield ("done", {"message_id": mid})
        return

    messages = [dict(m) for m in plan.messages]
    citations = list(plan.citations)
    preview = plan.prompt_preview

    tool_names = _enabled_tool_names(agent) if agentic else []
    mcp_specs: list = []
    if agentic:
        async with session_factory() as s:
            mcp_specs = await resolve_mcp_specs(s, agent)
    if (tool_names or mcp_specs) and llm.configured:
        # 外部 MCP 连接在整个工具循环期间保持打开，循环结束即断开
        async with open_agent_mcp_tools(mcp_specs) as mcp_tools:
            loop_registry = tool_registry.overlay(mcp_tools) if mcp_tools else tool_registry
            loop_names = [*tool_names, *(t.meta.name for t in mcp_tools)]
            async for ev in _run_tool_loop(
                agent=agent,
                messages=messages,
                citations=citations,
                tool_names=loop_names,
                engine_manager=engine_manager,
                llm=llm,
                tool_registry=loop_registry,
                session_factory=session_factory,
            ):
                yield ev
        preview = build_prompt_preview(messages)

    yield ("meta", {"citations": citations, "prompt_preview": preview})

    acc: list[str] = []
    try:
        async for token in llm.stream(messages):
            acc.append(token)
            yield ("token", {"text": token})
    except ApiError as e:
        yield ("error", {"code": e.code, "message": e.message})
        return

    answer = "".join(acc)
    mid = None
    if thread_id is not None:
        mid = await persist_answer(session_factory, thread_id, answer, citations)
    yield ("done", {"message_id": mid})
