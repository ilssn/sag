"""Host adapters connecting SAG Agent Core to the knowledge application."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker

from sag_agent import (
    Agent as RuntimeAgent,
)
from sag_agent import (
    AgentEvent as RuntimeEvent,
)
from sag_agent import (
    AgentRuntime,
    AgentTool,
    EventType,
    ToolExecutionMode,
    ToolRisk,
    ToolSpec,
)
from sag_agent import (
    ToolResult as RuntimeToolResult,
)
from sag_api.generation import LLMClient, build_prompt_preview
from sag_api.sag import EngineManager
from sag_api.services.agent_domain import (
    AskPlan,
    persist_answer,
    resolve_mcp_specs,
    resolve_sources,
)
from sag_api.tools import ToolContext as HostToolContext
from sag_api.tools import ToolRegistry
from sag_api.tools.mcp import open_agent_mcp_tools

AGENT_MAX_STEPS = 4

_DEFAULT_TOOLS = ["search_context", "get_entity"]
_TOOL_LABELS = {
    "search_context": "检索知识库",
    "get_entity": "查询实体",
}


@dataclass(frozen=True, slots=True)
class AgentStreamEvent:
    """Versioned runtime event ready for an HTTP/WebSocket transport."""

    type: str
    data: dict[str, Any]


def _enabled_tool_names(agent, *, has_sources: bool = False) -> list[str]:
    persona = agent.persona or {}
    names = persona.get("tools")
    configured = [name for name in names if isinstance(name, str)] if isinstance(names, list) else []
    # 检索是信源挂载带来的基础能力，不应依赖 persona 中是否碰巧保存了 tools 字段。
    builtins = _DEFAULT_TOOLS if has_sources or getattr(agent, "is_default", False) else []
    return list(dict.fromkeys([*builtins, *configured]))


def _adapt_tool(host_tool, host_context: HostToolContext, citations: list[dict]) -> AgentTool:
    async def execute(
        arguments: Mapping[str, Any],
        context,
    ) -> RuntimeToolResult:
        context.cancellation.raise_if_cancelled()
        host_context.citation_offset = len(citations)
        result = await host_tool.invoke(dict(arguments), host_context)
        citations.extend(result.citations)
        count = int(result.data.get("section_count") or len(result.citations) or 0)
        matches = [
            {
                key: citation.get(key)
                for key in (
                    "n",
                    "chunk_id",
                    "heading",
                    "snippet",
                    "score",
                    "source_id",
                    "source_name",
                )
            }
            for citation in result.citations[:6]
        ]
        details: dict[str, Any] = {
            "count": count,
            "sources": [{"id": source.id, "name": source.name} for source in host_context.sources],
        }
        if matches:
            details["matches"] = matches
        elif result.content:
            details["output_preview"] = result.content[:800]
        return RuntimeToolResult(
            content=result.content,
            details=details,
            artifacts={"citations": result.citations},
        )

    name = host_tool.meta.name
    return AgentTool(
        spec=ToolSpec(
            name=name,
            label=_TOOL_LABELS.get(name, name),
            description=host_tool.meta.description,
            parameters=host_tool.meta.parameters,
            risk=ToolRisk.READ_ONLY,
            # Citation numbering currently depends on source-order execution.
            execution_mode=ToolExecutionMode.SEQUENTIAL,
        ),
        executor=execute,
    )


def _prompt_preview(handle) -> str:
    return build_prompt_preview([message.to_model_dict() for message in handle.context.messages])


def _stream_event(event: RuntimeEvent, *, payload: Mapping[str, Any] | None = None) -> AgentStreamEvent:
    data = event.to_dict()
    if payload is not None:
        data["payload"] = dict(payload)
    return AgentStreamEvent(type=event.type.value, data=data)


async def generate_stream(
    session_factory: async_sessionmaker,
    *,
    plan: AskPlan,
    agent,
    thread_id: str | None,
    engine_manager: EngineManager,
    llm: LLMClient,
    tool_registry: ToolRegistry,
    runtime: AgentRuntime | None = None,
) -> AsyncIterator[AgentStreamEvent]:
    """Run one request and expose the SDK event contract to the host transport."""

    from sag_api.core.config import settings

    owns_runtime = runtime is None
    active_runtime = runtime or AgentRuntime()
    if owns_runtime:
        await active_runtime.start()

    citations = list(plan.citations)
    trace: list[dict] = []
    tool_inputs: dict[str, dict[str, Any]] = {}
    handle = None
    terminal = False

    async with session_factory() as session:
        sources = await resolve_sources(session, agent, plan.source_ids)
        mcp_specs = await resolve_mcp_specs(session, agent)
    host_context = HostToolContext(
        engine_manager=engine_manager,
        sources=sources,
        persona=agent.persona or {},
        agent=agent,
    )

    try:
        async with open_agent_mcp_tools(mcp_specs) as mcp_tools:
            names = _enabled_tool_names(agent, has_sources=bool(sources))
            host_tools = [tool_registry.get(name) for name in names if tool_registry.has(name)]
            host_tools.extend(mcp_tools)
            tools = tuple(_adapt_tool(tool, host_context, citations) for tool in host_tools)
            run_messages = list(plan.messages)
            if plan.source_ids and sources:
                scope_note = {
                    "role": "system",
                    "content": (
                        "用户已通过 @ 将本轮知识范围限定为："
                        + "、".join(source.name for source in sources)
                        + "。问题涉及资料时必须先调用 search_context，并只依据返回证据作答。"
                    ),
                }
                run_messages.insert(1 if run_messages and run_messages[0].get("role") == "system" else 0, scope_note)
            max_turns = max(1, int(getattr(settings, "agent_max_steps", AGENT_MAX_STEPS)))
            definition = RuntimeAgent(
                name=agent.name,
                model=llm,
                tools=tools,
                max_turns=max_turns,
                finalize_on_max_turns=True,
                metadata={"agent_id": agent.id},
            )
            handle = active_runtime.run(
                definition,
                history=run_messages,
                context=host_context,
                metadata={
                    "thread_id": thread_id,
                    "source_ids": [source.id for source in sources],
                    "source_names": [source.name for source in sources],
                },
            )

            async for event in handle:
                payload = event.payload
                output_payload: Mapping[str, Any] = payload

                if event.type == EventType.RUN_STARTED:
                    output_payload = {
                        **payload,
                        "citations": citations,
                        "sources": [{"id": source.id, "name": source.name} for source in sources],
                        "tools": [tool.spec.name for tool in tools],
                    }
                elif event.type in (
                    EventType.TOOL_APPROVAL_REQUIRED,
                    EventType.TOOL_STARTED,
                ):
                    tool_inputs[str(payload.get("tool_call_id") or "")] = {
                        "label": payload.get("label") or payload.get("name"),
                        "arguments": dict(payload.get("arguments") or {}),
                    }
                elif event.type == EventType.TOOL_COMPLETED:
                    details = payload.get("details") or {}
                    tool_call_id = str(payload.get("tool_call_id") or "")
                    started = tool_inputs.pop(tool_call_id, {})
                    trace.append(
                        {
                            "kind": "tool",
                            "step": event.turn,
                            "name": payload["name"],
                            "label": started.get("label") or payload.get("name"),
                            "arguments": started.get("arguments") or {},
                            "ms": payload.get("duration_ms", 0),
                            "count": details.get("count", 0),
                            "details": details,
                        }
                    )
                elif event.type == EventType.TOOL_FAILED:
                    error = payload.get("error") or {}
                    tool_call_id = str(payload.get("tool_call_id") or "")
                    started = tool_inputs.pop(tool_call_id, {})
                    trace.append(
                        {
                            "kind": "tool",
                            "step": event.turn,
                            "name": payload["name"],
                            "label": started.get("label") or payload.get("label") or payload.get("name"),
                            "arguments": started.get("arguments") or {},
                            "ms": payload.get("duration_ms", 0),
                            "count": 0,
                            "error": error.get("message", "工具执行失败"),
                        }
                    )
                elif (
                    event.type == EventType.MESSAGE_COMPLETED
                    and payload.get("message", {}).get("role") == "assistant"
                ):
                    duration = int(payload.get("duration_ms") or 0)
                    if payload.get("has_tool_calls"):
                        trace.append({"kind": "thinking", "step": event.turn, "ms": duration})
                    else:
                        trace.append({"kind": "answer", "step": event.turn, "ms": duration})
                elif event.type == EventType.RUN_COMPLETED:
                    message_id = None
                    if thread_id is not None:
                        message_id = await persist_answer(
                            session_factory,
                            thread_id,
                            str(payload.get("output") or ""),
                            citations,
                            steps=trace,
                        )
                    output_payload = {
                        **payload,
                        "message_id": message_id,
                        "citations": citations,
                        "prompt_preview": _prompt_preview(handle),
                    }
                    terminal = True
                elif event.type in (EventType.RUN_FAILED, EventType.RUN_CANCELLED):
                    terminal = True

                yield _stream_event(event, payload=output_payload)
    finally:
        if handle is not None and not terminal and not handle.done:
            handle.cancel()
            await handle.result()
        if owns_runtime:
            await active_runtime.stop()
