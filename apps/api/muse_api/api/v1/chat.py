from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from muse_api.core.db import SessionLocal, get_session
from muse_api.core.deps import get_engine_manager, get_llm, get_workspace_id
from muse_api.core.errors import ConfigurationError, MuseError
from muse_api.db.models import User
from muse_api.core.deps import get_current_user
from muse_api.generation import LLMClient
from muse_api.sag import EngineManager
from muse_api.schemas.chat import AskRequest, MessageOut, ThreadCreate, ThreadOut
from muse_api.schemas.common import Ok
from muse_api.services.chat_service import (
    create_thread,
    delete_thread,
    get_thread,
    list_messages,
    list_threads,
    persist_answer,
    prepare_ask,
)
from muse_api.services.source_service import get_source

router = APIRouter(prefix="/sources/{source_id}/threads", tags=["chat"])


def _sse(event: str, payload: dict) -> dict:
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


@router.get("", response_model=list[ThreadOut])
async def list_(
    source_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[ThreadOut]:
    source = await get_source(session, workspace_id, source_id)
    return [ThreadOut.model_validate(t) for t in await list_threads(session, source.id)]


@router.post("", response_model=ThreadOut, status_code=201)
async def create(
    source_id: str,
    body: ThreadCreate,
    user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> ThreadOut:
    source = await get_source(session, workspace_id, source_id)
    thread = await create_thread(session, source, user.id, body.title)
    return ThreadOut.model_validate(thread)


@router.get("/{thread_id}/messages", response_model=list[MessageOut])
async def messages(
    source_id: str,
    thread_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    source = await get_source(session, workspace_id, source_id)
    thread = await get_thread(session, source.id, thread_id)
    return [MessageOut.model_validate(m) for m in await list_messages(session, thread.id)]


@router.delete("/{thread_id}", response_model=Ok)
async def delete_(
    source_id: str,
    thread_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> Ok:
    source = await get_source(session, workspace_id, source_id)
    await delete_thread(session, source.id, thread_id)
    return Ok(detail="会话已删除")


@router.post("/{thread_id}/ask")
async def ask(
    source_id: str,
    thread_id: str,
    body: AskRequest,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
) -> EventSourceResponse:
    source = await get_source(session, workspace_id, source_id)
    thread = await get_thread(session, source.id, thread_id)
    if not llm.configured:
        raise ConfigurationError("尚未配置 LLM，无法生成回答")

    messages, citations = await prepare_ask(
        session,
        source=source,
        thread=thread,
        query=body.query,
        engine_manager=engine_manager,
        strategy=body.strategy,
        top_k=body.top_k,
    )
    thread_id_val = thread.id

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
        message_id = await persist_answer(SessionLocal, thread_id_val, answer, citations)
        yield _sse("done", {"message_id": message_id})

    return EventSourceResponse(event_gen())
