# sag 工程规范（Standards）

> sag 不只是一个 SAG 引擎示范——它同时是一份**可执行的最佳实践**：
> 技术选型、架构分层、代码纪律、产品设计、shadcn/ui 落地，每一层都经得起作为范本被引用。
> 本目录是这些规范的正典（single source of truth）；**代码与规范不一致时，视为 bug**。

## 价值理念

1. **干净胜过聪明**（Clean over clever）——一眼能读懂的直白实现，优先于炫技的抽象。
2. **约定即机制**（Convention as mechanism）——规范不靠自觉：删掉遗留 token 让旧类名失效、
   用 schema 校验让非法值 422、用门禁让不绿不合。能用机制兜底的，绝不写在口头。
3. **主流即负责**（Mainstream is responsibility）——选型永远选生态最主流、可长期维护的方案
   （FastAPI / SQLAlchemy 2 async / Next.js App Router / shadcn/ui / React Flow / MCP 官方 SDK），
   拒绝小众自嗨。
4. **细节即产品**（Details are the product）——加载态、空态、错误文案、键盘可达、亮暗两态，
   与功能同权重验收。
5. **有据可溯**（Grounded）——回答必须带引用、引用必须能一步开到原文分块。这是产品底线，
   也是知识库类产品的设计基线。

## 分册

| 文档 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 后端分层与依赖方向、错误模型、配置分层、测试纪律 |
| [frontend.md](frontend.md) | shadcn/ui 落地规范、token 纪律、公共组件、交互与状态规范 |
| [product.md](product.md) | 知识库设计规范、Agent 设计规范、MCP 作为契约 |

## 门禁（不绿不合）

```bash
# 后端（apps/api）
ruff check sag_api/ tests/ && python -m pytest -q      # 全绿
# 前端（apps/web）
npx tsc --noEmit && npx next build                     # 全绿
```

以上门禁由 **GitHub Actions 强制执行**（`.github/workflows/ci.yml`：push dev/main 与全部 PR），
本地跑过 ≠ 通过——以 CI 绿为准。提交节奏：功能分阶段各一提交推 `dev`，全绿后 `--no-ff`
合 `main`；发布打 `vX.Y.Z` tag。
