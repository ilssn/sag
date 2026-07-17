---
status: accepted
---

# 桌面运行配置固定使用全内嵌存储

桌面 V1 固定使用 SQLite 作为 SAG 元数据库和 zleap-sag 关系存储、LanceDB 作为向量存储，并把托管文件放入平台应用数据目录；客户端不提供 PostgreSQL、Elasticsearch、OceanBase 等基础设施选择。自托管运行配置继续允许通过 `SAG_*` 选择外部后端。两种运行配置复用同一套 FastAPI 业务代码，仅由启动配置提供默认值并校验允许的存储组合。
