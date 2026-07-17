#!/usr/bin/env python3
"""冻结 FastAPI sidecar（ADR-0019：PyInstaller onedir）。

流程：干净构建 venv（非 editable 安装 apps/api）→ PyInstaller spec →
裁剪冗余 → 产出 binaries/sidecar-dist/<target-triple>/sag-api/ →
刷新 binaries/sidecar（tauri.conf bundle.resources 引用的当前平台落点）。

macOS 设置 APPLE_SIGNING_IDENTITY 时对内嵌 Mach-O 逐个签名（公证前提）。
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

DESKTOP_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = DESKTOP_ROOT.parent.parent
API_ROOT = REPO_ROOT / "apps" / "api"
CACHE = DESKTOP_ROOT / ".cache"
BUILD_VENV = CACHE / "build-venv"
DIST_ROOT = DESKTOP_ROOT / "binaries" / "sidecar-dist"
STAGE_LINK = DESKTOP_ROOT / "binaries" / "sidecar"

# 裁剪清单：纯体积优化，功能无损（babel 仅保留 zh/en 场景不适用——litellm 不带 babel;
# 这里清理测试目录与 dist-info 文档）
PRUNE_GLOBS = (
    "**/tests",
    "**/test",
    "**/*.dist-info/RECORD",
)


def target_triple() -> str:
    machine = platform.machine().lower()
    arch = {"x86_64": "x86_64", "amd64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}.get(
        machine, machine
    )
    system = platform.system()
    if system == "Darwin":
        return f"{arch}-apple-darwin"
    if system == "Windows":
        return f"{arch}-pc-windows-msvc"
    return f"{arch}-unknown-linux-gnu"


def run(command: list[str], **kwargs) -> None:
    print("[build-sidecar] $", " ".join(str(part) for part in command), flush=True)
    subprocess.run(command, check=True, **kwargs)


def venv_python() -> Path:
    if platform.system() == "Windows":
        return BUILD_VENV / "Scripts" / "python.exe"
    return BUILD_VENV / "bin" / "python"


def ensure_build_venv() -> None:
    marker = BUILD_VENV / ".sag-build-ok"
    if marker.exists():
        print("[build-sidecar] 复用既有构建 venv")
        return
    shutil.rmtree(BUILD_VENV, ignore_errors=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    run([sys.executable, "-m", "venv", str(BUILD_VENV)])
    python = venv_python()
    run([str(python), "-m", "pip", "install", "--upgrade", "pip", "--quiet"])
    # 非 editable 安装：PyInstaller 模块图必须面向真实包布局
    run([str(python), "-m", "pip", "install", str(API_ROOT), "pyinstaller>=6.10", "--quiet"])
    marker.write_text("ok\n", encoding="utf-8")


def freeze() -> Path:
    triple = target_triple()
    dist_dir = DIST_ROOT / triple
    work_dir = CACHE / "pyinstaller-work"
    shutil.rmtree(dist_dir, ignore_errors=True)
    command = [
        str(venv_python()),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        str(DESKTOP_ROOT / "sidecar" / "sag-api.spec"),
    ]
    identity = os.environ.get("APPLE_SIGNING_IDENTITY")
    if identity and platform.system() == "Darwin":
        command[3:3] = [
            "--codesign-identity",
            identity,
            "--osx-entitlements-file",
            str(DESKTOP_ROOT / "src-tauri" / "entitlements.plist"),
        ]
    run(command, cwd=DESKTOP_ROOT / "sidecar")
    return dist_dir / "sag-api"


def prune(bundle: Path) -> None:
    removed = 0
    for pattern in PRUNE_GLOBS:
        for path in bundle.glob(pattern):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
            removed += 1
    print(f"[build-sidecar] 裁剪 {removed} 个冗余条目")


def stage(bundle: Path) -> None:
    """binaries/sidecar → 当前平台产物（tauri.conf 的 bundle.resources 源）。"""
    if STAGE_LINK.is_symlink() or STAGE_LINK.is_file():
        STAGE_LINK.unlink()
    elif STAGE_LINK.is_dir():
        shutil.rmtree(STAGE_LINK)
    try:
        STAGE_LINK.symlink_to(bundle, target_is_directory=True)
        print(f"[build-sidecar] 已链接 {STAGE_LINK} → {bundle}")
    except OSError:
        shutil.copytree(bundle, STAGE_LINK)
        print(f"[build-sidecar] 已复制 {bundle} → {STAGE_LINK}（平台不支持符号链接）")


def bundle_size_mb(bundle: Path) -> int:
    total = sum(path.stat().st_size for path in bundle.rglob("*") if path.is_file())
    return round(total / 1024 / 1024)


def main() -> int:
    ensure_build_venv()
    bundle = freeze()
    prune(bundle)
    stage(bundle)
    print(f"[build-sidecar] 完成：{bundle}（{bundle_size_mb(bundle)} MB · {target_triple()}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
