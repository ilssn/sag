from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from sag_api.schemas.insight import EntityOut, GraphRelationOut


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    strategy: Literal["multi", "vector", "atomic"] | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)


class GlobalSearchRequest(BaseModel):
    """工作空间级搜索：默认全部信源，可传 source_ids 收窄（如 @某信源）。"""

    query: str = Field(min_length=1, max_length=4000)
    source_ids: list[str] | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)
    strategy: Literal["multi", "vector", "atomic"] | None = None


class SectionOut(BaseModel):
    chunk_id: str | None
    heading: str
    content: str
    score: float
    rank: int
    source_id: str | None
    source_name: str | None = None


class SearchEventOut(BaseModel):
    id: str
    document_id: str | None = None
    source_id: str | None = None
    source_name: str | None = None
    title: str
    summary: str = ""
    category: str = ""
    rank: int = 0
    parent_id: str | None = None
    chunk_id: str | None = None
    start_time: datetime | None = None
    score: float = 0.0


class SearchResponse(BaseModel):
    query: str
    sections: list[SectionOut]
    events: list[SearchEventOut] = Field(default_factory=list)
    entities: list[EntityOut] = Field(default_factory=list)
    relations: list[GraphRelationOut] = Field(default_factory=list)
    stats: dict[str, Any]
