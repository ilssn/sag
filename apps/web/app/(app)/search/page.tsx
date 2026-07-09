"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, FileText, History, Library, List, MessageSquare, Search as SearchIcon, Waypoints, X } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ActivityItem, Section, Source } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useDetailPanel } from "@/components/features/detail-panel";
import { DocStatusBadge } from "@/components/features/status-badge";
import { EmptyState } from "@/components/features/empty-state";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// 图谱视图较重，按需加载（列表为默认视图）
const SearchGraph = dynamic(() => import("@/components/features/search-graph"), {
  ssr: false,
  loading: () => <Skeleton className="h-[560px] rounded-lg" />,
});

const HISTORY_KEY = "sag:search-history";

function readHistory(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function pushHistory(q: string) {
  const next = [q, ...readHistory().filter((x) => x !== q)].slice(0, 8);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

/** 检索扫描动画：骨架行 1→N 铺开、随机高亮、清空、再来——「翻找数据」的具象化。 */
function SearchScanning() {
  const [rows, setRows] = React.useState(1);
  const [lit, setLit] = React.useState<Set<number>>(new Set());
  React.useEffect(() => {
    let n = 1;
    const grow = window.setInterval(() => {
      n = n >= 6 ? 1 : n + 1;
      setRows(n);
      const picks = new Set<number>();
      const count = n <= 2 ? 1 : 2 + (n % 2);
      while (picks.size < Math.min(count, n)) picks.add(Math.floor(Math.random() * n));
      setLit(picks);
    }, 420);
    return () => window.clearInterval(grow);
  }, []);
  return (
    <div className="flex flex-col gap-1.5 overflow-hidden rounded-lg border p-3" aria-label="检索中">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-8 animate-fade-in rounded-md transition-colors duration-300",
            lit.has(i) ? "bg-primary/15 ring-1 ring-primary/25" : "bg-muted",
          )}
        />
      ))}
      <p className="pt-1 text-center text-xs text-muted-foreground">正在翻找知识库…</p>
    </div>
  );
}

function dayGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return "更早";
}

