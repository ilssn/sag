"""模型配置端点：GET 脱敏、PUT 持久化+生效、密钥保留、非法值 422、连接测试（离线）。

全程离线且**不留全局副作用**：`finally` 删除 settings 表行 + 还原被改的 `settings` 单例字段，
避免跨测试泄漏（端点会就地覆盖进程级单例）。连接测试只验证「未配置」分支（无网络）。
"""

import httpx
import pytest

from sag_api.core.config import Settings, settings

_RESTORE = ("llm_model", "llm_temperature", "search_top_k", "sag_language", "llm_api_key")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("http://localhost:3000", ["http://localhost:3000"]),
        (
            "http://localhost:3000,https://sag.example.com",
            ["http://localhost:3000", "https://sag.example.com"],
        ),
        ('["http://localhost:3000"]', ["http://localhost:3000"]),
    ],
)
def test_cors_origins_env_formats(monkeypatch, raw, expected):
    monkeypatch.setenv("SAG_CORS_ORIGINS", raw)
    assert Settings(_env_file=None).cors_origins == expected


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_model_config_crud_masking_and_test():
    from sqlalchemy import delete

    from sag_api.core.db import SessionLocal
    from sag_api.db.models import Setting
    from sag_api.main import app

    snapshot = {k: getattr(settings, k) for k in _RESTORE}
    transport = httpx.ASGITransport(app=app)
    try:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
                A = await _register(c, "modelcfg@t.com")

                # GET：密钥脱敏为 *_set，离线下未配置
                body = (await c.get("/api/v1/system/model-config", headers=A)).json()
                assert "llm_api_key" not in body and body["llm_api_key_set"] is False
                assert "search_top_k" in body and "sag_language" in body

                # 连接测试（未配置）→ 立即 ok False，无网络
                t = (await c.post("/api/v1/system/model-config/test", headers=A)).json()
                assert t["ok"] is False and "message" in t

                # PUT 非密钥字段 → 持久化 + 生效 + capabilities 反映
                r = await c.put(
                    "/api/v1/system/model-config",
                    headers=A,
                    json={"llm_model": "test-model-x", "search_top_k": 5, "sag_language": "en"},
                )
                assert r.status_code == 200, r.text
                assert r.json()["config"]["llm_model"] == "test-model-x"
                assert r.json()["capabilities"]["llm_model"] == "test-model-x"
                assert settings.llm_model == "test-model-x"  # 单例即时生效
                g = (await c.get("/api/v1/system/model-config", headers=A)).json()
                assert g["llm_model"] == "test-model-x" and g["search_top_k"] == 5
                assert g["sag_language"] == "en"

                # 密钥：设假 key → set=True 且不回显明文
                r = await c.put(
                    "/api/v1/system/model-config", headers=A, json={"llm_api_key": "sk-fake-xyz"}
                )
                assert r.json()["config"]["llm_api_key_set"] is True
                assert "sk-fake" not in r.text
                # 留空提交 → 保留原 key（仍 set），同时更新其他字段
                r = await c.put(
                    "/api/v1/system/model-config",
                    headers=A,
                    json={"llm_api_key": "", "llm_model": "m2"},
                )
                assert r.json()["config"]["llm_api_key_set"] is True
                assert r.json()["config"]["llm_model"] == "m2"

                # 非法值 → 422（Literal / 越界）
                assert (
                    await c.put(
                        "/api/v1/system/model-config", headers=A, json={"search_strategy": "nope"}
                    )
                ).status_code == 422
                assert (
                    await c.put(
                        "/api/v1/system/model-config", headers=A, json={"search_top_k": 999}
                    )
                ).status_code == 422
    finally:
        async with SessionLocal() as s:
            await s.execute(
                delete(Setting).where(Setting.scope == "global", Setting.key == "model_config")
            )
            await s.commit()
        for key, value in snapshot.items():
            setattr(settings, key, value)
