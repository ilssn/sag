from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import get_engine_manager, get_workspace_id
from zleap_api.sag import EngineManager
from zleap_api.schemas.search import GlobalSearchRequest, SearchRequest, SearchResponse, SectionOut
from zleap_api.services.source_service import get_source, list_sources

router = APIRouter(prefix="/sources/{source_id}/search", tags=["search"])
global_router = APIRouter(prefix="/search", tags=["search"])


@router.post("", response_model=SearchResponse)
async def search(
    source_id: str,
    body: SearchRequest,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> SearchResponse:
    source = await get_source(session, workspace_id, source_id)
    outcome = await engine_manager.search(
        source.sag_source_config_id,
        body.query,
        source=source,
        strategy=body.strategy,
        top_k=body.top_k,
    )
    # 对外 source_id = zleap 信源 id（可路由 / 取原文），不泄漏引擎内部 id
    return SearchResponse(
        query=outcome.query,
        sections=[
            SectionOut(**{**s.model_dump(), "source_id": source.id}, source_name=source.name)
            for s in outcome.sections
        ],
        stats=outcome.stats,
    )


@global_router.post("", response_model=SearchResponse)
async def global_search(
    body: GlobalSearchRequest,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> SearchResponse:
    """全局搜索：跨全部（或指定）信源 fan-out 检索，结果带信源名。"""
    sources = await list_sources(session, workspace_id)
    if body.source_ids:
        wanted = set(body.source_ids)
        sources = [s for s in sources if s.id in wanted]
    if not sources:
        return SearchResponse(query=body.query, sections=[], stats={"sources": 0})

    refs = {s.sag_source_config_id: s for s in sources}
    targets = [(s.sag_source_config_id, s) for s in sources]
    outcome = await engine_manager.search_many(targets, body.query, top_k=body.top_k)

    def out(s):
        src = refs.get(s.source_config_id or "")
        return SectionOut(
            **{**s.model_dump(), "source_id": src.id if src else None},
            source_name=src.name if src else None,
        )

    return SearchResponse(
        query=outcome.query,
        sections=[out(s) for s in outcome.sections],
        stats=outcome.stats,
    )
