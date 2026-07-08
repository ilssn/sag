import { clearToken, getToken } from "./auth";
import type {
  Agent,
  Binding,
  BindingTargetType,
  Capabilities,
  Doc,
  Message,
  Persona,
  SearchResponse,
  Source,
  SourceMcpDescriptor,
  Thread,
  TokenResponse,
  User,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

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
  login: (b: { email: string; password: string }) =>
    request<TokenResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(b) }),
  me: () => request<User>("/api/v1/auth/me"),
  capabilities: () => request<Capabilities>("/api/v1/system/capabilities"),

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

  listThreads: (id: string) => request<Thread[]>(`/api/v1/agents/${id}/threads`),
  createThread: (id: string, title = "新会话") =>
    request<Thread>(`/api/v1/agents/${id}/threads`, { method: "POST", body: JSON.stringify({ title }) }),
  listMessages: (id: string, tid: string) =>
    request<Message[]>(`/api/v1/agents/${id}/threads/${tid}/messages`),
  deleteThread: (id: string, tid: string) =>
    request(`/api/v1/agents/${id}/threads/${tid}`, { method: "DELETE" }),

  // 搜索
  globalSearch: (b: { query: string; source_ids?: string[]; top_k?: number }) =>
    request<SearchResponse>("/api/v1/search", { method: "POST", body: JSON.stringify(b) }),

  // 引用溯源：分块原文
  getChunk: (sourceId: string, chunkId: string) =>
    request<{ chunk_id: string; heading: string; content: string; source_id: string; source_name: string }>(
      `/api/v1/sources/${sourceId}/chunks/${chunkId}`,
    ),

  // 信源即 MCP：外部宿主（Claude Desktop / Cursor）挂载信息
  sourceMcp: (sourceId: string) =>
    request<SourceMcpDescriptor>(`/api/v1/sources/${sourceId}/mcp`),
};
