"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileJson2 } from "lucide-react";
import { SearchDialog } from "@/components/search-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { TOP_NAV } from "@/lib/site-config";
import type { SearchItem } from "@/lib/types";

export function SiteHeader({ searchItems }: { searchItems: SearchItem[] }) {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="header-primary">
        <Link className="brand" href="/" aria-label="Open Context 首页">
          <Image src="/octx-mark.svg" alt="" width={28} height={28} priority />
          <span>Open Context</span>
          <small>OCTX</small>
        </Link>

        <div className="header-search desktop-only">
          <SearchDialog items={searchItems} />
        </div>

        <div className="header-actions">
          <span className="version-label">v1.0</span>
          <a className="schema-link desktop-only" href="/schemas/1.0/manifest.schema.json">
            <FileJson2 size={16} aria-hidden="true" />
            JSON Schema
          </a>
          <div className="mobile-only">
            <SearchDialog items={searchItems} compact />
          </div>
          <ThemeToggle />
        </div>
      </div>

      <nav className="header-nav" aria-label="主导航">
        <Link className={pathname === "/" ? "active" : ""} href="/">
          概览
        </Link>
        {TOP_NAV.map((item) => (
          <Link
            className={pathname.startsWith(item.activePrefix) ? "active" : ""}
            href={item.href}
            key={item.href}
          >
            {item.title}
          </Link>
        ))}
      </nav>
    </header>
  );
}
