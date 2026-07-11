"""模型配置端点：GET 脱敏、PUT 持久化+生效、密钥保留、非法值 422、连接测试（离线）。

全程离线且**不留全局副作用**：`finally` 删除 settings 表行 + 还原被改的 `settings` 单例字段，
避免跨测试泄漏（端点会就地覆盖进程级单例）。连接测试只验证「未配置」分支（无网络）。
"""

import httpx
import pytest

from sag_api.core.config import Settings, settings

_RESTORE = (
    "llm_base_url",
    "llm_model",
    "llm_temperature",
    "llm_timeout_ms",
    "llm_max_retries",
    "document_chunk_max_tokens",
    "document_chunk_mode",
    "search_top_k",
    "sag_language",
    "llm_api_key",
    "document_parser",
    "mineru_base_url",
    "mineru_api_key",
    "mineru_version",
    "document_extract_concurrency",
)


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
                assert "mineru_api_key" not in body and body["mineru_api_key_set"] is False
                assert body["effective_document_parser"] == "markitdown"
                assert body["document_extract_concurrency"] == 5
                assert body["document_chunk_max_tokens"] == 1_000
                assert body["document_chunk_mode"] == "standard"
                assert body["llm_timeout_ms"] == 60_000
                assert body["llm_max_retries"] == 2
                assert "search_top_k" in body and "sag_language" in body

                # 连接测试（未配置）→ 立即 ok False，无网络
                t = (await c.post("/api/v1/system/model-config/test", headers=A)).json()
                assert t["ok"] is False and "message" in t

                # PUT 非密钥字段 → 持久化 + 生效 + capabilities 反映
                r = await c.put(
                    "/api/v1/system/model-config",
                    headers=A,
                    json={
                        "llm_model": "test-model-x",
                        "llm_timeout_ms": 45_000,
                        "llm_max_retries": 3,
                        "document_chunk_max_tokens": 1_600,
                        "document_chunk_mode": "heading_strict",
                        "search_top_k": 5,
                        "sag_language": "en",
                    },
                )
                assert r.status_code == 200, r.text
                assert r.json()["config"]["llm_model"] == "test-model-x"
                assert r.json()["capabilities"]["llm_model"] == "test-model-x"
                assert settings.llm_model == "test-model-x"  # 单例即时生效
                assert settings.llm_timeout_ms == 45_000
                assert settings.llm_max_retries == 3
                assert settings.document_chunk_max_tokens == 1_600
                assert settings.document_chunk_mode == "heading_strict"
                g = (await c.get("/api/v1/system/model-config", headers=A)).json()
                assert g["llm_model"] == "test-model-x" and g["search_top_k"] == 5
                assert g["sag_language"] == "en"
                assert g["llm_timeout_ms"] == 45_000 and g["llm_max_retries"] == 3
                assert g["document_chunk_max_tokens"] == 1_600
                assert g["document_chunk_mode"] == "heading_strict"

                # 密钥：设假 key → set=True 且不回显明文
                r = await c.put(
                    "/api/v1/system/model-config",
                    headers=A,
                    json={
                        "llm_base_url": "https://api.302.ai/v1",
                        "llm_api_key": "sk-fake-xyz",
                    },
                )
                assert r.json()["config"]["llm_api_key_set"] is True
                assert "sk-fake" not in r.text

                # 升级前已配置 302 的用户可在服务端复用旧 Key，一键补齐 MinerU。
                r = await c.post("/api/v1/system/model-config/mineru/302", headers=A)
                assert r.status_code == 200
                assert r.json()["config"]["mineru_base_url"] == "https://api.302.ai"
                assert r.json()["config"]["mineru_api_key_set"] is True
                assert "sk-fake" not in r.text
                # 留空提交 → 保留原 key（仍 set），同时更新其他字段
                r = await c.put(
                    "/api/v1/system/model-config",
                    headers=A,
                    json={"llm_api_key": "", "llm_model": "m2"},
                )
                assert r.json()["config"]["llm_api_key_set"] is True
                assert r.json()["config"]["llm_model"] == "m2"

                # 文档解析配置与密钥同样支持持久化、脱敏和即时生效。
                r = await c.put(
                    "/api/v1/system/model-config",
                    headers=A,
                    json={
                        "document_parser": "auto",
                        "mineru_base_url": "https://mineru.example.test",
                        "mineru_api_key": "sk-mineru-fake",
                        "mineru_version": "2.5",
                        "document_extract_concurrency": 7,
                    },
                )
                parser_config = r.json()["config"]
                assert parser_config["mineru_api_key_set"] is True
                assert parser_config["effective_document_parser"] == "mineru"
                assert parser_config["document_extract_concurrency"] == 7
                assert "sk-mineru-fake" not in r.text

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
                assert (
                    await c.put(
                        "/api/v1/system/model-config", headers=A, json={"document_parser": None}
                    )
                ).status_code == 422
                assert (
                    await c.put(
                        "/api/v1/system/model-config",
                        headers=A,
                        json={"document_extract_concurrency": 0},
                    )
                ).status_code == 422
                for invalid in (
                    {"llm_timeout_ms": 999},
                    {"llm_timeout_ms": None},
                    {"llm_max_retries": 11},
                    {"llm_max_retries": None},
                    {"document_chunk_max_tokens": 99},
                    {"document_chunk_max_tokens": None},
                    {"document_chunk_mode": "overlap"},
                    {"document_chunk_mode": None},
                ):
                    assert (
                        await c.put("/api/v1/system/model-config", headers=A, json=invalid)
                    ).status_code == 422
                assert (
                    await c.put(
                        "/api/v1/system/model-config",
                        headers=A,
                        json={"document_extract_concurrency": None},
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
