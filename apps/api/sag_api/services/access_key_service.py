"""本地访问密钥（ADR-0011）。

首装自动生成一把长期有效的本地访问密钥，供全部外部 API / MCP 宿主共用；
设置页只提供复制与换发（换发即时吊销旧钥）。密钥映射到首个用户
（单用户产品的整库语义），不引入 per-host/权限/过期体系。

存放于 settings 表（明文——与本地单用户产品既有的 llm_api_key 策略一致，
UI 需要可复制的原文）；进程内缓存一份用于热路径比对，换发时原子替换。
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.errors import AuthError
from sag_api.core.logging import get_logger
from sag_api.db.models import Setting, User

log = get_logger("access-key")

KEY_PREFIX = "sag_lak_"
_SCOPE = "global"
_KEY = "local_access_key"

_cached_key: str | None = None


def _generate() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def current_key() -> str | None:
    """进程内缓存的当前密钥（未初始化时为 None）。"""
    return _cached_key


def _set_cache(value: str | None) -> None:
    global _cached_key
    _cached_key = value


async def _row(session: AsyncSession) -> Setting | None:
    return await session.scalar(
        select(Setting).where(Setting.scope == _SCOPE, Setting.key == _KEY)
    )


async def ensure_local_access_key(session_factory) -> str:
    """lifespan 调用：缺失则生成并持久化，随后预热缓存。幂等。"""
    async with session_factory() as session:
        row = await _row(session)
        if row is None or not (row.value or {}).get("key"):
            value = {
                "key": _generate(),
                "created_at": datetime.now(UTC).isoformat(),
                "regenerated_at": None,
            }
            if row is None:
                session.add(Setting(scope=_SCOPE, key=_KEY, value=value))
            else:
                row.value = value
            await session.commit()
            log.info("已生成本地访问密钥（首装引导，供外部 API/MCP 宿主使用）")
            _set_cache(value["key"])
            return value["key"]
        _set_cache(row.value["key"])
        return row.value["key"]


async def get_local_access_key(session: AsyncSession) -> dict:
    row = await _row(session)
    if row is None or not (row.value or {}).get("key"):
        raise AuthError("本地访问密钥尚未初始化")
    return dict(row.value)


async def regenerate_local_access_key(session: AsyncSession) -> dict:
    """换发：写入新钥并原子替换缓存 —— 旧钥立即失效（ADR-0011）。"""
    row = await _row(session)
    value = {
        "key": _generate(),
        "created_at": ((row.value or {}).get("created_at") if row else None)
        or datetime.now(UTC).isoformat(),
        "regenerated_at": datetime.now(UTC).isoformat(),
    }
    if row is None:
        session.add(Setting(scope=_SCOPE, key=_KEY, value=value))
    else:
        row.value = value
    await session.commit()
    _set_cache(value["key"])
    log.info("本地访问密钥已换发，旧钥即时失效")
    return dict(value)


async def authenticate_access_key(session: AsyncSession, candidate: str) -> User:
    """校验密钥并映射到首个用户（整库单用户语义）。"""
    expected = current_key()
    if expected is None:
        row = await _row(session)
        expected = (row.value or {}).get("key") if row else None
        if expected:
            _set_cache(expected)
    if not expected or not secrets.compare_digest(candidate, expected):
        raise AuthError("本地访问密钥无效或已被换发")
    user = await session.scalar(
        select(User).where(User.is_active.is_(True)).order_by(User.created_at, User.id)
    )
    if user is None:
        raise AuthError("尚无本地用户：请先在应用中完成初始化")
    return user
