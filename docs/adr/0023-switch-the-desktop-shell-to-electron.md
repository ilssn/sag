---
status: accepted
---

# 桌面壳改用 Electron（取代 ADR-0018 的 Tauri 决定）

桌面壳从 Tauri v2 改为 Electron：本产品的招牌能力是 WebGL 重载的 3D 知识宇宙，Tauri 在 macOS 走 WKWebView，渲染与性能行为和日常调试的 Chromium 家族不一致且只能真机才可验证；Electron 全平台统一 Chromium，网页端验证过的效果原样交付。其次团队栈为 TypeScript + Python，Node 主进程可被直接维护，无需为约千行 Rust 壳建立能力。Tauri 的体积优势被约 500MB 的 Python sidecar 稀释（安装包差距 <20%），透明宠物窗（post-V1）在 Electron 同样成熟可行。ADR-0017 的 sidecar 启动协议、ADR-0007 的运行时配置注入（改经 contextBridge 于 preload 暴露 `__SAG_RUNTIME_CONFIG__`）、ADR-0019 的 PyInstaller onedir（改经 extraResources 分发）均原样保留。静态前端由自定义 `app://` 协议托管（绝对路径资源与稳定 origin），桌面 CORS origin 相应固定为 `app://sag`。ADR-0018 由本决定取代；0019/0020/0021 中与壳绑定的机制（resources 分发、更新器、NSIS）按 Electron 生态等价替换：electron-builder + electron-updater（GitHub Releases 发布源）、NSIS perUser 不变。
