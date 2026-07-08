from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from zleap_api.enums import WorkspaceRole


class WorkspaceOut(BaseModel):
    workspace_id: str
    workspace_name: str
    role: WorkspaceRole


class MemberOut(BaseModel):
    user_id: str
    email: str
    name: str
    role: WorkspaceRole
    joined_at: datetime


class InviteRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: WorkspaceRole = WorkspaceRole.EDITOR

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class RoleUpdateRequest(BaseModel):
    role: WorkspaceRole
