"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, FileText, Search, X } from "lucide-react";
import type { SearchItem } from "@/lib/types";

type Props = {
  items: SearchItem[];
  compact?: boolean;
};

export function SearchDialog({ items, compact = false }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const results = useMemo(() => {
    const terms = query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!terms.length) return items.slice(0, 8);
    return items
      .filter((item) => {
        const haystack = `${item.title}\n${item.description}\n${item.text}`.toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 10);
  }, [items, query]);

  return (
    <>
      <button
        className={compact ? "icon-button" : "search-trigger"}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="搜索 Open Context 文档"
        title="搜索文档"
      >
        <Search size={17} aria-hidden="true" />
        {!compact && <span>搜索文档...</span>}
        {!compact && <kbd>⌘K</kbd>}
      </button>

      {open && (
        <div className="search-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="search-panel"
            role="dialog"
            aria-modal="true"
            aria-label="搜索 Open Context 文档"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="search-input-row">
              <Search size={18} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索规范、概念、API 或术语..."
                aria-label="搜索关键词"
              />
              <button
                className="icon-button quiet"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭搜索"
                title="关闭"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="search-results" aria-live="polite">
              {results.length ? (
                results.map((item) => (
                  <Link className="search-result" href={item.href} key={item.href}>
                    <FileText size={17} aria-hidden="true" />
                    <span>
                      <small>{item.group}</small>
                      <strong>{item.title}</strong>
                      <em>{item.description}</em>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                ))
              ) : (
                <div className="search-empty">
                  <strong>没有找到结果</strong>
                  <span>试试 “manifest”、“Event” 或 “Package Digest”。</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
