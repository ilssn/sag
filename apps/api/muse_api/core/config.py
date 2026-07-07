"""应用配置（pydantic-settings）。

所有配置项均可通过环境变量 `MUSE_*` 或 `.env` 覆盖。设计上区分三类后端：

- **muse 元数据库**（用户 / 信源 / 文档 / 会话）：`database_url`
- **zleap-sag 存储**（分块 / 向量 / 事件图谱）：`sag_*` + `data_dir`
- **LLM / embedding**（抽取与答案生成）：`llm_*` / `embedding_*`

默认零依赖：SQLite 元数据 + zleap-sag 本地 LanceDB。生产可整体切到 Postgres。
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MUSE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── 应用 ────────────────────────────────────────────────────────────
    app_name: str = "muse"
    environment: Literal["dev", "prod"] = "dev"
    debug: bool = True
    secret_key: str = "dev-insecure-secret-change-me-in-production-0123456789"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 天
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # ── muse 元数据库 ───────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./.muse/muse.db"

    # ── 存储 ────────────────────────────────────────────────────────────
    data_dir: str = "./.muse/zleap"       # zleap-sag data_dir（LanceDB + SQLite）
    upload_dir: str = "./.muse/uploads"   # 上传原始文件落盘
    max_upload_mb: int = 25               # 单文件上传上限
    job_concurrency: int = 2              # 后台处理并发

    # ── zleap-sag 后端选择 ─────────────────────────────────────────────
    # None → 零基础设施（LanceDB + 内置 SQLite，落在 data_dir）
    sag_vector_provider: Literal["lancedb", "es", "pgvector", "oceanbase"] = "lancedb"
    sag_relational_provider: Literal["sqlite", "postgres", "mysql", "oceanbase"] | None = None
    sag_language: Literal["zh", "en"] = "zh"

    # 生产单库（pgvector）时复用同一 Postgres —— 由这些字段拼装
    sag_pg_host: str = "localhost"
    sag_pg_port: int = 5432
    sag_pg_user: str = "muse"
    sag_pg_password: str = "muse"
    sag_pg_database: str = "muse"

    # ── LLM（答案生成 + 抽取），OpenAI 兼容 ────────────────────────────
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str = "qwen3.6-flash"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 2048

    # ── Embedding（缺省复用 LLM 的 key / base_url）─────────────────────
    embedding_model: str = "bge-large-en-v1.5"
    embedding_base_url: str | None = None
    embedding_api_key: str | None = None
    embedding_dimensions: int | None = None

    # ── 检索默认 ────────────────────────────────────────────────────────
    search_strategy: Literal["multi", "vector", "atomic"] = "multi"
    search_top_k: int = 8

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        """允许用逗号分隔的字符串配置 CORS 源。"""
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return []
            if not v.startswith("["):
                return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def llm_configured(self) -> bool:
        """LLM 是否已配置（决定抽取 / 问答能否真正运行）。"""
        return bool(self.llm_api_key)

    @property
    def effective_embedding_api_key(self) -> str | None:
        return self.embedding_api_key or self.llm_api_key

    @property
    def effective_embedding_base_url(self) -> str | None:
        return self.embedding_base_url or self.llm_base_url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
