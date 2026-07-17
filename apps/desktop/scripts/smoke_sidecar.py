#!/usr/bin/env python3
"""冻结产物冒烟（ADR-0017/0019）：协议序列 + 探针 + 优雅停机。

1. 临时数据目录 + 随机端口/nonce 拉起 binaries/sidecar/sag-api
2. stdout JSONL：start ≤30s、ready ≤120s，校验 nonce 回显与 protocol=1
3. GET /system/health 与 /system/ready 均 200
4. （可选，设 SMOKE_LLM_API_KEY/SMOKE_EMBEDDING_API_KEY 时）注册 → 建源 →
   传入 markdown → 轮询就绪 → 检索命中 ≥1
5. 关 stdin → 优雅退出 ≤10s，退出码 0
任一步骤失败即非零退出（CI 腿失败）。
"""

from __future__ import annotations

import json
import os
import platform
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DESKTOP_ROOT = Path(__file__).resolve().parent.parent
BINARY = DESKTOP_ROOT / "binaries" / "sidecar" / (
    "sag-api.exe" if platform.system() == "Windows" else "sag-api"
)

START_TIMEOUT = 30
READY_TIMEOUT = 120
SHUTDOWN_TIMEOUT = 10


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def http_json(method: str, url: str, body: dict | None = None, token: str | None = None, timeout: int = 30):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, json.loads(response.read() or b"{}")


def fail(message: str, proc: subprocess.Popen | None = None) -> int:
    print(f"[smoke] FAIL: {message}", file=sys.stderr)
    if proc is not None and proc.stderr is not None:
        print("[smoke] sidecar stderr 尾部：", file=sys.stderr)
        try:
            print(proc.stderr.read()[-4000:], file=sys.stderr)
        except Exception:  # noqa: BLE001
            pass
    return 1


def main() -> int:
    if not BINARY.exists():
        return fail(f"未找到冻结产物 {BINARY}（先运行 make desktop-sidecar）")

    port = free_port()
    nonce = uuid.uuid4().hex
    data_dir = Path(tempfile.mkdtemp(prefix="sag-smoke-"))
    base = f"http://127.0.0.1:{port}"
    print(f"[smoke] binary={BINARY.name} port={port} data={data_dir}")

    proc = subprocess.Popen(
        [str(BINARY), "serve", "--data-dir", str(data_dir), "--port", str(port), "--nonce", nonce],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        events: list[str] = []
        ready = None
        deadline_start = time.time() + START_TIMEOUT
        deadline_ready = time.time() + READY_TIMEOUT
        while time.time() < deadline_ready:
            assert proc.stdout is not None
            line = proc.stdout.readline()
            if not line:
                return fail(f"就绪前 stdout 关闭；已见事件 {events}", proc)
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                return fail(f"stdout 混入非 JSONL 内容：{line!r}", proc)
            if event.get("nonce") != nonce:
                return fail(f"nonce 不匹配：{event}", proc)
            events.append(event["event"])
            if not events or events == ["start"]:
                if time.time() > deadline_start and "start" not in events:
                    return fail("30 秒内未收到 start 事件", proc)
            if event["event"] == "error":
                return fail(f"启动错误事件：{event}", proc)
            if event["event"] == "ready":
                ready = event
                break
        if ready is None:
            return fail(f"{READY_TIMEOUT} 秒内未就绪；事件 {events}", proc)
        if ready.get("protocol") != 1 or ready.get("api_version") != "v1":
            return fail(f"ready 握手字段异常：{ready}", proc)
        print(f"[smoke] 事件序列 OK：{events}")

        for path in ("/api/v1/system/health", "/api/v1/system/ready"):
            status, payload = http_json("GET", f"{base}{path}")
            if status != 200:
                return fail(f"{path} → {status} {payload}", proc)
        print("[smoke] 探针 OK")

        llm_key = os.environ.get("SMOKE_LLM_API_KEY")
        if llm_key:
            print("[smoke] 检测到密钥，执行入库+检索回路…")
            _, register = http_json(
                "POST", f"{base}/api/v1/auth/register",
                {"email": "smoke@sag.test", "password": "smoke-pass-123", "name": "Smoke"},
            )
            token = register["access_token"]
            http_json(
                "PUT", f"{base}/api/v1/system/model-config",
                {
                    "llm_api_key": llm_key,
                    "embedding_api_key": os.environ.get("SMOKE_EMBEDDING_API_KEY", llm_key),
                },
                token,
            )
            _, source = http_json(
                "POST", f"{base}/api/v1/sources", {"name": "smoke", "connector_kind": "file_upload"}, token
            )
            _, doc = http_json(
                "POST", f"{base}/api/v1/sources/{source['id']}/ingest",
                {"text": "SAG 桌面冒烟：知识引擎在本机运行。第二段：检索应命中本句。", "title": "冒烟文档"},
                token,
            )
            for _ in range(60):
                _, snapshot = http_json(
                    "GET", f"{base}/api/v1/sources/{source['id']}/documents/{doc['id']}", None, token
                )
                if snapshot.get("status") in {"ready", "failed"}:
                    break
                time.sleep(2)
            if snapshot.get("status") != "ready":
                return fail(f"文档处理未就绪：{snapshot}", proc)
            _, hits = http_json(
                "POST", f"{base}/api/v1/sources/{source['id']}/search", {"query": "检索应命中"}, token
            )
            if not hits.get("events") and not hits.get("sections"):
                return fail(f"检索零命中：{hits}", proc)
            print("[smoke] 入库+检索回路 OK")

        assert proc.stdin is not None
        proc.stdin.close()
        try:
            code = proc.wait(timeout=SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            return fail("stdin EOF 后未在限时内退出", proc)
        if code != 0:
            return fail(f"退出码 {code}", proc)
        print("[smoke] 优雅停机 OK（exit 0）")
        print("[smoke] PASS")
        return 0
    finally:
        if proc.poll() is None:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
