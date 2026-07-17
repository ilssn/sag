"""迁移前 SQLite 恢复点（ADR-0014）。

用 sqlite3 在线备份 API（WAL 下也一致），不是裸拷贝文件。
恢复 = 用备份覆盖 sag.db（先移除 -wal/-shm），由 CLI/壳侧执行。
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from sag_api.core.logging import get_logger

log = get_logger("db-recovery")

_KEEP_DEFAULT = 3


def create_recovery_point(
    db_path: Path,
    backup_dir: Path,
    *,
    from_revision: str | None,
    app_version: str,
    keep: int = _KEEP_DEFAULT,
) -> Path | None:
    """升级前落一份一致性备份；数据库文件不存在时返回 None。"""
    if not db_path.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    label = from_revision or "legacy"
    target = backup_dir / f"sag-{stamp}-{label}-pre{app_version}.db"

    source = sqlite3.connect(str(db_path))
    try:
        destination = sqlite3.connect(str(target))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()

    log.info("已创建迁移恢复点：%s", target)
    _prune(backup_dir, keep)
    return target


def list_recovery_points(backup_dir: Path) -> list[Path]:
    if not backup_dir.is_dir():
        return []
    return sorted(backup_dir.glob("sag-*.db"), reverse=True)


def restore_recovery_point(backup: Path, db_path: Path) -> None:
    """用备份覆盖当前元数据库（服务停止状态下执行；ADR-0014 回滚路径）。"""
    if not backup.exists():
        raise FileNotFoundError(f"恢复点不存在：{backup}")
    for suffix in ("-wal", "-shm"):
        sidecar = db_path.with_name(db_path.name + suffix)
        sidecar.unlink(missing_ok=True)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(str(backup))
    try:
        destination = sqlite3.connect(str(db_path))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    log.info("已从恢复点还原：%s → %s", backup, db_path)


def _prune(backup_dir: Path, keep: int) -> None:
    for stale in list_recovery_points(backup_dir)[keep:]:
        try:
            stale.unlink()
            log.info("清理过期恢复点：%s", stale)
        except OSError as error:  # noqa: PERF203
            log.warning("清理恢复点失败 %s：%s", stale, error)
