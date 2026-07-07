from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.core.db import get_session
from muse_api.core.deps import get_engine_manager, get_workspace_id
from muse_api.sag import EngineManager
from muse_api.schemas.search import GlobalSearchRequest, SearchRequest, SearchResponse, SectionOut
from muse_api.services.source_service import get_source, list_sources

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
    return SearchResponse(
        query=outcome.query,
        sections=[SectionOut(**s.model_dump(), source_name=source.name) for s in outcome.sections],
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

    names = {s.sag_source_config_id: s.name for s in sources}
    targets = [(s.sag_source_config_id, s) for s in sources]
    outcome = await engine_manager.search_many(targets, body.query, top_k=body.top_k)
    return SearchResponse(
        query=outcome.query,
        sections=[
            SectionOut(**s.model_dump(), source_name=names.get(s.source_config_id or ""))
            for s in outcome.sections
        ],
        stats=outcome.stats,
    )
