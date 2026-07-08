"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Layers, LayoutGrid, LogOut, Settings, Sparkles } from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const NAV = [
  { href: "/overview", label: "总览", icon: LayoutGrid },
  { href: "/assistants", label: "助手", icon: Sparkles },
  { href: "/sources", label: "信源", icon: Layers },
  { href: "/settings", label: "设置", icon: Settings },
];

function Brand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" asChild>
          <Link href="/overview">
            <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-sm font-semibold">s</span>
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">sag</span>
              <span className="truncate text-xs text-muted-foreground">SAG 知识助手</span>
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

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>平台</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    <Link href={item.href}>
                      <Icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
