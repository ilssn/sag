"""sidecar 入口（ADR-0016/0017）：参数、事件发射、实例锁、退出码。"""

from __future__ import annotations

import io
import json
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from sag_api.core import startup_events
from sag_api.core.instance_lock import (
    ensure_instance_lock,
    release_instance_lock,
)
from sag_api.sidecar import (
    DEFAULT_DESKTOP_PORT,
    EXIT_INSTANCE_LOCK,
    EXIT_PORT_CONFLICT,
    _build_parser,
)


class TestArgParsing:
    def test_serve_defaults(self):
        args = _build_parser().parse_args(["serve", "--data-dir", "/tmp/x"])
        assert args.command == "serve"
        assert args.port == DEFAULT_DESKTOP_PORT
        assert args.host == "127.0.0.1"
        assert args.emit_events == "stdout"
        assert args.portable is False

    def test_serve_full(self):
        args = _build_parser().parse_args(
            ["serve", "--data-dir", "/d", "--port", "9000", "--nonce", "n1", "--emit-events", "off"]
        )
        assert args.port == 9000
        assert args.nonce == "n1"
        assert args.emit_events == "off"

    def test_mcp_stdio_and_migrate(self):
        assert _build_parser().parse_args(["mcp-stdio", "--source-id", "s1"]).source_id == "s1"
        assert _build_parser().parse_args(["migrate", "--data-dir", "/d"]).command == "migrate"

    def test_missing_command_is_usage_error(self):
        with pytest.raises(SystemExit) as excinfo:
            _build_parser().parse_args([])
        assert excinfo.value.code == 2


class TestEventEmitter:
    def test_jsonl_schema_and_nonce_echo(self):
        buffer = io.StringIO()
        startup_events.configure_emitter(buffer, "nonce-1")
        try:
            startup_events.emit("start", pid=1, app_version="1.2.3")
            startup_events.emit(
                "ready",
                app_version="1.2.3",
                api_version="v1",
                protocol=startup_events.PROTOCOL_VERSION,
                port=47240,
                capabilities=["http-api"],
            )
        finally:
            startup_events.configure_emitter(None, None)

        lines = [json.loads(line) for line in buffer.getvalue().splitlines()]
        assert [e["event"] for e in lines] == ["start", "ready"]
        for event in lines:
            assert event["v"] == startup_events.PROTOCOL_VERSION
            assert event["nonce"] == "nonce-1"
            assert "ts" in event
        ready = lines[1]
        assert ready["port"] == 47240
        assert ready["capabilities"] == ["http-api"]

    def test_unconfigured_emitter_is_noop(self):
        startup_events.configure_emitter(None, None)
        startup_events.emit("start")  # 不抛即可
        assert startup_events.emitter_configured() is False


class TestInstanceLock:
    def test_conflict_detected_across_processes(self, tmp_path: Path):
        lock_path = tmp_path / ".sag.lock"
        ensure_instance_lock(lock_path, port=1234)
        try:
            # 进程内幂等
            ensure_instance_lock(lock_path, port=1234)
            # 第二个进程必须拿不到锁
            probe = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import sys; sys.path.insert(0, 'sag_api') if False else None\n"
                        "from sag_api.core.instance_lock import ensure_instance_lock, InstanceLockError\n"
                        "from pathlib import Path\n"
                        "import sag_api.core.instance_lock as il\n"
                        "il._RETRIES = 1\n"
                        "try:\n"
                        f"    ensure_instance_lock(Path({str(lock_path)!r}))\n"
                        "except InstanceLockError:\n"
                        "    raise SystemExit(11)\n"
                        "raise SystemExit(0)\n"
                    ),
                ],
                capture_output=True,
                timeout=30,
            )
            assert probe.returncode == EXIT_INSTANCE_LOCK, probe.stderr.decode()
        finally:
            release_instance_lock()

    def test_relock_after_release(self, tmp_path: Path):
        lock_path = tmp_path / ".sag.lock"
        ensure_instance_lock(lock_path)
        release_instance_lock()
        ensure_instance_lock(lock_path)
        release_instance_lock()

    def test_lock_error_carries_holder_info(self, tmp_path: Path):
        lock_path = tmp_path / ".sag.lock"
        ensure_instance_lock(lock_path, port=4711)
        try:
            import sag_api.core.instance_lock as lock_module

            probe = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "from sag_api.core.instance_lock import ensure_instance_lock, InstanceLockError\n"
                        "from pathlib import Path\n"
                        "import sag_api.core.instance_lock as il\n"
                        "il._RETRIES = 1\n"
                        "try:\n"
                        f"    ensure_instance_lock(Path({str(lock_path)!r}))\n"
                        "except InstanceLockError as e:\n"
                        "    print(e)\n"
                        "    raise SystemExit(11)\n"
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            assert probe.returncode == EXIT_INSTANCE_LOCK
            assert "4711" in probe.stdout  # 持有者诊断信息
            assert lock_module._held_fd is not None
        finally:
            release_instance_lock()


class TestPortConflictExitCode:
    def test_serve_exits_12_when_port_taken(self, tmp_path: Path):
        blocker = socket.create_server(("127.0.0.1", 0))
        port = blocker.getsockname()[1]
        try:
            probe = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "sag_api",
                    "serve",
                    "--data-dir",
                    str(tmp_path),
                    "--port",
                    str(port),
                    "--nonce",
                    "n-port",
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
        finally:
            blocker.close()
        assert probe.returncode == EXIT_PORT_CONFLICT, probe.stderr
        events = [json.loads(line) for line in probe.stdout.splitlines() if line.strip()]
        assert events, "stdout 应只承载 JSONL 事件"
        error = events[-1]
        assert error["event"] == "error"
        assert error["code"] == "port-conflict"
        assert error["nonce"] == "n-port"
        assert error["recoverable"] is False
