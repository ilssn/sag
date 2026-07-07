"""测试夹具：在导入 muse_api 之前把配置指向临时目录（settings 为进程级单例）。"""

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="muse-test-")
os.environ.setdefault("MUSE_DATABASE_URL", f"sqlite+aiosqlite:///{_TMP}/muse.db")
os.environ.setdefault("MUSE_DATA_DIR", f"{_TMP}/zleap")
os.environ.setdefault("MUSE_UPLOAD_DIR", f"{_TMP}/uploads")
os.environ.setdefault("MUSE_DEBUG", "false")
os.environ.setdefault("MUSE_SAG_LANGUAGE", "zh")
# 刻意不配置 LLM：测试离线路径与错误映射
