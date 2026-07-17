/**
 * 查询参数路由协议（ADR-0006）：静态导出没有服务端动态段，
 * 实体定位一律走查询参数——/chat?thread=、/knowledge?source=、/search?q=。
 * 所有 URL 的构造与解析集中在此，纯函数、可单测。
 */

export const CHAT_PATH = "/chat";
export const KNOWLEDGE_PATH = "/knowledge";
export const SEARCH_PATH = "/search";
export const SETTINGS_PATH = "/settings";
export const LOGIN_PATH = "/login";

export const THREAD_PARAM = "thread";
export const SOURCE_PARAM = "source";
export const QUERY_PARAM = "q";

/** 去掉静态导出 trailingSlash 带来的尾斜杠，让 "/chat/" 与 "/chat" 等价（根路径除外）。 */
export function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

export function chatHref(threadId?: string | null): string {
  if (!threadId) return CHAT_PATH;
  return `${CHAT_PATH}?${THREAD_PARAM}=${encodeURIComponent(threadId)}`;
}

export function knowledgeHref(sourceId?: string | null): string {
  if (!sourceId) return KNOWLEDGE_PATH;
  return `${KNOWLEDGE_PATH}?${SOURCE_PARAM}=${encodeURIComponent(sourceId)}`;
}

export function searchHref(options?: { q?: string; source?: string | null }): string {
  const params = new URLSearchParams();
  if (options?.q) params.set(QUERY_PARAM, options.q);
  if (options?.source) params.set(SOURCE_PARAM, options.source);
  const query = params.toString();
  return query ? `${SEARCH_PATH}?${query}` : SEARCH_PATH;
}

function paramFromSearch(search: string, key: string): string | null {
  const value = new URLSearchParams(search).get(key);
  return value ? value : null;
}

/** 从 location（pathname + search）解析当前会话线程。 */
export function threadIdFromLocation(pathname: string, search: string): string | null {
  if (normalizePathname(pathname) !== CHAT_PATH) return null;
  return paramFromSearch(search, THREAD_PARAM);
}

/** 从 location 解析当前信源详情。 */
export function sourceIdFromLocation(pathname: string, search: string): string | null {
  if (normalizePathname(pathname) !== KNOWLEDGE_PATH) return null;
  return paramFromSearch(search, SOURCE_PARAM);
}

/**
 * 新会话拿到线程 ID 后接管 URL（history.replaceState，不触发路由卸载）。
 * 保留当前 pathname（可能带尾斜杠），只改查询串。
 */
export function threadUrlForReplaceState(threadId: string): string {
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : CHAT_PATH;
  return `${pathname}?${THREAD_PARAM}=${encodeURIComponent(threadId)}`;
}

/** 非 React 代码（api.ts 401 兜底）用的硬跳转。 */
export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  window.location.assign(LOGIN_PATH);
}
