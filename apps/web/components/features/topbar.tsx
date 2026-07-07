"use client";

import Link from "next/link";
import { LogOut, TriangleAlert } from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import { ThemeToggle } from "@/components/features/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar() {
  const { user, capabilities, logout } = useApp();
  const initial = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-paper/80 px-5 backdrop-blur-sm">
      <div className="min-w-0" />

      <div className="flex items-center gap-1.5">
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
