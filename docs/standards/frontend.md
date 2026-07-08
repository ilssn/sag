# 前端规范（shadcn/ui 落地 · token 纪律 · 交互）

## Token 纪律（零硬编码）

- **只用语义 token**：`foreground / muted-foreground / background / card / muted / border /
  primary / destructive / success`。禁止 hex/rgb、禁止 `text-zinc-500` 这类原始色阶、
  禁止自造别名——遗留别名已从 tailwind.config 删除，写了就是编译期无效类。
- 状态色只有两个扩展：`success`（成功态）与标准 `destructive`；其余一律中性。
- 亮暗两态**免费获得**：所有颜色经 CSS 变量，禁止手写 `dark:` 色值覆盖。
- 装饰层同样 token 化：点阵网格/光晕（`.bg-dot-grid` / `.bg-halo`）基于
  `--foreground`/`--primary` 透明度，跟随主题。
- 陷阱备忘：tailwind 任意选择器里的 `\_` 在 JS 字符串会丢反斜杠导致类名错配——
  第三方库（如 React Flow）的深层样式一律走 globals 的作用域类（`.sag-graph …`）。

## 组件规范

- **先查组件库再写标签**：段状单选 → `ToggleGroup`；表单行 → `Field/FieldLabel/FieldDescription`；
  下拉 → `Select`；确认 → `ConfirmDialog`（AlertDialog 内核）；告警 → `Alert`；空态 → `EmptyState`
  （Empty 原语）；加载 → `Spinner`/`Skeleton`；徽章 → `Badge`（default/secondary/outline/success/destructive）。
- **公共组件清单**（先复用再新建）：`PageHeader`（页头三段式）· `CopyButton` · `CodeBlock` ·
  `DocStatusBadge` · `detail-panel`（三栏详情：Provider/Main/Outlet）· `ConversationView`（对话状态机）。
- Button 变体 = shadcn 标准六件（default/destructive/outline/secondary/ghost/link），不新增私有变体。
- 布局用 `flex/grid + gap-*`，禁 `space-*`；等宽高用 `size-*`；条件类一律 `cn()`。
- 新增 shadcn 组件走 CLI（Node ≥ 20）：`npx shadcn@latest add <component>`；
  第三方 registry 文件落地后必须核对导入别名与组成完整性。

## 交互与状态规范

- **四态齐备**才算完成一个视图：加载（Skeleton）→ 空态（EmptyState + 行动入口）→
  错误（destructive 提示 + 可行动文案）→ 内容。
- 异步按钮：`disabled + <Spinner /> + 进行时文案`（「保存中…」）；主按钮文案 = 动作本身
  （「删除信源」而非「确定」）。
- 长任务给**真进度**：上传走 XHR `upload.onprogress` + `Progress`；处理中行内给不确定态微光条。
- 详情一律走右侧**三栏详情面板**（可放大、小屏退化 Sheet、切主导航自动收起），
  不再新增居中 Dialog 展示内容型详情。
- 流式对话中**禁止组件重挂**：新会话用 `history.replaceState` 接管 URL + 广播
  `sag:pathchange` 让侧栏同步高亮。
- 键盘可达：可点击行给 `role="button" + tabIndex + Enter/Space`；图标按钮必配 `aria-label`/`title`。
- 文案规范：错误说清「发生了什么 + 怎么办」；成功 toast 用完成时（「已保存并生效」）。

## 视觉细节

- 字阶：页面标题 `font-display text-2xl font-semibold`（经 PageHeader）；正文 `text-sm`；
  辅助 `text-xs text-muted-foreground`；数字对齐 `tabular-nums`。
- 阴影只有两档：`shadow-soft`（常态）/ `shadow-lift`(hover/浮层)；动效曲线 `ease-smooth`，
  入场 `animate-fade-in`，尊重 `prefers-reduced-motion`（tailwindcss-animate 默认）。
- 内容列上限：对话/搜索 `max-w-3xl`、设置/详情 `max-w-4xl`——超大屏不摊平。
