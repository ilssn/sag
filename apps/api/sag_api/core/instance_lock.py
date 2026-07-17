"""单实例数据锁（ADR-0016）：同一数据目录同时只允许一个业务进程写入。

锁文件 {data_root}/.sag.lock，进程存活期间持有（fcntl/msvcrt 非阻塞独占）；
内容为 {pid, port, started_at} 诊断信息。进程级幂等：sidecar 在绑定端口前
取锁，lifespan 再次调用时是无操作；dev/Docker 场景由 lifespan 首次取锁。
指向不同数据目录的自托管实例互不影响。
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from sag_api.core.logging import get_logger

log = get_logger("instance-lock")

_RETRIES = 3
_RETRY_DELAY_SECONDS = 0.5

_held_fd: int | None = None
_held_path: Path | None = None


class InstanceLockError(RuntimeError):
    """数据目录已被另一实例锁定。"""


def _try_lock(fd: int) -> bool:
    if sys.platform == "win32":  # pragma: no cover —— Windows 分支由桌面 CI/真机验证
        import msvcrt

        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    import fcntl

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def ensure_instance_lock(path: Path, *, port: int | None = None) -> None:
    """取得数据目录锁；已持有时无操作，冲突时抛 InstanceLockError。"""
    global _held_fd, _held_path
    if _held_fd is not None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    for attempt in range(_RETRIES):
        if _try_lock(fd):
            payload = json.dumps(
                {
                    "pid": os.getpid(),
                    "port": port,
                    "started_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
            )
            os.ftruncate(fd, 0)
            os.pwrite(fd, payload.encode("utf-8"), 0)
            _held_fd = fd
            _held_path = path
            log.debug("已持有实例锁：%s", path)
            return
        if attempt < _RETRIES - 1:
            # 容忍 uvicorn --reload 等短暂交接
            time.sleep(_RETRY_DELAY_SECONDS)
    holder = ""
    try:
        holder = os.pread(fd, 4096, 0).decode("utf-8", "replace").strip()
    except OSError:
        pass
    os.close(fd)
    raise InstanceLockError(
        f"数据目录已被另一实例锁定（{path}）"
        + (f"：{holder}" if holder else "")
        + "。请先退出正在运行的 SAG，或为本实例指定不同的数据目录。"
    )


def release_instance_lock() -> None:
    """显式释放（进程退出内核也会自动释放；供测试与优雅停机使用）。"""
    global _held_fd, _held_path
    if _held_fd is None:
        return
    try:
        os.close(_held_fd)
    except OSError:
        pass
    if _held_path is not None:
        try:
            _held_path.unlink(missing_ok=True)
        except OSError:
            pass
    _held_fd = None
    _held_path = None
