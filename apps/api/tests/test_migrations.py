"""Alembic 迁移 runner（ADR-0014）：全新库/存量库/幂等/恢复点。"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.ext.asyncio import create_async_engine

from sag_api.core.config import Settings
from sag_api.core.paths import ensure_data_layout
from sag_api.db.migrate import head_revision, run_migrations

# conftest 的进程级存储环境变量会盖过 data_root 派生，令本套件误操作共享测试库——先摘掉。
_CONFTEST_ENV_KEYS = ("SAG_DATABASE_URL", "SAG_DATA_DIR", "SAG_UPLOAD_DIR")


@pytest.fixture(autouse=True)
def _isolated_storage_env(monkeypatch: pytest.MonkeyPatch):
    for key in _CONFTEST_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _make(tmp_path: Path):
    settings = Settings(_env_file=None, data_root=str(tmp_path))
    paths = ensure_data_layout(settings)
    engine = create_async_engine(settings.database_url, future=True)
    return settings, paths, engine


async def _tables(engine) -> set[str]:
    async with engine.connect() as conn:
        return set(await conn.run_sync(lambda sync: sa_inspect(sync).get_table_names()))


async def _revision(engine) -> str | None:
    async with engine.connect() as conn:
        row = (
            await conn.exec_driver_sql("SELECT version_num FROM alembic_version")
        ).fetchone()
    return row[0] if row else None


@pytest.mark.asyncio
async def test_fresh_database_is_built_from_versioned_baseline(tmp_path: Path):
    settings, paths, engine = _make(tmp_path)
    try:
        report = await run_migrations(engine, settings, paths)
        assert report.applied is True
        assert report.from_revision is None
        assert report.stamped_legacy is False
        tables = await _tables(engine)
        assert {"users", "sources", "documents", "alembic_version"} <= tables
        assert await _revision(engine) == head_revision()
        # 全新库不落恢复点（没有可保护的既有数据）
        assert report.recovery_point is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_second_run_is_a_noop(tmp_path: Path):
    settings, paths, engine = _make(tmp_path)
    try:
        await run_migrations(engine, settings, paths)
        report = await run_migrations(engine, settings, paths)
        assert report.applied is False
        assert report.from_revision == head_revision()
        assert report.recovery_point is None
    finally:
        await engine.dispose()


def _degrade_to_legacy_sql() -> tuple[str, ...]:
    """把当前形状的库退化为 create_all 时代形状（模拟旧安装）。"""
    return (
        "DROP TABLE alembic_version",
        "DROP INDEX IF EXISTS ix_agents_is_default",
        "DROP INDEX IF EXISTS ix_threads_archived",
        "DROP INDEX IF EXISTS ix_messages_thread_created_id",
        "DROP INDEX IF EXISTS ix_documents_source_sag_source",
        "ALTER TABLE agents DROP COLUMN is_default",
        "ALTER TABLE threads DROP COLUMN archived",
        "ALTER TABLE messages DROP COLUMN prompt_preview",
    )


@pytest.mark.asyncio
async def test_legacy_create_all_database_is_reconciled_and_stamped(tmp_path: Path):
    settings, paths, engine = _make(tmp_path)
    try:
        # 先建到最新，再退化出一个「create_all 时代」库（含业务数据表、无版本表、缺新列）
        await run_migrations(engine, settings, paths)
        async with engine.begin() as conn:
            for ddl in _degrade_to_legacy_sql():
                await conn.exec_driver_sql(ddl)
            await conn.exec_driver_sql(
                "INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) "
                "VALUES ('u1', 'a@b.c', 'Ada', 'x', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )

        report = await run_migrations(engine, settings, paths)
        assert report.applied is True
        assert report.from_revision is None
        assert report.stamped_legacy is True
        assert await _revision(engine) == head_revision()

        async with engine.connect() as conn:
            columns = await conn.run_sync(
                lambda sync: {c["name"] for c in sa_inspect(sync).get_columns("agents")}
            )
            indexes = await conn.run_sync(
                lambda sync: {i["name"] for i in sa_inspect(sync).get_indexes("messages")}
            )
            row = (await conn.exec_driver_sql("SELECT name FROM users")).fetchone()
        assert "is_default" in columns
        assert "ix_messages_thread_created_id" in indexes
        assert row is not None and row[0] == "Ada"  # 存量数据原样保留

        # 存量库升级前必须已落恢复点
        assert report.recovery_point is not None
        assert report.recovery_point.exists()
        assert report.recovery_point.parent == paths.backup_dir
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_recovery_points_pruned_to_three(tmp_path: Path):
    from sag_api.db import recovery

    settings, paths, engine = _make(tmp_path)
    try:
        await run_migrations(engine, settings, paths)
        assert paths.db_path is not None
        for i in range(5):
            recovery.create_recovery_point(
                paths.db_path,
                paths.backup_dir,
                from_revision=f"{i:04d}",
                app_version="test",
            )
        assert len(recovery.list_recovery_points(paths.backup_dir)) == 3
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_restore_recovery_point_round_trip(tmp_path: Path):
    from sag_api.db import recovery

    settings, paths, engine = _make(tmp_path)
    try:
        await run_migrations(engine, settings, paths)
        async with engine.begin() as conn:
            await conn.exec_driver_sql(
                "INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) "
                "VALUES ('u1', 'a@b.c', 'Ada', 'x', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        assert paths.db_path is not None
        backup = recovery.create_recovery_point(
            paths.db_path, paths.backup_dir, from_revision="0001", app_version="test"
        )
        assert backup is not None
        # 破坏性写入后还原
        async with engine.begin() as conn:
            await conn.exec_driver_sql("DELETE FROM users")
        await engine.dispose()

        recovery.restore_recovery_point(backup, paths.db_path)
        verify = create_async_engine(settings.database_url, future=True)
        try:
            async with verify.connect() as conn:
                row = (await conn.exec_driver_sql("SELECT name FROM users")).fetchone()
            assert row is not None and row[0] == "Ada"
        finally:
            await verify.dispose()
    finally:
        await engine.dispose()
