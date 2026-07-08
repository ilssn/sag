// 活动空间选择（多空间成员的切换状态；单空间用户无感）
const WS_KEY = "zleap_ws";

export function getActiveWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WS_KEY);
}

export function setActiveWorkspace(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WS_KEY, id);
}

export function clearActiveWorkspace() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(WS_KEY);
}
