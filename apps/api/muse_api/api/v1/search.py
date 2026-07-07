from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.core.db import get_session
from muse_api.core.deps import get_engine_manager, get_workspace_id
from muse_api.sag import EngineManager
from muse_api.schemas.search import SearchRequest, SearchResponse, SectionOut
from muse_api.services.source_service import get_source

router = APIRouter(prefix="/sources/{source_id}/search", tags=["search"])


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
        sections=[SectionOut(**s.model_dump()) for s in outcome.sections],
        stats=outcome.stats,
    )
