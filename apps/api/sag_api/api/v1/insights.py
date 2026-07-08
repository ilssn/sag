from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.db import get_session
from sag_api.core.deps import get_current_user, get_engine_manager
from sag_api.db.models import User
from sag_api.sag import EngineManager
from sag_api.schemas.insight import EntityOut
from sag_api.services.insight_service import list_entities
from sag_api.services.source_service import get_source

router = APIRouter(prefix="/sources/{source_id}/entities", tags=["insights"])


@router.get("", response_model=list[EntityOut])
async def entities(
    source_id: str,
    types: str | None = None,
    limit: int = 100,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> list[EntityOut]:
    source = await get_source(session, source_id)
    type_list = [t for t in (types or "").split(",") if t] or None
    ents = await list_entities(engine_manager, source, types=type_list, limit=limit)
    return [EntityOut(**e.model_dump()) for e in ents]
