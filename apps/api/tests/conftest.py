"""测试夹具：在导入 zleap_api 之前把配置指向临时目录（settings 为进程级单例）。"""

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="zleap-test-")
os.environ.setdefault("ZLEAP_DATABASE_URL", f"sqlite+aiosqlite:///{_TMP}/zleap.db")
os.environ.setdefault("ZLEAP_DATA_DIR", f"{_TMP}/zleap")
os.environ.setdefault("ZLEAP_UPLOAD_DIR", f"{_TMP}/uploads")
os.environ.setdefault("ZLEAP_DEBUG", "false")
os.environ.setdefault("ZLEAP_SAG_LANGUAGE", "zh")
# 强制离线：即使存在带真实 key 的 .env，也保证测试确定性（不发起 LLM 调用）
os.environ["ZLEAP_LLM_API_KEY"] = ""
os.environ["ZLEAP_LLM_BASE_URL"] = ""
os.environ["ZLEAP_EMBEDDING_API_KEY"] = ""
