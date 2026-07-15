# 探索模式 4D 图谱：时间即飞行

**目标：** 把「知识宇宙」探索模式的第四维从「离散翻页」改造为「沿时间轴飞行」——Z 轴在每个信息源内部是一条由真实时间戳决定的稳定时间轴，滚轮驱动相机沿这条轴飞行。一个手势一个语义，消除当前「滚轮同时驱动缩放与翻页」的根本性手感冲突。

**架构：** 时间轴是**源内本地**的（进入某个信息源后飞它自己的时间；星系摆位与后端 partition 坐标完全不变）。`Z = f(event.start_time)`，时间刻度与源的视觉半径解耦。相机沿轴飞行取代「节点朝静止相机飞来」。远景由 `time_buckets` 驱动的星云粒子表达时间密度，近景维持现有 240 节点 Sprite 壳与 3d-force-graph 内建拾取管线。`stable`/`journey` 双模状态机与滚轮阈值状态机一并删除。

**技术栈：** three.js 0.185.1、3d-force-graph 1.80、React 19 / Next.js 15、vitest 4.1.10。后端（FastAPI）**不改动**。

## 全局约束

- 只动探索主场景：`universe-scene.tsx`、`knowledge-universe.tsx`、`lib/universe-*.ts`。**不碰** `orbital-graph-3d.tsx`（单信息源 3D 图）、不碰 `source-graph.tsx`/`graph-canvas.tsx`（2D 图）。
- 后端零改动。所需数据（`start_time`、`time_buckets`）后端已算好并已随 API 下发。
- 不引入 InstancedMesh。近景 240 节点预算就是「眼前那层壳」，现有 Sprite 方案够用；换 InstancedMesh 会打断 3d-force-graph 的内建 raycast 拾取，hover/click 全线要重写，风险与收益不成比例。
- 保持既有的性能纪律：有界缓存、有界场景预算、hover/click 不发网络、空闲休眠。
- 每个阶段结束时 `npx tsc --noEmit` 与 `npx vitest run` 必须全绿（基线：退出码 0 / 350 tests，37 files）。
- 删除模块时连同其 `.test.ts` 一起删；被删除的行为若仍需保留，测试须迁移到新归属模块，不得静默丢失覆盖。
- 遵循 `docs/standards/`：语义 token、shadcn 组件、四态齐备。
- 每阶段收尾更新 `docs/architecture/knowledge-universe.md`——本次改造的起因之一就是代码与该文档在滚轮语义上长期背离，**不允许再次留下漂移**。

## 交互契约（改造后）

一个物理手势一个语义，互不重叠：

| 手势 | 语义 | 是否可能发网络 |
|---|---|---|
| 滚轮 / 双指滚动 | 沿当前信息源的时间轴飞行 | 是（飞行前方低水位预取） |
| 拖拽 | 相机旋转 / 平移 | 否 |
| Ctrl/Cmd + 滚轮（pinch） | 缩放 | 否 |
| 点击节点 | 锁定 / 聚焦 | 否 |

**已知的用户可感知变更：滚轮不再是缩放。** 这是「时间即飞行」的必然结果，也是消除手感冲突的核心。缩放能力保留在 pinch 与点击聚焦上。现有代码里 `planUniverseTimelineWheel` 已经把 ctrl/meta 变体豁免为 `"zoom-only"`（`lib/universe-timeline-wheel.ts:121-133`），这个拆分已经半实现了。

---

### 阶段 0：手感止血

与重构正交，先落地、独立可验证，且在重构后依然有效（新设计里相机持续运动，这两处只会更重要）。

**文件：**
- 修改：`apps/web/components/features/universe-scene.tsx`

**接口：**
- 消费：无新增
- 产出：滚轮联动路径上的帧预算回收

- [x] **Step 1: 给 `updateNodeMorphScales` 加节流**

`universe-scene.tsx:3111-3129` 是 `handleControlsChange` 联动路径上唯一没有节流的全节点遍历——同一个回调里的 `updateVisualLayout`(24ms, `:4547`)、`updateLabels`(32ms, `:3994`)、`evaluateLod`(110ms, `:4750`) 都有节流，只有它没有。它经 `nodeMorphScale`(`:3094`) → `nodeProjectionScale`(`:3059-3075`) 对每个非 source 节点做一次 `Math.hypot` + `Math.tan`。OrbitControls 的 wheel 处理是同步、不走 rAF 合并的，快速滚动时同一显示帧内会被反复触发，每次完整遍历一遍场景节点。

