"""全局搜索策略覆盖：请求值必须经过校验并传给检索引擎。"""

import httpx
import pytest


async def _register(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "search-strategy@t.com", "password": "password123"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_global_search_forwards_validated_strategy():
    from sag_api.core.deps import get_engine_manager
    from sag_api.main import app
    from sag_api.sag.dto import SearchOutcome

    class RecordingEngine:
        strategy: str | None = None
        top_k: int | None = None

        async def provision(self, *_args):
            return None

        async def search_many(self, targets, query, *, strategy=None, top_k=None):
            self.strategy = strategy
            self.top_k = top_k
            return SearchOutcome(query=query, sections=[], stats={"strategy": strategy})

    engine = RecordingEngine()
    app.dependency_overrides[get_engine_manager] = lambda: engine
    try:
        transport = httpx.ASGITransport(app=app)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
                headers = await _register(client)
                source = await client.post(
                    "/api/v1/sources",
                    headers=headers,
                    json={"name": "检索策略测试源"},
                )
                assert source.status_code == 201, source.text

                response = await client.post(
                    "/api/v1/search",
                    headers=headers,
                    json={"query": "策略测试", "strategy": "atomic", "top_k": 7},
                )
                assert response.status_code == 200, response.text
                assert engine.strategy == "atomic"
                assert engine.top_k == 7
                assert response.json()["stats"]["strategy"] == "atomic"

                invalid = await client.post(
                    "/api/v1/search",
                    headers=headers,
                    json={"query": "策略测试", "strategy": "unknown"},
                )
                assert invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_engine_manager, None)
