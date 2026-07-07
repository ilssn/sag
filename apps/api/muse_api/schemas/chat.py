from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from muse_api.enums import MessageRole


class ThreadCreate(BaseModel):
    source_id: str
    title: str = "新会话"


class ThreadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    thread_id: str
    role: MessageRole
    content: str
    citations: list[dict[str, Any]]
    created_at: datetime


class AskRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    strategy: str | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)
