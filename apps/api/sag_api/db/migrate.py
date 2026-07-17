"""迁移 runner（ADR-0014）：Alembic 是元数据库模式演进的唯一机制。

三种库形态：
- 全新库           → 直接 `upgrade head`（首装即从版本化基线构建）；
- create_all 时代库 → 先跑一次性 reconcile 垫片（原 _COLUMN_UPGRADES /
  _INDEX_UPGRADES DDL 原样内迁），补齐到基线形状后 `stamp 0001` 再升级；
- 已版本化库        → 有 pending 才升级（升级前自动落 SQLite 恢复点）。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncEngine

from sag_api import __version__
from sag_api.core.config import Settings
from sag_api.core.logging import get_logger
from sag_api.core.paths import DataPaths
from sag_api.db import recovery

log = get_logger("db-migrate")

BASELINE_REVISION = "0001"


@dataclass(frozen=True)
class MigrationReport:
    from_revision: str | None
    to_revision: str
    applied: bool
    stamped_legacy: bool
    recovery_point: Path | None


def alembic_config(*, upload_root: str | None = None) -> AlembicConfig:
    """程序化构建配置：脚本目录取包内路径（冻结后仍有效），不读 alembic.ini。"""
    cfg = AlembicConfig()
    script_location = Path(__file__).resolve().parent / "migrations"
    cfg.set_main_option("script_location", str(script_location))
    if upload_root is not None:
        # 数据迁移（如 storage_key 回填）经 attributes 取运行时上传根。
        cfg.attributes["upload_root"] = upload_root
    return cfg


def head_revision() -> str:
    script = ScriptDirectory.from_config(alembic_config())
    head = script.get_current_head()
    if head is None:  # pragma: no cover —— 版本目录为空属于打包错误
        raise RuntimeError("迁移目录为空：没有可用的 head 版本")
    return head


# ── create_all 时代库的一次性 reconcile 垫片 ─────────────────────────────
# 原 core/db.py 的 _COLUMN_UPGRADES / _INDEX_UPGRADES 原样内迁；
# 只为把旧库补齐到基线形状后 stamp，此后所有演进走正式迁移脚本。

_LEGACY_COLUMN_UPGRADES: dict[str, dict[str, str]] = {
    "agents": {"is_default": "BOOLEAN NOT NULL DEFAULT 0"},
    "documents": {
        "progress": "INTEGER NOT NULL DEFAULT 0",
        "token_usage": "BIGINT NOT NULL DEFAULT 0",
    },
    "threads": {"archived": "BOOLEAN NOT NULL DEFAULT 0"},
    "messages": {
        "attachments_json": "JSON",
        "steps_json": "JSON",
        "prompt_preview": "TEXT NOT NULL DEFAULT ''",
    },
    "universe_dirty_sources": {"revision": "INTEGER NOT NULL DEFAULT 1"},
}

_LEGACY_INDEX_UPGRADES = (
    "CREATE INDEX IF NOT EXISTS ix_messages_thread_created_id ON messages (thread_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS ix_documents_source_sag_source ON documents (source_id, sag_source_id)",
)


def _existing_columns(sync_conn, table: str) -> set[str] | None:
    inspector = sa_inspect(sync_conn)
    if not inspector.has_table(table):
        return None
    return {column["name"] for column in inspector.get_columns(table)}


def _legacy_reconcile(sync_conn) -> None:
    """把 create_all 时代库补齐到基线形状（幂等）。"""
    from sag_api.db import models  # noqa: F401 —— 注册全部表
    from sag_api.db.base import Base

    # 期间新增的表（旧库可能缺）由 create_all 一次性补齐——只建缺失表，不改旧表。
    Base.metadata.create_all(sync_conn)
    for table, columns in _LEGACY_COLUMN_UPGRADES.items():
        existing = _existing_columns(sync_conn, table)
        if existing is None:
            continue
        for column, ddl in columns.items():
            if column not in existing:
                sync_conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    for ddl in _LEGACY_INDEX_UPGRADES:
        sync_conn.exec_driver_sql(ddl)


# ── 状态探测 ────────────────────────────────────────────────────────────


def _inspect_state(sync_conn) -> tuple[str | None, bool]:
    """返回 (alembic 当前版本或 None, 是否存在业务表)。"""
    inspector = sa_inspect(sync_conn)
    has_business = inspector.has_table("users")
    if not inspector.has_table("alembic_version"):
        return None, has_business
    row = sync_conn.exec_driver_sql("SELECT version_num FROM alembic_version").fetchone()
    return (row[0] if row else None), has_business


def _stamp(sync_conn, cfg: AlembicConfig, revision: str) -> None:
    cfg.attributes["connection"] = sync_conn
    command.stamp(cfg, revision)


def _upgrade(sync_conn, cfg: AlembicConfig) -> None:
    cfg.attributes["connection"] = sync_conn
    command.upgrade(cfg, "head")


async def current_revision(engine: AsyncEngine) -> str | None:
    async with engine.connect() as conn:
        revision, _ = await conn.run_sync(_inspect_state)
    return revision


async def run_migrations(
    engine: AsyncEngine,
    settings: Settings,
    paths: DataPaths,
) -> MigrationReport:
    """按库形态执行迁移；升级前自动落恢复点（ADR-0014）。"""
    cfg = alembic_config(upload_root=settings.upload_dir)
    target = head_revision()

    async with engine.connect() as conn:
        revision, has_business = await conn.run_sync(_inspect_state)

    if revision == target:
        return MigrationReport(
            from_revision=revision,
            to_revision=target,
            applied=False,
            stamped_legacy=False,
            recovery_point=None,
        )

    recovery_point: Path | None = None
    if paths.db_path is not None and (has_business or revision is not None):
        recovery_point = recovery.create_recovery_point(
            paths.db_path,
            paths.backup_dir,
            from_revision=revision,
            app_version=__version__,
        )

    stamped_legacy = False
    async with engine.begin() as conn:
        if revision is None and has_business:
            # create_all 时代库：补齐 → stamp 基线，再走正式升级。
            log.info("检测到未版本化的存量库，reconcile 后 stamp 至基线 %s", BASELINE_REVISION)
            await conn.run_sync(_legacy_reconcile)
            await conn.run_sync(_stamp, cfg, BASELINE_REVISION)
            stamped_legacy = True
        await conn.run_sync(_upgrade, cfg)

    log.info(
        "迁移完成：%s → %s%s",
        revision or ("legacy" if has_business else "fresh"),
        target,
        "（含存量库 stamp）" if stamped_legacy else "",
    )
    return MigrationReport(
        from_revision=revision,
        to_revision=target,
        applied=True,
        stamped_legacy=stamped_legacy,
        recovery_point=recovery_point,
    )
