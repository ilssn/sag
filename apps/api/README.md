# zleap-api

zleap 的后端服务：FastAPI + `zleap-sag`。

## 分层

| 层 | 目录 | 职责 |
|---|---|---|
| 适配层 | `zleap_api/sag/` | **唯一** import `zleap-sag` 之处；信源 ↔ `DataEngine` |
| 连接器 | `zleap_api/connectors/` | 采集抽象 + 注册表（文件上传 → 动态同步） |
| 任务队列 | `zleap_api/jobs/` | 后台处理编排（ingest → extract 状态机） |
| 生成层 | `zleap_api/generation/` | 检索结果 → LLM 流式答案 + 引用 |
| 领域服务 | `zleap_api/services/` | 纯业务逻辑，不依赖 FastAPI |
| 接口 | `zleap_api/api/v1/` | HTTP 路由，仅做 IO / 校验 / 序列化 |

## 运行

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn zleap_api.main:app --reload
```

文档 UI：http://localhost:8000/docs
