---
status: accepted
---

# 桌面正式版使用平台标准应用数据目录

桌面正式版通过 Tauri `appLocalDataDir()` 和稳定的 bundle identifier 定位数据库、知识索引与导入文件：macOS 使用用户级 `Application Support`，Windows 使用 `%LOCALAPPDATA%`。可再生成缓存与日志分别使用平台对应目录，用户导出和备份由用户选择位置；设置页提供打开数据目录与受控迁移能力。`~/.sag` 不作为 GUI 正式版默认路径，只可用于显式的 CLI 或便携运行模式。
