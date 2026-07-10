import { clearToken, getToken } from "./auth";
import type { SearchStrategy } from "./retrieval-config";
import type {
  ActivityItem,
  Entity,
  Agent,
  Binding,
  BindingTargetType,
  Capabilities,
  Doc,
  Message,
  ModelConfig,
  ModelConfigPatch,
  ModelSetupStatus,
  KnowledgeMcpDescriptor,
  Persona,
  SearchResponse,
  Source,
  SourceGraphResponse,
  SourceMcpDescriptor,
  Thread,
  TokenResponse,
  User,
} from "./types";

/** 浏览器通过局域网 IP 打开前端时，自动将 API 指向同主机 8000 端口。 */
function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (!isLocalHost) {
      const pointsToLocal =
        !configured ||
        configured.includes("localhost") ||
        configured.includes("127.0.0.1");
      if (pointsToLocal) {
        return `${protocol}//${hostname}:8000`;
      }
    }
  }
  return configured || "http://localhost:8000";
}

export const API_BASE = resolveApiBase();

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // 30s 超时护栏（SSE 流式接口不走此函数，不受影响）
  const signal = opts.signal ?? AbortSignal.timeout(30_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers, signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ApiError(0, "timeout", "请求超时，请检查网络后重试");
    }
    throw new ApiError(0, "network", "网络异常，请稍后重试");
  }

  if (res.status === 401 && typeof window !== "undefined" && !path.includes("/auth/")) {
    clearToken();
    window.location.href = "/login";
  }

  if (!res.ok) {
    let code = "error";
    let message = res.statusText || "请求失败";
    try {
      const j = await res.json();
      if (j?.error) {
        code = j.error.code ?? code;
        message = j.error.message ?? message;
      } else if (j?.detail) {
        message = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : ((await res.text()) as unknown as T);
}

export const api = {
  // auth / system
  register: (b: { email: string; password: string; name?: string }) =>
    request<TokenResponse>("/api/v1/auth/register", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { name: string; email?: string; password?: string }) =>
    request<TokenResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(b) }),
  me: () => request<User>("/api/v1/auth/me"),
  capabilities: () => request<Capabilities>("/api/v1/system/capabilities"),

  // 模型与检索配置
  getModelConfig: () => request<ModelConfig>("/api/v1/system/model-config"),
  modelSetupStatus: () => request<ModelSetupStatus>("/api/v1/system/model-setup"),
  quickSetup302: (apiKey: string) =>
    request<{ config: ModelConfig; capabilities: Capabilities }>(
      "/api/v1/system/model-setup/302",
      {
        method: "POST",
        body: JSON.stringify({ api_key: apiKey }),
      },
    ),
  saveModelConfig: (b: ModelConfigPatch) =>
    request<{ config: ModelConfig; capabilities: Capabilities }>("/api/v1/system/model-config", {
      method: "PUT",
      body: JSON.stringify(b),
    }),
  setup302MinerU: () =>
    request<{ config: ModelConfig; capabilities: Capabilities }>(
      "/api/v1/system/model-config/mineru/302",
      { method: "POST" },
    ),
  testModelConfig: () =>
    request<{ ok: boolean; message: string }>("/api/v1/system/model-config/test", {
      method: "POST",
    }),

  // 信源
  listSources: () => request<Source[]>("/api/v1/sources"),
  getSource: (id: string) => request<Source>(`/api/v1/sources/${id}`),
  createSource: (b: { name: string; description?: string }) =>
    request<Source>("/api/v1/sources", { method: "POST", body: JSON.stringify(b) }),
  updateSource: (id: string, b: Record<string, unknown>) =>
    request<Source>(`/api/v1/sources/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteSource: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/sources/${id}`, { method: "DELETE" }),
  syncSource: (id: string) =>
    request<{ id: string; type: string }>(`/api/v1/sources/${id}/sync`, { method: "POST" }),

  // 文档
  listDocuments: (sid: string) => request<Doc[]>(`/api/v1/sources/${sid}/documents`),
  uploadDocumentWithProgress: (sid: string, file: File, onProgress: (pct: number) => void) =>
    new Promise<Doc>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/v1/sources/${sid}/documents`);
      xhr.setRequestHeader("Authorization", `Bearer ${getToken() ?? ""}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else {
          let msg = "上传失败";
          try { msg = JSON.parse(xhr.responseText)?.error?.message ?? msg; } catch { /* noop */ }
          reject(new ApiError(xhr.status, "upload_failed", msg));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "network_error", "网络错误，上传中断"));
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    }),

  uploadDocument: (sid: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Doc>(`/api/v1/sources/${sid}/documents`, { method: "POST", body: fd });
  },
  reprocessDocument: (sid: string, did: string) =>
    request(`/api/v1/sources/${sid}/documents/${did}/reprocess`, { method: "POST" }),
  deleteDocument: (sid: string, did: string) =>
    request(`/api/v1/sources/${sid}/documents/${did}`, { method: "DELETE" }),

  // Agent
  listAgents: () => request<Agent[]>("/api/v1/agents"),
  getDefaultAgent: () => request<Agent>("/api/v1/agents/default"),
  getAgent: (id: string) => request<Agent>(`/api/v1/agents/${id}`),
  createAgent: (b: { name: string; avatar?: string; persona?: Persona }) =>
    request<Agent>("/api/v1/agents", { method: "POST", body: JSON.stringify(b) }),
  updateAgent: (id: string, b: { name?: string; avatar?: string; persona?: Persona }) =>
    request<Agent>(`/api/v1/agents/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteAgent: (id: string) => request<{ ok: boolean }>(`/api/v1/agents/${id}`, { method: "DELETE" }),

  listBindings: (id: string) => request<Binding[]>(`/api/v1/agents/${id}/bindings`),
  addBinding: (
    id: string,
    b: { target_type: BindingTargetType; target_id?: string; config?: Record<string, unknown> },
  ) => request<Binding>(`/api/v1/agents/${id}/bindings`, { method: "POST", body: JSON.stringify(b) }),
  removeBinding: (id: string, bindingId: string) =>
    request<{ ok: boolean }>(`/api/v1/agents/${id}/bindings/${bindingId}`, { method: "DELETE" }),

  listThreads: (
    id: string,
    opts?: { archived?: boolean; limit?: number; offset?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.archived) params.set("archived", "true");
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const query = params.toString();
    return request<Thread[]>(`/api/v1/agents/${id}/threads${query ? `?${query}` : ""}`);
  },
  updateThread: (id: string, tid: string, b: { title?: string; archived?: boolean }) =>
    request<Thread>(`/api/v1/agents/${id}/threads/${tid}`, {
      method: "PATCH",
      body: JSON.stringify(b),
    }),
  createThread: (id: string, title = "新会话") =>
    request<Thread>(`/api/v1/agents/${id}/threads`, { method: "POST", body: JSON.stringify({ title }) }),
  deleteMessage: (id: string, tid: string, mid: string) =>
    request<{ ok: boolean }>(`/api/v1/agents/${id}/threads/${tid}/messages/${mid}`, {
      method: "DELETE",
    }),
  listMessages: (id: string, tid: string) =>
    request<Message[]>(`/api/v1/agents/${id}/threads/${tid}/messages`),
  cancelAgentRun: (id: string, tid: string, runId: string) =>
    request<{ ok: boolean }>(`/api/v1/agents/${id}/threads/${tid}/runs/${runId}/cancel`, {
      method: "POST",
    }),
  approveAgentTool: (id: string, tid: string, runId: string, toolCallId: string) =>
    request<{ ok: boolean }>(
      `/api/v1/agents/${id}/threads/${tid}/runs/${runId}/tool-calls/${toolCallId}/approve`,
      { method: "POST" },
    ),
  rejectAgentTool: (id: string, tid: string, runId: string, toolCallId: string, reason: string) =>
    request<{ ok: boolean }>(
      `/api/v1/agents/${id}/threads/${tid}/runs/${runId}/tool-calls/${toolCallId}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  deleteThread: (id: string, tid: string) =>
    request(`/api/v1/agents/${id}/threads/${tid}`, { method: "DELETE" }),

  // 搜索
  globalSearch: (b: {
    query: string;
    source_ids?: string[];
    top_k?: number;
    strategy?: SearchStrategy;
  }) =>
    request<SearchResponse>("/api/v1/search", { method: "POST", body: JSON.stringify(b) }),

  // 引用溯源：分块原文
  getChunk: (sourceId: string, chunkId: string) =>
    request<{ chunk_id: string; heading: string; content: string; source_id: string; source_name: string }>(
      `/api/v1/sources/${sourceId}/chunks/${chunkId}`,
    ),

  // 实体（图谱增强）
  listEntities: (sid: string) => request<Entity[]>(`/api/v1/sources/${sid}/entities`),
  getSourceGraph: (sid: string) =>
    request<SourceGraphResponse>(`/api/v1/sources/${sid}/graph`),

  // 近期动态（搜索页时间线）
  getActivity: () => request<ActivityItem[]>("/api/v1/activity"),

  // 单文档元数据 + 原始文件（预览用 blob 拉取，需带 Bearer）
  getDocument: (sid: string, did: string) => request<Doc>(`/api/v1/sources/${sid}/documents/${did}`),
  documentFileUrl: (sid: string, did: string) =>
    `${API_BASE}/api/v1/sources/${sid}/documents/${did}/file`,
  documentParsedUrl: (sid: string, did: string) =>
    `${API_BASE}/api/v1/sources/${sid}/documents/${did}/parsed`,

  // 对话图片附件（≤10MB，png/jpg/webp/gif）
  uploadAttachment: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ id: string; name: string; media_type: string }>("/api/v1/attachments", {
      method: "POST",
      body: fd,
    });
  },
  attachmentUrl: (id: string) => `${API_BASE}/api/v1/attachments/${id}`,

  // 信源即 MCP：外部宿主（Claude Desktop / Cursor）挂载信息
  sourceMcp: (sourceId: string) =>
    request<SourceMcpDescriptor>(`/api/v1/sources/${sourceId}/mcp`),

  // 整个 SAG 知识库的 MCP 挂载信息
  knowledgeMcp: () => request<KnowledgeMcpDescriptor>("/api/v1/system/mcp"),
};
