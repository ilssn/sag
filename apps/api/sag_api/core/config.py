"""应用配置（pydantic-settings）。

所有配置项均可通过环境变量 `SAG_*` 或 `.env` 覆盖。设计上区分三类后端：

- **sag 元数据库**（用户 / 信源 / 文档 / 会话）：`database_url`
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
        env_prefix="SAG_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── 应用 ────────────────────────────────────────────────────────────
    app_name: str = "sag"
    environment: Literal["dev", "prod"] = "dev"
    debug: bool = True
    secret_key: str = "dev-insecure-secret-change-me-in-production-0123456789"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 天
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    # 关闭后仅允许首个用户注册（部署引导），其余返回 403
    allow_registration: bool = True

    # ── sag 元数据库 ───────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./.data/sag.db"

    # ── 存储 ────────────────────────────────────────────────────────────
    data_dir: str = "./.data/engine"       # zleap-sag data_dir（LanceDB + SQLite）
    upload_dir: str = "./.data/uploads"   # 上传原始文件落盘
    max_upload_mb: int = 25               # 单文件上传上限
    job_concurrency: int = 2              # 后台处理并发
    job_max_attempts: int = 3             # 可重试失败的最大尝试次数（含首次）
    engine_cache_size: int = 16           # 引擎槽 LRU 上限（超限逐出最久未用）
    engine_warmup_count: int = 4          # 启动时预热最近使用的信源引擎数
    # 允许上传的扩展名白名单（小写，含点）；空集合表示不限制
    allowed_upload_exts: set[str] = {
        ".md", ".markdown", ".txt", ".text", ".pdf", ".doc", ".docx",
        ".ppt", ".pptx", ".xls", ".xlsx", ".csv", ".tsv", ".html", ".htm",
        ".json", ".rtf", ".epub", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    }

    # ── zleap-sag 后端选择 ─────────────────────────────────────────────
    # None → 零基础设施（LanceDB + 内置 SQLite，落在 data_dir）
    sag_vector_provider: Literal["lancedb", "es", "pgvector", "oceanbase"] = "lancedb"
    sag_relational_provider: Literal["sqlite", "postgres", "mysql", "oceanbase"] | None = None
    sag_language: Literal["zh", "en"] = "zh"

    # 生产单库（pgvector）时复用同一 Postgres —— 由这些字段拼装
    sag_pg_host: str = "localhost"
    sag_pg_port: int = 5432
    sag_pg_user: str = "sag"
    sag_pg_password: str = "sag"
    sag_pg_database: str = "sag"

    # ── LLM（答案生成 + 抽取），OpenAI 兼容 ────────────────────────────
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str = "qwen3.6-flash"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 2048
    llm_context_window: int = 128_000  # 模型上下文窗口（供用量圆环分母）
    llm_request_timeout: float = 120.0  # 单次 LLM 请求超时（秒）；不设则 SDK 默认 600s×重试=假死

    # ── Embedding（缺省复用 LLM 的 key / base_url）─────────────────────
    embedding_model: str = "bge-large-en-v1.5"
    embedding_base_url: str | None = None
    embedding_api_key: str | None = None
    embedding_dimensions: int | None = None

    # ── 检索默认 ────────────────────────────────────────────────────────
    search_strategy: Literal["multi", "vector", "atomic"] = "multi"
    search_top_k: int = 8
    # multi（图谱增强）含查询侧 LLM 往返：给每个信源设时限，超时/失败/空结果自动回退 vector
    search_source_timeout: float = 12.0
    search_fallback_vector: bool = True

    # ── Agent 循环 ──────────────────────────────────────────────────────
    agent_max_steps: int = 6              # 工具调用最大轮数（多轮检索的上界）
    history_keep_recent: int = 8          # 历史压缩时原文保留的最近消息数

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
