"""EngineManager —— 管理 zleap-sag `DataEngine` 的生命周期与调用。

每个信源（source_config_id）对应一个 `DataEngine` 实例（引擎「一实例一源」的语义）。
引擎按需构造并缓存；每源一把锁，串行化该源上的读写，避免并发误用。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from zleap.sag import DataEngine

from muse_api.core.config import Settings
from muse_api.core.logging import get_logger
from muse_api.sag.config_builder import build_engine_config
from muse_api.sag.dto import EntityInfo, ProcessOutcome, RetrievedSection, SearchOutcome
from muse_api.sag.errors import map_sag_errors

if TYPE_CHECKING:
    from muse_api.db.models import Source

log = get_logger("sag")

StageCallback = Callable[[str], Awaitable[None]]


@dataclass
class _Slot:
    engine: DataEngine
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class EngineManager:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._slots: dict[str, _Slot] = {}
        self._create_lock = asyncio.Lock()

    def _config_for(self, source: Source | None) -> Any:
        overrides = None
        if source is not None and source.config:
            overrides = source.config.get("engine")
        return build_engine_config(self._settings, overrides=overrides)

    async def _slot(self, source_config_id: str, source: Source | None = None) -> _Slot:
        slot = self._slots.get(source_config_id)
        if slot is not None:
            return slot
        async with self._create_lock:
            slot = self._slots.get(source_config_id)
            if slot is None:
                log.info("构造引擎 source_config_id=%s", source_config_id)
                config = self._config_for(source)
                engine = DataEngine(config, source_config_id=source_config_id, health_check=False)
                with map_sag_errors():
                    await engine.start()
                slot = _Slot(engine=engine)
                self._slots[source_config_id] = slot
        return slot

    @asynccontextmanager
    async def use(self, source_config_id: str, source: Source | None = None):
        """取得该源的引擎并持有其锁（串行化本源上的操作）。"""
        slot = await self._slot(source_config_id, source)
        async with slot.lock:
            yield slot.engine

    async def provision(self, source_config_id: str, source: Source | None = None) -> None:
        """确保该源的引擎 schema 就绪（幂等）。"""
        await self._slot(source_config_id, source)

    async def process_document(
        self,
        source_config_id: str,
        path: str,
        *,
        source: Source | None = None,
        on_stage: StageCallback | None = None,
    ) -> ProcessOutcome:
        """在同一引擎实例上完成 ingest → extract（extract 复用 ingest 的加载结果）。"""
        with map_sag_errors():
            async with self.use(source_config_id, source) as engine:
                if on_stage:
                    await on_stage("loading")
                ingest = await engine.ingest(str(path))
                if on_stage:
                    await on_stage("extracting")
                extract = await engine.extract()
        return ProcessOutcome.from_results(ingest, extract)

    async def search(
        self,
        source_config_id: str,
        query: str,
        *,
        source: Source | None = None,
        strategy: str | None = None,
        top_k: int | None = None,
    ) -> SearchOutcome:
        strategy = strategy or self._settings.search_strategy
        top_k = top_k or self._settings.search_top_k
        with map_sag_errors():
            async with self.use(source_config_id, source) as engine:
                result = await engine.search(query, strategy=strategy, top_k=top_k)
        return SearchOutcome.from_result(result)

    async def search_many(
        self,
        targets: list[tuple[str, Source | None]],
        query: str,
        *,
        strategy: str | None = None,
        top_k: int | None = None,
    ) -> SearchOutcome:
        """跨多个信源并发检索 → 去重/合并/排序。单源失败不影响整体（灵魂 fan-out）。"""
        strategy = strategy or self._settings.search_strategy
        top_k = top_k or self._settings.search_top_k
        per_source_k = max(top_k, 4)

        async def _one(scid: str, source: Source | None):
            try:
                with map_sag_errors():
                    async with self.use(scid, source) as engine:
                        return await engine.search(query, strategy=strategy, top_k=per_source_k)
            except Exception as e:  # noqa: BLE001
                log.warning("fan-out 检索失败 %s：%s", scid, getattr(e, "message", None) or e)
                return None

        results = await asyncio.gather(*(_one(scid, src) for scid, src in targets))

        best: dict[str, dict] = {}
        loose: list[dict] = []
        for res in results:
            if res is None:
                continue
            for s in getattr(res, "sections", None) or []:
                cid = s.get("chunk_id")
                score = float(s.get("score") or 0.0)
                if cid:
                    if cid not in best or score > float(best[cid].get("score") or 0.0):
                        best[cid] = s
                else:
                    loose.append(s)
        merged = sorted(
            [*best.values(), *loose], key=lambda x: float(x.get("score") or 0.0), reverse=True
        )[:top_k]
        return SearchOutcome(
            query=query,
            sections=[RetrievedSection.from_section(s) for s in merged],
            stats={"sources": len(targets), "candidates": len(best) + len(loose)},
        )

    async def list_entities(
        self,
        source_config_id: str,
        *,
        source: Source | None = None,
        types: list[str] | None = None,
        limit: int = 100,
    ) -> list[EntityInfo]:
        """读取该源的事件—实体图谱，按热度（关联事件数）排序。extract 后才有数据。"""
        await self._slot(source_config_id, source)  # 确保引擎 / DB 已初始化
        from sqlalchemy import func, select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import Entity, EventEntity

        heat = func.count(EventEntity.id)
        conds = [Entity.source_config_id == source_config_id]
        if types:
            conds.append(Entity.type.in_(list(types)))
        stmt = (
            select(Entity, heat.label("heat"))
            .outerjoin(EventEntity, EventEntity.entity_id == Entity.id)
            .where(*conds)
            .group_by(Entity.id)
            .order_by(heat.desc())
            .limit(limit)
        )
        sf = get_session_factory()
        async with sf() as s:
            rows = (await s.execute(stmt)).all()
        return [
            EntityInfo(
                id=e.id,
                name=e.name or "",
                type=e.type or "",
                description=e.description or "",
                heat=int(h or 0),
            )
            for e, h in rows
        ]

    async def entity_context(
        self,
        source_config_id: str,
        entity_id: str,
        *,
        source: Source | None = None,
        limit: int = 20,
    ) -> list[str]:
        """某实体关联事件的文本片段（用于生成人格）。"""
        await self._slot(source_config_id, source)
        from sqlalchemy import select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import EventEntity, SourceEvent

        stmt = (
            select(SourceEvent.title, SourceEvent.summary, SourceEvent.content)
            .join(EventEntity, EventEntity.event_id == SourceEvent.id)
            .where(EventEntity.entity_id == entity_id)
            .limit(limit)
        )
        sf = get_session_factory()
        snippets: list[str] = []
        async with sf() as s:
            for title, summary, content in (await s.execute(stmt)).all():
                text = summary or content or title
                if text:
                    snippets.append(str(text)[:500])
        return snippets

    async def aclose_all(self) -> None:
        for scid, slot in list(self._slots.items()):
            try:
                await slot.engine.aclose()
            except Exception as e:  # noqa: BLE001
                log.warning("关闭引擎失败 %s: %s", scid, e)
        self._slots.clear()
