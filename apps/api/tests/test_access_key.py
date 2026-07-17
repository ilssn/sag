"""本地访问密钥（ADR-0011）：首启生成、REST/MCP 接受、换发即废、JWT 不受影响。"""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.asyncio
async def test_access_key_lifecycle_end_to_end():
    from sag_api.main import app
    from sag_api.services import access_key_service

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # lifespan 已生成密钥
            key = access_key_service.current_key()
            assert key is not None and key.startswith(access_key_service.KEY_PREFIX)

            # 建立首个用户（LAK 映射目标）并取 JWT
            register = await client.post(
                "/api/v1/auth/register",
                json={"email": "k@e.y", "password": "password123", "name": "Key"},
            )
            assert register.status_code == 201
            jwt_headers = {"Authorization": f"Bearer {register.json()['access_token']}"}
            lak_headers = {"Authorization": f"Bearer {key}"}

            # REST 接受 LAK（等价首个用户）
            me = await client.get("/api/v1/auth/me", headers=lak_headers)
            assert me.status_code == 200
            assert me.json()["name"] == "Key"

            # 设置页读取端点（JWT 鉴权）返回原文
            exposed = await client.get("/api/v1/system/local-access-key", headers=jwt_headers)
            assert exposed.status_code == 200
            assert exposed.json()["key"] == key

            # MCP 描述符直接携带真实密钥
            descriptor = await client.get("/api/v1/system/mcp", headers=jwt_headers)
            assert descriptor.json()["http"]["headers"]["Authorization"] == f"Bearer {key}"

            # 换发：旧钥 401，新钥 200，JWT 不受影响
            regenerated = await client.post(
                "/api/v1/system/local-access-key/regenerate", headers=jwt_headers
            )
            new_key = regenerated.json()["key"]
            assert new_key != key
            assert (await client.get("/api/v1/auth/me", headers=lak_headers)).status_code == 401
            assert (
                await client.get(
                    "/api/v1/auth/me", headers={"Authorization": f"Bearer {new_key}"}
                )
            ).status_code == 200
            assert (await client.get("/api/v1/auth/me", headers=jwt_headers)).status_code == 200


@pytest.mark.asyncio
async def test_access_key_requires_existing_user(tmp_path):
    """尚无用户时 LAK 401 且给出初始化指引。"""
    from sag_api.core.db import SessionLocal, init_db
    from sag_api.core.errors import AuthError
    from sag_api.services import access_key_service

    await init_db()
    key = await access_key_service.ensure_local_access_key(SessionLocal)

    from sqlalchemy import delete

    from sag_api.db.models import User

    async with SessionLocal() as session:
        await session.execute(delete(User))
        await session.commit()
        with pytest.raises(AuthError, match="初始化"):
            await access_key_service.authenticate_access_key(session, key)


@pytest.mark.asyncio
async def test_wrong_key_rejected():
    from sag_api.core.db import SessionLocal, init_db
    from sag_api.core.errors import AuthError
    from sag_api.services import access_key_service

    await init_db()
    await access_key_service.ensure_local_access_key(SessionLocal)
    async with SessionLocal() as session:
        with pytest.raises(AuthError):
            await access_key_service.authenticate_access_key(
                session, access_key_service.KEY_PREFIX + "forged"
            )


def test_desktop_first_run_secret_persisted(tmp_path):
    from sag_api.core.config import Settings
    from sag_api.core.security import INSECURE_SECRETS, ensure_runtime_secrets

    secret_path = tmp_path / "secret.key"
    # 注：litellm 导入时会把 CWD .env 灌入 os.environ，默认值不可依赖——显式传入不安全密钥
    insecure = next(iter(INSECURE_SECRETS))
    s = Settings(
        _env_file=None, runtime_mode="desktop", data_root=str(tmp_path), secret_key=insecure
    )
    ensure_runtime_secrets(s, secret_path)
    first = s.secret_key
    assert first not in INSECURE_SECRETS and len(first) == 64
    assert secret_path.read_text().strip() == first
    assert (secret_path.stat().st_mode & 0o777) == 0o600

    # 二次启动读取同一密钥（JWT 跨重启有效）
    s2 = Settings(
        _env_file=None, runtime_mode="desktop", data_root=str(tmp_path), secret_key=insecure
    )
    ensure_runtime_secrets(s2, secret_path)
    assert s2.secret_key == first

    # 显式 SAG_SECRET_KEY 优先：不触碰文件
    s3 = Settings(
        _env_file=None, runtime_mode="desktop", data_root=str(tmp_path), secret_key="x" * 40
    )
    ensure_runtime_secrets(s3, secret_path)
    assert s3.secret_key == "x" * 40

    # standard 模式不做任何事
    s4 = Settings(_env_file=None, secret_key=insecure)
    ensure_runtime_secrets(s4, tmp_path / "other.key")
    assert s4.secret_key == insecure
    assert not (tmp_path / "other.key").exists()
