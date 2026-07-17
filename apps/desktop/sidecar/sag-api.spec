# -*- mode: python ; coding: utf-8 -*-
"""sag-api sidecar 冻结配置（ADR-0019：onedir，经 bundle.resources 分发）。

必须在「干净的非 editable 安装」构建 venv 中执行（build_sidecar.py 负责搭建）；
editable 安装会污染 PyInstaller 的模块图。
"""

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

datas, binaries, hiddenimports = [], [], []

# 引擎与自身包整体收集：zleap 的 prompts/、tokenizer.json 与 sag_api 的
# Alembic versions/ 都是运行期按文件系统读取的包数据（ADR-0014/0019）。
for package in ("zleap", "sag_api", "sag_agent", "lancedb", "lance", "pyarrow", "tzdata", "alembic"):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hiddenimports += h

# litellm 的模型价格表/模板是 JSON 数据文件
datas += collect_data_files("litellm")

hiddenimports += collect_submodules("markitdown")
# mcp.cli 需要未安装的 typer extra 且导入即 sys.exit —— 排除之
hiddenimports += collect_submodules("mcp", filter=lambda name: not name.startswith("mcp.cli"))
hiddenimports += [
    # uvicorn 按字符串动态导入的组件
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "aiosqlite",
    # tiktoken 的编码注册表由入口点发现
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
    # 原生轮子（hooks-contrib 已覆盖动态库；此处兜底模块图）
    "onnxruntime",
    "tokenizers",
]

a = Analysis(
    ["entry.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=["hooks"],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "IPython", "pip", "setuptools", "wheel"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="sag-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # Windows 不弹控制台;stdio 管道不受影响
    disable_windowed_traceback=False,
    codesign_identity=None,   # macOS 由 build_sidecar.py 传 --codesign-identity
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="sag-api",
)
