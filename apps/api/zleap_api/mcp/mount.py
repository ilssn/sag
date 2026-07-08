"""把信源 MCP 作为 Streamable-HTTP 端点挂进 FastAPI。

外部宿主（Claude Desktop / Cursor）挂载 URL 形如：

    http://<host>/mcp?source_id=<信源 id>      （Authorization: Bearer <token>）

一个 zleap 实例只挂**一个** MCP server；具体服务哪个信源由每个请求的 `source_id`
决定——中间件解析 `source_id`、校验 JWT、载入 Source 并注入作用域（contextvar），
再委托给 FastMCP 的 ASGI 应用。作用域随请求隔离，故外部宿主与进程内 agent 可共用同一
server。会话管理器（session manager）需在应用 lifespan 内运行，见 `main.lifespan`。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING
from urllib.parse import parse_qs

import jwt
from sqlalchemy import select

from zleap_api.core.db import SessionLocal
from zleap_api.core.logging import get_logger
from zleap_api.core.security import decode_token
from zleap_api.db.models import Source
from zleap_api.mcp.server import build_source_mcp, use_scope

if TYPE_CHECKING:
    from fastapi import FastAPI
    from mcp.server.fastmcp import FastMCP

log = get_logger("mcp.http")


async def _send_json(send, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})


def _bearer(scope) -> str | None:
    for name, value in scope.get("headers") or []:
        if name == b"authorization":
            raw = value.decode("latin-1")
            return raw[7:].strip() if raw.lower().startswith("bearer ") else raw.strip()
    return None


class ScopedSourceMCP:
    """ASGI 包装：解析 source_id + 鉴权 + 注入信源作用域，再委托给 MCP 应用。"""

    def __init__(self, parent_app: FastAPI, mcp_asgi) -> None:
        self._parent = parent_app
        self._mcp = mcp_asgi

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self._mcp(scope, receive, send)
            return

        params = parse_qs((scope.get("query_string") or b"").decode())
        source_id = (params.get("source_id") or [""])[0].strip()
        if not source_id:
            await _send_json(send, 400, {"error": "缺少 source_id 查询参数"})
            return

        token = _bearer(scope)
        if not token:
            await _send_json(send, 401, {"error": "缺少认证令牌"})
            return
        try:
            decode_token(token)
        except jwt.PyJWTError:
            await _send_json(send, 401, {"error": "令牌无效或已过期"})
            return

        async with SessionLocal() as session:
            source = (
                await session.execute(select(Source).where(Source.id == source_id))
            ).scalar_one_or_none()
        if source is None:
            await _send_json(send, 404, {"error": "信源不存在"})
            return

        engine_manager = self._parent.state.engine_manager
        with use_scope(engine_manager, source):
            await self._mcp(scope, receive, send)


def attach_source_mcp(app: FastAPI) -> FastMCP:
    """构造 HTTP 版信源 MCP、挂到 `/mcp`，返回 FastMCP（其 session manager 交 lifespan 运行）。

    内层 FastMCP 的路由改到根 `/`，外层用 `Mount("/mcp")` 承接——避免 `/mcp` 内再套 `/mcp`
    的双重路径。外部宿主使用带斜杠的 `/mcp/?source_id=…`（Mount 对无斜杠会 307 到有斜杠）。
    """
    mcp = build_source_mcp(stateless_http=True)
    mcp.settings.streamable_http_path = "/"
    mcp_asgi = mcp.streamable_http_app()  # 惰性创建 session_manager
    app.mount("/mcp", ScopedSourceMCP(app, mcp_asgi))
    return mcp
