"""OpenAI 兼容对话端点——把任意 Agent 当作一个「带引用的模型」调用。

    POST /api/v1/openai/{agent_id}/chat/completions
    Authorization: Bearer <sag JWT>

支持 stream / 非流两种；请求体沿用 OpenAI Chat Completions 结构。
检索、系统提示、防幻觉短路与站内对话完全一致，便于外部系统无缝接入。
"""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.db import SessionLocal, get_session
from sag_api.core.deps import (
    get_current_user,
    get_engine_manager,
    get_llm,
    get_tool_registry,
)
from sag_api.core.errors import ConfigurationError, UpstreamError, ValidationError
from sag_api.db.models import User
from sag_api.generation import LLMClient
from sag_api.sag import EngineManager
from sag_api.services import agent_domain as svc
from sag_api.services import agent_service
from sag_api.tools import ToolRegistry

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


@router.post("/{agent_id}/chat/completions")
async def chat_completions(
    agent_id: str,
    body: ChatCompletionRequest,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
    tool_registry: ToolRegistry = Depends(get_tool_registry),
):
    agent = await svc.get_agent(session, agent_id)
    query, history = _split_query(body.messages)

    plan = await svc.build_ask_context(
        session, agent=agent, query=query, engine_manager=engine_manager, history=history
    )
    if plan.short_circuit is None and not llm.configured:
        raise ConfigurationError("尚未配置 LLM，无法生成回答")

    created = int(time.time())
    model = body.model or f"sag:{agent.name}"
    cid = f"chatcmpl-{agent_id[:12]}-{created}"

    def _events():
        # 无状态：thread_id=None → 不落库；复用同一 Agent 循环
        return agent_service.generate_stream(
            SessionLocal,
            plan=plan,
            agent=agent,
            thread_id=None,
            engine_manager=engine_manager,
            llm=llm,
            tool_registry=tool_registry,
        )

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
            async for name, payload in _events():
                if name == "token":
                    yield chunk({"content": payload["text"]})
                elif name == "error":
                    yield chunk({"content": f"\n[错误] {payload['message']}"})
            yield chunk({}, finish="stop")
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    # 非流式：消费同一事件流，聚合为最终答案
    parts: list[str] = []
    citations = plan.citations
    async for name, payload in _events():
        if name == "token":
            parts.append(payload["text"])
        elif name == "meta":
            citations = payload["citations"]
        elif name == "error":
            raise UpstreamError(payload["message"])
    return {
        "id": cid,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "".join(parts)},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        # sag 扩展：引用溯源（标准客户端忽略未知字段）
        "sag": {"citations": citations, "sources": plan.section_count},
    }
