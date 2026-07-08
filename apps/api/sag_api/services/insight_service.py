"""洞察领域逻辑：事件—实体图谱读取（供未来图谱视图与 get_entity 工具）。"""

from __future__ import annotations

from sag_api.db.models import Source
from sag_api.sag import EngineManager, EntityInfo


async def list_entities(
    engine_manager: EngineManager, source: Source, *, types: list[str] | None = None, limit: int = 100
) -> list[EntityInfo]:
    return await engine_manager.list_entities(
        source.sag_source_config_id, source=source, types=types, limit=limit
    )
