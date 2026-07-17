"""PyInstaller 冻结入口：`sag-api` 可执行 = sag_api.sidecar CLI。

freeze_support 必须最先执行（Windows 冻结环境的 multiprocessing 安全）。
"""

import multiprocessing
import sys

multiprocessing.freeze_support()

from sag_api.sidecar import main  # noqa: E402 —— freeze_support 之后再触发业务导入

sys.exit(main())
