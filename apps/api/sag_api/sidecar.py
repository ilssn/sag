"""sidecar 命令行入口（ADR-0016/0017）。

    sag-api serve --data-dir <abs> --port 47240 [--host 127.0.0.1] [--nonce N]
                  [--emit-events stdout|off] [--portable]
    sag-api mcp-stdio [--data-dir <abs>] [--source-id ID]
    sag-api migrate --data-dir <abs>

严格顺序（serve）：解析参数 → 环境引导（import sag_api 业务模块之前）→
日志走 stderr → 目录布局 → 事件发射器 → 实例锁（先于端口）→ 绑定端口 →
emit(start) → uvicorn（lifespan 内逐相发射，ready 表示业务 API 开放）。

停机：stdin EOF 是宿主的主停机信号（壳退出即触发，防孤儿进程）；
SIGTERM/SIGINT 同样优雅停机。

退出码：0 正常停机 · 2 用法错误 · 11 实例锁冲突 · 12 端口被占。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import socket
import sys
import threading
from pathlib import Path

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_INSTANCE_LOCK = 11
EXIT_PORT_CONFLICT = 12

DEFAULT_DESKTOP_PORT = 47240  # ADR-0010/0022：桌面公开默认端口（自托管保持 8000）


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sag-api",
        description="SAG 后端 sidecar（桌面壳/受控环境入口）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="启动业务服务（桌面 sidecar 模式）")
    serve.add_argument("--data-dir", type=Path, default=None, help="数据根目录（绝对路径）")
    serve.add_argument("--port", type=int, default=DEFAULT_DESKTOP_PORT)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--nonce", default=None, help="宿主校验用一次性口令（回显于全部事件）")
    serve.add_argument(
        "--emit-events", choices=("stdout", "off"), default="stdout",
        help="JSONL 启动事件目标（默认 stdout；日志始终走 stderr）",
    )
    serve.add_argument(
        "--portable", action="store_true",
        help="便携模式：standard 运行模式 + 默认 ~/.sag 数据目录（仅显式 CLI 使用）",
    )

    stdio = sub.add_parser("mcp-stdio", help="以 stdio 传输运行 MCP server")
    stdio.add_argument("--data-dir", type=Path, default=None)
    stdio.add_argument("--source-id", default=None)

    migrate = sub.add_parser("migrate", help="独立执行数据库迁移后退出")
    migrate.add_argument("--data-dir", type=Path, default=None)
    return parser


def _bootstrap_environment(data_dir: Path | None, *, portable: bool) -> None:
    """在 import 业务模块之前固定运行环境（settings 单例在首次 import 时定型）。"""
    os.environ["SAG_DISABLE_DOTENV"] = "1"
    if portable:
        os.environ.setdefault("SAG_RUNTIME_MODE", "standard")
        if data_dir is None:
            data_dir = Path.home() / ".sag"
    else:
        os.environ["SAG_RUNTIME_MODE"] = "desktop"
    if data_dir is not None:
        os.environ["SAG_DATA_ROOT"] = str(Path(data_dir).expanduser().resolve())
    elif not portable:
        print("错误：desktop 模式必须提供 --data-dir（由宿主传入 appLocalDataDir）", file=sys.stderr)
        raise SystemExit(EXIT_USAGE)


def _watch_stdin_eof(loop: asyncio.AbstractEventLoop, server) -> threading.Thread:
    """stdin EOF = 宿主要求停机（壳崩溃/退出时防孤儿）。守护线程阻塞读。"""

    def _watch() -> None:
        try:
            while sys.stdin.buffer.read(4096):
                pass
        except Exception:  # noqa: BLE001 —— stdin 不可用时放弃该信号源
            return
        loop.call_soon_threadsafe(setattr, server, "should_exit", True)

    thread = threading.Thread(target=_watch, name="stdin-eof-watch", daemon=True)
    thread.start()
    return thread


def _serve(args: argparse.Namespace) -> int:
    _bootstrap_environment(args.data_dir, portable=args.portable)

    # 环境定型后才允许 import 业务模块
    from sag_api.core import startup_events
    from sag_api.core.config import settings
    from sag_api.core.instance_lock import InstanceLockError, ensure_instance_lock
    from sag_api.core.logging import configure_logging
    from sag_api.core.paths import ensure_data_layout

    configure_logging("DEBUG" if settings.debug else "INFO", stream=sys.stderr)
    paths = ensure_data_layout(settings)
    if args.emit_events == "stdout":
        startup_events.configure_emitter(sys.stdout, args.nonce)

    # 实例锁先于端口：第二实例绝不与主实例争抢稳定端口（ADR-0016）
    try:
        ensure_instance_lock(paths.lock_path, port=args.port)
    except InstanceLockError as error:
        startup_events.emit(
            "error", stage="startup", code="instance-already-running",
            message=str(error), recoverable=False,
        )
        print(str(error), file=sys.stderr)
        return EXIT_INSTANCE_LOCK

    # 先绑端口（ADR-0017）；占用即显式失败，绝不静默换端口（ADR-0010）
    try:
        sock = socket.create_server((args.host, args.port))
    except OSError as error:
        message = f"端口被占用或不可绑定：{args.host}:{args.port}（{error}）"
        startup_events.emit(
            "error", stage="startup", code="port-conflict",
            message=message, recoverable=False, port=args.port,
        )
        print(message, file=sys.stderr)
        return EXIT_PORT_CONFLICT

    import uvicorn

    config = uvicorn.Config(
        "sag_api.main:app",
        host=args.host,
        port=args.port,
        log_config=None,  # 日志由 configure_logging 接管（stderr）
        lifespan="on",
        access_log=False,
    )
    server = uvicorn.Server(config)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _watch_stdin_eof(loop, server)
    try:
        loop.run_until_complete(server.serve(sockets=[sock]))
    finally:
        loop.close()
        sock.close()
    return EXIT_OK


def _mcp_stdio(args: argparse.Namespace) -> int:
    _bootstrap_environment(args.data_dir, portable=True)
    from sag_api.core.logging import configure_logging
    from sag_api.mcp.server import serve_stdio

    configure_logging("INFO", stream=sys.stderr)
    # 只读为主（WAL 允许跨进程读者），不取实例锁；外部宿主推荐走 HTTP /mcp/ + 本地访问密钥。
    asyncio.run(serve_stdio(args.source_id))
    return EXIT_OK


def _migrate(args: argparse.Namespace) -> int:
    _bootstrap_environment(args.data_dir, portable=args.data_dir is None)
    from sag_api.core.config import settings
    from sag_api.core.db import engine
    from sag_api.core.logging import configure_logging
    from sag_api.core.paths import ensure_data_layout
    from sag_api.db.migrate import run_migrations

    configure_logging("INFO", stream=sys.stderr)
    paths = ensure_data_layout(settings)
    report = asyncio.run(run_migrations(engine, settings, paths))
    print(
        f"迁移完成：{report.from_revision or 'fresh/legacy'} → {report.to_revision}"
        + (f"（恢复点 {report.recovery_point}）" if report.recovery_point else ""),
        file=sys.stderr,
    )
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command == "serve":
        return _serve(args)
    if args.command == "mcp-stdio":
        return _mcp_stdio(args)
    if args.command == "migrate":
        return _migrate(args)
    return EXIT_USAGE  # pragma: no cover —— argparse required=True 已兜底


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
