# 下一代 4D 知识探索工作台：生产设计与实施计划

> 状态：目标设计已决策；滚轮方向、稳定布局、背景隔离与探索连线分层已实施，v3 工作台按阶段推进
> 日期：2026-07-15
> 适用范围：知识库总览、4D 图谱、时间浏览、搜索、原文阅读、问答与探索记录
> 交付原则：不保留旧交互、旧协议或旧本地偏好的兼容层；新链路验收后一次切换并删除旧实现

## 1. 结论

产品继续保留“知识宇宙”的沉浸感，但不再把所有知识、卡片、连线和工具同时堆进一个全屏
3D 场景。新形态是一套统一的知识探索工作台：

- 顶部负责搜索、范围和视图，不负责性能调参。
- 中央 4D 知识地图负责结构、时间和焦点，不负责承载长文本。
- 底部时间轨始终提供明确的时间定位；“深入”态滚轮把相机推进与相邻时间页绑定，“浏览”态
  滚轮只缩放，拖动只旋转或平移并立即回到稳定浏览。
- 右侧标准详情面板负责概览、原文证据和问答。
- 浏览器式前进、后退和“保存探索”负责追踪过程。
- 同一个 KnowledgeScope 贯穿图谱、搜索、问答和引用，文档与实体类型不再只在前端隐藏。
- 数据缓存、场景候选、镜头可见内容和可读标签分层维护。缓存里有数据，不等于立刻渲染；
  渲染了星点，也不等于立刻展示卡片。

用户看到的默认画面必须克制：先理解范围和时间分布，再进入事件网络，再阅读证据，最后基于
同一上下文提问或总结。沉浸感来自连续的空间和时间，而不是来自持续运动、粒子、卡片墙和粗线。

### 1.1 当前稳定化基线（已落地）

- 屏幕空间宇宙背景不再订阅相机 LOD/progress；全屏探索由 AppShell 显式暂停环境动画，拖动时
  不产生鼠标彗星，数据星云也不因 controls start 自激。
- 滚轮方向与 OrbitControls 统一：靠近进入更早时间，拉远回到较近时间；转场 busy 时不保存、
  不排队、不在 settle 后重放旧意图。
- 时间 intent 命中时立即捕获镜头中心；网络返回不能把新节点出生点改到迟到的 controls.target。
- retained 节点坐标、大小和透明度保持不动；新节点从中心小尺度进入；缓存回退节点从记忆位置
  恢复；正反方向使用同一确定性 lane，不再镜像兜圈。
- 深入态默认隐藏普通关系，只显示 hover/pin 的真实一跳；拖动回到浏览态后再显示完整关系。
- 深入转场结束只隐藏有界 outgoing ghost，不做第二次 `graphData()`；下一页提交或进入浏览态时
  再统一清理。无可见关系时，动画帧不遍历和更新全部线几何。

## 2. 当前问题审计

### 2.1 产品与信息架构

当前一个全屏场景同时承担全库总览、时间翻页、关系浏览、搜索结果、节点扩展、原文入口、
问答上下文、缓存状态和性能设置。结果是：

- 用户无法快速判断当前范围、时间位置、焦点和下一步动作。
- 搜索答案、数十张事件卡、实体标签、放射连线、浮动助手和场景控制争夺同一层注意力。
- 搜索、问答和图谱分别维护范围，画面已筛选但回答仍可能检索全库。
- “锁定”同时表示节点选中、范围固定和时间导航阻塞，语义混乱。
- normal、preview、explore、stable、journey 等实现状态暴露成产品行为，用户需要学习内部机器。
- 工程参数被当成业务配置：可见事件数、缓存容量、节点预算等不应由普通用户负责。

### 2.2 数据与查询

现有 keyset 双向分页、snapshot/revision、原子事件—实体载荷、固定 deque、工作集所有者去重
都是正确基础，应保留。真正的问题是查询作用域和状态所有权：

- 时间线请求只有单一 source，没有文档、实体类型和时间范围。
- 实体类型在服务端取回 top-N 后才由前端删除，既不节省查询，也可能把用户需要的低排名类型
  永久挡在 top-N 之外。
- 时间线事件没有直接返回 document_id 和 document_name；按文档过滤若在前端补做，会退化为
  每节点详情请求。
- 搜索和问答也只有 source_ids，没有统一的文档、类型和时间 scope。
- 文档列表当前为无分页全量读取，不能直接充当大型知识库的筛选 facet。
- 运行期首次请求创建索引不是生产迁移规范；同一页面中的 revision fence 还会产生重复往返。
- 事件排序使用发生时间，缺失时回退摄取时间，但前端无法知道当前显示的是哪种时间。

### 2.3 前端与渲染

