"""异步数据库引擎与会话。"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from sag_api.core.config import settings


def _ensure_sqlite_dir(url: str) -> None:
    """SQLite 文件所在目录不存在时先创建。"""
    marker = "sqlite+aiosqlite:///"
    if url.startswith(marker):
        path = url[len(marker) :]
        if path and path not in (":memory:",):
            os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)


_ensure_sqlite_dir(settings.database_url)

engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
)

# SQLite：外键约束 + 并发友好（WAL 读写并行，busy_timeout 让写入等待而非立即报锁）
if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()


SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """建库/升级的稳定接缝：委托 Alembic 迁移 runner（ADR-0014 唯一机制）。

    原 create_all + _COLUMN_UPGRADES/_INDEX_UPGRADES 已退役——存量库由
    migrate.run_migrations 的一次性 reconcile 垫片补齐并 stamp 至基线。
    """
    from sag_api.core.paths import ensure_data_layout
    from sag_api.db.migrate import run_migrations

    paths = ensure_data_layout(settings)
    await run_migrations(engine, settings, paths)


async def dispose_db() -> None:
    await engine.dispose()
