"""Agent 循环 —— 把「问答」从 RAG 单发升级为有界工具调用循环。

设计要点（对齐旧版 SAG 的解耦思路，但用原生 function-calling）：
- 检索不再是写死的必经步骤，而是 `search_context` 工具；对有信源绑定的助手，
  循环开始前**自动播种**一次检索（保住「永远有据」、离线可短路），随后模型可
  按需再调工具（`get_entity`、以及第二阶段的 MCP 工具）。
- 默认（未开启额外工具）行为与旧版**逐字节一致**：meta → 流式 token → done，
  短路与未配置分支不变。额外工具仅在 `persona.tools` 开启时进入循环。
- 最终答案始终走 `llm.stream()` 流式；工具「决策」步走 `llm.chat(tools=)` 非流式。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import async_sessionmaker

from zleap_api.core.errors import MuseError
from zleap_api.core.logging import get_logger
from zleap_api.generation import LLMClient, build_prompt_preview
from zleap_api.sag import EngineManager
from zleap_api.services.soul_service import (
    AskPlan,
    persist_answer,
    remember_exchange,
    resolve_sources,
)
from zleap_api.tools import ToolContext, ToolRegistry

log = get_logger("agent")

# 工具循环最大步数（防跑飞）；测试可 monkeypatch 缩短
AGENT_MAX_STEPS = 4

AgentEvent = tuple[str, dict]


def _enabled_tool_names(soul) -> list[str]:
    """助手显式开启的额外工具名（persona.tools）。默认空 → 不进循环，行为同旧版。"""
    persona = soul.persona or {}
    names = persona.get("tools")
    return [n for n in names if isinstance(n, str)] if isinstance(names, list) else []


async def _run_tool_loop(
    *,
    soul,
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
        sources = await resolve_sources(s, soul)
    ctx = ToolContext(
        engine_manager=engine_manager, sources=sources, persona=soul.persona or {}, soul=soul
    )
    schemas = tool_registry.schemas(tool_names)
    if not schemas:
        return
    for _step in range(AGENT_MAX_STEPS):
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
            yield ("tool", {"name": call.name})
            if not tool_registry.has(call.name):
                content = f"未知工具：{call.name}"
            else:
                try:
                    result = await tool_registry.get(call.name).invoke(call.arguments, ctx)
                    content = result.content
                    citations.extend(result.citations)
                except Exception as e:  # noqa: BLE001
                    log.warning("工具执行失败 %s: %s", call.name, e)
                    content = f"工具执行失败：{e}"
            messages.append({"role": "tool", "tool_call_id": call.id, "content": content})


async def generate_stream(
    session_factory: async_sessionmaker,
    job_queue,
    *,
    plan: AskPlan,
    soul,
    thread_id: str | None,
    query: str,
    engine_manager: EngineManager,
    llm: LLMClient,
    tool_registry: ToolRegistry,
    upload_dir: str,
) -> AsyncIterator[AgentEvent]:
    """驱动一次问答，产出事件流：meta → (tool)* → token* → done / error。

    `thread_id` 为 None 时（如 OpenAI 无状态端点）跳过落库与记忆闭环。
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

    tool_names = _enabled_tool_names(soul)
    if tool_names and llm.configured:
        async for ev in _run_tool_loop(
            soul=soul,
            messages=messages,
            citations=citations,
            tool_names=tool_names,
            engine_manager=engine_manager,
            llm=llm,
            tool_registry=tool_registry,
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
    except MuseError as e:
        yield ("error", {"code": e.code, "message": e.message})
        return

    answer = "".join(acc)
    mid = None
    if thread_id is not None:
        mid = await persist_answer(session_factory, thread_id, answer, citations)
        await remember_exchange(
            session_factory,
            job_queue,
            soul_id=soul.id,
            thread_id=thread_id,
            question=query,
            answer=answer,
            upload_dir=upload_dir,
        )
    yield ("done", {"message_id": mid})
