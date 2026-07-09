"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Expand, Shrink, TriangleAlert } from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import { ThemeToggle } from "@/components/features/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const SECTION: Record<string, string> = {
  "/chat": "对话",
  "/search": "搜索",
  "/knowledge": "知识",
  "/settings": "设置",
};

function sectionLabel(pathname: string): string {
  const key = Object.keys(SECTION).find((k) => pathname === k || pathname.startsWith(k + "/"));
  return key ? SECTION[key] : "sag";
}

export function SiteHeader() {
  const pathname = usePathname();
  const { capabilities, windowMode, toggleWindowMode } = useApp();
  const label = sectionLabel(pathname);
  const windowed = windowMode === "window";

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">
            <BreadcrumbLink asChild>
              <Link href="/chat">sag</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5">
        {capabilities && !capabilities.llm_configured && (
          <Link
            href="/settings"
            className="hidden items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 sm:inline-flex"
          >
            <TriangleAlert className="size-3.5" />
            未配置模型
          </Link>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-8 md:inline-flex"
              onClick={toggleWindowMode}
              aria-label={windowed ? "切换为满屏" : "切换为窗口"}
            >
              {windowed ? <Expand /> : <Shrink />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{windowed ? "满屏显示" : "窗口显示"}</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
    </header>
  );
}
