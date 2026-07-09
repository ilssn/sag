"""运行期模型配置 —— DB 覆盖层叠加在 env 默认（`settings` 单例）之上。

单用户本地示范：把「模型与检索」配置存进 `settings` 表（scope=global, key=model_config）。
启动时与保存后**就地覆盖 `settings` 单例**的相应字段，端点再重建 `LLMClient` / 重置暖引擎，
使配置改动**无需重启即生效**。api_key 明文入库（本地单用户可接受），读取时脱敏（只返回是否已设）。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sag_api.core.config import Settings
from sag_api.core.config import settings as _settings
from sag_api.db.models import Setting

_SCOPE = "global"
_KEY = "model_config"

# 允许运行期覆盖的字段（值已由请求 schema 校验/转型）
_FIELDS = frozenset(
    {
        "llm_base_url",
        "llm_api_key",
        "llm_model",
        "llm_temperature",
        "llm_max_tokens",
        "llm_context_window",
        "embedding_model",
        "embedding_base_url",
        "embedding_api_key",
        "embedding_dimensions",
        "search_strategy",
        "search_top_k",
        "sag_language",
    }
)
_SECRET_FIELDS = frozenset({"llm_api_key", "embedding_api_key"})
_NULLABLE_FIELDS = frozenset({"llm_base_url", "embedding_base_url", "embedding_dimensions"})


async def _load_row(session: AsyncSession) -> Setting | None:
    return await session.scalar(
        select(Setting).where(Setting.scope == _SCOPE, Setting.key == _KEY)
    )


async def load_overrides(session: AsyncSession) -> dict:
    row = await _load_row(session)
    return dict(row.value) if row and isinstance(row.value, dict) else {}


def apply_overrides(settings: Settings, overrides: dict) -> None:
    """把存储的覆盖值就地写回 settings 单例（请求 schema 已保证类型合法）。"""
    for key, value in overrides.items():
        if key in _FIELDS:
            setattr(settings, key, value)


async def apply_startup_overrides(session_factory: async_sessionmaker) -> None:
    """启动时：把 DB 里的模型配置覆盖到 settings 单例（在构建 LLMClient 之前调用）。"""
    async with session_factory() as session:
        apply_overrides(_settings, await load_overrides(session))


def effective_model_config() -> dict:
    """当前生效的模型配置（读 settings 单例；密钥脱敏为 *_set 布尔）。"""
    return {
        "llm_base_url": _settings.llm_base_url,
        "llm_model": _settings.llm_model,
        "llm_temperature": _settings.llm_temperature,
        "llm_max_tokens": _settings.llm_max_tokens,
        "llm_context_window": _settings.llm_context_window,
        "llm_api_key_set": bool(_settings.llm_api_key),
        "embedding_model": _settings.embedding_model,
        "embedding_base_url": _settings.embedding_base_url,
        "embedding_dimensions": _settings.embedding_dimensions,
        "embedding_api_key_set": bool(_settings.embedding_api_key),
        "search_strategy": _settings.search_strategy,
        "search_top_k": _settings.search_top_k,
        "sag_language": _settings.sag_language,
    }


async def save_model_config(session: AsyncSession, patch: dict) -> dict:
    """合并保存模型配置：入库 + 覆盖 settings 单例；返回生效配置（脱敏）。

    约定（配合 `exclude_unset`）：
    - 字段未出现 → 保持不变；
    - 密钥字段值为空 → 忽略（保留原密钥，避免误清空）；空值仅经显式非空覆盖；
    - 可空字段（base_url / dimensions）值为空 → 置 None（清除）。
    """
    row = await _load_row(session)
    stored = dict(row.value) if row and isinstance(row.value, dict) else {}

    for key, value in patch.items():
        if key not in _FIELDS:
            continue
        if key in _SECRET_FIELDS:
            if value:  # 仅非空才更新；空/None 保留原值
                stored[key] = str(value)
            continue
        if key in _NULLABLE_FIELDS and (value is None or value == ""):
            stored[key] = None
            continue
        stored[key] = value

    if row is None:
        session.add(Setting(scope=_SCOPE, key=_KEY, value=stored))
    else:
        row.value = stored
    await session.commit()

    apply_overrides(_settings, stored)
    return effective_model_config()
