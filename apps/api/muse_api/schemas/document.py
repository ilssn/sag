from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from muse_api.enums import DocumentStatus


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    chunk_count: int
    event_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime
