# 贡献指南

sag 以「可执行的最佳实践」为标准——请先读 [docs/standards/](docs/standards/README.md)
（架构 / 前端 / 产品三册），**代码与规范不一致时视为 bug**。

## 环境

- 后端：Python ≥ 3.11（`apps/api`，`pip install -e ".[dev]"`）
- 前端：Node ≥ 20（`apps/web`，`npm install`；shadcn CLI 需要 Node 20+）

## 门禁（不绿不提 · CI 强制）

推 `dev`/`main` 与所有 PR 都会触发 GitHub Actions（后端 ruff+pytest、前端 tsc+build）——
以 CI 结果为准。本地预检：

```bash
cd apps/api && ruff check sag_api/ tests/ && python -m pytest -q
cd apps/web && npx tsc --noEmit && npx next build
```

## 流程

1. 从 `dev` 拉分支；小步提交，提交信息说清「做了什么 + 为什么」。
2. 新端点：happy path + 4xx 测试；新视图：加载/空/错误/内容四态齐备。
3. UI 一律走 shadcn 组件与语义 token（见 frontend.md），禁止硬编码色值与私有变体。
4. 全绿后 PR 到 `dev`；维护者 `--no-ff` 合 `main` 并按语义化版本打 tag。

## 提问与讨论

Issue 请附：复现步骤 / 期望行为 / 实际行为 / 环境（OS·Python·Node）。
