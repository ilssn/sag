#!/usr/bin/env python3
"""脚本化假 sidecar：不依赖真实后端测试壳的协议状态机（CI desktop-check 用）。

用法：fake_sidecar.py <场景> [--nonce N]
场景：
  happy         start → migration → engine-init → ready，随后常驻直到 stdin EOF
  port-conflict 发 error{port-conflict} 后退出码 12
  migrate-fail  发 error{migration-failed} 后常驻（维护模式语义）
  crash-early   start 后直接崩溃（无 error 事件）
  silent        什么都不发（触发壳的 30s start 超时）
"""

from __future__ import annotations

import argparse
import json
import sys
import time


def emit(event: str, nonce: str | None, **fields) -> None:
    payload = {"v": 1, "event": event, "ts": "1970-01-01T00:00:00Z"}
    if nonce:
        payload["nonce"] = nonce
    payload.update(fields)
    print(json.dumps(payload), flush=True)


def wait_stdin_eof() -> None:
    while sys.stdin.buffer.read(4096):
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario")
    parser.add_argument("--nonce", default=None)
    # 与真实 CLI 同形的参数便于壳直接替换
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--port", type=int, default=47240)
    parser.add_argument("serve", nargs="?", default=None)
    args, _ = parser.parse_known_args()
    nonce = args.nonce

    if args.scenario == "happy":
        emit("start", nonce, pid=0, app_version="0.0.0-fake")
        emit("migration", nonce, status="begin")
        emit("migration", nonce, status="done", from_revision=None, to_revision="0002")
        emit("engine-init", nonce, status="begin")
        emit("engine-init", nonce, status="done")
        emit(
            "ready", nonce,
            app_version="0.0.0-fake", api_version="v1", protocol=1,
            port=args.port, capabilities=["http-api"],
        )
        wait_stdin_eof()
        return 0
    if args.scenario == "port-conflict":
        emit("error", nonce, stage="startup", code="port-conflict",
             message="端口被占用", recoverable=False, port=args.port)
        return 12
    if args.scenario == "migrate-fail":
        emit("start", nonce, pid=0, app_version="0.0.0-fake")
        emit("migration", nonce, status="begin")
        emit("error", nonce, stage="migration", code="migration-failed",
             message="模拟迁移失败", recoverable=True)
        wait_stdin_eof()
        return 0
    if args.scenario == "crash-early":
        emit("start", nonce, pid=0, app_version="0.0.0-fake")
        return 1
    if args.scenario == "silent":
        time.sleep(3600)
        return 0
    print(f"未知场景：{args.scenario}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
