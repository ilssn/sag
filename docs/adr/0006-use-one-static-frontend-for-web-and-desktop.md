---
status: accepted
---

# Web 与桌面共用静态前端产物

`apps/web` 将改为可完全静态导出的客户端应用，Web 部署与 Tauri 客户端共同使用同一类静态产物；桌面运行时只携带 FastAPI sidecar，不捆绑 Next/Node 服务。运行时资源统一使用查询参数路由：`/chat?thread=<id>`、`/knowledge?source=<id>` 与 `/search?q=...`，现有旧路径和 Next redirects 直接移除，不保留兼容层。该选择需要移除请求期国际化和动态资源路由等服务端依赖，但可以减少一个运行进程，统一两种宿主的前端行为，并降低安装包、启动编排和故障恢复复杂度。
