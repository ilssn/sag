---
status: accepted
---

# Sidecar 就绪前执行版本化数据库迁移

Alembic 成为 SAG 元数据库结构与数据迁移的唯一机制，首次安装也从版本化基线创建数据库。sidecar 启动时先获取单实例锁、创建 SQLite 恢复点并运行迁移，成功后才报告 ready；失败时不开放业务 API，由桌面壳提供恢复与日志入口。现有 `create_all()` 加 `_COLUMN_UPGRADES` 的临时演进方式不再作为正式客户端兼容路径，避免升级规则分散且无法覆盖改名、约束和数据转换。
