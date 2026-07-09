"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Archive, ChevronsUpDown, Library, LogOut, MessageSquarePlus, Search, Settings } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { useChatLive } from "@/lib/chat-live";
import { relativeTime } from "@/lib/format";
import { useApp } from "@/components/features/app-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

function Brand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="h-14" asChild>
          <Link href="/chat">
            <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
              <span className="text-base font-semibold">S</span>
            </div>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-base font-semibold">SAG</span>
              <span className="truncate text-xs text-muted-foreground">知识库 Agent</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavUser() {
  const { user, logout } = useApp();
  const initial = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {initial}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user?.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            side="top"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col">
                <span className="truncate text-sm font-medium">{user?.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="size-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ contained = false }: { contained?: boolean }) {
  const routePath = usePathname();
  const router = useRouter();
  const { agent, threads, refreshThreads } = useApp();
  const live = useChatLive();

  // replaceState（新会话接管 URL 不打断流式）不会触发 usePathname —— 监听自定义事件补齐
  const [pathname, setPathname] = React.useState(routePath);
  React.useEffect(() => setPathname(routePath), [routePath]);
  React.useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("sag:pathchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("sag:pathchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const activeThreadId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;

  async function archiveThread(tid: string) {
    if (!agent) return;
    try {
      await api.updateThread(agent.id, tid, { archived: true });
      await refreshThreads();
      if (activeThreadId === tid) router.push("/chat");
      toast.success("已归档，可在 设置 → 助手 恢复");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "归档失败");
    }
  }

  const searchActive = pathname === "/search" || pathname.startsWith("/search/");
  const knowledgeActive = pathname === "/knowledge" || pathname.startsWith("/knowledge/");

  return (
    <Sidebar collapsible="icon" className={contained ? "absolute" : undefined}>
      <SidebarHeader>
        <Brand />
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        <SidebarGroup className="shrink-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={searchActive} tooltip="搜索">
                <Link href="/search">
                  <Search />
                  <span>搜索</span>
                  <kbd className="ml-auto hidden rounded border border-sidebar-border px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden sm:inline-flex">
                    ⌘K
                  </kbd>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="新对话">
                <Link
                  href="/chat"
                  onClick={() => window.dispatchEvent(new Event("sag:new-chat"))}
                >
                  <MessageSquarePlus />
                  <span>新对话</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={knowledgeActive} tooltip="知识库">
                <Link href="/knowledge">
                  <Library />
                  <span>知识库</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1 overflow-hidden group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>会话</SidebarGroupLabel>
          <SidebarMenu className="min-h-0 flex-1 overflow-y-auto pr-1">
            {threads.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                还没有会话，从「新对话」开始。
              </p>
            )}
            {threads.map((t) => {
              const isLive = live.streaming && live.threadId === t.id;
              return (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton asChild isActive={t.id === activeThreadId}>
                    <Link href={`/chat/${t.id}`} aria-label={t.title}>
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {isLive ? (
                        <Spinner className="size-3 shrink-0 text-muted-foreground" aria-label="生成中" />
                      ) : (
                        <span className="ml-2 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0">
                          {relativeTime(t.updated_at)}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                  {!isLive && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            archiveThread(t.id);
                          }}
                          aria-label="归档会话"
                          className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/menu-item:opacity-100"
                        >
                          <Archive className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">归档</TooltipContent>
                    </Tooltip>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname.startsWith("/settings")} tooltip="设置">
              <Link href="/settings">
                <Settings />
                <span>设置</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
