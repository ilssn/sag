from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import (
    get_current_user,
    get_engine_manager,
    get_llm,
    get_workspace_id,
    require_editor,
)
from zleap_api.generation import LLMClient
from zleap_api.sag import EngineManager
from zleap_api.schemas.insight import EntityOut
from zleap_api.schemas.soul import SoulOut
from zleap_api.services.insight_service import entity_to_soul, list_entities
from zleap_api.services.source_service import get_source

router = APIRouter(prefix="/sources/{source_id}/entities", tags=["insights"])


@router.get("", response_model=list[EntityOut])
async def entities(
    source_id: str,
    types: str | None = None,
    limit: int = 100,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> list[EntityOut]:
    source = await get_source(session, workspace_id, source_id)
    type_list = [t for t in (types or "").split(",") if t] or None
    ents = await list_entities(engine_manager, source, types=type_list, limit=limit)
    return [EntityOut(**e.model_dump()) for e in ents]


@router.post("/{entity_id}/to-soul", response_model=SoulOut, status_code=201)
async def to_soul(
    source_id: str,
    entity_id: str,
    workspace_id: str = Depends(get_workspace_id),
    user=Depends(get_current_user),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
    llm: LLMClient = Depends(get_llm),
) -> SoulOut:
    source = await get_source(session, workspace_id, source_id)
    soul = await entity_to_soul(
        session,
        workspace_id,
        source,
        entity_id,
        owner_id=user.id,
        engine_manager=engine_manager,
        llm=llm,
    )
    return SoulOut.model_validate(soul)
