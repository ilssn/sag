from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from zleap_api.core.config import settings
from zleap_api.core.db import SessionLocal, get_session
from zleap_api.core.deps import (
    get_current_user,
    get_engine_manager,
    get_job_queue,
    get_llm,
    get_workspace_id,
    get_workspace_role,
    require_editor,
)
from zleap_api.core.errors import ConfigurationError, MuseError
from zleap_api.db.models import User
from zleap_api.enums import AuditAction, WorkspaceRole
from zleap_api.generation import LLMClient
from zleap_api.jobs import JobQueue
from zleap_api.sag import EngineManager
from zleap_api.schemas.common import Ok
from zleap_api.schemas.soul import (
    BindingCreate,
    BindingOut,
    SoulAskRequest,
    SoulCreate,
    SoulMessageOut,
    SoulOut,
    SoulThreadCreate,
    SoulThreadOut,
    SoulUpdate,
)
from zleap_api.services import audit_service
from zleap_api.services import soul_service as svc

router = APIRouter(prefix="/souls", tags=["souls"])


def _sse(event: str, payload: dict) -> dict:
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


# ── CRUD ────────────────────────────────────────────────────────────
@router.get("", response_model=list[SoulOut])
async def list_(
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    souls = await svc.list_souls(session, ws, user_id=user.id, role=role)
    return [SoulOut.model_validate(s) for s in souls]


@router.post("", response_model=SoulOut, status_code=201)
async def create(
    body: SoulCreate,
    request: Request,
    ws: str = Depends(get_workspace_id),
    user: User = Depends(get_current_user),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.create_soul(
        session,
        ws,
        name=body.name,
        owner_id=user.id,
        avatar=body.avatar,
        persona=body.persona,
        visibility=body.visibility,
    )
    out = SoulOut.model_validate(soul)
    await audit_service.record_request(
        request,
        AuditAction.SOUL_CREATE,
        target_type="soul",
        target_id=soul.id,
        target_label=soul.name,
        meta={"visibility": str(soul.visibility)},
    )
    return out


@router.get("/{soul_id}", response_model=SoulOut)
async def get_(
    soul_id: str,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    return SoulOut.model_validate(soul)


@router.patch("/{soul_id}", response_model=SoulOut)
async def update_(
    soul_id: str,
    body: SoulUpdate,
    request: Request,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
):
    before = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    prev_visibility = before.visibility
    soul = await svc.update_soul(
        session,
        ws,
        soul_id,
        user_id=user.id,
        role=role,
        name=body.name,
        avatar=body.avatar,
        persona=body.persona,
        visibility=body.visibility,
    )
    out = SoulOut.model_validate(soul)
    # 可见性变化是团队安全相关事件，单独审计
    if body.visibility is not None and body.visibility != prev_visibility:
        await audit_service.record_request(
            request,
            AuditAction.SOUL_VISIBILITY,
            target_type="soul",
            target_id=soul.id,
            target_label=soul.name,
            meta={"from": str(prev_visibility), "to": str(soul.visibility)},
        )
    return out


@router.delete("/{soul_id}", response_model=Ok)
async def delete_(
    soul_id: str,
    request: Request,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
):
    before = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    label = before.name
    await svc.delete_soul(session, ws, soul_id, user_id=user.id, role=role)
    await audit_service.record_request(
        request,
        AuditAction.SOUL_DELETE,
        target_type="soul",
        target_id=soul_id,
        target_label=label,
    )
    return Ok(detail="助手已删除")


# ── 绑定 ────────────────────────────────────────────────────────────
@router.get("/{soul_id}/bindings", response_model=list[BindingOut])
async def list_bindings(
    soul_id: str,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    return [BindingOut.model_validate(b) for b in await svc.list_bindings(session, soul)]


@router.post("/{soul_id}/bindings", response_model=BindingOut, status_code=201)
async def add_binding(
    soul_id: str,
    body: BindingCreate,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    svc.ensure_manageable(soul, user.id, role)
    b = await svc.add_binding(session, ws, soul, target_type=body.target_type, target_id=body.target_id)
    return BindingOut.model_validate(b)


@router.delete("/{soul_id}/bindings/{binding_id}", response_model=Ok)
async def remove_binding(
    soul_id: str,
    binding_id: str,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    svc.ensure_manageable(soul, user.id, role)
    await svc.remove_binding(session, soul, binding_id)
    return Ok(detail="已解绑")


# ── 会话（按人隔离）──────────────────────────────────────────────────
@router.get("/{soul_id}/threads", response_model=list[SoulThreadOut])
async def list_threads(
    soul_id: str,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    threads = await svc.list_threads(session, soul.id, user_id=user.id)
    return [SoulThreadOut.model_validate(t) for t in threads]


@router.post("/{soul_id}/threads", response_model=SoulThreadOut, status_code=201)
async def create_thread(
    soul_id: str,
    body: SoulThreadCreate,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    thread = await svc.create_thread(session, soul, user.id, body.title)
    return SoulThreadOut.model_validate(thread)


@router.get("/{soul_id}/threads/{thread_id}/messages", response_model=list[SoulMessageOut])
async def messages(
    soul_id: str,
    thread_id: str,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    thread = await svc.get_thread(session, soul.id, thread_id, user_id=user.id)
    return [SoulMessageOut.model_validate(m) for m in await svc.list_messages(session, thread.id)]


@router.delete("/{soul_id}/threads/{thread_id}", response_model=Ok)
async def delete_thread(
    soul_id: str,
    thread_id: str,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    await svc.delete_thread(session, soul.id, thread_id, user_id=user.id)
    return Ok(detail="会话已删除")


@router.post("/{soul_id}/threads/{thread_id}/ask")
async def ask(
    soul_id: str,
    thread_id: str,
    body: SoulAskRequest,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
    job_queue: JobQueue = Depends(get_job_queue),
) -> EventSourceResponse:
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    thread = await svc.get_thread(session, soul.id, thread_id, user_id=user.id)
    if not llm.configured:
        raise ConfigurationError("尚未配置 LLM，无法生成回答")

    messages, citations = await svc.prepare_ask(
        session,
        soul=soul,
        thread=thread,
        query=body.query,
        engine_manager=engine_manager,
        author=body.author or user.name,
    )
    thread_id_val = thread.id
    question = body.query

    async def event_gen():
        yield _sse("meta", {"citations": citations})
        acc: list[str] = []
        try:
            async for token in llm.stream(messages):
                acc.append(token)
                yield _sse("token", {"text": token})
        except MuseError as e:
            yield _sse("error", {"code": e.code, "message": e.message})
            return
        answer = "".join(acc)
        message_id = await svc.persist_answer(SessionLocal, thread_id_val, answer, citations)
        # 记忆闭环：共享助手 = 团队共享记忆；私有助手 = 个人记忆
        await svc.remember_exchange(
            SessionLocal,
            job_queue,
            soul_id=soul_id,
            thread_id=thread_id_val,
            question=question,
            answer=answer,
            upload_dir=settings.upload_dir,
        )
        yield _sse("done", {"message_id": message_id})

    return EventSourceResponse(event_gen())
