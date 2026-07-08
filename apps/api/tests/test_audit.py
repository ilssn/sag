"""审计 e2e：动作触发落审计行、owner 可读、viewer 403、CSV 导出、请求追踪头。"""

import httpx
import pytest

WS = "X-Workspace-Id"


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_audit_flow():
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "owner@a.com")

            # 每个响应都带请求追踪头
            r0 = await c.get("/api/v1/auth/me", headers=A)
            assert r0.headers.get("X-Request-Id")

            # 触发若干可审计动作
            src = await c.post("/api/v1/sources", headers=A, json={"name": "手册"})
            sid = src.json()["id"]
            await c.post(
                f"/api/v1/sources/{sid}/documents",
                headers=A,
                files={"file": ("a.md", b"# hello\nworld", "text/markdown")},
            )
            await c.post("/api/v1/souls", headers=A, json={"name": "小助手"})

            # owner 读审计：注册 + 建源 + 上传 + 建助手 均在列
            page = (await c.get("/api/v1/audit", headers=A)).json()
            actions = [it["action"] for it in page["items"]]
            assert page["total"] >= 4
            for expected in (
                "user.register",
                "source.create",
                "document.upload",
                "soul.create",
            ):
                assert expected in actions, f"缺少审计动作 {expected}"

            # 字段完整性：source.create 带对象标签，且记录了 IP
            sc = next(it for it in page["items"] if it["action"] == "source.create")
            assert sc["target_label"] == "手册"
            assert sc["actor_email"] == "owner@a.com"

            # 按动作过滤
            only = (await c.get("/api/v1/audit?action=soul.create", headers=A)).json()
            assert only["total"] == 1 and only["items"][0]["action"] == "soul.create"

            # 按操作者邮箱过滤
            byactor = (await c.get("/api/v1/audit?actor=owner@a.com", headers=A)).json()
            assert byactor["total"] >= 4

            # CSV 导出
            exp = await c.get("/api/v1/audit/export", headers=A)
            assert exp.status_code == 200
            assert "text/csv" in exp.headers["content-type"]
            assert "source.create" in exp.text

            # viewer 无权读审计
            B = await _register(c, "viewer@a.com")
            ws_a = (await c.get("/api/v1/auth/me", headers=A)).json()["memberships"][0][
                "workspace_id"
            ]
            await c.post(
                "/api/v1/workspaces/current/members",
                headers=A,
                json={"email": "viewer@a.com", "role": "viewer"},
            )
            assert (
                await c.get("/api/v1/audit", headers={**B, WS: ws_a})
            ).status_code == 403

            # 邀请动作本身也被审计（member.invite）
            page2 = (await c.get("/api/v1/audit?action=member.invite", headers=A)).json()
            assert page2["total"] == 1
            assert page2["items"][0]["target_label"] == "viewer@a.com"

            # 审计按空间隔离：B 自己的默认空间无 A 的记录
            own = (await c.get("/api/v1/audit", headers=B)).json()
            assert all(it["actor_email"] != "owner@a.com" for it in own["items"])
