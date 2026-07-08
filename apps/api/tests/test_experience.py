"""R4 体验四件套：防幻觉短路、prompt 透明、记忆面板、OpenAI 兼容端点。

离线（无 LLM key）下用 empty_response 短路路径获得确定性回答，无需真实模型。
"""

import json

import httpx
import pytest


async def _register(c, email="exp@t.com"):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


EMPTY = "抱歉，我暂时没有查到相关资料。"


async def _make_soul_with_empty_response(c, headers):
    soul = (
        await c.post(
            "/api/v1/agents",
            headers=headers,
            json={"name": "严谨助手", "persona": {"empty_response": EMPTY}},
        )
    ).json()
    return soul


@pytest.mark.asyncio
async def test_empty_response_short_circuit_and_prompt_preview():
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c)
            soul = await _make_soul_with_empty_response(c, A)
            thread = (await c.post(f"/api/v1/agents/{soul['id']}/threads", headers=A, json={})).json()

            # 无绑定信源 → 检索为空 → 兜底话术，且不需要 LLM（离线也可）
            events: list[tuple[str, dict]] = []
            async with c.stream(
                "POST",
                f"/api/v1/agents/{soul['id']}/threads/{thread['id']}/ask",
                headers=A,
                json={"query": "公司的报销流程是怎样的？"},
            ) as resp:
                assert resp.status_code == 200
                ev = None
                async for line in resp.aiter_lines():
                    if line.startswith("event:"):
                        ev = line.split(":", 1)[1].strip()
                    elif line.startswith("data:") and ev:
                        events.append((ev, json.loads(line.split(":", 1)[1].strip())))

            kinds = [e for e, _ in events]
            assert "meta" in kinds and "token" in kinds and "done" in kinds
            assert "error" not in kinds
            meta = next(d for e, d in events if e == "meta")
            assert meta["prompt_preview"]  # prompt 透明
            tokens = "".join(d["text"] for e, d in events if e == "token")
            assert tokens == EMPTY

            # 该轮回答已落库
            msgs = (
                await c.get(f"/api/v1/agents/{soul['id']}/threads/{thread['id']}/messages", headers=A)
            ).json()
            assert any(m["content"] == EMPTY and m["role"] == "assistant" for m in msgs)


@pytest.mark.asyncio
async def test_openai_compatible_endpoint():
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "oai@t.com")
            soul = await _make_soul_with_empty_response(c, A)

            # 非流式：标准 OpenAI ChatCompletion 结构
            r = await c.post(
                f"/api/v1/openai/{soul['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "user", "content": "介绍一下产品定价"}]},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["object"] == "chat.completion"
            assert body["choices"][0]["message"]["content"] == EMPTY
            assert body["choices"][0]["finish_reason"] == "stop"
            assert "zleap" in body  # 扩展字段：引用

            # 流式：SSE chunk + [DONE]
            chunks: list[str] = []
            async with c.stream(
                "POST",
                f"/api/v1/openai/{soul['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "user", "content": "你好"}], "stream": True},
            ) as resp:
                assert resp.status_code == 200
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        chunks.append(line[len("data:"):].strip())
            assert chunks[-1] == "[DONE]"
            content = "".join(
                json.loads(ch)["choices"][0]["delta"].get("content", "")
                for ch in chunks
                if ch != "[DONE]"
            )
            assert content == EMPTY

            # 缺少 user 消息 → 422
            bad = await c.post(
                f"/api/v1/openai/{soul['id']}/chat/completions",
                headers=A,
                json={"messages": [{"role": "system", "content": "x"}]},
            )
            assert bad.status_code == 422

            # 未认证 → 401
            un = await c.post(
                f"/api/v1/openai/{soul['id']}/chat/completions",
                json={"messages": [{"role": "user", "content": "hi"}]},
            )
            assert un.status_code == 401
