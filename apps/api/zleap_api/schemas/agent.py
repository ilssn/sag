from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from zleap_api.enums import BindingTargetType, MessageRole


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    avatar: str = ""
    persona: dict[str, Any] = Field(default_factory=dict)  # { system_prompt, greeting, tools[] }


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    avatar: str | None = None
    persona: dict[str, Any] | None = None


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    avatar: str
    persona: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class BindingCreate(BaseModel):
    target_type: BindingTargetType = BindingTargetType.SOURCE
    target_id: str = ""
    config: dict[str, Any] = Field(default_factory=dict)  # MCP: url 或 command/args/env


class BindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    target_type: BindingTargetType
    target_id: str
    config: dict[str, Any]


class ThreadCreate(BaseModel):
    title: str = "新会话"


class ThreadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agent_id: str
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
