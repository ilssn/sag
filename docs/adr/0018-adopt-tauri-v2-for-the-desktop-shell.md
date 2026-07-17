---
status: superseded-by-0023
---

# 桌面壳采用 Tauri v2

桌面客户端使用 Tauri v2（而非 v1 或 Electron）构建：v1 已进入维护期，v2 才具备我们依赖的官方插件生态（single-instance、updater、process、window-state）、capability/ACL 安全模型与托盘菜单 API，后续伴生形态（ADR-0001/0004 的窗口变形）也依赖 v2 的多窗口能力。Electron 被排除：在本就约数百 MB 的 Python sidecar 之上再叠加 Chromium 运行时没有收益，且 ADR-0003 的透明窗口论证以 Tauri 为前提。壳工程位于 `apps/desktop`（独立 npm 包 + src-tauri），bundle identifier 固定为 `com.zleap.sag`（dev 构建用 `com.zleap.sag.dev` 覆盖）——该标识决定平台数据目录与单实例身份（ADR-0012），首个公开发布后不可再更改，改名等于孤儿化所有用户数据。
