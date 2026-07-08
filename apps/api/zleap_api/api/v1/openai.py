"""OpenAI 兼容对话端点——把任意 zleap 助手当作一个「带记忆与引用的模型」调用。

    POST /api/v1/openai/{soul_id}/chat/completions
    Authorization: Bearer <zleap JWT>

支持 stream / 非流两种；请求体沿用 OpenAI Chat Completions 结构。
检索、人格注入、防幻觉短路与站内对话完全一致，便于外部系统无缝接入。
"""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import (
    get_current_user,
    get_engine_manager,
    get_llm,
    get_workspace_id,
    get_workspace_role,
)
from zleap_api.core.errors import ConfigurationError, ValidationError
from zleap_api.db.models import User
from zleap_api.enums import WorkspaceRole
from zleap_api.generation import LLMClient
from zleap_api.sag import EngineManager
from zleap_api.services import soul_service as svc

router = APIRouter(prefix="/openai", tags=["openai"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    model: str | None = None
    stream: bool = False
    # 兼容字段，接收但不强制透传（检索参数以助手人格为准）
    temperature: float | None = None
    max_tokens: int | None = None


def _split_query(messages: list[ChatMessage]) -> tuple[str, list[dict[str, str]]]:
    """取最后一条 user 消息为本轮问题，其余 user/assistant 作为历史。"""
    last_user = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].role == "user"), None)
    if last_user is None:
        raise ValidationError("messages 中缺少 user 消息")
    query = messages[last_user].content
    history = [
        {"role": m.role, "content": m.content}
        for idx, m in enumerate(messages)
        if idx != last_user and m.role in ("user", "assistant")
    ]
    return query, history


@router.post("/{soul_id}/chat/completions")
async def chat_completions(
    soul_id: str,
    body: ChatCompletionRequest,
    ws: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
):
    soul = await svc.get_soul(session, ws, soul_id, user_id=user.id, role=role)
    query, history = _split_query(body.messages)

    plan = await svc.build_ask_context(
        session, soul=soul, query=query, engine_manager=engine_manager, history=history
    )
    if plan.short_circuit is None and not llm.configured:
        raise ConfigurationError("尚未配置 LLM，无法生成回答")

    created = int(time.time())
    model = body.model or f"zleap:{soul.name}"
    cid = f"chatcmpl-{soul_id[:12]}-{created}"

    if body.stream:
        async def gen():
            def chunk(delta: dict, finish: str | None = None) -> str:
                payload = {
                    "id": cid,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }
                return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            yield chunk({"role": "assistant"})
            if plan.short_circuit is not None:
                yield chunk({"content": plan.short_circuit})
            else:
                async for token in llm.stream(plan.messages):
                    yield chunk({"content": token})
            yield chunk({}, finish="stop")
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    # 非流式
    answer = plan.short_circuit if plan.short_circuit is not None else await llm.complete(plan.messages)
    return {
        "id": cid,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": answer},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        # zleap 扩展：引用溯源（标准客户端忽略未知字段）
        "zleap": {"citations": plan.citations, "sources": plan.section_count},
    }
