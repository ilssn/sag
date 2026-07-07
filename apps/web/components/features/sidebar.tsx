"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Layers, Settings, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/overview", label: "总览", icon: LayoutGrid },
  { href: "/assistants", label: "助手", icon: Sparkles },
  { href: "/sources", label: "信源", icon: Layers },
  { href: "/settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[236px] shrink-0 flex-col border-r border-hairline bg-surface/60 md:flex">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <span className="grid size-6 place-items-center rounded-[7px] bg-gold text-[13px] font-bold text-[#1b1a17] shadow-sm">
          m
        </span>
        <span className="font-display text-[1.35rem] font-medium tracking-tight">muse</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                active
                  ? "bg-gold-soft text-gold-strong"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-gold" />
              )}
              <Icon className={cn("size-[18px]", active ? "text-gold-strong" : "text-ink-faint group-hover:text-ink-muted")} />
              <span className={cn(active && "font-medium")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 text-[11px] leading-relaxed text-ink-faint">
        <div className="rule-gold mb-3 w-8" />
        从信息源到知识问答
      </div>
    </aside>
  );
}
