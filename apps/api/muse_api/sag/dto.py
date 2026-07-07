"""muse 侧的引擎结果 DTO —— 与 zleap-sag 的返回结构解耦。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class RetrievedSection(BaseModel):
    """一个检索到的段落（用于问答上下文与引用）。"""

    chunk_id: str | None = None
    heading: str = ""
    content: str = ""
    score: float = 0.0
    rank: int = 0
    source_id: str | None = None
    source_config_id: str | None = None

    @classmethod
    def from_section(cls, s: dict[str, Any]) -> RetrievedSection:
        return cls(
            chunk_id=s.get("chunk_id"),
            heading=(s.get("heading") or "").strip(),
            content=(s.get("content") or "").strip(),
            score=float(s.get("score") or 0.0),
            rank=int(s.get("rank") or 0),
            source_id=s.get("source_id"),
            source_config_id=s.get("source_config_id"),
        )


class SearchOutcome(BaseModel):
    """检索结果聚合。"""

    query: str
    sections: list[RetrievedSection]
    stats: dict[str, Any] = {}

    @classmethod
    def from_result(cls, result: Any) -> SearchOutcome:
        raw_sections = getattr(result, "sections", None) or []
        query = getattr(result, "query", "") or ""
        if not isinstance(query, str):
            query = str(query)
        return cls(
            query=query,
            sections=[RetrievedSection.from_section(s) for s in raw_sections],
            stats=getattr(result, "stats", None) or {},
        )


class EntityInfo(BaseModel):
    """从事件—实体图谱聚合出的一个实体（用于洞察 / 书→人物）。"""

    id: str
    name: str
    type: str
    description: str = ""
    heat: int = 0  # 关联事件数（频次 × 中心度的代理指标）


class ProcessOutcome(BaseModel):
    """文档处理（ingest + extract）结果。"""

    source_id: str | None = None
    chunk_count: int = 0
    event_count: int = 0
    chunk_ids: list[str] = []
    event_ids: list[str] = []

    @classmethod
    def from_results(cls, ingest: Any, extract: Any) -> ProcessOutcome:
        return cls(
            source_id=getattr(ingest, "source_id", None),
            chunk_count=int(getattr(ingest, "chunk_count", 0) or 0),
            event_count=int(getattr(extract, "event_count", 0) or 0),
            chunk_ids=list(getattr(ingest, "chunk_ids", []) or []),
            event_ids=list(getattr(extract, "event_ids", []) or []),
        )
