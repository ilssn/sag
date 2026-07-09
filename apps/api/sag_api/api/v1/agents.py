from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from sag_api.core.db import SessionLocal, get_session
from sag_api.core.deps import (
    get_current_user,
    get_engine_manager,
    get_llm,
    get_tool_registry,
)
from sag_api.core.errors import ApiError
from sag_api.db.models import User
from sag_api.generation import LLMClient
from sag_api.sag import EngineManager
from sag_api.schemas.agent import (
    AgentCreate,
    AgentOut,
    AgentUpdate,
    AskRequest,
    BindingCreate,
    BindingOut,
    MessageOut,
    ThreadCreate,
    ThreadOut,
    ThreadUpdate,
)
from sag_api.schemas.common import Ok
from sag_api.services import agent_domain as svc
from sag_api.services import agent_service
from sag_api.tools import ToolRegistry

router = APIRouter(prefix="/agents", tags=["agents"])


def _sse(event: str, payload: dict) -> dict:
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


# ── CRUD ────────────────────────────────────────────────────────────
@router.get("", response_model=list[AgentOut])
async def list_(
    _user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return [AgentOut.model_validate(a) for a in await svc.list_agents(session)]


@router.post("", response_model=AgentOut, status_code=201)
async def create(
    body: AgentCreate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.create_agent(session, name=body.name, avatar=body.avatar, persona=body.persona)
    return AgentOut.model_validate(agent)


@router.get("/default", response_model=AgentOut)
async def get_default(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """默认 agent（get-or-create）：客户端主对话入口，知识库=全部信源。"""
    return AgentOut.model_validate(await svc.get_default_agent(session))


@router.get("/{agent_id}", response_model=AgentOut)
async def get_(
    agent_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return AgentOut.model_validate(await svc.get_agent(session, agent_id))


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_(
    agent_id: str,
    body: AgentUpdate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.update_agent(
        session, agent_id, name=body.name, avatar=body.avatar, persona=body.persona
    )
    return AgentOut.model_validate(agent)


@router.delete("/{agent_id}", response_model=Ok)
async def delete_(
    agent_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await svc.delete_agent(session, agent_id)
    return Ok(detail="Agent 已删除")


# ── 绑定（信源 / MCP）────────────────────────────────────────────────
@router.get("/{agent_id}/bindings", response_model=list[BindingOut])
async def list_bindings(
    agent_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    return [BindingOut.model_validate(b) for b in await svc.list_bindings(session, agent)]


@router.post("/{agent_id}/bindings", response_model=BindingOut, status_code=201)
async def add_binding(
    agent_id: str,
    body: BindingCreate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    b = await svc.add_binding(
        session, agent, target_type=body.target_type, target_id=body.target_id, config=body.config
    )
    return BindingOut.model_validate(b)


@router.delete("/{agent_id}/bindings/{binding_id}", response_model=Ok)
async def remove_binding(
    agent_id: str,
    binding_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    await svc.remove_binding(session, agent, binding_id)
    return Ok(detail="已解绑")


# ── 会话 ────────────────────────────────────────────────────────────
@router.get("/{agent_id}/threads", response_model=list[ThreadOut])
async def list_threads(
    agent_id: str,
    archived: bool = False,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    return [
        ThreadOut.model_validate(t)
        for t in await svc.list_threads(session, agent.id, archived=archived)
    ]


@router.post("/{agent_id}/threads", response_model=ThreadOut, status_code=201)
async def create_thread(
    agent_id: str,
    body: ThreadCreate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    thread = await svc.create_thread(session, agent, body.title)
    return ThreadOut.model_validate(thread)


@router.patch("/{agent_id}/threads/{thread_id}", response_model=ThreadOut)
async def update_thread(
    agent_id: str,
    thread_id: str,
    body: ThreadUpdate,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    t = await svc.update_thread(
        session, agent.id, thread_id, title=body.title, archived=body.archived
    )
    return ThreadOut.model_validate(t)


@router.get("/{agent_id}/threads/{thread_id}/messages", response_model=list[MessageOut])
async def messages(
    agent_id: str,
    thread_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    thread = await svc.get_thread(session, agent.id, thread_id)
    return [MessageOut.model_validate(m) for m in await svc.list_messages(session, thread.id)]


@router.delete("/{agent_id}/threads/{thread_id}", response_model=Ok)
async def delete_thread(
    agent_id: str,
    thread_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    await svc.delete_thread(session, agent.id, thread_id)
    return Ok(detail="会话已删除")


@router.delete("/{agent_id}/threads/{thread_id}/messages/{message_id}", response_model=Ok)
async def delete_message(
    agent_id: str,
    thread_id: str,
    message_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    agent = await svc.get_agent(session, agent_id)
    await svc.delete_message(session, agent.id, thread_id, message_id)
    return Ok(detail="已删除")


@router.post("/{agent_id}/threads/{thread_id}/ask")
async def ask(
    agent_id: str,
    thread_id: str,
    body: AskRequest,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
    tool_registry: ToolRegistry = Depends(get_tool_registry),
) -> EventSourceResponse:
    agent = await svc.get_agent(session, agent_id)
    thread = await svc.get_thread(session, agent.id, thread_id)

    async def event_gen():
        import time as _time

        # 首轮检索作为第一个可见步骤：SSE 立刻开流，前端时间线实时呈现
        yield _sse("status", {"phase": "retrieving", "step": 0})
        yield _sse(
            "tool", {"name": "search_context", "step": 0, "args": body.query[:60]}
        )
        _t0 = _time.perf_counter()
        try:
            plan = await svc.prepare_ask(
                session,
                agent=agent,
                thread=thread,
                query=body.query,
                engine_manager=engine_manager,
                attachments=body.attachments,
                source_ids=body.source_ids,
                llm=llm,
            )
        except ApiError as e:
            yield _sse("error", {"code": e.code, "message": e.message})
            return
        seed_ms = int((_time.perf_counter() - _t0) * 1000)
        yield _sse(
            "tool_result",
            {"name": "search_context", "step": 0, "ms": seed_ms, "count": plan.section_count},
        )
        if plan.short_circuit is None and not llm.configured:
            yield _sse("error", {"code": "configuration_error", "message": "尚未配置 LLM，无法生成回答"})
            return
        seed_step = {
            "kind": "tool",
            "step": 0,
            "name": "search_context",
            "args": body.query[:60],
            "ms": seed_ms,
            "count": plan.section_count,
        }

        async for name, payload in agent_service.generate_stream(
            SessionLocal,
            plan=plan,
            agentic=body.mode != "fast",
            preface_trace=[seed_step],
            agent=agent,
            thread_id=thread.id,
            engine_manager=engine_manager,
            llm=llm,
            tool_registry=tool_registry,
        ):
            yield _sse(name, payload)

    return EventSourceResponse(event_gen())
