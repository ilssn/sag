"""结构化启动事件（ADR-0017）。

sidecar 模式下由 sag_api.sidecar 在启动前 configure_emitter(stdout, nonce)；
事件按 JSONL 每行一条写出并即时 flush，日志走 stderr 与之隔离。
dev / Docker（make api、uvicorn 直启）未配置发射器 —— emit 是无操作。

事件模式（v=1，全部事件回显 nonce）：
  start{pid,app_version} → migration{status:begin|progress|done,…}
  → engine-init{status:begin|done} → ready{api_version,protocol,port,…}
  | error{stage,code,message,recoverable}
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import IO

PROTOCOL_VERSION = 1

_target: IO[str] | None = None
_nonce: str | None = None


def configure_emitter(target: IO[str] | None, nonce: str | None) -> None:
    """sidecar 入口专用；传 None 关闭发射（默认态）。"""
    global _target, _nonce
    _target = target
    _nonce = nonce


def emitter_configured() -> bool:
    return _target is not None


def emit(event: str, **fields: object) -> None:
    """发射一条启动事件（未配置时无操作；任何写失败不影响启动流程）。"""
    if _target is None:
        return
    payload: dict[str, object] = {
        "v": PROTOCOL_VERSION,
        "event": event,
        "ts": datetime.now(UTC).isoformat(),
    }
    if _nonce is not None:
        payload["nonce"] = _nonce
    payload.update(fields)
    try:
        _target.write(json.dumps(payload, ensure_ascii=False) + "\n")
        _target.flush()
    except Exception:  # noqa: BLE001 —— 协议管道破裂不应拖垮服务本体
        pass
