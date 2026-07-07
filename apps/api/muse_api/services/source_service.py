"""信源领域逻辑。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.connectors import registry
from muse_api.core.errors import MuseError, NotFoundError
from muse_api.core.logging import get_logger
from muse_api.db.base import new_id
from muse_api.db.models import Source
from muse_api.sag import EngineManager
from muse_api.schemas.source import SourceCreate, SourceUpdate

log = get_logger("services.source")


async def list_sources(session: AsyncSession, workspace_id: str) -> list[Source]:
    rows = await session.execute(
        select(Source).where(Source.workspace_id == workspace_id).order_by(Source.created_at.desc())
    )
    return list(rows.scalars().all())


async def get_source(session: AsyncSession, workspace_id: str, source_id: str) -> Source:
    source = await session.get(Source, source_id)
    if source is None or source.workspace_id != workspace_id:
        raise NotFoundError("信源不存在")
    return source


async def create_source(
    session: AsyncSession,
    workspace_id: str,
    data: SourceCreate,
    *,
    engine_manager: EngineManager,
) -> Source:
    connector = registry.get(data.connector_kind)
    connector.validate_config(data.config)

    source = Source(
        workspace_id=workspace_id,
        name=data.name,
        description=data.description,
        connector_kind=data.connector_kind,
        sag_source_config_id=f"src_{new_id()[:16]}",
        config=data.config or {},
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)

    # 预建引擎 schema（幂等）；失败不阻断创建，处理文档时会重试
    try:
        await engine_manager.provision(source.sag_source_config_id, source)
    except MuseError as e:
        log.warning("信源引擎预建失败 %s：%s", source.sag_source_config_id, e.message)
    return source


async def update_source(
    session: AsyncSession, workspace_id: str, source_id: str, data: SourceUpdate
) -> Source:
    source = await get_source(session, workspace_id, source_id)
    if data.name is not None:
        source.name = data.name
    if data.description is not None:
        source.description = data.description
    if data.status is not None:
        source.status = data.status
    await session.commit()
    await session.refresh(source)
    return source


async def delete_source(session: AsyncSession, workspace_id: str, source_id: str) -> None:
    source = await get_source(session, workspace_id, source_id)
    await session.delete(source)
    await session.commit()
    # 注：MVP 暂不清除引擎侧该源的向量 / 图谱数据（保留在 data_dir）。
