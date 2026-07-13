from __future__ import annotations

from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from sag_api.enums import SearchStrategy


class QuickModelSetupRequest(BaseModel):
    api_key: str = Field(min_length=1, max_length=500)

    @field_validator("api_key")
    @classmethod
    def normalize_api_key(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("API Key 不能为空")
        return value


class SystemPreferencesUpdate(BaseModel):
    timezone: str = Field(min_length=1, max_length=100)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        normalized = value.strip()
        try:
            ZoneInfo(normalized)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("必须使用有效的 IANA 时区，例如 Asia/Shanghai") from error
        return normalized


class ModelConfigUpdate(BaseModel):
    """模型与检索配置的部分更新（未出现的字段保持不变）。

    密钥字段留空表示「保持原值」（不清空）；base_url / dimensions 留空表示清除。
    """

    llm_base_url: str | None = Field(default=None, max_length=500)
    llm_api_key: str | None = Field(default=None, max_length=500)
    llm_model: str | None = Field(default=None, min_length=1, max_length=200)
    llm_temperature: float | None = Field(default=None, ge=0, le=2)
    llm_max_tokens: int | None = Field(default=None, ge=1, le=32768)
    llm_context_window: int | None = Field(default=None, ge=1024, le=2_000_000)

    embedding_model: str | None = Field(default=None, min_length=1, max_length=200)
    embedding_base_url: str | None = Field(default=None, max_length=500)
    embedding_api_key: str | None = Field(default=None, max_length=500)
    embedding_dimensions: int | None = Field(default=None, ge=1, le=8192)

    document_parser: Literal["auto", "markitdown", "mineru"] | None = None
    mineru_base_url: str | None = Field(default=None, max_length=500)
    mineru_api_key: str | None = Field(default=None, max_length=500)
    mineru_version: Literal["2.0", "2.5"] | None = None

    search_strategy: SearchStrategy | None = None
    search_top_k: int | None = Field(default=None, ge=1, le=50)
    sag_language: Literal["zh", "en"] | None = None

    @field_validator("document_parser", "mineru_version")
    @classmethod
    def reject_null_parser_fields(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("解析器与 MinerU 版本不能为 null")
        return value
