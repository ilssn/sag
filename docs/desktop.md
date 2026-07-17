# SAG 桌面开发与发布指南

桌面客户端 = **Electron 壳（apps/desktop）+ FastAPI sidecar（apps/api 冻结产物）+
web 静态导出（apps/web/out）**。政策层见 ADR-0005~0017、0019~0023；本文是工程操作面。

## 架构速览

```
┌───────────────────────────────────────────────┐
│ Electron 主进程（TS → dist-electron/）        │
│  supervisor ── spawn ──► sag-api serve        │
│      │  stdout JSONL（启动协议 ADR-0017）     │
│      │  stderr → logs/sidecar.log             │
│  app://sag ◄── protocol.handle ── dist-web/   │
│  preload ── contextBridge ──► __SAG_RUNTIME_CONFIG__（ADR-0007）
└───────────────────────────────────────────────┘
```

- 数据目录：`app.getPath("userData")/data`（macOS `~/Library/Application Support/SAG/data`、
  Windows `%APPDATA%/SAG/data`），经 `--data-dir` 传给 sidecar（ADR-0012）。
- 端口：默认 **47240**（ADR-0022），用户改动持久化于 `userData/shell-settings.json`；
  冲突显式修复（boot 页改端口），绝不静默漂移（ADR-0010）。
- 前端 origin：`app://sag`；后端 desktop 模式 CORS 只放行该 origin 与显式配置项。

## 前置依赖

- Node ≥ 20（npm-only，preinstall 强制）、Python 3.11/3.12
- 打包另需各平台原生工具链（macOS: Xcode CLT；Windows: VS Build Tools）

## 开发循环

```bash
make install            # 前后端依赖
make desktop-install    # Electron 依赖
make api                # 终端 A：venv 起后端（dev 模式，8000 端口，与桌面数据隔离）
make desktop-dev        # 终端 B：组装 dist-web + 起壳
```

- 开发态壳默认用 `apps/api/.venv/bin/python -m sag_api` 直接拉起 sidecar（desktop 模式、
  47240 端口、独立数据目录）；`SAG_SIDECAR_COMMAND` 可整体覆盖拉起命令。
- 前端改动后重跑 `npm run stage:frontend`（apps/desktop）刷新 dist-web。

## sidecar 启动协议速查（ADR-0017）

`sag-api serve --data-dir <abs> --port <n> --nonce <N>`；stdout 每行一条 JSON（均回显 nonce）：

```
start{pid,app_version} → migration{status,current?,total?}
→ engine-init{status} → ready{app_version,api_version,protocol,capabilities}
| error{stage,code,message,recoverable}
```

- 终态错误码（壳不得自动重启）：`port-conflict` / `instance-already-running` /
  `migration-failed` / `engine-data-incompatible`；退出码 0/2/11/12。
- 停机信号：**stdin EOF**（壳退出防孤儿）；SIGTERM 冗余。
- 就绪后崩溃：退避重启 ≤3（2/8/30s，健康 10 分钟清零）。

## 日志与数据位置

| 内容 | 位置 |
| --- | --- |
| 壳日志 | `app.getPath("logs")/shell.log` |
| sidecar 日志 | 同目录 `sidecar.log` |
| 业务数据 | `userData/data/`（sag.db · engine/ · uploads/ · backups/ · secret.key · .sag.lock） |
| 壳偏好 | `userData/shell-settings.json`（port / closeToQuit / updatePolicy） |

## 故障排除

- **端口被占**：boot 页直接改端口保存重试；或退出占用进程。
- **迁移失败**：数据在 `data/backups/` 有迁移前恢复点；
  `sag-api restore` 之前可先用 `sag-api migrate --data-dir <dir>` 复现诊断。
- **重置应用**：退出 SAG 后删除 userData 目录（知识索引与上传原文都在其中,慎重）。
- **双开**：第二实例自动聚焦主窗口（ADR-0016）；数据目录锁 `.sag.lock` 冲突退出码 11。

## 构建与发布

```bash
make desktop-sidecar   # PyInstaller onedir（约 800MB，binaries/sidecar）
make desktop-smoke     # 冻结产物冒烟（协议+探针；SMOKE_LLM_API_KEY 时含检索回路）
make desktop-build     # electron-builder → apps/desktop/release/
```

**发布 runbook**（release.yml，tag 触发）：

1. 四处版本号一致（`npm run check:versions`）+ CHANGELOG 记录
2. `git tag vX.Y.Z && git push --tags` → CI 产出 **draft** release
   （DMG + NSIS + electron-updater `latest*.yml` 清单）
3. 真机 QA 清单（见下）通过后手动 publish draft = 发布门
4. 已装客户端经 electron-updater 提示式升级（就绪+10s/每 24h/手动）

**Secrets 清单**：`APPLE_CERTIFICATE(_PASSWORD)`、`APPLE_ID`、`APPLE_PASSWORD`、
`APPLE_TEAM_ID`（签名+公证）；`SMOKE_LLM_API_KEY`、`SMOKE_EMBEDDING_API_KEY`（可选，
冒烟检索回路）；Windows 代码签名证书留位（ADR-0021）。

## 真机 QA 清单（unverified-by-construction，发布门）

本仓库 CI 无 mac/Win GUI 真机，以下只能真机验证：

- [ ] 首装冷启动：boot 页 → 迁移相位 → 工作台；数据目录按平台落位
- [ ] 登录 → 上传文档 → 事件抽取 → 探索模式 3D 场景（60fps 目测）
- [ ] 关窗=隐藏、托盘 打开/退出、closeToQuit 偏好、Dock/任务栏行为
- [ ] 二次启动聚焦；端口冲突改端口恢复；杀 sidecar 观察退避重启与横幅
- [ ] 升级安装：旧版本数据经 Alembic + 引擎数据门无损升级（恢复点存在）
- [ ] electron-updater 从 N-1 版本提示并完成升级
- [ ] macOS 公证/Gatekeeper 放行；Windows SmartScreen 文案确认（未签名警告）
- [ ] OS 注销/关机时优雅停机（无孤儿 sag-api 进程）
