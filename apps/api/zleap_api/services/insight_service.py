"""洞察领域逻辑：事件—实体图谱聚合、书 → 人物（实体 → 灵魂）。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.errors import NotFoundError
from zleap_api.db.models import Soul, Source
from zleap_api.enums import BindingTargetType, SoulOrigin
from zleap_api.generation import LLMClient, generate_persona
from zleap_api.sag import EngineManager, EntityInfo
from zleap_api.services.soul_service import add_binding, create_soul


async def list_entities(
    engine_manager: EngineManager, source: Source, *, types: list[str] | None = None, limit: int = 100
) -> list[EntityInfo]:
    return await engine_manager.list_entities(
        source.sag_source_config_id, source=source, types=types, limit=limit
    )


async def entity_to_soul(
    session: AsyncSession,
    workspace_id: str,
    source: Source,
    entity_id: str,
    *,
    engine_manager: EngineManager,
    llm: LLMClient,
) -> Soul:
    """把书中一个实体（人物）提取成灵魂：依据其相关事件用 LLM 生成人格，并绑定该书信源。"""
    entities = await engine_manager.list_entities(source.sag_source_config_id, source=source)
    entity = next((e for e in entities if e.id == entity_id), None)
    if entity is None:
        raise NotFoundError("实体不存在或尚未抽取")

    snippets = await engine_manager.entity_context(
        source.sag_source_config_id, entity_id, source=source
    )
    persona = await generate_persona(llm, entity.name, snippets)

    soul = await create_soul(
        session,
        workspace_id,
        name=entity.name,
        avatar=entity.name[:1],
        persona=persona,
        origin=SoulOrigin.BOOK_ENTITY,
        origin_ref={"source_id": source.id, "entity_id": entity_id, "entity_type": entity.type},
    )
    # 绑定这本书作为其上下文，让它只依据书中情节说话
    await add_binding(
        session, workspace_id, soul, target_type=BindingTargetType.SOURCE, target_id=source.id
    )
    return soul