当前 KnowledgeUniverse 约 3,700 行、UniverseScene 约 5,600 行，另有一套独立 3D 图引擎。
网络、缓存、分页、相机、时间、卡片、选择、粒子和资源生命周期互相牵引：

- 滚轮缩放与时间加载缺少明确状态和方向契约；相机靠近却回到较新数据，转场期间还会排队
  重放旧手势，造成数据与镜头在不同时间反向移动。
- 场景中的对象数接近数据数，同时还有 DOM 卡片、手写投影、碰撞和多条动画循环。
- 焦点网络会绕过卡片预算，形成截图中的二十余张卡片墙。
- 相同事实同时存在于 deque、window、working set、graph memo 和多个 Map/ref，容易出现闪烁、
  迟到响应和状态不同步。
- 相机移动与网络 LOD 相连；缩放可能请求数据，查询也可能导致全场重排。
- 当前测试大量验证源码中“存在某段逻辑”，没有真实验证帧耗时、内存稳定和视觉连续性。

## 3. 产品目标与不可破坏原则

### 3.1 用户目标

用户必须能够顺畅完成一条闭环：

1. 看清当前知识范围和时间分布。
2. 进入一个时间段、主题或搜索命中。
3. 聚焦事件或实体的一跳事实网络。
4. 一步阅读证据，两步到原始文档。
5. 基于当前范围和焦点追问。
6. 保存线索、生成带引用的探索总结，并可恢复现场。

### 3.2 不可破坏原则

- **事实第一**：图谱只展示 SAG 事件、实体、关系和原文证据，不制造视觉关系。
- **原文第一公民**：任何搜索、回答、事件或实体最多两步到原始证据。
- **输入职责可预测**：“深入”态滚轮只推进连续的相机—时间语义；“浏览”态滚轮只缩放；拖动
  只控制相机并结束深入；时间轨和按钮始终可显式定位；hover 只预览。
- **增量且有界**：数据总量可以无限增长，浏览器缓存、Three 场景、DOM 和动画成本必须有界。
- **稳定身份**：相同 scope 和 revision 下，相同节点位置、选择和历史恢复结果一致。
- **先聚合后细节**：默认展示分布与代表内容，只有用户靠近或聚焦才升级细节。
- **旧画面留存**：后台请求、预取和 snapshot 更新不能先清空当前安全画面。
- **系统负责性能**：用户只配置知识范围和可读偏好，不配置缓存、像素和 GPU 上限。

## 4. 新信息架构

### 4.1 页面骨架

| 区域 | 常驻内容 | 展开内容 | 禁止内容 |
|---|---|---|---|
| 顶部范围栏 | 返回、面包屑、搜索、当前范围、固定范围、关系/时间投影 | 文档、实体类型、时间筛选 | 缓存容量、节点预算、WebGL 重试 |
| 中央 4D 地图 | 聚合星云、事件星、代表实体、焦点关系 | 当前焦点的一跳网络 | 长文本、全量结果卡、全量关系 |
| 底部时间轨 | 时间密度、当前位置、前后、范围摘要 | 拖动预览、时间区间选择 | 无方向提示或不可回退的翻页 |
| 右侧详情面板 | 默认关闭 | 概览、证据、问答 | 可拖动浮窗、重复卡片 |
| 探索历史 | 后退、前进、保存探索 | 历史抽屉、总结 | 记录 hover、缩放和每一帧相机 |

移除覆盖图谱的“搜索 / 问答 / 知识库”浮动迷你工作区。助手入口进入右侧“问答”页签，不再以
机器人形象遮挡知识内容。右侧详情复用项目现有 detail-panel 和响应式 Sheet 规范。

### 4.2 三层地图，而不是一张全量图

1. **总览层**
   - 全库入口显示信源簇、文档量、事件量和时间密度。
   - 不读取单个事件和实体，不绘制事实关系。
   - 点击信源进入其 4D 视图。

2. **时间 / 关系层**
   - 同一份数据提供“时间”和“关系”两个明确投影，不产生两套选择或缓存。
   - 时间投影突出时间分布和事件簇；关系投影突出事件与代表实体。
   - 投影切换只改变布局表达，范围、焦点、缓存和详情不丢失。

3. **焦点层**
   - 只展示一个事件或实体的真实一跳网络。
   - 画布最多出现一个焦点摘要和少量关键标签；完整关系列表进入右侧面板。
   - 搜索结果默认显示在右侧列表；只有选中的一条结果和证据链进入焦点层，禁止把所有命中
     变成全屏事件卡。

### 4.3 右侧详情

右侧固定三个页签：

- **概览**：标题、时间、类型、来源、关联数量、一跳关系列表、“继续探索”。
- **原文与证据**：引用 chunk、上下文、文档名、原始文件入口；引用点击保持当前地图现场。
- **问答**：自动继承当前 KnowledgeScope、时间切片和焦点节点；输入器上方始终展示实际 scope。