按邻居的既有模式加 24ms 节流（与 `updateVisualLayout` 对齐，因为二者都是每帧视觉刷新层）。注意：节流后需确认 `timelineMotion` 进行中的节点缩放不会因错过帧而抖动——若有，节流应对「有活跃动画时」豁免。

- [x] **Step 2: 修渲染休眠的墙钟 / 帧数脱节**

`wakeRendering`(`:4832-4854`) 的休眠计时器是 `setTimeout(墙钟 ms)`，`handleControlsStart`(`:4991`) 固定给 1400ms 宽限；但 OrbitControls 的阻尼按**帧数**衰减（`dampingFactor=0.085`，`:1010`，收敛到 1% 残余约需 53 帧）。60fps 下约 880ms 内收敛，低于宽限没问题；30fps 下需要约 1.8s，超过宽限，`pauseAnimation()` 会在缩放惯性肉眼可见地还在滑动时把它硬停——而这恰好最容易发生在本就吃力、最需要平滑收尾的设备上。

改为让休眠条件真正查询「阻尼是否已收敛」，而不是赌一个墙钟常数。

- [x] **Step 3: 验证阶段 0**

四道门禁全绿：`tsc --noEmit` 0、`vitest run` 352 tests（基线 350 + 新增 2）、`eslint --max-warnings=0` 0、`next build` 0。

新增单测（`universe-scene.test.ts`）：
- `throttles projection morph scales on the camera path without stalling motion`——同时断言 `setObjectOpacity` 仍在应用 `nodeMorphScale`，这是节流安全的前提，一旦被删除节流就会导致动画抖动。
- `waits for camera damping to fall quiet before sleeping the renderer`

修正了两个既有测试的过度具体断言（非行为变更）：`updateLabels(performance.now())` → `updateLabels(now)`（原意是「不得 force」，仍然守住）；`sourceBetween` 的锚点 `"private updateNodeMorphScales()"` → `"private updateNodeMorphScales("`（签名新增参数）。

**未验证**：手感的实际改善没有实测。这两处是纯性能修复，需要真实设备 + 帧率剖析才能观测，代码层不变量已有测试守住。真正的手感验证在阶段 2。

---

### 阶段 1：Z = 源内稳定时间轴，双模合并

改造的地基。本阶段**不动相机**——先让静止场景里的时间深度正确，再让相机动起来。

**文件：**
- 修改：`apps/web/components/features/knowledge-universe.tsx`（摆位与年龄数据流）
- 删除：`apps/web/lib/universe-display-mode.ts`、`apps/web/lib/universe-display-mode.test.ts`
- 修改：`apps/web/components/features/knowledge-universe.test.ts`
- 修改：`apps/web/components/features/universe-scene.tsx`（`presentationScale/Opacity` 兜底、`onCameraInteraction` 解耦）

**接口：**
- 消费：`UniverseTimelineEventOut.start_time`（后端已下发，`schemas/universe.py:94,179`）
- 产出：每个事件一个由时间戳决定的、在源内稳定的世界坐标 Z

**已知限制（阶段 1 实施中发现，暂受「后端零改动」约束）**

后端用 `coalesce(SourceEvent.start_time, SourceEvent.created_time)` 计算 `time_buckets` 的边界（`engine_manager.py:1492,1496-1506`，对全源聚合、无分页，故边界确实是源内稳定的），但前端拿不到 `created_time`——`UniversePatchNode`（`lib/types.ts:524-533`）只有 `start_time`，API 不下发 `created_time`。

因此当一个源里**部分**事件 `start_time` 为空时，后端边界会被这些事件的入库时间撑开，而前端只认 `start_time`，结果是有真实时间的事件被挤向轴的一端。有 `start_time` 的事件仍然稳定；没有的退回 rank（与原实现对所有事件的做法一致，不构成倒退）。

根治需要后端下发 `created_time` 或一个 start_time-only 的范围，会打破「后端零改动」约束——待真实数据验证后再决定是否提出。

（已排除的无效修法：用「首个/末个非空桶」收紧边界。`min_time` 必落在 0 号桶、`max_time` 必落在末桶，两者恒非空，该操作是 no-op。）

- [x] **Step 1: 年龄改由真实时间戳决定**

