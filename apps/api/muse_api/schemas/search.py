from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    strategy: str | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)


class SectionOut(BaseModel):
    chunk_id: str | None
    heading: str
    content: str
    score: float
    rank: int
    source_id: str | None


class SearchResponse(BaseModel):
    query: str
    sections: list[SectionOut]
    stats: dict[str, Any]