点击节点只选中并打开概览；点击证据切换到原文；点击“基于此提问”切换到问答。三个阶段在
同一个面板完成，不创建新的浮窗，也不清空图谱。

## 5. 统一范围模型

### 5.1 公共类型

    type KnowledgeScope = {
      sourceIds: string[];
      documents: {
        mode: "all" | "include";
        ids: string[];
      };
      entityTypes: {
        mode: "all" | "include";
        values: string[];
      };
      time: {
        from: string | null;
        to: string | null;
        basis: "occurred";
      };
      fixed: boolean;
    };

服务端规范化后返回：

    type ResolvedKnowledgeScope = KnowledgeScope & {
      scopeHash: string;
      revision: string;
      documentCount: number;
      eventCount: number;
      entityCount: number;
      effectiveTimeBasis: "occurred-with-ingested-fallback";
    };

### 5.2 范围语义

- sourceIds 为空表示全库总览；详细 4D 时间浏览时必须收敛为一个信源。多信源搜索和问答可以
  保持多选，但各信源事实不跨源连边。
- “全部文档”表示当前所选信源内所有 ready 文档；处理中、失败和已删除文档不进入事实 scope。
- 文档选择、实体类型和时间范围必须在服务端计数、排序、top-N 和分页之前应用。
- 实体类型筛选删除对应实体及其关系，但不伪造或重连事实。
- 时间投影中，事件事实不会因为所选实体类型下没有邻居而消失；它会保留为独立事件星。
  关系投影中，此类事件不进入关系网络，以免出现没有上下文的“裸网络节点”。
- 事件时间优先使用 occurred time；缺失时回退 ingested time，并在事件详情和时间轨上明确标记。
- fixed 表示范围跨探索、搜索、阅读和问答保持不变，不再使用“锁定”一词。
- 节点选择使用“保持焦点”，与范围固定完全分离。

### 5.3 配置交互

- 顶部范围摘要始终可见，例如“历史 · 3 个文档 · 人物/地点 · 1840—1912”。
- 点击摘要打开业务筛选面板：文档支持分页搜索和“全部 / 已选”；实体类型显示当前 scope 计数；
  时间范围使用直方图刷选。
- 面板采用“草稿 → 应用”，勾选过程不请求、不重排。应用后生成新 scopeHash。
- 范围固定后，搜索、问答、继续探索和保存探索都继承同一 revision；用户要修改时先解除固定。
- 新 scope 仍包含当前焦点时保持焦点；不包含时清除焦点，并用一条可关闭提示解释原因。
- 用户偏好只保留标签密度、关系密度、降低动态和上次业务范围。缓存、窗口、像素比、节点上限
  只存在于系统策略或开发诊断。

## 6. 4D 与渐进式呈现

### 6.1 第四维

4D 定义为稳定的三维知识坐标 x/y/z 加独立时间状态 t：

- 三维坐标表达信源、主题和事实关系。
- 时间轨明确表达 t、时间窗口、数据边界和密度。
- 时间变化控制哪些事实进入候选窗口，以及远近、大小和明暗；不会改写相机输入语义。
- 同一 scope/revision 的节点坐标稳定。前进、后退、搜索高亮、阅读和问答都不重新运行整图布局。

### 6.2 四层渐进管线

| 层 | 内容 | 是否联网 | 是否进入 Three | 是否进入 DOM |
|---|---|---:|---:|---:|
| 数据缓存 | 当前页、回退页、预取页、详情 | 需要 | 否 | 否 |
| 场景候选 | 当前时间窗与镜头 overscan 内节点 | 否 | 是 | 否 |
| 镜头可见 | 正面视锥、有效深度、足够投影尺寸 | 否 | 是 | 有上限的轻卡 |
| 可读焦点 | hover、选中、搜索证据链 | 详情按需 | 是 | 单一完整摘要或右侧详情 |

这四层必须由不同状态拥有者维护。缓存页不会因为存在就进入当前实例池；当前时间窗只建立一个
有界、稳定的实例池。相机运动不增删该池中的 Object3D，而是在渲染循环内更新可见性掩码。
用户拖拽/轨道旋转把区域带到镜头正面后，内容才从不可交互星点升级为名称或轻卡；只有时间窗、
scope 或事实数据变化才重建稳定实例池。

### 6.3 镜头正面显示规范

- 稳定实例池由当前时间窗、15% overscan 和 scene budget 决定；相机只计算池内可见性。
- 标签和轻卡按镜头朝向、投影尺寸、深度、搜索相关性、焦点关系和屏幕拥挤度统一评分。
- 镜头运动时只保留正面约 65° 视锥中的焦点与主标签；边缘和背面只保留不可交互星点。
- 镜头停止约 140ms 后，正面标签在 160ms 内淡入；停稳约 420ms 后，才允许升级为轻卡。
- 轻卡只包含类型、标题和时间，不显示长摘要；桌面最多 6 张、移动最多 3 张，并在事件与实体
  之间保留配额。hover 可临时提升当前一张，click 后才显示一个完整摘要和右侧详情。
