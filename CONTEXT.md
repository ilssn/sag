# Ubiquitous Language

## Product surfaces

- **Web 版（Web App）**：通过浏览器访问的 SAG 工作台。
- **桌面客户端（Desktop Client）**：用户安装在 macOS 或 Windows 上的 SAG 工作台；默认打开完整主面板。
- **桌面壳（Desktop Shell）**：承载共享界面并管理桌面窗口、应用生命周期与本地服务的客户端边界。
- **共享界面（Shared UI）**：Web 版与桌面客户端共同使用的产品界面和交互代码。
- **本地 Web 运行时（Local Web Runtime）**：随桌面客户端启动、向桌面窗口提供完整 SAG Web 工作台的本地服务。
- **本地后端（Local Backend）**：随桌面客户端运行、为共享界面及本机外部调用方提供知识库能力的本地 API 服务。
- **Python Sidecar**：由桌面壳启动和停止的本地后端可执行目录；使用 PyInstaller `onedir` 冻结，不要求用户安装 Python。
- **桌面整包（Desktop Bundle）**：同一版本内的 Electron、Next.js、本地后端及原生依赖集合。
- **整包更新（Whole-app Update）**：以桌面整包为最小更新单位，不分别替换 Web 或 Python 运行时。
- **应用数据目录（App Data Directory）**：操作系统为 SAG 分配的标准用户数据目录；知识库、上传文件和运行密钥保存在此处，不写入安装目录。
