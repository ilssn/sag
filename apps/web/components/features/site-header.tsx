"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, TriangleAlert } from "lucide-react";

import { useApp } from "@/components/features/app-shell";
import { useSearch } from "@/components/features/search-overlay";
import { ThemeToggle } from "@/components/features/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const SECTION: Record<string, string> = {
  "/overview": "总览",
  "/assistants": "助手",
  "/sources": "信源",
  "/settings": "设置",
};

function sectionLabel(pathname: string): string {
  const key = Object.keys(SECTION).find((k) => pathname === k || pathname.startsWith(k + "/"));
  return key ? SECTION[key] : "zleap";
}

export function SiteHeader() {
  const pathname = usePathname();
  const { capabilities } = useApp();
  const { openSearch } = useSearch();
  const label = sectionLabel(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">
            <BreadcrumbLink asChild>
              <Link href="/overview">zleap</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={() => openSearch()}
          className="inline-flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="size-3.5" />
          <span className="hidden md:inline">搜索…</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground md:inline-flex">
            ⌘K
          </kbd>
        </button>

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
      </div>
    </header>
  );
}