- 屏幕按网格做深度优先碰撞：同一格优先焦点、搜索命中、较近和较重要节点。
- 进入与退出采用迟滞阈值，参考进入 0.65、退出 0.52，并保留最短 120ms，避免边界闪烁。
- 背面永不展示完整事件卡；旋转到正面后才升级。完整内容固定进入右侧详情。
- 普通关系只在两个端点都处于正面可见集时绘制；通向边缘或背面的关系淡出，并在焦点详情中
  用“另有 N 个关系”表达。不可见节点从 raycast、hover 和键盘空间导航候选中移除。
- hover 只显示一行轻预览并高亮真实一跳，不请求、不移动相机、不写历史。
- click 选中并打开详情；点击空白或 Esc 清除焦点，不刷新场景。

具体阈值集中在单一 ScenePolicy，由设备档位和可观测数据调整，不允许散落在组件中。

### 6.4 视觉层级

- L0：信源/文档簇与时间密度；无事实边、无事件卡。
- L1：时间段与事件簇；只显示代表事件星。
- L2：当前时间窗的事件、主实体和稀疏关系；正面停稳后显示有上限的轻卡。
- L3：当前焦点的一跳事实网络、一个摘要、证据和问答入口。

事件继续使用星形，实体使用圆点或类别图形；形状与文字共同区分，不能只依赖颜色。普通关系
细且低对比，只绘制当前候选中的事实边；焦点一跳提高对比。跨簇关系在低 LOD 聚合成数量，
不绘制毛线团。背景星云低对比、低运动，仅提供空间深度，不与数据节点争夺亮度。

### 6.5 动画

- 一个时间窗口使用一个批次时钟：中央小星出现、整体放大和扩散，旧窗口向边缘淡出。
- 禁止逐节点 setTimeout、弹性飞入、粒子爆发和全场重新布局。
- 普通空间过渡 160—240ms；缓存命中的完整时间切换在 600ms 内稳定。
- retained 节点从当前真实位置插值；只有新节点从簇锚点进入，只有失去全部 owner 的节点退出。
- reduced-motion 下取消位移，只保留约 120ms 透明度变化。

## 7. 交互状态机

产品只暴露五个用户可理解的状态：

| 状态 | 用户在做什么 | 中央地图 | 右侧面板 |
|---|---|---|---|
| 总览 | 选择知识范围 | 聚合簇与时间密度 | 关闭 |
| 时间切片 | 查看一个时间段 | 事件簇与代表节点 | 可选时间摘要 |
| 焦点 | 查看事件或实体网络 | 一跳高亮，其余降噪 | 概览 |
| 阅读 | 核对原文 | 保持焦点与相机 | 原文与证据 |
| 问答 | 基于现场提问 | 保持焦点，可高亮引用 | 问答 |

时间切片内只暴露“深入 / 浏览”两个用户可理解的交互提示；实现中的 loading、transitioning、
prefetching 等异步子状态不直接暴露。

### 7.1 输入映射

| 输入 | 唯一职责 | 网络请求 |
|---|---|---:|
| 深入态滚轮 / 触控板 | 靠近并进入更早时间；拉远并回到较近时间 | 缓存未命中时 |
| 浏览态滚轮 / 触控板 | 围绕指针平滑缩放 | 否 |
| 拖动 / 轨道手势 | 切回浏览态并旋转到镜头正面；修饰键或明确手势平移 | 否 |
| hover | 临时高亮与轻预览 | 否 |
| click 节点 | 选中并打开概览 | 详情可按需 |
| click 空白 / Esc | 返回上一层或清除焦点 | 否 |
| 时间轨拖动 | 拖动时本地预览，释放时提交时间窗口 | 缓存未命中时 |
| 时间前后按钮 / 左右键 | 进入深入态并移动一个时间窗口 | 缓存未命中时 |
| 搜索提交 | 返回排序结果与摘要 | 是 |
| 选择搜索结果 | 投影一条证据链 | 缓存优先 |
| 基于此提问 | 进入问答并继承 scope/focus | 是 |

方向契约只定义一次：`deltaY < 0` 与 OrbitControls 的 dolly-in 一致，表示深入 `next/older`；
`deltaY > 0` 与 dolly-out 一致，表示回退 `previous/newer`。浏览器已经处理系统自然滚动，不做
平台特判。达到阈值一次只提交一个窗口；loading / transitioning 期间滚轮保持相机跟手但不排队、
不在 settle 后重放。拖动立即切回浏览态，零查询、零重排。相邻页预取仍由时间窗口低水位驱动，
而不是由相机半径或每帧 LOD 触发。

