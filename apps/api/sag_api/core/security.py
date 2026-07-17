"""认证原语：密码哈希（bcrypt）、JWT 令牌与首启密钥引导。"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import bcrypt
import jwt

from sag_api.core.config import Settings, settings

_ALGO = "HS256"
_BCRYPT_MAX_BYTES = 72  # bcrypt 硬限制

# 已知不安全的默认密钥（prod 拒绝启动；desktop 首启自动替换为持久随机值）
INSECURE_SECRETS = frozenset(
    {
        "dev-insecure-secret-change-me-in-production-0123456789",
        "please-change-this-in-production-0123456789",
        "dev-secret-change-me",
    }
)


def ensure_runtime_secrets(runtime_settings: Settings, secret_key_path: Path) -> None:
    """desktop 模式首启：把不安全默认密钥替换为持久随机值（ADR-0011/0012）。

    存放于 {data_root}/secret.key（0600）而非数据库——恢复点回滚元数据库
    不应连带回滚/失效签名密钥；显式 SAG_SECRET_KEY 始终最高优先。
    """
    if runtime_settings.runtime_mode != "desktop":
        return
    if runtime_settings.secret_key not in INSECURE_SECRETS and runtime_settings.secret_key:
        return
    if secret_key_path.exists():
        value = secret_key_path.read_text(encoding="utf-8").strip()
    else:
        value = secrets.token_hex(32)
        secret_key_path.parent.mkdir(parents=True, exist_ok=True)
        secret_key_path.write_text(value + "\n", encoding="utf-8")
        secret_key_path.chmod(0o600)
    # settings 单例运行时覆盖（与 settings_service 相同模式）
    object.__setattr__(runtime_settings, "secret_key", value)


def _clip(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_clip(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_clip(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGO)


def decode_token(token: str) -> dict[str, Any]:
    """解码并校验 JWT；失败抛 `jwt.PyJWTError`。"""
    return jwt.decode(token, settings.secret_key, algorithms=[_ALGO])
