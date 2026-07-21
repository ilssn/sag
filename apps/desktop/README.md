# SAG Desktop

SAG Desktop 用 Electron 承载现有 Next.js 工作台，并在本机管理两个随包运行的服务：

- Next.js standalone 本地 Web 运行时；
- PyInstaller `onedir` 形式的 FastAPI/Python sidecar。

桌面版默认打开完整主面板，产品界面和路由继续来自 `apps/web`。首版不拆分宠物窗口，也不维护第二套前端。

## 本地开发

要求：

- Node.js 20+；
- Python 3.11；
- `apps/web`、`apps/api` 和 `apps/desktop` 的依赖已经安装。

首次准备：

```bash
cd apps/web
npm install

cd ../api
uv sync --extra dev --extra desktop

cd ../desktop
npm install
```

启动 Web、API 和 Electron：

```bash
cd apps/desktop
npm run dev
```

如果 3000 或 8000 端口已经运行对应服务，开发脚本会复用它们。退出 Electron 时，由脚本创建的子进程会一起退出。

## 发布构建

发布构建必须在目标操作系统上执行。PyInstaller sidecar 含操作系统和 CPU 架构相关的原生库，不能在 macOS 上生成可发布的 Windows sidecar。

macOS Apple Silicon：

```bash
cd apps/desktop
npm run dist:mac
```

Windows x64：

```powershell
cd apps/desktop
npm run dist:win
```

构建顺序固定为：

1. 编译 Electron main/preload；
2. 用桌面 API 地址重新构建 Next.js standalone；
3. 冻结 Python sidecar；
4. 组装 Web、API 和运行清单；
5. 生成并签名安装产物。

产物位于 `apps/desktop/release/`：

- macOS：DMG 用于安装，ZIP 用于自动更新；
- Windows：NSIS 安装器及其更新元数据。

只验证应用目录、不生成安装器时，可运行：

```bash
npm run package:dir
```

## 构建与发布配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `SAG_DESKTOP_APP_ID` | `ai.zleap.sag` | 应用唯一标识；首次公开发布后不得随意修改 |
| `SAG_DESKTOP_API_PORT` | `8000` | 本地 API 端口；同时写入 Web 构建和桌面运行时 |
| `SAG_DESKTOP_WEB_PORT` | `32100` | 本地 Web 首选端口；被占用时向后寻找可用端口 |
| `SAG_UPDATE_BASE_URL` | 未设置 | 通用更新源根地址；未设置时不生成更新配置，也不检查更新 |
| `SAG_NOTARIZE` | `false` | 设为 `true` 时执行 macOS notarization |
| `SAG_DESKTOP_PYTHON` | `apps/api/.venv` 中的 Python | 构建 sidecar 使用的解释器 |
| `SAG_PYTHON_DIST_DIR` | API 默认冻结产物目录 | 复用 CI 中已构建的 sidecar |

签名凭据通过 electron-builder 支持的 CI 环境变量或系统证书存储注入，不写入仓库。应用图标母版和平台产物位于 `apps/desktop/assets/icon-master.png`、`icon.icns` 与 `icon.ico`。

`SAG_DESKTOP_API_PORT` 属于发布构建参数，不建议交给最终用户修改，因为 Next.js 中的 API Base 是构建时值。若确实修改，构建和运行阶段必须保持一致。

## 运行与数据目录

正式客户端只监听 loopback：

- Web：`localhost:32100` 起的动态端口；
- API/MCP：`127.0.0.1:8000`。

数据库、上传文件、知识引擎数据和桌面运行密钥不写入安装目录，而是写入 Electron 标准 `userData` 目录：

- macOS：`~/Library/Application Support/SAG/`
- Windows：`%APPDATA%\SAG\`

应用更新不会覆盖此目录；Windows 卸载器也配置为默认保留用户数据。

## 更新约束

桌面版采用整包版本和整包更新：Electron、Next.js、Python API 及其原生依赖使用同一个 `apps/desktop/package.json` 版本发布。不要分别更新 Web 或 Python sidecar，否则无法保证接口和数据迁移兼容。

通用更新源需要发布安装产物和 electron-builder 生成的元数据。只有配置了 `SAG_UPDATE_BASE_URL` 的正式构建才启用客户端更新检查；开发构建和无更新元数据的本地产物不会联网检查。

## 发布前检查

至少完成：

```bash
npm run typecheck
npm run prepare:release
```

并在干净的目标机器验证：

- 首次安装和首次冷启动；
- Web 登录页与 `/api/v1/system/ready`；
- 文档导入、搜索、对话、探索模式和 MCP；
- 应用退出后两个本地服务均结束；
- 覆盖升级保留用户数据；
- 签名、macOS notarization、Windows SmartScreen 与自动更新。
