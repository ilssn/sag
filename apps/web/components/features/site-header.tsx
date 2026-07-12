"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Expand, Minimize2, Shrink, TriangleAlert } from "lucide-react";

import { PRODUCT_NAME } from "@/lib/branding";
import {
  workspaceSectionDefinition,
  workspaceSectionFromPathname,
} from "@/lib/workspace";
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

function sectionLabel(pathname: string): string {
  const workspaceSection = workspaceSectionFromPathname(pathname);
  if (workspaceSection) return workspaceSectionDefinition(workspaceSection).label;
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "设置";
  return PRODUCT_NAME;
}

export function SiteHeader() {
  const pathname = usePathname();
  const { capabilities, windowMode, toggleWindowMode, minimizeWorkspace } = useApp();
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
              <Link href="/chat">{PRODUCT_NAME}</Link>
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

        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-8 md:inline-flex"
              onClick={minimizeWorkspace}
              aria-label="收起为迷你工作台"
            >
              <Minimize2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">收起工作台</TooltipContent>
        </Tooltip>
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
      </div>
    </header>
  );
}