### 7.2 探索轨迹

- 只记录有意义的提交：应用范围、定位时间、选中焦点、打开证据、提交问题、保存笔记和生成总结。
- 不记录 hover、连续相机帧和后台预取。
- 后退/前进恢复 scope、time anchor、projection、focus、camera bookmark 和 panel tab。
- 未保存探索只在当前会话保存；用户点击“保存探索”后创建服务端 session。
- 已保存探索批量追加步骤，避免每个细小动作写数据库。
- “总结当前探索”只在用户触发时运行，输入为固定 scope、已保存焦点、阅读过的证据和问题，
  输出必须带可打开引用。

## 8. 数据与 API v3

### 8.1 保留的正确原语

- 签名 opaque cursor。
- snapshot_id、source revision 和 as_of。
- effective_event_time + event_id 的 keyset 双向分页。
- 事件及其实体和事实边的原子校验与接纳。
- page_id、事件 ID、节点 ID 和关系 ID 幂等去重。
- 固定容量双端页索引、工作集 owner/ref-count 和相邻页预取。
- dirty source 聚合快照与原子切换。

“事件包”只作为内部事务边界存在，产品文案统一使用“事件”“时间段”“关系”。

### 8.2 新接口

#### GET /api/v1/universe/facets

输入 source_id、query、cursor、limit，返回：

- revision 和 scope 统计。
- 可分页搜索的 ready documents：id、name、event_count、time_range。
- entity types：key、label、entity_count、event_count。
- effective time range 和有界时间 buckets。
- ETag；未变更时支持 304。

禁止复用无界 document list 作为筛选数据源。

#### POST /api/v1/universe/window

请求：

    {
      "schema_version": 3,
      "scope": { "...": "KnowledgeScope" },
      "anchor_time": "optional ISO time",
      "direction": "older | newer | around",
      "cursor": "optional signed cursor",
      "snapshot_id": "required after first page",
      "limit": "server-policy bounded"
    }

响应：

    {
      "schema_version": 3,
      "resolved_scope": { "scopeHash": "...", "revision": "..." },
      "snapshot_id": "...",
      "as_of": "...",
      "events": [
        {
          "id": "...",
          "event_time": "...",
          "end_time": null,
          "time_basis": "occurred | ingested",
          "document": { "id": "...", "name": "..." },
          "entities": [],
          "relations": []
        }
      ],
      "newer_cursor": "...",
      "older_cursor": "...",
      "has_newer": true,
      "has_older": true
    }

around 用于时间轨 seek；older/newer 用于相邻页。所有游标签名绑定 scopeHash、revision、
snapshot、time basis 和排序边界，任何筛选变化都必须产生新 snapshot。

#### POST /api/v1/universe/neighbors

- 请求必须携带 resolved scope、snapshot、node kind、node id 和 cursor。
- event → entity 在关系排序和 top-N 前应用实体类型。
- entity → event 在计数和 keyset 分页前应用文档与时间范围。
- 返回事实闭合的一跳页；不能跨 scope 或复用旧 cursor。

#### 搜索与问答

- 搜索、Agent/问答请求接受同一 KnowledgeScope 或已解析 scopeHash。
- 文档、时间和实体类型同时约束事件召回、chunk 证据和引用。
- 所有 citation 必须属于 resolved scope；越界引用视为服务端契约错误。
- 搜索结果返回 event、document、chunk 和 relation refs，选择结果时不需要重新全库查询。

#### 探索记录

- POST /explorations：创建已保存探索，存 scope 快照和标题。
- POST /explorations/{id}/steps：批量追加 focus、read、query、note、summary，带 idempotency key。
- PATCH /explorations/{id}：重命名、归档。
- GET list/detail：恢复 scope、时间、焦点、相机书签和引用。

### 8.3 服务端执行规范

- app document_id 在请求入口一次批量校验并映射为 SAG source_id；all 模式不展开巨大 ID 列表。
- 文档、实体类型和时间条件进入 SQL / 向量查询的过滤层，必须发生在 limit、count 和 rank 前。
- event 响应批量补齐文档 provenance，禁止每事件详情查询。
- Source 持有单调 graph_revision；摄取、删除和重算在事实提交后原子递增。
- revision fence 只读取必要的单行版本，避免每页重复读取 overview/dirty/source 多次。
- 时间线、文档和类型索引通过正式迁移创建，删除首次请求动态 DDL。
- facet 和 overview 使用按 source/document/type 的增量物化统计；筛选抽屉打开时不得扫全库。
- v3 在原路由族内直接替换 v2 客户端和 DTO，不保留双协议、字段转换或旧 cursor 兼容。

## 9. 客户端架构

