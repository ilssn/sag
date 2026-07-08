from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_id: str | None
    actor_email: str
    action: str
    target_type: str
    target_id: str
    target_label: str
    meta_json: str
    ip: str
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditOut]
    total: int
    limit: int
    offset: int
