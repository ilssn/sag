from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from zleap_api.enums import NamespaceKind


class NamespaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    icon: str = ""
    color: str = ""


class NamespaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    kind: NamespaceKind
    icon: str
    color: str
    is_system: bool
    created_at: datetime
    updated_at: datetime