function ActivityTimeline({ items }: { items: ActivityItem[] | null }) {
  const { open } = useDetailPanel();
  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="还没有动态"
        description="上传文档或开始对话后，这里会按时间线展示最近的动态。"
      />
    );
  }
  const groups: [string, ActivityItem[]][] = [];
  for (const item of items) {
    const g = dayGroup(item.at);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(item);
    else groups.push([g, [item]]);
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map(([label, rows]) => (
        <section key={label} className="flex flex-col gap-1.5">
          <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </h3>
          <div className="overflow-hidden rounded-lg border">
            {rows.map((item, i) =>
              item.type === "thread" ? (
                <Link
                  key={`${item.type}-${item.id}`}
                  href={`/chat/${item.id}`}
                  className={`flex items-center gap-3 px-4 py-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 ${i > 0 ? "border-t" : ""}`}
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {relativeTime(item.at)}
                  </span>
                </Link>
              ) : (
                <button
                  key={`${item.type}-${item.id}`}
                  onClick={() =>
                    item.source_id &&
                    open({ kind: "document", sourceId: item.source_id, documentId: item.id })
                  }
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 ${i > 0 ? "border-t" : ""}`}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.subtitle && (
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {item.subtitle}
                    </span>
                  )}
                  {item.status && <DocStatusBadge status={item.status} />}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {relativeTime(item.at)}
                  </span>
                </button>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function ResultList({ results }: { results: Section[] }) {
  const { open } = useDetailPanel();
  if (results.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="没有召回任何内容"
        description="换个说法试试，或确认文档已处理完成。"
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      {results.map((s, i) => (
        <button
          key={`${s.chunk_id}-${i}`}
          onClick={() =>
            s.chunk_id &&
            s.source_id &&
            open({
              kind: "chunk",
              sourceId: s.source_id,
              chunkId: s.chunk_id,
              heading: s.heading ?? undefined,
              sourceName: s.source_name ?? undefined,
            })
          }
          className={`flex w-full flex-col gap-1 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 ${i > 0 ? "border-t" : ""}`}
        >
          <div className="flex items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-muted text-[11px] font-semibold">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {s.heading || "片段"}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{s.source_name}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {s.score.toFixed(3)}
            </span>
          </div>
          <p className="line-clamp-2 pl-7 text-xs text-muted-foreground">{s.content}</p>
        </button>
      ))}
    </div>
  );
}

function SearchPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [scoped, setScoped] = React.useState<{ id: string; name: string }[]>([]);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>([]);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [results, setResults] = React.useState<Section[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [activity, setActivity] = React.useState<ActivityItem[] | null>(null);
  const [view, setView] = React.useState<"list" | "graph">("list");
  const [lastQuery, setLastQuery] = React.useState("");
  const [topK, setTopK] = React.useState(12);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const preset = params.get("source");
  React.useEffect(() => {
    api
      .listSources()
      .then((list) => {
        setSources(list);
        if (preset) {
          const hit = list.find((s) => s.id === preset);
          if (hit) setScoped([{ id: hit.id, name: hit.name }]);
        }
      })
      .catch(() => {});
    api.getActivity().then(setActivity).catch(() => setActivity([]));
    setHistory(readHistory());
    inputRef.current?.focus();
  }, [preset]);

  async function run(e?: React.FormEvent, k?: number) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const limit = k ?? 12;
    setTopK(limit);
    setBusy(true);
    try {
      setHistory(pushHistory(q));
      const r = await api.globalSearch({
        query: q,
        source_ids: scoped.length ? scoped.map((s) => s.id) : undefined,
        top_k: limit,
        // 搜索页用纯向量（毫秒级）；multi=图谱增强需 LLM 抽实体（秒级），留给对话检索
        strategy: "vector",
      });
      setResults(r.sections);
      setLastQuery(q);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "检索失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <form onSubmit={run} className="flex items-center gap-2">
        <div className="relative flex-1">
          <div
            className={cn(
              "flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input bg-card py-1 pl-10 pr-9 shadow-soft transition-[border-color,box-shadow]",
              "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
            )}
          >
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            {scoped.map((sc) => (
              <span
                key={sc.id}
                className="inline-flex max-w-[min(100%,12rem)] items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
              >
                <Library className="size-3 shrink-0" />
                <span className="truncate">{sc.name}</span>
                <button
                  type="button"
                  aria-label={`移除 ${sc.name}`}
                  onClick={() => setScoped((p) => p.filter((x) => x.id !== sc.id))}
                  className="rounded-sm text-primary/70 hover:bg-primary/15 hover:text-primary"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                if (!v.trim() && scoped.length === 0) setResults(null);
                if (v.endsWith("@")) setMentionOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "@") setMentionOpen(true);
                if (e.key === "Escape") setMentionOpen(false);
              }}
              placeholder={scoped.length ? "继续输入关键词…" : "搜索知识库 · 输入 @ 限定范围"}
              className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                if (scoped.length === 0) setResults(null);
                inputRef.current?.focus();
              }}
              aria-label="清空"
              className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
          {mentionOpen && (
            <div className="absolute left-0 top-full z-20 mt-2 w-80">
              <Command className="rounded-lg border shadow-lift">
                <CommandInput placeholder="匹配知识库…" autoFocus />
                <CommandList>
                  <CommandEmpty>没有匹配的信源</CommandEmpty>
                  <CommandGroup heading="知识库范围（可多选）">
                    {sources.map((s) => {
                      const on = scoped.some((x) => x.id === s.id);
                      return (
                        <CommandItem
                          key={s.id}
                          value={s.name}
                          onSelect={() => {
                            setScoped((p) =>
                              on
                                ? p.filter((x) => x.id !== s.id)
                                : [...p, { id: s.id, name: s.name }],
                            );
                            setQuery((q) => (q.endsWith("@") ? q.slice(0, -1) : q));
                            setMentionOpen(false);
                            inputRef.current?.focus();
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          {on && <span className="text-xs text-muted-foreground">已选</span>}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/chat"))}
          className="shrink-0 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          取消
        </button>
      </form>

      {busy && results === null ? (
        <SearchScanning />
      ) : results !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="text-sm font-medium">检索结果</h2>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                召回 {results.length} 条 · 点击查看原文
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={view}
                onValueChange={(v) => v && setView(v as typeof view)}
                aria-label="结果视图"
              >
                <ToggleGroupItem value="list" aria-label="列表视图">
                  <List />
                </ToggleGroupItem>
                <ToggleGroupItem value="graph" aria-label="图谱视图">
                  <Waypoints />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          {view === "graph" && results.length > 0 ? (
            <SearchGraph query={lastQuery} results={results} />
          ) : (
            <>
              <ResultList results={results} />
              {results.length >= topK && topK < 48 && (
                <div className="flex justify-center pt-1">
                  <button
                    onClick={() => run(undefined, topK + 12)}
                    disabled={busy}
                    className="rounded-full border bg-card px-4 py-1.5 text-xs text-muted-foreground shadow-soft outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {busy ? "加载中…" : "显示更多结果"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium">近期动态</h2>
          <ActivityTimeline items={activity} />
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <React.Suspense fallback={<div className="p-6"><Skeleton className="h-12 rounded-lg" /></div>}>
      <SearchPageInner />
    </React.Suspense>
  );
}