`knowledge-universe.tsx:1556-1569` 目前用 `universeTemporalRankProgress(可见窗口内的排名)` 算 `ageProgress`——同一个事件的深度由它「此刻恰好排第几」决定，翻出窗口语义就消失。

改用 `universeTemporalTimestampProgress`（`universe-display-mode.ts:318-333`）。该函数已写好、已有单测、生产代码零调用——本阶段把它从待删模块里救出来，迁到新归属（见 Step 3）。

关键：归一化的**定义域必须是整个信息源的时间跨度**（`partition.time_buckets` 的首尾即 `[min_time, max_time]`，manifest 已下发），而不是当前可见窗口。这正是「稳定」的含义。

- [x] **Step 2: 摆位改造，时间刻度与源半径解耦**

`knowledge-universe.tsx:1690-1717` 目前：`z = center.z + normalizedOffset.z * radius`——时间刻度被源的视觉半径绑架，每源刻度不同。

拆掉这个耦合：Z 的尺度由一个独立的、跨源一致的「时间轴长度」常量给出；`radius` 只继续管 x/y 的横向铺开。横向角度目前是 `stableUnit(bundleId)` 哈希（`universe-display-mode.ts:473`），**保留**——它提供的确定性视觉分离在新模型下依然需要，只是不再承担时间语义。

**待评估（阶段 1 实施中发现）：扩展发现的事件不在时间轴上**

`timelineEventPlacementByKey` 有两个填充来源——可见 timeline bundles，以及 `origin === "expansion"` 的 bundle（「探索更多」发现的事件）。但 `temporalProjectionByBundleId` 只由可见 timeline bundles 构建，因此扩展事件有 `timelinePlacement` 却无 `temporalProjection`，落在 `stableRootEventOffset` 的黄金角螺旋上而不是时间轴上。

这是**既有行为**（原实现在 journey 模式下同样如此），本次未改变，也未恶化。但结果是一个场景里并存两套摆位系统：timeline 事件在时间轴上，扩展事件在螺旋上。扩展事件同样有 `start_time`，理应也落在轴上。

需要决定：是把时间投影扩展到 expansion bundles（视觉一致，但要处理「轴上某处突然长出一簇事件」的观感），还是保持现状（扩展是「离题探索」，不属于主时间线）。留到阶段 2 相机飞行成型后再判断——那时才看得出扩展事件散落在轴外是否碍事。

- [x] **Step 3: 删除双模状态机**

`stable` 模式的存在理由是「景深是临时预览、会 snap 回平铺」。Z 永久是时间后，这个理由消失：时间相近的事件天然落在相近的 Z 上，同期事件自动就是平的；`stable` 真正在做的是「把跨越数年的事件强行拍到一个面上」，而那正是本次改造要消灭的东西。

删除 `universe-display-mode.ts` + `.test.ts`，拆掉 `knowledge-universe.tsx` / `universe-scene.tsx` 里 57 处 displayMode 相关引用。保留并迁移的资产：
- `universeTemporalTimestampProgress`（Step 1 要用）
- `projectUniverseTemporalBatch` 的「年龄 → 缩放/透明度」插值曲线（`ageExponent` 等视觉语言原样保留，只是输入换成时间戳、输出不再叫「模式」）
- 对应的单测一并迁移，不得丢失覆盖

同时解掉 `onCameraInteraction` → `restoreStablePresentation`（`knowledge-universe.tsx:766-776,3326`）这条链——没有模式可恢复了。

- [x] **Step 4: 消除命名漂移**

现状是三套词汇指同两个状态：代码 `stable`/`journey`、文档「正常/预览」（`docs/architecture/knowledge-universe.md:33-34,204`）、UI 实际显示「预览/探索」（`messages/zh-CN.json:1112-1113`，注意 **UI 的「预览」对应代码的 `stable`**）。双模删除后这些词汇全部作废，清理 i18n 键与文档表述。

- [x] **Step 5: 验证阶段 1（门禁部分）**

四道门禁全绿：`tsc` 0 · `vitest` 349/37 · `eslint` 0 · `next build` 0 · `i18n:check` 1019 键对齐。净删 919 行。

覆盖迁移核对：`universe-display-mode.test.ts` 原有 12 个测试（5 个状态机 + 7 个投影）。仍然有效的四条已迁入 `universe-temporal-axis.test.ts`——rank/时间戳归一化、near/far 单调性、确定性车道、策略钳制。消失的八条断言的是双模切换、stable 平铺、以及生产从未跑过的混合插值，其行为本身已不存在。无静默覆盖丢失。

