---
status: accepted
---

# 以签名静态清单自托管更新

桌面更新使用 tauri-plugin-updater + 自托管静态 `latest.json`（ADR-0003 的 App Store 之外分发）：主端点为 GitHub Releases 的 `releases/latest/download/latest.json`，保留 `dl.zleap.ai/sag/<channel>/latest.json` 镜像位（路径编码渠道，后续 beta 走 `sag/beta/`）。更新产物由 Tauri 签名私钥签署，公钥编译进壳；私钥仅存于发布 CI secrets 与团队密码库——**该私钥一旦丢失，所有已装客户端只能手动重装升级**，保管纪律随本决定生效。更新策略为提示式：就绪后与每 24 小时检查一次 + 设置页手动检查，用户确认后下载安装并可立即重启；不做退出时静默安装（与 ADR-0009 的常驻语义冲突）。壳、前端与 sidecar 共用一个应用版本号，`ready` 握手中 app_version 与壳不一致即判终态错误。
