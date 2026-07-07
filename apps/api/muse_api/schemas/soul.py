from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from muse_api.enums import BindingTargetType, MessageRole, SoulOrigin, SoulStatus


class SoulCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    avatar: str = ""
    persona: dict[str, Any] = Field(default_factory=dict)


class SoulUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    avatar: str | None = None
    persona: dict[str, Any] | None = None


class SoulOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    avatar: str
    persona: dict[str, Any]
    origin: SoulOrigin
    status: SoulStatus
    memory_namespace_id: str | None
    created_at: datetime
    updated_at: datetime


class BindingCreate(BaseModel):
    target_type: BindingTargetType
    target_id: str


class BindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    target_type: BindingTargetType
    target_id: str
    mode: str


class SoulThreadCreate(BaseModel):
    title: str = "新会话"


class SoulThreadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    soul_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class SoulMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    thread_id: str
    role: MessageRole
    content: str
    author: str | None
    citations: list[dict[str, Any]]
    created_at: datetime


class SoulAskRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    author: str | None = None
