export type WorkspaceSection = "search" | "answer" | "knowledge";

export interface WorkspaceSectionDefinition {
  id: WorkspaceSection;
  href: string;
  shortcut?: string;
}

/**
 * 工作台能力的单一入口配置。normal 与 mini 只改变呈现方式，不再各自维护菜单。
 */
export const WORKSPACE_SECTIONS: readonly WorkspaceSectionDefinition[] = [
  { id: "search", href: "/search", shortcut: "⌘K" },
  { id: "answer", href: "/chat", shortcut: "⌘J" },
  { id: "knowledge", href: "/knowledge" },
];

export function isWorkspaceSection(value: unknown): value is WorkspaceSection {
  return value === "search" || value === "answer" || value === "knowledge";
}

export function workspaceSectionFromPathname(pathname: string): WorkspaceSection | null {
  // 静态导出 trailingSlash 下 usePathname 可能返回 "/chat/"，统一裁剪后比较。
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.replace(/\/+$/, "") || "/"
      : pathname;
  if (normalized === "/search" || normalized.startsWith("/search/")) return "search";
  if (normalized === "/chat" || normalized.startsWith("/chat/")) return "answer";
  if (normalized === "/knowledge" || normalized.startsWith("/knowledge/")) return "knowledge";
  return null;
}

export function workspaceSectionDefinition(section: WorkspaceSection) {
  return WORKSPACE_SECTIONS.find((item) => item.id === section)!;
}
