"""Alembic 环境：支持两种进入方式。

1. 运行时（sag_api.db.migrate）：经 config.attributes["connection"] 注入的
   已建立同步连接（async 引擎 run_sync 包装），不自行建连。
2. 开发 CLI（alembic -c apps/api/alembic.ini …）：读取 SAG_DATABASE_URL /
   sqlalchemy.url 自行建连（async URL 自动降级为同步方言做 autogenerate）。
"""

from __future__ import annotations

import os

from alembic import context
from sqlalchemy import create_engine, pool

from sag_api.db import models  # noqa: F401 —— 注册全部表到 metadata
from sag_api.db.base import Base

config = context.config
target_metadata = Base.metadata


def _database_url() -> str:
    url = (
        config.get_main_option("sqlalchemy.url")
        or os.environ.get("SAG_DATABASE_URL")
        or "sqlite+aiosqlite:///./.data/sag.db"
    )
    # CLI 路径用同步方言（autogenerate/upgrade 均为同步 API）。
    return url.replace("sqlite+aiosqlite", "sqlite").replace(
        "postgresql+asyncpg", "postgresql"
    )


def _configure_and_run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=True,  # SQLite ALTER 依赖 batch 模式
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_as_batch=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    injected = config.attributes.get("connection")
    if injected is not None:
        _configure_and_run(injected)
        return
    engine = create_engine(_database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        _configure_and_run(connection)
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
