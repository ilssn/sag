from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from muse_api.enums import DocumentStatus


class MessageItem(BaseModel):
    text: str
    author: str | None = None
    role: str | None = None
    ts: str | None = None
    thread: str | None = None


class IngestRequest(BaseModel):
    """统一写入：文本或一批消息，二选一。"""

    text: str | None = None
    title: str | None = None
    messages: list[MessageItem] | None = Field(default=None)


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
