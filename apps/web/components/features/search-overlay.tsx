"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, CornerDownLeft, FileText, Search, X } from "lucide-react";

import { api } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import type { Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChunkDialog, type ChunkRef } from "@/components/features/chat/chunk-dialog";

/** 搜索范围：不传 = 全部信源；传入则锁定单一信源（可在浮层内移除）。 */
export interface SearchScope {
  id: string;
  name: string;
}

interface SearchCtx {
  openSearch: (scope?: SearchScope) => void;
}

const Ctx = React.createContext<SearchCtx>({ openSearch: () => {} });
export const useSearch = () => React.useContext(Ctx);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<SearchScope | null>(null);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Section[] | null>(null); // null = 未搜索
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [chunk, setChunk] = React.useState<ChunkRef | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const openSearch = React.useCallback((s?: SearchScope) => {
    setScope(s ?? null);
    setQuery("");
    setResults(null);
    setActive(0);
    setOpen(true);
  }, []);

  // 全局 ⌘K / Ctrl+K
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  async function run() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setActive(0);
    try {
      const res = await api.globalSearch({
        query: q,
        source_ids: scope ? [scope.id] : undefined,
        top_k: 12,
      });
      setResults(res.sections);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function go(section: Section) {
    setOpen(false);
    if (section.source_id) router.push(`/sources/${section.source_id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (results && results.length > 0) go(results[active]);
      else run();
    } else if (e.key === "ArrowDown" && results?.length) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp" && results?.length) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Backspace" && !query && scope) {
      setScope(null);
    }
  }

  // 输入变化后回到「待搜索」态，Enter 触发检索
  function onChange(v: string) {
    setQuery(v);
    if (results !== null) setResults(null);
  }

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Ctx.Provider value={{ openSearch }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[16%] max-w-xl translate-y-0 gap-0 p-0 [&>button]:hidden"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">搜索</DialogTitle>

          <div className="flex items-center gap-2.5 border-b px-4 py-3">
            {loading ? (
              <Spinner className="shrink-0" />
            ) : (
              <Search className="size-4 shrink-0 text-muted-foreground" />
            )}
            {scope && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                @{scope.name}
                <button
                  onClick={() => setScope(null)}
                  className="rounded hover:text-destructive"
                  aria-label="移除范围限定"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={scope ? `在 ${scope.name} 中搜索…` : "搜索全部信源…"}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
              esc
            </kbd>
          </div>

          <div ref={listRef} className="max-h-[52vh] overflow-y-auto overscroll-contain p-2">
            {results === null ? (
              <div className="flex items-center justify-between px-3 py-8 text-sm text-muted-foreground">
                <span>{loading ? "检索中…" : "输入问题或关键词，Enter 检索"}</span>
                {!loading && (
                  <span className="hidden items-center gap-1 sm:flex">
                    <CornerDownLeft className="size-3.5" />
                  </span>
                )}
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                没有找到相关内容{scope ? `（范围：${scope.name}）` : ""}。换个说法试试。
              </div>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.chunk_id ?? i}`}
                  data-idx={i}
                  onClick={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                    i === active ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <FileText
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      i === active ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {r.heading && (
                        <span className="truncate text-[13px] font-medium text-foreground">{r.heading}</span>
                      )}
                      {r.source_name && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {r.source_name}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                      {r.content}
                    </span>
                  </span>
                  <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                    {r.chunk_id && r.source_id && (
                      <span
                        role="button"
                        tabIndex={-1}
                        title="查看原文"
                        onClick={(e) => {
                          e.stopPropagation();
                          setChunk({
                            sourceId: r.source_id!,
                            chunkId: r.chunk_id!,
                            heading: r.heading,
                            sourceName: r.source_name,
                          });
                        }}
                        className={cn(
                          "rounded p-1 text-muted-foreground transition-opacity hover:text-foreground",
                          i === active ? "opacity-100" : "opacity-0",
                        )}
                      >
                        <BookOpenText className="size-3.5" />
                      </span>
                    )}
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {r.score.toFixed(2)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          {results && results.length > 0 && (
            <div className="flex items-center gap-3 border-t px-4 py-2 text-[10.5px] text-muted-foreground">
              <span>↑↓ 选择</span>
              <span>Enter 打开信源</span>
              <span className="ml-auto tabular-nums">{results.length} 条结果</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ChunkDialog chunk={chunk} onOpenChange={(o) => !o && setChunk(null)} />
    </Ctx.Provider>
  );
}
