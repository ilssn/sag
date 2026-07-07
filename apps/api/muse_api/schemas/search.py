from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    strategy: str | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)


class GlobalSearchRequest(BaseModel):
    """工作空间级搜索：默认全部信源，可传 source_ids 收窄（如 @某信源）。"""

    query: str = Field(min_length=1, max_length=4000)
    source_ids: list[str] | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)


class SectionOut(BaseModel):
    chunk_id: str | None
    heading: str
    content: str
    score: float
    rank: int
    source_id: str | None
    source_name: str | None = None


class SearchResponse(BaseModel):
    query: str
    sections: list[SectionOut]
    stats: dict[str, Any]
