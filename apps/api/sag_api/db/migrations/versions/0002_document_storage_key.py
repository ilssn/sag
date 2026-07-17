"""documents.storage_path → storage_key（ADR-0013：相对键 + 数据回填）

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-17

回填策略（upload_root 由 migrate.alembic_config 经 attributes 注入）：
1. 路径解析后位于 upload_root 内 → 取相对 posix 键（正常情形）；
2. 不在根内但 upload_root/{source_id}/{basename} 实际存在 → 采用该键
   （恢复相对拼写漂移时期写入的行）；
3. 其余（孤儿：文件不在受管根内）→ `_orphaned/{doc_id}/{basename}`，
   一个永不解析成功的键 —— 走既有「原始文件不存在或已被清理」404 文案；
   原文件在原处不动，绝不删除。
"""
from __future__ import annotations

import sys
from pathlib import Path, PurePosixPath

import sqlalchemy as sa
from alembic import context, op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _to_key(raw_path: str | None, upload_root: Path, source_id: str, doc_id: str) -> str:
    basename = Path(raw_path).name if raw_path else "unknown"
    if raw_path:
        try:
            resolved = Path(raw_path).expanduser().resolve()
        except OSError:
            resolved = None
        if resolved is not None and resolved.is_relative_to(upload_root):
            return str(PurePosixPath(*resolved.relative_to(upload_root).parts))
        candidate = upload_root / source_id / basename
        if candidate.is_file():
            return str(PurePosixPath(source_id, basename))
    return str(PurePosixPath("_orphaned", doc_id, basename))


def upgrade() -> None:
    bind = op.get_bind()
    # 防御：reconcile 垫片可能已用当前模型补建缺失表（直接带 storage_key 形状）。
    columns = {c["name"] for c in sa.inspect(bind).get_columns("documents")}
    if "storage_key" in columns and "storage_path" not in columns:
        return
    upload_root = Path(
        context.config.attributes.get("upload_root") or "./.data/uploads"
    ).resolve()

    rows = bind.execute(
        sa.text("SELECT id, source_id, storage_path FROM documents")
    ).fetchall()
    converted = recovered = orphaned = 0
    for doc_id, source_id, raw_path in rows:
        key = _to_key(raw_path, upload_root, source_id, doc_id)
        if key.startswith("_orphaned/"):
            orphaned += 1
        elif raw_path and not raw_path.startswith(str(upload_root)):
            recovered += 1
        else:
            converted += 1
        bind.execute(
            sa.text("UPDATE documents SET storage_path = :key WHERE id = :id"),
            {"key": key, "id": doc_id},
        )

    with op.batch_alter_table("documents") as batch:
        batch.alter_column("storage_path", new_column_name="storage_key")

    # stdout 是 sidecar 协议通道（ADR-0017），迁移日志一律走 stderr
    print(
        f"[0002] storage_key 回填完成：converted={converted} "
        f"recovered={recovered} orphaned={orphaned}",
        file=sys.stderr,
    )


def downgrade() -> None:
    upload_root = Path(
        context.config.attributes.get("upload_root") or "./.data/uploads"
    ).resolve()
    with op.batch_alter_table("documents") as batch:
        batch.alter_column("storage_key", new_column_name="storage_path")
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, storage_path FROM documents")).fetchall()
    for doc_id, key in rows:
        if key and not key.startswith("_orphaned/") and not Path(key).is_absolute():
            bind.execute(
                sa.text("UPDATE documents SET storage_path = :path WHERE id = :id"),
                {"path": str(upload_root / key), "id": doc_id},
            )
