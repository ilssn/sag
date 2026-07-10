"""EngineManager —— 管理 zleap-sag `DataEngine` 的生命周期与调用。

每个信源（source_config_id）对应一个 `DataEngine` 实例（引擎「一实例一源」的语义）。
引擎按需构造并缓存；每源一把锁，串行化该源上的读写，避免并发误用。
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
    ProcessOutcome,
    RetrievedSection,
    SearchOutcome,
    SourceGraphInfo,
)
from sag_api.sag.errors import map_sag_errors

if TYPE_CHECKING:
    from sag_api.db.models import Source

log = get_logger("sag")

StageCallback = Callable[[str], Awaitable[None]]


@dataclass
class _Slot:
    engine: DataEngine
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_used: float = field(default_factory=time.monotonic)


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
        if slot is not None:
            slot.last_used = time.monotonic()
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
                if scid != keep and not s.lock.locked()
            ]
            if not candidates:
                break  # 其余都在忙，暂不逐出
            _, victim = min(candidates)
            slot = self._slots.pop(victim)
            try:
                await slot.engine.aclose()
                log.info("LRU 逐出引擎 source_config_id=%s（缓存上限 %d）", victim, self._cache_size)
            except Exception as e:  # noqa: BLE001
                log.warning("逐出引擎失败 %s: %s", victim, e)

    @asynccontextmanager
    async def use(self, source_config_id: str, source: Source | None = None):
        """取得该源的引擎并持有其锁（串行化本源上的操作）。"""
        slot = await self._slot(source_config_id, source)
        async with slot.lock:
            slot.last_used = time.monotonic()
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
        event_limit: int = 60,
        entity_limit: int = 48,
    ) -> SourceGraphInfo:
        """读取一个有界、按文档均衡的事件—实体图谱切片。

        图谱只读取本次展示文档对应的引擎 source_id。事件使用窗口排名轮询各文档，
        避免单篇长文占满配额；关联边另设硬上限，防止高基数抽取拖垮响应与浏览器。
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

            association_limit = min(600, max(240, event_limit * 6, entity_limit * 8))
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
        slot = self._slots.pop(source_config_id, None)
        if slot is None:
            return
        try:
            async with slot.lock:  # 等待在途操作结束
                await slot.engine.aclose()
        except Exception as e:  # noqa: BLE001
            log.warning("释放引擎失败 %s: %s", source_config_id, e)

    async def aclose_all(self) -> None:
        for scid, slot in list(self._slots.items()):
            try:
                await slot.engine.aclose()
            except Exception as e:  # noqa: BLE001
                log.warning("关闭引擎失败 %s: %s", scid, e)
        self._slots.clear()
