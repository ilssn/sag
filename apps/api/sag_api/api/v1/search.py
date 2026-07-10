from __future__ import annotations

from typing import TypedDict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.db import get_session
from sag_api.core.deps import get_current_user, get_engine_manager
from sag_api.db.models import Source, User
from sag_api.sag import EngineManager, RetrievedSection
from sag_api.schemas.insight import EntityOut, GraphRelationOut
from sag_api.schemas.search import (
    GlobalSearchRequest,
    SearchEventOut,
    SearchRequest,
    SearchResponse,
    SectionOut,
)
from sag_api.services.source_service import get_source, list_sources

router = APIRouter(prefix="/sources/{source_id}/search", tags=["search"])
global_router = APIRouter(prefix="/search", tags=["search"])


class _EventGraphFields(TypedDict):
    events: list[SearchEventOut]
    entities: list[EntityOut]
    relations: list[GraphRelationOut]


async def _event_graph_fields(
    engine_manager: EngineManager,
    sections: list[RetrievedSection],
    sources_by_config: dict[str, Source],
) -> _EventGraphFields:
    graph = await engine_manager.graph_for_sections(
        sections,
        sources_by_config,
        event_limit=max(1, len(sections)),
    )
    events = []
    for event in graph.events:
        source = sources_by_config.get(event.source_config_id)
        events.append(
            SearchEventOut(
                id=event.id,
                source_id=source.id if source else None,
                source_name=source.name if source else None,
                title=event.title,
                summary=event.summary,
                category=event.category,
                rank=event.rank,
                parent_id=event.parent_id,
                chunk_id=event.chunk_id,
                start_time=event.start_time,
                score=event.score,
            )
        )
    return {
        "events": events,
        "entities": [EntityOut(**entity.model_dump()) for entity in graph.entities],
        "relations": [
            GraphRelationOut(
                source_id=association.event_id,
                source_kind="event",
                target_id=association.entity_id,
                target_kind="entity",
                kind="mentions",
                weight=association.weight,
                description=association.description,
            )
            for association in graph.associations
        ],
    }


@router.post("", response_model=SearchResponse)
async def search(
    source_id: str,
    body: SearchRequest,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> SearchResponse:
    source = await get_source(session, source_id)
    outcome = await engine_manager.search(
        source.sag_source_config_id,
        body.query,
        source=source,
        strategy=body.strategy,
        top_k=body.top_k,
    )
    for section in outcome.sections:
        section.source_config_id = section.source_config_id or source.sag_source_config_id
    graph_fields = await _event_graph_fields(
        engine_manager,
        outcome.sections,
        {source.sag_source_config_id: source},
    )
    # 对外 source_id = sag 信源 id（可路由 / 取原文），不泄漏引擎内部 id
    return SearchResponse(
        query=outcome.query,
        sections=[
            SectionOut(**{**s.model_dump(), "source_id": source.id}, source_name=source.name)
            for s in outcome.sections
        ],
        **graph_fields,
        stats=outcome.stats,
    )


@global_router.post("", response_model=SearchResponse)
async def global_search(
    body: GlobalSearchRequest,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> SearchResponse:
    """全局搜索：跨全部（或指定）信源 fan-out 检索，结果带信源名。"""
    sources = await list_sources(session)
    if body.source_ids:
        wanted = set(body.source_ids)
        sources = [s for s in sources if s.id in wanted]
    if not sources:
        return SearchResponse(query=body.query, sections=[], stats={"sources": 0})

    refs = {s.sag_source_config_id: s for s in sources}
    targets = [(s.sag_source_config_id, s) for s in sources]
    outcome = await engine_manager.search_many(
        targets,
        body.query,
        strategy=body.strategy,
        top_k=body.top_k,
    )
    graph_fields = await _event_graph_fields(engine_manager, outcome.sections, refs)

    def out(s):
        src = refs.get(s.source_config_id or "")
        return SectionOut(
            **{**s.model_dump(), "source_id": src.id if src else None},
            source_name=src.name if src else None,
        )

    return SearchResponse(
        query=outcome.query,
        sections=[out(s) for s in outcome.sections],
        **graph_fields,
        stats=outcome.stats,
    )
