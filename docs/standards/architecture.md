# 后端架构规范

## 分层与依赖方向（只许向下）

```
api/v1/        路由：只做 IO / 校验 / 序列化，不写业务
services/      领域逻辑：纯函数式服务，不 import FastAPI
tools/         Agent 工具层：Tool ABC + 注册表；MCP 远端工具适配成同一接口
mcp/           信源即 MCP：FastMCP server + HTTP 挂载（作用域经 contextvar 注入）
jobs/          队列抽象 + 进程内 worker（退避重试）
generation/    LLM 客户端（OpenAI 兼容 + function-calling）、提示词、引用
sag/       ★  引擎适配层：全项目唯一 import zleap-sag 之处
db/ · core/    模型 / 配置 / 安全 / 错误 / 日志
```

**规则**
- 第三方引擎/SDK 只允许在**一个适配层**出现（`sag/`、`generation/llm.py`、`tools/mcp.py`）。
  换实现 = 改一个目录。
- 路由函数体 ≤ 15 行为宜：取依赖 → 调 service → 包装响应。出现 if/for 的业务分支就该下沉。
- 单例（EngineManager / LLMClient / JobQueue）挂 `app.state`，经 `core/deps.py` 注入；
  服务层通过参数接收，**不得**自行 import 单例。

## 错误模型

- 领域异常统一继承 `ApiError`（`core/errors.py`），自带 `status_code/code/message`；
  全局 handler 映射为 `{"error": {code, message}}`。路由**不写** try/except 转换。
- 边界失败要分级：单信源检索失败不阻断 fan-out（log + 跳过）；单文件上传失败不阻断批量；
  MCP 单个 server 连不上只跳过该 server。**局部失败绝不放大为整体失败。**

## 配置分层

`env 默认（pydantic-settings, SAG_ 前缀） → DB 覆盖（settings 表） → 运行期单例`。
可视化配置保存 = 入库 + 就地覆盖单例 + 重建 LLM 客户端 + 重置暖引擎——**无需重启即生效**。
密钥明文入库（单用户本地），读取一律脱敏为 `*_set` 布尔，永不回显。

## 数据与迁移

- dev 用 `create_all` + `_COLUMN_UPGRADES`（幂等 ADD COLUMN）就地升级；生产走 Alembic。
- 模型只留必要列；JSON 列（persona/config/citations）承载弹性结构，命名 `*_json`。

## 测试纪律

- **离线优先**：全套测试不依赖真实 LLM/网络（conftest 强制清空 key）。检索这类离线必失败的
  路径，测「结构化失败不崩」而非硬造成功。
- **共享库免疫**：单用户全局数据下用存在性断言（`any(x.id == …)`），不用精确计数。
- **不留全局副作用**：改过进程级单例的测试必须 `finally` 还原 + 清理落库行。
- 每个新端点至少覆盖：happy path + 一个 4xx。
