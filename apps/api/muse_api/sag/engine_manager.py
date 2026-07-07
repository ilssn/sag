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
from muse_api.sag.dto import ProcessOutcome, SearchOutcome
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

    def _config_for(self, source: "Source | None") -> Any:
        overrides = None
        if source is not None and source.config:
            overrides = source.config.get("engine")
        return build_engine_config(self._settings, overrides=overrides)

    async def _slot(self, source_config_id: str, source: "Source | None" = None) -> _Slot:
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
    async def use(self, source_config_id: str, source: "Source | None" = None):
        """取得该源的引擎并持有其锁（串行化本源上的操作）。"""
        slot = await self._slot(source_config_id, source)
        async with slot.lock:
            yield slot.engine

    async def provision(self, source_config_id: str, source: "Source | None" = None) -> None:
        """确保该源的引擎 schema 就绪（幂等）。"""
        await self._slot(source_config_id, source)

    async def process_document(
        self,
        source_config_id: str,
        path: str,
        *,
        source: "Source | None" = None,
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
        source: "Source | None" = None,
        strategy: str | None = None,
        top_k: int | None = None,
    ) -> SearchOutcome:
        strategy = strategy or self._settings.search_strategy
        top_k = top_k or self._settings.search_top_k
        with map_sag_errors():
            async with self.use(source_config_id, source) as engine:
                result = await engine.search(query, strategy=strategy, top_k=top_k)
        return SearchOutcome.from_result(result)

    async def aclose_all(self) -> None:
        for scid, slot in list(self._slots.items()):
            try:
                await slot.engine.aclose()
            except Exception as e:  # noqa: BLE001
                log.warning("关闭引擎失败 %s: %s", scid, e)
        self._slots.clear()
