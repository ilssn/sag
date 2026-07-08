"""团队 e2e：邀请 → 空间切换 → 角色门 → 助手可见性 → 会话按人隔离。"""

import httpx
import pytest

WS = "X-Workspace-Id"


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_team_flow():
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "alice@t.com")
            B = await _register(c, "bob@t.com")

            # A 的空间 id 与成员
            me_a = (await c.get("/api/v1/auth/me", headers=A)).json()
            assert len(me_a["memberships"]) == 1
            ws_a = me_a["memberships"][0]["workspace_id"]
            assert me_a["memberships"][0]["role"] == "owner"

            # 非成员带 header 访问 → 403
            r = await c.get("/api/v1/sources", headers={**B, WS: ws_a})
            assert r.status_code == 403

            # 邀请：非 owner 邀请 → 403；owner 邀请未注册 → 404；正常邀请 editor → 201；重复 → 409
            assert (
                await c.post(
                    "/api/v1/workspaces/current/members",
                    headers={**B, WS: ws_a},
                    json={"email": "x@t.com"},
                )
            ).status_code == 403
            assert (
                await c.post(
                    "/api/v1/workspaces/current/members", headers=A, json={"email": "ghost@t.com"}
                )
            ).status_code == 404
            r = await c.post(
                "/api/v1/workspaces/current/members",
                headers=A,
                json={"email": "bob@t.com", "role": "editor"},
            )
            assert r.status_code == 201 and r.json()["role"] == "editor"
            assert (
                await c.post(
                    "/api/v1/workspaces/current/members", headers=A, json={"email": "bob@t.com"}
                )
            ).status_code == 409

            # B /me 现在有两个空间；带 header 可访问 A 空间
            me_b = (await c.get("/api/v1/auth/me", headers=B)).json()
            assert len(me_b["memberships"]) == 2
            src = await c.post(
                "/api/v1/sources", headers={**B, WS: ws_a}, json={"name": "共享手册"}
            )
            assert src.status_code == 201
            sid = src.json()["id"]
            # A 能看到 B 建的信源（同一记忆体）
            assert any(
                s["id"] == sid for s in (await c.get("/api/v1/sources", headers=A)).json()
            )

            # 助手可见性：B 建私有助手 → A(owner) 可见但普通视角验证用 C…
            # 先验证：B 建私有助手，A 是 owner 仍可见；B 的私有助手对 viewer C 不可见
            soul_priv = (
                await c.post(
                    "/api/v1/souls",
                    headers={**B, WS: ws_a},
                    json={"name": "B的私助", "visibility": "private"},
                )
            ).json()
            soul_team = (
                await c.post(
                    "/api/v1/souls",
                    headers={**B, WS: ws_a},
                    json={"name": "团队决策脑", "visibility": "workspace"},
                )
            ).json()

            C = await _register(c, "carol@t.com")
            r = await c.post(
                "/api/v1/workspaces/current/members",
                headers=A,
                json={"email": "carol@t.com", "role": "viewer"},
            )
            assert r.status_code == 201

            names_c = {
                s["name"] for s in (await c.get("/api/v1/souls", headers={**C, WS: ws_a})).json()
            }
            assert "团队决策脑" in names_c and "B的私助" not in names_c
            # 直接访问私有助手 → 404（不暴露存在性）
            assert (
                await c.get(f"/api/v1/souls/{soul_priv['id']}", headers={**C, WS: ws_a})
            ).status_code == 404

            # viewer 只读：建信源/上传/建助手 → 403
            assert (
                await c.post("/api/v1/sources", headers={**C, WS: ws_a}, json={"name": "x"})
            ).status_code == 403
            assert (
                await c.post(
                    f"/api/v1/sources/{sid}/documents",
                    headers={**C, WS: ws_a},
                    files={"file": ("a.md", b"# t", "text/markdown")},
                )
            ).status_code == 403
            assert (
                await c.post("/api/v1/souls", headers={**C, WS: ws_a}, json={"name": "x"})
            ).status_code == 403

            # 非管理者不能改共享助手设定：C(viewer) 被写门挡；再验证 editor 但非创建者
            D = await _register(c, "dave@t.com")
            await c.post(
                "/api/v1/workspaces/current/members",
                headers=A,
                json={"email": "dave@t.com", "role": "editor"},
            )
            r = await c.patch(
                f"/api/v1/souls/{soul_team['id']}",
                headers={**D, WS: ws_a},
                json={"name": "改名"},
            )
            assert r.status_code == 403  # 仅创建者或空间 owner 可管理
            # 空间 owner(A) 可以管理
            assert (
                await c.patch(
                    f"/api/v1/souls/{soul_team['id']}", headers=A, json={"name": "决策脑v2"}
                )
            ).status_code == 200

            # 共享助手会话按人隔离
            th_b = (
                await c.post(
                    f"/api/v1/souls/{soul_team['id']}/threads", headers={**B, WS: ws_a}, json={}
                )
            ).json()
            th_d = (
                await c.post(
                    f"/api/v1/souls/{soul_team['id']}/threads", headers={**D, WS: ws_a}, json={}
                )
            ).json()
            ids_b = {
                t["id"]
                for t in (
                    await c.get(
                        f"/api/v1/souls/{soul_team['id']}/threads", headers={**B, WS: ws_a}
                    )
                ).json()
            }
            assert th_b["id"] in ids_b and th_d["id"] not in ids_b
            # D 不能读 B 的会话消息
            assert (
                await c.get(
                    f"/api/v1/souls/{soul_team['id']}/threads/{th_b['id']}/messages",
                    headers={**D, WS: ws_a},
                )
            ).status_code == 404

            # 角色护栏：唯一 owner 不可自降/被移除
            assert (
                await c.patch(
                    f"/api/v1/workspaces/current/members/{me_a['id']}",
                    headers=A,
                    json={"role": "editor"},
                )
            ).status_code == 422
            assert (
                await c.delete(
                    f"/api/v1/workspaces/current/members/{me_a['id']}", headers=A
                )
            ).status_code == 422
            # 成员自行退出
            assert (
                await c.delete(
                    f"/api/v1/workspaces/current/members/{me_b['id']}",
                    headers={**B, WS: ws_a},
                )
            ).status_code == 200
            assert len(
                (await c.get("/api/v1/auth/me", headers=B)).json()["memberships"]
            ) == 1
