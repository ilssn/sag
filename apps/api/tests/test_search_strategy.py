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
    from sag_api.sag.dto import (
        EntityInfo,
        GraphAssociationInfo,
        GraphEventInfo,
        RetrievedSection,
        SearchOutcome,
        SourceGraphInfo,
    )

    class RecordingEngine:
        strategy: str | None = None
        top_k: int | None = None

        async def provision(self, *_args):
            return None

        async def search_many(self, targets, query, *, strategy=None, top_k=None):
            self.strategy = strategy
            self.top_k = top_k
            source_config_id = targets[0][0]
            return SearchOutcome(
                query=query,
                sections=[
                    RetrievedSection(
                        chunk_id="chunk-1",
                        heading="原始分块标题",
                        content="原始分块正文",
                        score=0.82,
                        source_config_id=source_config_id,
                    )
                ],
                stats={"strategy": strategy},
            )

        async def graph_for_sections(self, sections, sources_by_config, **_kwargs):
            source_config_id = sections[0].source_config_id
            return SourceGraphInfo(
                events=[
                    GraphEventInfo(
                        id="event-1",
                        source_config_id=source_config_id,
                        source_id="document-1",
                        chunk_id="chunk-1",
                        title="外卖骑手收入变化",
                        summary="报告分析了工作时长、技能与收入之间的关系。",
                        category="劳动研究",
                        score=0.82,
                    )
                ],
                entities=[
                    EntityInfo(
                        id="entity-1",
                        name="外卖骑手",
                        type="职业",
                        description="平台配送劳动者",
                        heat=1,
                    )
                ],
                associations=[
                    GraphAssociationInfo(event_id="event-1", entity_id="entity-1")
                ],
            )

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
                result = response.json()
                assert result["events"][0]["title"] == "外卖骑手收入变化"
                assert result["events"][0]["summary"].startswith("报告分析")
                assert result["events"][0]["source_id"] == source.json()["id"]
                assert result["entities"][0]["name"] == "外卖骑手"
                assert result["relations"][0]["kind"] == "mentions"

                invalid = await client.post(
                    "/api/v1/search",
                    headers=headers,
                    json={"query": "策略测试", "strategy": "unknown"},
                )
                assert invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_engine_manager, None)
