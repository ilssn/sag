import { clearToken, getToken } from "./auth";
import type {
  Binding,
  BindingTargetType,
  Capabilities,
  Connector,
  Doc,
  Entity,
  Namespace,
  Persona,
  SearchResponse,
  Soul,
  SoulMessage,
  SoulThread,
  Source,
  Thread,
  TokenResponse,
  User,
  Message,
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

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

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

  // namespaces
  listNamespaces: () => request<Namespace[]>("/api/v1/namespaces"),
  createNamespace: (b: { name: string; icon?: string; color?: string }) =>
    request<Namespace>("/api/v1/namespaces", { method: "POST", body: JSON.stringify(b) }),
  deleteNamespace: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/namespaces/${id}`, { method: "DELETE" }),

  // sources
  listConnectors: () => request<Connector[]>("/api/v1/sources/connectors"),
  listSources: (namespaceId?: string) =>
    request<Source[]>(`/api/v1/sources${namespaceId ? `?namespace_id=${namespaceId}` : ""}`),
  getSource: (id: string) => request<Source>(`/api/v1/sources/${id}`),
  createSource: (b: {
    name: string;
    description?: string;
    connector_kind?: string;
    namespace_id?: string;
    config?: Record<string, unknown>;
  }) => request<Source>("/api/v1/sources", { method: "POST", body: JSON.stringify(b) }),
  updateSource: (id: string, b: Record<string, unknown>) =>
    request<Source>(`/api/v1/sources/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteSource: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/sources/${id}`, { method: "DELETE" }),
  syncSource: (id: string) =>
    request<{ id: string; type: string }>(`/api/v1/sources/${id}/sync`, { method: "POST" }),

  // documents
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

  // chat
  listThreads: (sid: string) => request<Thread[]>(`/api/v1/sources/${sid}/threads`),
  createThread: (sid: string, title = "新会话") =>
    request<Thread>(`/api/v1/sources/${sid}/threads`, {
      method: "POST",
      body: JSON.stringify({ source_id: sid, title }),
    }),
  listMessages: (sid: string, tid: string) =>
    request<Message[]>(`/api/v1/sources/${sid}/threads/${tid}/messages`),
  deleteThread: (sid: string, tid: string) =>
    request(`/api/v1/sources/${sid}/threads/${tid}`, { method: "DELETE" }),

  // souls
  listSouls: () => request<Soul[]>("/api/v1/souls"),
  getSoul: (id: string) => request<Soul>(`/api/v1/souls/${id}`),
  createSoul: (b: { name: string; avatar?: string; persona?: Persona }) =>
    request<Soul>("/api/v1/souls", { method: "POST", body: JSON.stringify(b) }),
  updateSoul: (id: string, b: { name?: string; avatar?: string; persona?: Persona }) =>
    request<Soul>(`/api/v1/souls/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteSoul: (id: string) => request<{ ok: boolean }>(`/api/v1/souls/${id}`, { method: "DELETE" }),

  listBindings: (id: string) => request<Binding[]>(`/api/v1/souls/${id}/bindings`),
  addBinding: (id: string, b: { target_type: BindingTargetType; target_id: string }) =>
    request<Binding>(`/api/v1/souls/${id}/bindings`, { method: "POST", body: JSON.stringify(b) }),
  removeBinding: (id: string, bindingId: string) =>
    request<{ ok: boolean }>(`/api/v1/souls/${id}/bindings/${bindingId}`, { method: "DELETE" }),

  listSoulThreads: (id: string) => request<SoulThread[]>(`/api/v1/souls/${id}/threads`),
  createSoulThread: (id: string, title = "新会话") =>
    request<SoulThread>(`/api/v1/souls/${id}/threads`, { method: "POST", body: JSON.stringify({ title }) }),
  listSoulMessages: (id: string, tid: string) =>
    request<SoulMessage[]>(`/api/v1/souls/${id}/threads/${tid}/messages`),
  deleteSoulThread: (id: string, tid: string) =>
    request(`/api/v1/souls/${id}/threads/${tid}`, { method: "DELETE" }),

  // insights / 书→人物
  listEntities: (sid: string, types?: string) =>
    request<Entity[]>(`/api/v1/sources/${sid}/entities${types ? `?types=${types}` : ""}`),
  entityToSoul: (sid: string, entityId: string) =>
    request<Soul>(`/api/v1/sources/${sid}/entities/${entityId}/to-soul`, { method: "POST" }),

  // search (调试)
  search: (sid: string, body: { query: string; strategy?: string; top_k?: number }) =>
    request<SearchResponse>(`/api/v1/sources/${sid}/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
