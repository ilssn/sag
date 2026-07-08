"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Eye, LogOut, TriangleAlert } from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import { ThemeToggle } from "@/components/features/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABEL: Record<string, string> = {
  owner: "所有者",
  editor: "编辑者",
  viewer: "只读",
};

export function Topbar() {
  const { user, capabilities, workspace, role, switchWorkspace, logout } = useApp();
  const initial = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();
  const memberships = user?.memberships ?? [];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-paper/80 px-5 backdrop-blur-sm">
      <div className="flex min-w-0 items-center">
        {memberships.length > 1 && workspace ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="group flex max-w-[15rem] items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-gold">
                <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-gold text-[11px] font-bold text-[#1b1a17]">
                  {(workspace.workspace_name || "空").slice(0, 1)}
                </span>
                <span className="truncate font-medium text-ink">
                  {workspace.workspace_name}
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-ink-faint">
                切换空间
              </DropdownMenuLabel>
              {memberships.map((m) => (
                <DropdownMenuItem
                  key={m.workspace_id}
                  onClick={() => {
                    if (m.workspace_id !== workspace.workspace_id)
                      switchWorkspace(m.workspace_id);
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-ink/[0.06] text-[11px] font-semibold text-ink-soft">
                    {(m.workspace_name || "空").slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.workspace_name}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {ROLE_LABEL[m.role]}
                  </span>
                  {m.workspace_id === workspace.workspace_id && (
                    <Check className="size-3.5 shrink-0 text-gold-strong" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        {role === "viewer" && (
          <span className="mr-1 hidden items-center gap-1.5 rounded-full border border-hairline bg-ink/[0.03] px-2.5 py-1 text-xs font-medium text-ink-faint sm:flex">
            <Eye className="size-3.5" />
            只读成员
          </span>
        )}
        {capabilities && !capabilities.llm_configured && (
          <Link
            href="/settings"
            className="mr-1 hidden items-center gap-1.5 rounded-full border border-gold/30 bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold-strong transition-colors hover:border-gold/60 sm:flex"
          >
            <TriangleAlert className="size-3.5" />
            未配置模型
          </Link>
        )}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gold">
              <Avatar>
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="truncate text-sm font-medium text-ink">{user?.name}</div>
              <div className="truncate text-xs font-normal text-ink-faint">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-danger focus:text-danger">
              <LogOut className="size-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