### 9.1 职责边界

    API / TanStack Query
            ↓
    ScopeStore + TimelineIndex + NormalizedFacts
            ↓
    StableSceneFactsSelector
            ↓
    Immutable SceneFactsSnapshot
            ↓
    R3F VisibilityMask + ReadableOverlay + Detail Panel

- **TanStack Query**：拥有请求、AbortSignal、相同请求合并、stale/gc、相邻页预取和错误重试。
- **ScopeStore**：只拥有已应用 scope、草稿 scope、fixed 和 scope history。
- **TimelineIndex**：只拥有双向 cursor、页顺序、active anchor 和预取水位。
- **NormalizedFacts**：按规范 ID 保存事件、实体、关系和 owner；负责主动探索与后续时间页去重。
- **StableSceneFactsSelector**：纯函数，只在 scope、time、facts 或 policy 变化时生成有界实例池，
  不把连续 camera 状态放进 React snapshot。
- **VisibilityMask**：在 R3F 渲染循环内根据 camera 更新实例透明度、关系掩码和 hit mask，不触发
  React render，不逐帧 mount/unmount Object3D。
- **ReadableOverlay**：镜头停稳后节流计算标签/轻卡，使用 keyed DOM 复用；相机运动期间不做
  全量 React reconciliation。
- **Scene**：只接收不可变 SceneFactsSnapshot，不请求网络、不维护 cursor、不决定预取。
- **Detail Panel**：只读取选择、详情、原文和问答状态，不直接操控 Three 对象。

网络 Promise、AbortController 和数据缓存不得回到页面组件的 ref/Map 中。

### 9.2 缓存与预取

- Query key 至少包含 scopeHash、snapshot、cursor/direction 和 page size。
- 内部默认网络页 6 个事件、可见窗口 6、回退 1 页、前进预取 2 页、常驻约 24 个事件事务；
  最终值由唯一 server/device policy 生成，不暴露给用户。
- 首屏提交后在空闲期预取相邻时间；前台操作优先，冲突方向的预取使用 Query signal 取消。
- 页面隐藏、离线、save-data 或连续失败时暂停预取。
- scope 改变立即取消旧 prefetch；旧 Query cache 保留短 TTL，切回时可复用。
- 新 scope 以当前中心时间 seek 最近事件。首个新窗口完成前保留 last-good 画面并降低对比，
  然后原子替换，禁止白屏和跳回最新。
- snapshot 更新时保留 last-good 投影，在后台按相同 scope/time 重建；不能先清空当前场景。
- 浏览器持久化业务偏好和已保存探索，不持久化事实 payload、snapshot 或 cursor。

### 9.3 渲染技术选型

- 新知识地图使用 Three + @react-three/fiber，配套 @react-three/drei 管理 CameraControls、
  Bounds、Instances、Billboard、Html 和 AdaptiveDpr。
- React 19 对应使用兼容的 R3F 主版本；依赖版本在 npm lock 中固定。
- 新场景退出 3d-force-graph；现有坐标已是确定性需求，保留第二套引擎生命周期没有价值。
- 事件与实体使用 InstancedMesh/Points；普通关系合并为 LineSegments；焦点路径才独立绘制。
- frameloop 使用 demand；相机、时间过渡或短动画时唤醒，稳定后停止连续 RAF。
- motion 只负责 DOM 工具栏、详情面板和一个焦点预览；三维动画使用场景唯一时钟。
- 现有 d3-force 只在 Worker 中计算新 scope 的局部布局，完成后冻结；运行中不持续力模拟。
- 页面只保留一个场景所有者，拆为 CameraRig、AtmosphereLayer、GraphGeometryLayer、
  CameraVisibilityLayer、FocusOverlayLayer 和 TimeRailOverlay。

