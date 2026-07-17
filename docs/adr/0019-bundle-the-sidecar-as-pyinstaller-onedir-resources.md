---
status: accepted
---

# sidecar 以 PyInstaller onedir 形态随资源分发

FastAPI sidecar 用 PyInstaller **onedir**（目录形态）冻结，经 Tauri `bundle.resources` 打入安装包，由 Rust 直接以资源目录内的可执行文件拉起；不使用 `externalBin`（只接受单文件），也不使用 onefile（每次启动要把约数百 MB 解压到临时目录，Windows Defender 实扫下冷启动常见 10–30 秒，且与 ADR-0017 的自动重启相乘；onedir 还允许构建期逐个签名内嵌 Mach-O，规避 macOS 公证的运行时解包风险）。macOS 按架构分别构建 arm64 与 x86_64（pyarrow/lancedb 无可靠 universal2 轮子，胖包白增约 400MB）。若真机验证发现资源执行位或嵌套签名无法在打包后存活，降级路径是 onefile + externalBin，一处配置翻转即可。（ADR-0023 换壳后，分发通道由 Tauri bundle.resources 等价替换为 electron-builder extraResources，冻结形态与拉起方式不变。）