`cameraGesture*` 机制提前删除（原排在阶段 2 Step 3）：它是 `onCameraInteraction` 的唯一支撑，双模一删即证明性死亡，留到阶段 2 等于留一坨死代码。阶段 2 也确认不需要它——该分类之所以存在是因为滚轮语义暧昧（缩放 + 时间），而阶段 2 把滚轮整个从 OrbitControls 手里拿走后暧昧本身消失。`handleControlsEnd` 随之变空，连同其监听一并移除。

- [ ] **Step 6: 视觉验证阶段 1（待用户执行）**

**门禁绿 ≠ 摆位对。** 需要跑起来确认：事件按真实时间戳分布在 Z 上、时间相近的事件深度相近、翻页时同一事件的 Z 不再跳变、时间聚集的事件不再叠成一点。

**预期的中间态倒退**：本阶段把摆位换成了绝对时间轴，但相机还不会飞（阶段 2）。翻到旧事件时它们会待在远处又小又暗，相机不跟过去——这是分阶段的必然代价，阶段 1 不是可发布状态。

**待调参**：`TEMPORAL_AXIS_DEPTH = 640`（世界单位）、`nearLateralSpread = 0.18`、`lateralJitter = 0.45` 均是无法凭空推算的视觉量，需实际观测后定。

---

### 阶段 2：相机飞行，滚轮统一

**文件：**
- 修改：`apps/web/components/features/universe-scene.tsx`
- 删除：`apps/web/lib/universe-timeline-wheel.ts`、`apps/web/lib/universe-timeline-wheel.test.ts`
- 修改：`apps/web/components/features/universe-scene.test.ts`
- 修改：`apps/web/lib/universe-timeline-prefetch.ts`（预取触发源）

**接口：**
- 消费：阶段 1 产出的稳定时间轴 Z
- 产出：相机沿时间轴的连续飞行；滚轮的唯一语义

- [ ] **Step 1: 滚轮脱离 OrbitControls，直接驱动相机沿时间轴**

现状是两个机制抢一个手势：`handleTimelineWheel` 绑在 `host` 捕获阶段（`:1059-1062`），OrbitControls 的 wheel 绑在 `rendererCanvas` 目标阶段，前者故意先跑一步标记 `cameraGestureKind` 再放行给后者做 dolly。

新模型下滚轮只有一个语义，因此**滚轮完全不再传给 OrbitControls 的 dolly**：`preventDefault` + 自己驱动相机沿源的时间轴方向移动。这同时干掉：
- 120px 隐藏累积阈值（连续飞行不需要阈值）
- `forwardTimelineWheelToCanvas`(`:4917-4940`) 这套 label 层转发 hack（存在的唯一理由就是让 OrbitControls 也收到 wheel）
- `zoomToCursor: true`(`:1013`) 带来的支点漂移——它与「沿稳定轴飞行」直接冲突

注意 wheel 监听当前是 `passive: true`(`:1061`)，要 `preventDefault` 必须改为非 passive。

- [ ] **Step 2: 删除滚轮阈值状态机**

删 `universe-timeline-wheel.ts` + `.test.ts`。其中值得保留并迁移的设计资产：
- `deltaMode` 0/1/2 的归一化（`:72-86`）——飞行速度换算仍然需要
- ctrl/meta 豁免为缩放（`:121-133`）——正是新交互契约里的 pinch 分支

作废的：120px 阈值、单槽方向队列、`busy` 排队、`drainUniverseTimelineWheel`——连续飞行下这些概念都不成立。

- [x] **Step 3: 重做 `cameraGestureKind`** —— 已在阶段 1 完成

`:809` 的这个全局单值字段存在的理由是「滚轮=缩放+时间导航的组合手势，不能让它把 journey 打回 stable」。双模删除（阶段 1）+ 滚轮语义唯一化（Step 1）之后，这个字段的存在理由消失，连同它的已知缺陷一起删除：一次真实拖拽的 `start` 与首次 `change` 之间若插入一次杂散 wheel tick，`"pointer"` 会被覆盖成 `"wheel"`，让本该触发的回调被吞掉（`:4956` vs `:4978`）。

- [ ] **Step 4: 预取改由相机 Z 驱动**