[React Three Fiber 官方安装说明](https://r3f.docs.pmnd.rs/getting-started/installation)明确其
v9 与 React 19 配对；TanStack Query 的[请求取消](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
与[预取说明](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)覆盖本方案
需要的 AbortSignal、相同请求复用和相邻页预取。实施时以官方文档和锁文件为唯一版本依据。

## 10. 性能策略与 SLO

### 10.1 自适应硬预算

| 项目 | 桌面 | 移动 |
|---|---:|---:|
| L2 场景候选节点 | 160 | 80 |
| 普通关系 | 220 | 100 |
| L3 焦点子图 | 48 节点 / 72 边 | 28 节点 / 40 边 |
| DOM 场景浮层上限 | 8 | 4 |
| 其中自动轻卡 | 6 | 3 |
| 氛围粒子 | 1,500 | 600 |
| 渲染像素预算 | 240 万 | 110 万 |
| 稳态 draw calls | ≤ 20 | ≤ 20 |

预算是上限而不是填满目标。高密度数据优先聚合、裁剪标签和普通关系，不裁剪焦点事实闭包。
设备策略可以根据 GPU、视口、DPR、reduced-motion 和近期帧耗时降档；普通用户不可手动上调。

### 10.2 验收 SLO

- 1920×1080 Chrome 中档集显：相机拖动/缩放 p95 帧耗时 ≤ 20ms；移动端 ≤ 33ms。
- 输入到相机反馈 ≤ 50ms；hover 到高亮 ≤ 100ms；选择到视觉反馈 ≤ 120ms。
- 预取命中时，时间切换开始反馈 ≤ 100ms，完整稳定 ≤ 600ms。
- 交互期间不得出现超过 50ms 的主线程长任务。
- 标签选择与碰撞单帧 ≤ 2ms；DOM 场景浮层不超过预算。
- 静止 700ms 后停止连续 RAF。
- 50 次时间前进/回退后，JS heap 增长 ≤ 10MB；geometry/material/texture 回到基线 ±5%。
- 首个可交互聚合场景：缓存命中 ≤ 1.2s，正常网络 p75 ≤ 2.5s。
- 任意知识库总量下，请求页、缓存、scene candidate 和 DOM 成本均不随全量线性增长。

## 11. 失败、降级与无障碍

- 每一层都有 loading、empty、error、content 四态。
- 后台预取失败只在时间边缘提示，不覆盖当前内容，不弹全屏错误。
- 无结果显示当前实际 scope 和清除哪个筛选可恢复结果。
- WebGL context lost 尝试一次恢复同一 SceneFactsSnapshot；失败后降级到时间列表和 2D 关系视图，
  不把知识库判为不可用。
- 移动端默认时间列表 / 2D 关系图，3D 为可选沉浸视图；业务能力与桌面一致。
- 3D 画布提供同 scope、同排序的可键盘操作列表；方向键移动焦点，Enter 打开，Esc 返回。
- 所有数据区别同时使用形状、文字和颜色；满足明暗主题对比。
- prefers-reduced-motion 下关闭空间位移、背景运动和自动相机，只保留必要淡入淡出。
- 原文、引用、搜索结果和问答不依赖 3D，屏幕阅读器可以完成完整闭环。

## 12. 实施计划

最终只发布一套新链路。开发可在分支中按阶段验证，但不在生产长期运行双协议或双场景。

### 阶段 A：契约与数据基础

- 定义 KnowledgeScope、scopeHash、graphRevision 和 schema v3。
- 增加分页 facets、document provenance、around seek、scoped neighbors。
- 搜索和问答接入同一 scope；引用增加服务端越界校验。
- 将时间线和类型索引迁移到正式 migration，删除运行时 DDL。
- 建立 75/495、高共享实体、单事件 100+ 关系、100 时间窗基准数据集。

完成标准：API 契约测试证明筛选发生在 count/rank/limit 前；同 scope 双向翻页无重复无遗漏；
搜索、问答和引用不能越界。

### 阶段 B：共享客户端领域层

- 引入 TanStack Query，API client 全面接受 AbortSignal。
- 建立 ScopeStore、TimelineIndex、NormalizedFacts 和 StableSceneFactsSelector。
- 保留并收敛现有 deque、atomic admission、owner/ref-count 的纯数据能力。
- 删除页面组件中的请求 Map、timelineRequestRef、手写 prefetch promise 和重复 graph memo。
- 实现 last-good、scope seek、快照后台重建和浏览器式历史。

完成标准：无 WebGL 也能通过单元测试完成 scope 切换、双向时间、预取取消、去重和历史恢复；
React 组件不直接拥有网络状态机。

### 阶段 C：新 R3F 4D 场景

- 建立单一 R3F 场景所有者和五个渲染层。
- 完成实例化节点、合并关系、稳定布局、frameloop demand 和资源释放。
- 实现 L0—L3、镜头正面评分、screen-grid 碰撞、overscan、迟滞和 reduced-motion。
- 时间窗口使用单批次时钟；预取和网络提交与相机帧完全解耦，深入态只在手势阈值处协调相机
  语义与已准备好的相邻时间页。
- 建立真实 WebGL 性能采集和视觉回归。

完成标准：达到第 10 节 SLO；旋转过程中不出现标签闪烁，背面无卡片，进入正面后渐进升级；
数据预取不改变当前 SceneFactsSnapshot。

### 阶段 D：探索—阅读—问答闭环

- 上线顶部范围栏、业务筛选面板、底部时间轨和关系/时间投影。
- 右侧详情完成概览、证据、问答；引用打开原文时保持现场。
- 搜索改为右侧结果列表 + 单条证据链投影。
- 完成探索历史、保存、恢复和带引用总结。
- 移动端与无 WebGL 路径达到功能等价。

完成标准：用户可在 5 秒内说清范围、时间、焦点和下一步；任意事件两步到原文，一步发起
有范围提示的问答；往返不丢 scope/focus，不重复请求缓存命中数据。

### 阶段 E：一次切换与清理

- 用新工作台替换旧全屏 KnowledgeUniverse 入口。
- 删除旧 v2 DTO、旧 cursor、旧 localStorage 图谱偏好和所有迁移代码。
- 删除旧 knowledge-universe、universe-scene、orbital 旧场景中只服务该功能的实现。
- 若没有剩余消费者，移除 3d-force-graph 依赖。
- 删除旧 normal/preview/stable/journey、延迟 wheel queue 和分散的分页补丁，收口为明确的
  `interactionMode: deep | browse` 与单一滚轮适配器；把源码字符串测试替换为行为、WebGL 和性能测试。
- 更新 as-built 架构文档、运行手册和性能看板。

完成标准：仓库中只存在一个 scope 模型、一个时间协议、一个 4D 场景所有者和一个详情/问答入口。

## 13. 测试与生产门禁

### 13.1 服务端

- scope canonicalization、权限、空范围、文档状态和 facet 分页。
- 每种文档/类型/时间组合在分页前过滤，total 与实际返回一致。
- around/older/newer 在同一 snapshot 内无重复、无遗漏、游标必然前进。
- cursor 不能跨 scopeHash、revision、source 或 time basis。
- 主动邻域探索与后续时间页按规范 ID 去重，不制造孤立节点或悬空边。
- snapshot 变化保留旧响应安全性，迟到响应不能污染新 scope。
- 搜索与问答引用必须属于 resolved scope。

### 13.2 客户端领域层

- deque、normalized owner、admission 和 eviction 使用属性测试覆盖随机前进/回退。
- scope 变更取消旧请求；切回旧 scope 命中短期 cache。
- 时间 seek 保留中心时间；被筛焦点有明确清理原因。
- 相同事实不因主动探索和时间页重复创建。
- 后退/前进恢复范围、时间、焦点、相机书签和页签。

### 13.3 交互与视觉

- Playwright 真 WebGL：缩放、旋转、时间拖动、hover、选择、空白解锁、筛选、搜索、阅读、问答。
- 视觉回归：L0—L3、正面/背面、详情展开、深浅主题、移动端、reduced-motion。
- 拖动和浏览态缩放断言零 timeline/search 请求；深入态每个有效阈值最多一个 timeline intent，
  busy 期间零延迟重放；后台预取断言零相机/焦点变化。
- 搜索 30 条命中时，画布仍只有一条选中证据链，不出现卡片墙。
- 高密度焦点网络不超过 L3 预算，重要事实进入右侧关系列表。

### 13.4 性能与稳定

- 自动采集 renderer.info 的 draw calls、triangles、textures、programs。
- PerformanceObserver 采集 long task、INP、首场景和窗口切换耗时。
- 连续 100 时间窗口、50 次往返、反复 scope 切换和页面隐藏/恢复。
- WebGL context loss、离线、慢网、请求取消、snapshot_changed 和内存压力降档。
- 生产按设备档位观察首场景、p95 frame、context loss、降级率、cache hit 和引用越界错误。

## 14. 明确禁止

- 在没有“深入 / 浏览”状态、统一方向契约、阈值和 busy 丢弃策略时，让滚轮同时改相机与时间。
- hover 发请求、开完整卡片、移动相机或写探索历史。
- 默认展示全部事件卡、实体卡和事实关系。
- 用相机距离决定网络查询。
- 从服务端取回全量后再过滤文档或实体类型。
- 搜索、图谱和问答各自维护 scope。
- 查询增量导致全场重排、白屏或自动回到最新时间。
- 把缓存数量、场景节点上限、像素比和 WebGL 重试作为普通用户设置。
- 用同一个词表达范围固定、节点选择和时间阻塞。
- 继续增加 preview、stable、journey 等补丁式产品模式。
- 在图谱上堆长文本来代替结构化结果列表和原文阅读。
- 依赖 3D 才能完成搜索、阅读或问答。

## 15. 已锁定默认值与边界

- 默认进入聚合总览；右侧面板关闭。
- 进入信源后默认全部 ready 文档、全部实体类型、完整时间范围。
- 默认时间使用发生时间，缺失时明示回退摄取时间。
- 默认不展示批量完整事件卡；正面停稳后最多显示桌面 6 / 移动 3 张轻卡，完整焦点摘要最多一个。
- 默认只突出当前一跳；普通关系细、淡、稀疏。
- 默认内部时间页和可见窗口为 6，缓存约 24，但用户不可见、不可调。
- 业务筛选使用草稿后应用；scope 应用后立即贯穿探索、搜索和问答。
- 事件不会因为实体类型筛选而从时间历史消失；无关系事件只在时间投影保留。
- 不支持编辑事实、自由画边、跨信源实体自动合并、VR 或无限场景驻留。
- 不做旧协议、旧偏好或旧交互兼容；切换后直接删除。
