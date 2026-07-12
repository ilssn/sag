from __future__ import annotations

from datetime import UTC, datetime
from typing import TypedDict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.db import get_session
from sag_api.core.deps import get_current_user, get_engine_manager, get_llm
from sag_api.db.models import Source, User
from sag_api.generation import LLMClient
from sag_api.sag import EngineManager, RetrievedSection
from sag_api.schemas.insight import EntityOut, GraphRelationOut
from sag_api.schemas.search import (
    GlobalSearchRequest,
    SearchEventOut,
    SearchRequest,
    SearchResponse,
    SearchSourceHitOut,
    SectionOut,
)
from sag_api.services.retrieval_service import (
    retrieve_relevant_sections,
    synthesize_search_answer,
)
from sag_api.services.source_service import get_source, search_source_candidates

router = APIRouter(prefix="/sources/{source_id}/search", tags=["search"])
global_router = APIRouter(prefix="/search", tags=["search"])


class _EventGraphFields(TypedDict):
    events: list[SearchEventOut]
    entities: list[EntityOut]
    relations: list[GraphRelationOut]


def _source_hits(events: list[SearchEventOut]) -> list[SearchSourceHitOut]:
    def utc(value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

    grouped: dict[str, dict] = {}
    seen: set[tuple[str, str]] = set()
    for event in events:
        if not event.source_id:
            continue
        key = (event.source_id, event.id)
        if key in seen:
            continue
        seen.add(key)
        item = grouped.setdefault(
            event.source_id,
            {
                "source_id": event.source_id,
                "source_name": event.source_name,
                "event_hits": 0,
                "max_score": 0.0,
                "latest_event_time": None,
            },
        )
        item["event_hits"] += 1
        item["max_score"] = max(float(item["max_score"]), float(event.score or 0.0))
        if event.start_time is not None:
            event_time = utc(event.start_time)
            if item["latest_event_time"] is None or event_time > item["latest_event_time"]:
                item["latest_event_time"] = event_time
    ranked = sorted(
        grouped.values(),
        key=lambda item: (
            -int(item["event_hits"]),
            -float(item["max_score"]),
            -(item["latest_event_time"].timestamp() if item["latest_event_time"] else 0.0),
            str(item["source_id"]),
        ),
    )
    return [SearchSourceHitOut(**item) for item in ranked]


async def _event_graph_fields(
    engine_manager: EngineManager,
    sections: list[RetrievedSection],
    sources_by_config: dict[str, Source],
) -> _EventGraphFields:
    if not sections:
        return {"events": [], "entities": [], "relations": []}
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
    llm: LLMClient = Depends(get_llm),
) -> SearchResponse:
    source = await get_source(session, source_id)
    outcome = await retrieve_relevant_sections(
        engine_manager,
        [source],
        body.query,
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
        source_hits=_source_hits(graph_fields["events"]),
        summary=await synthesize_search_answer(
            outcome.query,
            outcome.sections,
            llm=llm,
        ),
        stats=outcome.stats,
    )


@global_router.post("", response_model=SearchResponse)
async def global_search(
    body: GlobalSearchRequest,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
) -> SearchResponse:
    """全局搜索：先选有界信源分区，再 fan-out 检索并返回可追溯结果。"""
    sources = await search_source_candidates(session, body.source_ids)
    if not sources:
        return SearchResponse(query=body.query, sections=[], stats={"sources": 0})

    refs = {s.sag_source_config_id: s for s in sources}
    outcome = await retrieve_relevant_sections(
        engine_manager,
        sources,
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

    section_outputs = [out(s) for s in outcome.sections]
    summary = await synthesize_search_answer(
        outcome.query,
        outcome.sections,
        llm=llm,
    )
    exploration_id = None
    if body.save_exploration:
        from sag_api.services.universe_service import save_exploration

        event_outputs = [item.model_dump(mode="json") for item in graph_fields["events"]]
        entity_outputs = [item.model_dump(mode="json") for item in graph_fields["entities"]]
        relation_outputs = [item.model_dump(mode="json") for item in graph_fields["relations"]]
        section_refs = [
            {
                "n": index,
                "chunk_id": item.chunk_id,
                "heading": item.heading,
                "score": item.score,
                "source_id": item.source_id,
                "source_name": item.source_name,
            }
            for index, item in enumerate(section_outputs, 1)
        ]
        exploration, _step = await save_exploration(
            session,
            user_id=_user.id,
            query=outcome.query,
            source_ids=[source.id for source in sources],
            summary=summary,
            events=event_outputs,
            entities=entity_outputs,
            relations=relation_outputs,
            evidence=section_refs,
        )
        exploration_id = exploration.id

    return SearchResponse(
        query=outcome.query,
        sections=section_outputs,
        **graph_fields,
        source_hits=_source_hits(graph_fields["events"]),
        summary=summary,
        exploration_id=exploration_id,
        stats=outcome.stats,
    )