现状预取由「页意图」触发。新模型下改为由相机在时间轴上的位置与速度驱动：飞行前方低水位时预取。`planUniverseTimelinePrefetch`(`lib/universe-timeline-prefetch.ts:102-236`) 的「至多预取一页、优先用户当前方向、避免来回震荡」决策逻辑原样可用，只需把输入从「页意图方向」换成「相机飞行方向」。

- [ ] **Step 5: 飞行途中的数据等待反馈**

现状缓存未命中时 3D 场景零反馈，只有屏幕底部一行 11px 小字（`knowledge-universe.tsx:3534-3541`），1.6s 看门狗(`universe-scene.tsx:2629-2636`) 还会静默回滚整个意图。

连续飞行下这个问题会更明显——飞行不能因为等数据而卡住。设计原则：**飞行永不阻塞**。前方数据未到位时，星云（阶段 3）先行表达「那里有东西，正在具象化」，节点到位后就地凝现，不打断相机运动。删除看门狗的静默回滚——飞行没有「意图」可回滚。

- [ ] **Step 6: 验证阶段 2**

`npx tsc --noEmit && npx vitest run` 全绿。**视觉验证**：滚轮飞行连续跟手、无阈值跳变、无网络等待卡顿；拖拽只旋转平移；pinch 只缩放；四种手势互不干扰。低帧率设备（可用 CPU throttle 模拟）下阻尼收尾不被硬停。

---

### 阶段 3：远景星云 = 时间密度

**文件：**
- 修改：`apps/web/components/features/universe-scene.tsx`（`rebuildNebula`）

**接口：**
- 消费：`partition.time_buckets`（`lib/types.ts:420` 已有类型声明，当前全 `apps/web` 零消费）
- 产出：飞行前方的时间密度预览

- [ ] **Step 1: 星云消费 `time_buckets`**

现状 `rebuildNebula`(`:3186-3336`) 的粒子分配权重是 `log2(eventCount + entityCount + 2)`(`:3214-3227`)——表达的是「该源内容总量」，与时间无关。

改为让粒子沿该源的时间轴分布，密度由 `time_buckets[].count` 决定。后端已按源把 `[min_time, max_time]` 等分成 8 桶（上限 24，`engine_manager.py:1481,1490`）并精确统计每桶事件数，随 manifest 下发。

已知局限，需在实现时评估：桶是**等时间宽度**而非等事件数，时间分布高度不均的源会出现很空的桶；桶数上限 24，若沿轴飞行需要更细的分箱，需后端放开 `bucket_count`——这会打破「后端零改动」约束，届时单独提出。

- [ ] **Step 2: 保持现有星云基建不动**

`makeNebulaMaterial`(`:642-760`) 的 shader、逐粒子 `BufferAttribute`(`:3286-3327`)、仅在 context 变化时整体重传的 `updateNebulaAlphas`(`:3359-3409`) 这套「GPU 端做视觉状态、不逐帧全量重传」的范式已在生产验证，原样保留，只改粒子的位置分配逻辑。

粒子预算维持 `universe_proxy_budget_*`（桌面 3000 / 移动 1200）硬上限不变。

- [ ] **Step 3: 验证阶段 3**

`npx tsc --noEmit && npx vitest run` 全绿。**视觉验证**：飞行时能在抵达之前就看见前方的事件密度；密集时段星云浓、稀疏时段星云淡；星云与近景节点的凝现过渡不突兀。

---

### 阶段 4：文档对齐

- [ ] **Step 1: 重写 `docs/architecture/knowledge-universe.md` 的相关章节**

本次改造的起因之一就是代码与该文档在滚轮语义上背离（文档 5 处写「滚轮只做平滑缩放，不触发时间加载」，代码却在滚轮上挂了翻页 + 网络）。改造后交互契约彻底变化，必须同步：
- 产品语义（`:20-40`）：翻页 → 飞行
- 交互状态表（`:255-273`）：按本文档「交互契约」章节重写
- 生产验证门禁（`:275-310`）：更新为飞行模型的验收项
- 增量过渡规则（`:197-253`）：相机不再静止

- [ ] **Step 2: 把该文档加进 `docs/README.md` 索引**

`docs/README.md:10-16` 列了 `architecture.md`/`agent-mcp-graph.md`/`agent-runtime.md`/`connectors.md`，唯独漏了 `architecture/knowledge-universe.md`——对后续读者是个发现性缺口。

- [ ] **Step 3: 更新 `CHANGELOG.md`**

`Unreleased` 段当前完全没提探索模式（对比它涉及的代码量，这本身是个过程缺口）。
