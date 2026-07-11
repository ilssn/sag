"""EngineManager —— 管理 zleap-sag `DataEngine` 的生命周期与调用。

每个信源（source_config_id）对应一个 `DataEngine` 实例（引擎「一实例一源」的语义）。
引擎按需构造并缓存；普通引擎调用按源串行，文档处理用独立 loader/extractor 并发执行。
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from zleap.sag import DataEngine

from sag_api.core.config import Settings
from sag_api.core.logging import get_logger
from sag_api.sag.config_builder import build_engine_config
from sag_api.sag.dto import (
    EntityInfo,
    GraphAssociationInfo,
    GraphEventInfo,
    ProcessCheckpoint,
    ProcessOutcome,
    RetrievedSection,
    SearchOutcome,
    SourceGraphInfo,
)
from sag_api.sag.errors import map_sag_errors
from sag_api.sag.incremental_processor import IncrementalDocumentProcessor

if TYPE_CHECKING:
    from sag_api.db.models import Source

log = get_logger("sag")

StageCallback = Callable[[str], Awaitable[None]]
CheckpointCallback = Callable[[ProcessCheckpoint], Awaitable[None]]
PauseCheck = Callable[[], Awaitable[bool]]


@dataclass
class _Slot:
    engine: DataEngine
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    state_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    idle: asyncio.Event = field(default_factory=asyncio.Event)
    concurrent_users: int = 0
    last_used: float = field(default_factory=time.monotonic)
    closing: bool = False

    def __post_init__(self) -> None:
        self.idle.set()


class EngineManager:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._slots: dict[str, _Slot] = {}
        self._create_lock = asyncio.Lock()
        self._cache_size = max(1, settings.engine_cache_size)

    def _config_for(self, source: Source | None) -> Any:
        overrides = None
        if source is not None and source.config:
            overrides = source.config.get("engine")
        return build_engine_config(self._settings, overrides=overrides)

    async def _slot(self, source_config_id: str, source: Source | None = None) -> _Slot:
        slot = self._slots.get(source_config_id)
        if slot is not None and not slot.closing:
            slot.last_used = time.monotonic()
            return slot
        async with self._create_lock:
            slot = self._slots.get(source_config_id)
            if slot is None or slot.closing:
                log.info("构造引擎 source_config_id=%s", source_config_id)
                config = self._config_for(source)
                engine = DataEngine(config, source_config_id=source_config_id, health_check=False)
                with map_sag_errors():
                    await engine.start()
                slot = _Slot(engine=engine)
                self._slots[source_config_id] = slot
                await self._evict_lru(keep=source_config_id)
        return slot

    async def _evict_lru(self, *, keep: str) -> None:
        """超过缓存上限时逐出最久未用、且当前空闲（未持锁）的引擎槽。

        在 `_create_lock` 内调用。持锁中的槽跳过——正在服务的源不被打断。
        """
        while len(self._slots) > self._cache_size:
            candidates = [
                (s.last_used, scid)
                for scid, s in self._slots.items()
                if scid != keep and not s.lock.locked() and s.concurrent_users == 0
            ]
            if not candidates:
                break  # 其余都在忙，暂不逐出
            _, victim = min(candidates)
            slot = self._slots.pop(victim)
            slot.closing = True
            try:
                await slot.idle.wait()
                async with slot.lock:
                    await slot.engine.aclose()
                log.info("LRU 逐出引擎 source_config_id=%s（缓存上限 %d）", victim, self._cache_size)
            except Exception as e:  # noqa: BLE001
                log.warning("逐出引擎失败 %s: %s", victim, e)

    @asynccontextmanager
    async def use(self, source_config_id: str, source: Source | None = None):
        """取得该源的引擎并持有其锁（串行化本源上的操作）。"""
        while True:
            slot = await self._slot(source_config_id, source)
            await slot.lock.acquire()
            if slot.closing:
                slot.lock.release()
                continue
            break
        try:
            slot.last_used = time.monotonic()
            yield slot.engine
        finally:
            slot.lock.release()

    @asynccontextmanager
    async def use_concurrently(self, source_config_id: str, source: Source | None = None):
        """取得共享资源但不串行化文档处理；独立 loader/extractor 隔离可变状态。"""
        while True:
            slot = await self._slot(source_config_id, source)
            async with slot.state_lock:
                if slot.closing:
                    continue
                slot.concurrent_users += 1
                slot.idle.clear()
                slot.last_used = time.monotonic()
                break
        try:
            yield slot.engine
        finally:
            async with slot.state_lock:
                slot.concurrent_users -= 1
                if slot.concurrent_users == 0:
                    slot.idle.set()

    async def provision(self, source_config_id: str, source: Source | None = None) -> None:
        """确保该源的引擎 schema 就绪（幂等）。"""
        await self._slot(source_config_id, source)

    async def process_document(
        self,
        source_config_id: str,
        path: str | None,
        *,
        source: Source | None = None,
        on_stage: StageCallback | None = None,
        checkpoint: ProcessCheckpoint | None = None,
        on_checkpoint: CheckpointCallback | None = None,
        should_pause: PauseCheck | None = None,
        max_concurrency: int | None = None,
    ) -> ProcessOutcome:
        """独立处理一篇文档；同源文档可并行，chunk 完成即保存断点。"""

        async def ignore_checkpoint(_checkpoint: ProcessCheckpoint) -> None:
            return None

        async def never_pause() -> bool:
            return False

        with map_sag_errors():
            async with self.use_concurrently(source_config_id, source) as engine:
                processor = IncrementalDocumentProcessor(
                    engine,
                    source_config_id,
                    max_concurrency=max_concurrency
                    or self._settings.document_extract_concurrency,
                    chunk_max_tokens=self._settings.document_chunk_max_tokens,
                    chunk_mode=self._settings.document_chunk_mode,
                )
                return await processor.process(
                    path,
                    checkpoint=checkpoint or ProcessCheckpoint(),
                    on_checkpoint=on_checkpoint or ignore_checkpoint,
                    should_pause=should_pause or never_pause,
                    on_stage=on_stage,
                )

    async def _search_raw(
        self,
        source_config_id: str,
        query: str,
        *,
        source: Source | None,
        strategy: str,
        top_k: int,
    ) -> SearchOutcome:
        """单次检索（带每源时限）。超时抛 asyncio.TimeoutError。"""
        timeout = max(1.0, self._settings.search_source_timeout)
        with map_sag_errors():
            async with self.use(source_config_id, source) as engine:
                result = await asyncio.wait_for(
                    engine.search(query, strategy=strategy, top_k=top_k), timeout
                )
        return SearchOutcome.from_result(result)

    async def search(
        self,
        source_config_id: str,
        query: str,
        *,
        source: Source | None = None,
        strategy: str | None = None,
        top_k: int | None = None,
    ) -> SearchOutcome:
        """检索（韧性版）：multi 超时/失败/空结果时自动回退 vector，保证「有数据必有结果」。

        multi 的查询侧含 LLM 实体抽取（慢且可能失败重试）；事件向量层缺失的源也会空转。
        回退把这类退化收敛为一次快速向量检索，可经 `search_fallback_vector=false` 关闭。
        """
        strategy = strategy or self._settings.search_strategy
        top_k = top_k or self._settings.search_top_k
        try:
            outcome = await self._search_raw(
                source_config_id, query, source=source, strategy=strategy, top_k=top_k
            )
            if outcome.sections or strategy == "vector" or not self._settings.search_fallback_vector:
                return outcome
            log.info("multi 空结果，回退 vector source_config_id=%s", source_config_id)
        except TimeoutError:
            if strategy == "vector" or not self._settings.search_fallback_vector:
                raise
            log.warning(
                "检索超时(%.0fs) 回退 vector source_config_id=%s strategy=%s",
                self._settings.search_source_timeout, source_config_id, strategy,
            )
        except Exception as e:  # noqa: BLE001
            if strategy == "vector" or not self._settings.search_fallback_vector:
                raise
            log.warning(
                "检索失败回退 vector source_config_id=%s strategy=%s err=%s",
                source_config_id, strategy, getattr(e, "message", None) or e,
            )
        return await self._search_raw(
            source_config_id, query, source=source, strategy="vector", top_k=top_k
        )

    async def search_many(
        self,
        targets: list[tuple[str, Source | None]],
        query: str,
        *,
        strategy: str | None = None,
        top_k: int | None = None,
    ) -> SearchOutcome:
        """跨多个信源并发检索 → 去重/合并/排序；单源失败不影响 Agent 整体结果。"""
        strategy = strategy or self._settings.search_strategy
        top_k = top_k or self._settings.search_top_k
        per_source_k = max(top_k, 4)

        async def _one(scid: str, source: Source | None):
            try:
                outcome = await self.search(
                    scid, query, source=source, strategy=strategy, top_k=per_source_k
                )
                return scid, outcome
            except Exception as e:  # noqa: BLE001
                log.warning("fan-out 检索失败 %s：%s", scid, getattr(e, "message", None) or e)
                return None

        results = await asyncio.gather(*(_one(scid, src) for scid, src in targets))

        best: dict[tuple[str, str], RetrievedSection] = {}
        loose: list[RetrievedSection] = []
        for result in results:
            if result is None:
                continue
            scid, outcome = result
            for sec in outcome.sections:
                # 部分向量后端不会回填来源；跨源聚合时补齐，供 MCP/UI 正确标注。
                if not sec.source_config_id:
                    sec.source_config_id = scid
                if sec.chunk_id:
                    key = (sec.source_config_id, sec.chunk_id)
                    prev = best.get(key)
                    if prev is None or sec.score > prev.score:
                        best[key] = sec
                else:
                    loose.append(sec)
        merged = sorted([*best.values(), *loose], key=lambda x: x.score, reverse=True)[:top_k]
        return SearchOutcome(
            query=query,
            sections=merged,
            stats={"sources": len(targets), "candidates": len(best) + len(loose)},
        )

    async def graph_for_sections(
        self,
        sections: list[RetrievedSection],
        sources_by_config: dict[str, Source | None],
        *,
        event_limit: int = 50,
        entity_limit: int = 48,
    ) -> SourceGraphInfo:
        """把命中分块映射回真实事件—实体关系，并保持检索相关度顺序。"""
        chunk_scores: dict[tuple[str, str], float] = {}
        chunk_ids_by_config: dict[str, set[str]] = {}
        for section in sections:
            source_config_id = (section.source_config_id or "").strip()
            chunk_id = (section.chunk_id or "").strip()
            if not source_config_id or not chunk_id:
                continue
            key = (source_config_id, chunk_id)
            chunk_scores[key] = max(chunk_scores.get(key, 0.0), section.score)
            chunk_ids_by_config.setdefault(source_config_id, set()).add(chunk_id)

        if not chunk_ids_by_config:
            return SourceGraphInfo()

        await asyncio.gather(
            *(
                self._slot(source_config_id, sources_by_config.get(source_config_id))
                for source_config_id in chunk_ids_by_config
            )
        )

        from sqlalchemy import and_, or_, select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import Entity, EventEntity, SourceEvent

        section_filters = [
            and_(
                SourceEvent.source_config_id == source_config_id,
                SourceEvent.chunk_id.in_(chunk_ids),
            )
            for source_config_id, chunk_ids in chunk_ids_by_config.items()
        ]
        sf = get_session_factory()
        async with sf() as session:
            event_rows = (
                (
                    await session.execute(
                        select(
                            SourceEvent.id.label("id"),
                            SourceEvent.source_config_id.label("source_config_id"),
                            SourceEvent.source_id.label("source_id"),
                            SourceEvent.title.label("title"),
                            SourceEvent.summary.label("summary"),
                            SourceEvent.category.label("category"),
                            SourceEvent.rank.label("rank"),
                            SourceEvent.parent_id.label("parent_id"),
                            SourceEvent.chunk_id.label("chunk_id"),
                            SourceEvent.start_time.label("start_time"),
                        ).where(
                            or_(*section_filters),
                            (SourceEvent.status.is_(None) | (SourceEvent.status != "DELETED")),
                        )
                    )
                )
                .mappings()
                .all()
            )
            events_by_chunk: dict[tuple[str, str], list[Any]] = {}
            for row in event_rows:
                key = (row["source_config_id"], row["chunk_id"] or "")
                events_by_chunk.setdefault(key, []).append(row)
            for rows in events_by_chunk.values():
                rows.sort(key=lambda row: (int(row["rank"] or 0), row["id"]))

            # 每个高相关分块先贡献一个事件，再进入下一轮，避免单个长分块占满结果。
            ordered_chunk_keys = sorted(
                chunk_scores,
                key=lambda key: (-chunk_scores[key], key[0], key[1]),
            )
            balanced_rows: list[Any] = []
            depth = 0
            while True:
                added = False
                for key in ordered_chunk_keys:
                    rows = events_by_chunk.get(key, [])
                    if depth >= len(rows):
                        continue
                    balanced_rows.append(rows[depth])
                    added = True
                if not added:
                    break
                depth += 1

            # 重复上传或重叠分块会抽取出同名事件；同一信源只保留相关度最高的一条。
            seen_titles: set[tuple[str, str]] = set()
            event_rows = []
            for row in balanced_rows:
                normalized_title = re.sub(r"\s+", "", str(row["title"] or "")).casefold()
                title_key = (row["source_config_id"], normalized_title or row["id"])
                if title_key in seen_titles:
                    continue
                seen_titles.add(title_key)
                event_rows.append(row)
                if len(event_rows) >= event_limit:
                    break
            events = [
                GraphEventInfo(
                    id=row["id"],
                    source_config_id=row["source_config_id"],
                    source_id=row["source_id"],
                    title=row["title"] or "未命名事件",
                    summary=str(row["summary"] or "")[:800],
                    category=row["category"] or "",
                    rank=int(row["rank"] or 0),
                    parent_id=row["parent_id"],
                    chunk_id=row["chunk_id"],
                    start_time=row["start_time"],
                    score=chunk_scores.get(
                        (row["source_config_id"], row["chunk_id"] or ""),
                        0.0,
                    ),
                )
                for row in event_rows
            ]
            event_ids = [event.id for event in events]
            if not event_ids:
                return SourceGraphInfo(events=events)

            association_limit = min(600, max(120, event_limit * 6, entity_limit * 8))
            association_rows = (
                await session.execute(
                    select(
                        EventEntity.event_id,
                        EventEntity.entity_id,
                        EventEntity.weight,
                        EventEntity.description,
                        Entity.name,
                        Entity.type,
                        Entity.description.label("entity_description"),
                    )
                    .join(Entity, Entity.id == EventEntity.entity_id)
                    .where(
                        EventEntity.event_id.in_(event_ids),
                        Entity.source_config_id.in_(chunk_ids_by_config),
                    )
                    .order_by(EventEntity.weight.desc(), EventEntity.created_time.asc())
                    .limit(association_limit)
                )
            ).all()

        heat: dict[str, int] = {}
        entity_rows: dict[str, tuple[str, str, str]] = {}
        for _event_id, entity_id, _weight, _description, name, kind, description in association_rows:
            heat[entity_id] = heat.get(entity_id, 0) + 1
            entity_rows[entity_id] = (
                str(name or "")[:500],
                str(kind or "")[:50],
                str(description or "")[:500],
            )
        selected_entity_ids = {
            entity_id
            for entity_id, _count in sorted(
                heat.items(),
                key=lambda item: (-item[1], entity_rows[item[0]][0], item[0]),
            )[:entity_limit]
        }
        entities = [
            EntityInfo(
                id=entity_id,
                name=entity_rows[entity_id][0],
                type=entity_rows[entity_id][1],
                description=entity_rows[entity_id][2],
                heat=heat[entity_id],
            )
            for entity_id in selected_entity_ids
        ]
        entities.sort(key=lambda entity: (-entity.heat, entity.name, entity.id))
        associations = [
            GraphAssociationInfo(
                event_id=event_id,
                entity_id=entity_id,
                weight=float(weight or 1.0),
                description=str(description or "")[:240],
            )
            for event_id, entity_id, weight, description, *_rest in association_rows
            if entity_id in selected_entity_ids
        ][:300]
        return SourceGraphInfo(
            events=events,
            entities=entities,
            associations=associations,
            total_entities=len(entities),
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

    async def source_graph(
        self,
        source_config_id: str,
        source_ids: list[str],
        *,
        source: Source | None = None,
        event_limit: int = 2_000,
        entity_limit: int = 2_000,
    ) -> SourceGraphInfo:
        """按展示预算读取一个按文档均衡的事件—实体图谱。

        图谱只读取本次展示文档对应的引擎 source_id。事件使用窗口排名轮询各文档，
        避免单篇长文占满配额；关联边覆盖优先并限制密度，避免高基数图谱拖垮浏览器。
        """
        await self._slot(source_config_id, source)
        from sqlalchemy import func, select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import Entity, EventEntity, SourceEvent

        sf = get_session_factory()
        async with sf() as s:
            total_entities = int(
                (
                    await s.execute(select(func.count(Entity.id)).where(Entity.source_config_id == source_config_id))
                ).scalar_one()
                or 0
            )
            if not source_ids:
                return SourceGraphInfo(total_entities=total_entities)

            # 每个文档先取 rank 较小的事件，再在文档之间轮询，兼顾层级根节点与覆盖面。
            source_rank = (
                func.row_number()
                .over(
                    partition_by=SourceEvent.source_id,
                    order_by=(SourceEvent.rank.asc(), SourceEvent.created_time.desc()),
                )
                .label("source_rank")
            )
            ranked = (
                select(
                    SourceEvent.id.label("id"),
                    SourceEvent.source_id.label("source_id"),
                    SourceEvent.title.label("title"),
                    SourceEvent.summary.label("summary"),
                    SourceEvent.category.label("category"),
                    SourceEvent.rank.label("rank"),
                    SourceEvent.parent_id.label("parent_id"),
                    SourceEvent.chunk_id.label("chunk_id"),
                    SourceEvent.start_time.label("start_time"),
                    SourceEvent.created_time.label("created_time"),
                    source_rank,
                )
                .where(
                    SourceEvent.source_config_id == source_config_id,
                    SourceEvent.source_id.in_(source_ids),
                    (SourceEvent.status.is_(None) | (SourceEvent.status != "DELETED")),
                )
                .subquery()
            )
            event_rows = (
                (
                    await s.execute(
                        select(ranked)
                        .order_by(ranked.c.source_rank.asc(), ranked.c.created_time.desc())
                        .limit(event_limit)
                    )
                )
                .mappings()
                .all()
            )
            events = [
                GraphEventInfo(
                    id=row["id"],
                    source_config_id=source_config_id,
                    source_id=row["source_id"],
                    title=row["title"] or "未命名事件",
                    summary=str(row["summary"] or "")[:800],
                    category=row["category"] or "",
                    rank=int(row["rank"] or 0),
                    parent_id=row["parent_id"],
                    chunk_id=row["chunk_id"],
                    start_time=row["start_time"],
                )
                for row in event_rows
            ]
            event_ids = [event.id for event in events]
            if not event_ids:
                return SourceGraphInfo(events=events, total_entities=total_entities)

            relation_limit = min(12_000, max(300, event_limit * 2, entity_limit * 2))
            association_limit = min(24_000, relation_limit * 4)
            association_rows = (
                await s.execute(
                    select(
                        EventEntity.event_id,
                        EventEntity.entity_id,
                        EventEntity.weight,
                        EventEntity.description,
                        Entity.name,
                        Entity.type,
                        Entity.description.label("entity_description"),
                    )
                    .join(Entity, Entity.id == EventEntity.entity_id)
                    .where(
                        EventEntity.event_id.in_(event_ids),
                        Entity.source_config_id == source_config_id,
                    )
                    .order_by(EventEntity.weight.desc(), EventEntity.created_time.asc())
                    .limit(association_limit)
                )
            ).all()

        # 热度在当前图谱切片中计算；优先保留跨事件出现的实体。
        heat: dict[str, int] = {}
        entity_rows: dict[str, tuple[str, str, str]] = {}
        for _event_id, entity_id, _weight, _description, name, kind, entity_description in association_rows:
            heat[entity_id] = heat.get(entity_id, 0) + 1
            entity_rows[entity_id] = (
                str(name or "")[:500],
                str(kind or "")[:50],
                str(entity_description or "")[:500],
            )
        selected_entity_ids = {
            entity_id
            for entity_id, _count in sorted(
                heat.items(),
                key=lambda item: (-item[1], entity_rows[item[0]][0], item[0]),
            )[:entity_limit]
        }
        entities = [
            EntityInfo(
                id=entity_id,
                name=entity_rows[entity_id][0],
                type=entity_rows[entity_id][1],
                description=entity_rows[entity_id][2],
                heat=heat[entity_id],
            )
            for entity_id in selected_entity_ids
        ]
        entities.sort(key=lambda entity: (-entity.heat, entity.name, entity.id))

        eligible_rows = [
            row for row in association_rows if row[1] in selected_entity_ids
        ]
        covering_rows = []
        remaining_rows = []
        covered_events: set[str] = set()
        covered_entities: set[str] = set()
        for row in eligible_rows:
            event_id, entity_id = row[0], row[1]
            if event_id not in covered_events or entity_id not in covered_entities:
                covering_rows.append(row)
                covered_events.add(event_id)
                covered_entities.add(entity_id)
            else:
                remaining_rows.append(row)
        selected_rows = [*covering_rows, *remaining_rows][:relation_limit]

        associations = [
            GraphAssociationInfo(
                event_id=event_id,
                entity_id=entity_id,
                weight=float(weight or 1.0),
                description=str(description or "")[:240],
            )
            for event_id, entity_id, weight, description, *_rest in selected_rows
        ]
        return SourceGraphInfo(
            events=events,
            entities=entities,
            associations=associations,
            total_entities=total_entities,
        )

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

    async def list_chunk_headings(
        self,
        source_config_id: str,
        *,
        source: Source | None = None,
        doc_sag_id: str | None = None,
        limit: int = 300,
    ) -> list[dict]:
        """分块大纲：heading + rank（可限定单文档），供 MCP outline。"""
        await self._slot(source_config_id, source)
        from sqlalchemy import select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import SourceChunk

        conds = [SourceChunk.source_config_id == source_config_id]
        if doc_sag_id:
            conds.append(SourceChunk.source_id == doc_sag_id)
        stmt = (
            select(SourceChunk.id, SourceChunk.heading, SourceChunk.rank)
            .where(*conds)
            .order_by(SourceChunk.rank)
            .limit(limit)
        )
        sf = get_session_factory()
        async with sf() as s:
            rows = (await s.execute(stmt)).all()
        return [
            {"chunk_id": cid, "heading": (h or "").strip(), "rank": int(r or 0)}
            for cid, h, r in rows
        ]

    async def get_document_markdown(
        self,
        source_config_id: str,
        article_id: str,
        *,
        source: Source | None = None,
    ) -> str | None:
        """读取成功入库时保存的整篇 Markdown；不存在或内容为空时返回 None。"""
        await self._slot(source_config_id, source)
        from sqlalchemy import select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import Article

        sf = get_session_factory()
        async with sf() as session:
            content = await session.scalar(
                select(Article.content).where(
                    Article.id == article_id,
                    Article.source_config_id == source_config_id,
                )
            )
        return str(content) if content else None

    async def grep_chunks(
        self,
        source_config_id: str,
        pattern: str,
        *,
        source: Source | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """精确文本匹配（LIKE，大小写不敏感）：语义检索之外的确定性查找。"""
        await self._slot(source_config_id, source)
        from sqlalchemy import select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import SourceChunk

        needle = pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = (
            select(SourceChunk.id, SourceChunk.heading, SourceChunk.content)
            .where(
                SourceChunk.source_config_id == source_config_id,
                SourceChunk.content.ilike(f"%{needle}%", escape="\\"),
            )
            .order_by(SourceChunk.rank)
            .limit(limit)
        )
        sf = get_session_factory()
        async with sf() as s:
            rows = (await s.execute(stmt)).all()
        out = []
        for cid, heading, content in rows:
            text = content or ""
            lowered = text.lower()
            needle = pattern.lower()
            positions: list[int] = []
            start = 0
            while (position := lowered.find(needle, start)) >= 0:
                positions.append(position)
                start = position + max(1, len(needle))

            def quality(position: int, content: str = text) -> int:
                window = content[max(0, position - 40) : position + 700]
                cjk = sum("\u3400" <= char <= "\u9fff" for char in window)
                return cjk - window.count("http") * 40 - window.count("](") * 15

            best = max(positions, key=quality) if positions else 0
            prefix_start = max(0, best - 500)
            prefix = text[prefix_start:best]
            dates = list(
                re.finditer(
                    r"20\d{2}(?:年\d{1,2}月\d{1,2}日|[-/]\d{1,2}[-/]\d{1,2})",
                    prefix,
                )
            )
            lo = prefix_start + dates[-1].start() if dates else max(0, best - 80)
            snippet = text[lo : best + 700]
            snippet = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", snippet)
            snippet = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", snippet)
            snippet = re.sub(r"[ \t]+", " ", snippet).strip()
            display_heading = (heading or "").strip()
            for line in text.splitlines():
                candidate = re.sub(r"!\[[^]]*\]\([^)]*\)", "", line)
                candidate = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", candidate)
                candidate = candidate.lstrip("#* -").strip()
                if needle in candidate.lower() and 2 <= len(candidate) <= 160:
                    display_heading = candidate
                    break
            out.append(
                {
                    "chunk_id": cid,
                    "heading": display_heading,
                    "snippet": snippet,
                }
            )
        return out

    async def get_chunk(
        self,
        source_config_id: str,
        chunk_id: str,
        *,
        source: Source | None = None,
    ):
        """读取某分块的完整原文（引用/搜索溯源）。不存在返回 None。"""
        from sag_api.sag.dto import ChunkInfo

        await self._slot(source_config_id, source)
        from sqlalchemy import select
        from zleap.sag.db import get_session_factory
        from zleap.sag.db.models import SourceChunk

        sf = get_session_factory()
        async with sf() as s:
            row = (
                await s.execute(
                    select(SourceChunk).where(
                        SourceChunk.id == chunk_id,
                        SourceChunk.source_config_id == source_config_id,
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return None
        return ChunkInfo(
            chunk_id=row.id,
            heading=(row.heading or "").strip(),
            content=(row.content or row.raw_content or "").strip(),
            rank=int(row.rank or 0),
        )

    async def release(self, source_config_id: str) -> None:
        """关闭并移除某源的引擎槽（信源删除时调用；幂等）。"""
        async with self._create_lock:
            slot = self._slots.pop(source_config_id, None)
            if slot is None:
                return
            slot.closing = True
            try:
                await slot.idle.wait()
                async with slot.lock:  # 等待在途操作结束
                    await slot.engine.aclose()
            except Exception as e:  # noqa: BLE001
                log.warning("释放引擎失败 %s: %s", source_config_id, e)

    async def aclose_all(self) -> None:
        # 先标记并摘除，阻止新请求拿到即将关闭的槽；逐槽等待在途操作完成。
        async with self._create_lock:
            slots = list(self._slots.items())
            for _, slot in slots:
                slot.closing = True
            self._slots.clear()
            for scid, slot in slots:
                try:
                    await slot.idle.wait()
                    async with slot.lock:
                        await slot.engine.aclose()
                except Exception as e:  # noqa: BLE001
                    log.warning("关闭引擎失败 %s: %s", scid, e)
