"""进程级运行时相位（ADR-0014/0017）。

lifespan 按 starting → migrating → engine-init → ready 推进；
任何启动关卡失败进入 maintenance —— 进程继续存活、仅开放 /system/*，
桌面壳据此渲染恢复界面而不是面对一个死进程。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

RuntimePhase = Literal["starting", "migrating", "engine-init", "ready", "maintenance"]


class StartupGateError(RuntimeError):
    """启动关卡失败（携带机器可读错误码，进入维护模式而非崩溃）。"""

    def __init__(self, code: str, message: str, *, recoverable: bool = True):
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable


@dataclass
class RuntimeState:
    phase: RuntimePhase = "starting"
    error_code: str | None = None
    error_message: str | None = None
    detail: dict = field(default_factory=dict)

    def advance(self, phase: RuntimePhase) -> None:
        self.phase = phase

    def fail(self, code: str, message: str, **detail: object) -> None:
        self.phase = "maintenance"
        self.error_code = code
        self.error_message = message
        self.detail = dict(detail)

    @property
    def ready(self) -> bool:
        return self.phase == "ready"

    def snapshot(self) -> dict:
        return {
            "phase": self.phase,
            "error": (
                {"code": self.error_code, "message": self.error_message}
                if self.error_code
                else None
            ),
        }
