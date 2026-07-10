"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Clock,
  FileText,
  Library,
  List,
  Search as SearchIcon,
  Sparkles,
  Waypoints,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import {
  DEFAULT_SEARCH_STRATEGY,
  getSearchStrategy,
  isSearchStrategy,
  type SearchStrategy,
} from "@/lib/retrieval-config";
import { cn } from "@/lib/utils";
import type { ActivityItem, Entity, SearchEvent, Source, SourceGraphRelation } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { useDetailPanel } from "@/components/features/detail-panel";
import { SearchStrategyControl } from "@/components/features/search-strategy-control";
import { DocStatusBadge } from "@/components/features/status-badge";
import { EmptyState } from "@/components/features/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// 图谱视图较重，按需加载（列表为默认视图）
const SearchGraph = dynamic(() => import("@/components/features/search-graph"), {
  ssr: false,
  loading: () => <Skeleton className="h-[560px] rounded-lg" />,
});

function mentionTerm(query: string): string | null {
  const at = query.lastIndexOf("@");
  if (at < 0) return null;
  const term = query.slice(at + 1);
  return /\s/.test(term) ? null : term;
}

function removeMentionTerm(query: string): string {
  const at = query.lastIndexOf("@");
  if (at < 0) return query;
  const before = query.slice(0, at).trimEnd();
  return before ? `${before} ` : "";
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

const ROW_CARD =
  "group flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left shadow-soft outline-none transition-all hover:bg-muted/35 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring";

function ActivityCard({ item }: { item: ActivityItem }) {
  const { open } = useDetailPanel();
  const Icon = FileText;
  const cardClass =
    "group flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:bg-muted/45";
  const body = (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 max-w-full truncate text-sm font-medium text-foreground">
            {item.title}
          </span>
          {item.status && <DocStatusBadge status={item.status} />}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {item.subtitle || "文档"}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        查看原文
        <ArrowUpRight className="size-3" />
      </span>
    </>
  );

  return (
    <button
      type="button"
      onClick={() =>
        item.source_id &&
        open({ kind: "document", sourceId: item.source_id, documentId: item.id, title: item.title })
      }
      className={cardClass}
    >
      {body}
    </button>
  );
}

function ActivityTimeline({ items }: { items: ActivityItem[] | null }) {
  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="还没有最近动态"
        description="上传文档或开始对话后，这里会按时间展示最近产生的事件。"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card/45">
      {[...items].map((item, index) => (
        <div key={`${item.type}-${item.id}`} className={cn(index > 0 && "border-t border-border/60")}>
          <ActivityCard item={item} />
        </div>
      ))}
    </div>
  );
}

function ResultList({ results }: { results: SearchEvent[] }) {
  const { open } = useDetailPanel();
  if (results.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="没有召回任何内容"
        description="换个说法试试，或确认文档已完成事件抽取。"
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {results.map((event) => (
        <button
          key={event.id}
          type="button"
          disabled={!event.chunk_id || !event.source_id}
          onClick={() =>
            event.chunk_id &&
            event.source_id &&
            open({
              kind: "chunk",
              sourceId: event.source_id,
              chunkId: event.chunk_id,
              heading: event.title,
              sourceName: event.source_name ?? undefined,
            })
          }
          className={cn(
            ROW_CARD,
            "disabled:cursor-default disabled:hover:bg-card disabled:hover:shadow-soft",
          )}
        >
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <Sparkles className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {event.title || "未命名事件"}
              </span>
              {event.category && (
                <span className="hidden shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 sm:inline">
                  {event.category}
                </span>
              )}
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {event.source_name}
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {event.score.toFixed(3)}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {event.summary || "暂无事件摘要"}
            </span>
          </span>
          {event.chunk_id && event.source_id && (
            <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              查看原文
              <ArrowUpRight className="size-3" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function SearchPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { capabilities } = useApp();
  const defaultStrategy = isSearchStrategy(capabilities?.search_strategy)
    ? capabilities.search_strategy
    : DEFAULT_SEARCH_STRATEGY;
  const [query, setQuery] = React.useState("");
  const [scoped, setScoped] = React.useState<{ id: string; name: string }[]>([]);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [results, setResults] = React.useState<SearchEvent[] | null>(null);
  const [graphEntities, setGraphEntities] = React.useState<Entity[]>([]);
  const [graphRelations, setGraphRelations] = React.useState<SourceGraphRelation[]>([]);
  const [hasMoreResults, setHasMoreResults] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [activity, setActivity] = React.useState<ActivityItem[] | null>(null);
  const [view, setView] = React.useState<"list" | "graph">("list");
  const [lastQuery, setLastQuery] = React.useState("");
  const [strategy, setStrategy] = React.useState<SearchStrategy>(defaultStrategy);
  const [lastStrategy, setLastStrategy] = React.useState<SearchStrategy>(defaultStrategy);
  const [topK, setTopK] = React.useState(12);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const searchRequestIdRef = React.useRef(0);

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
    api.getActivity().then((a) => setActivity(a.filter((x) => x.type === "document"))).catch(() => setActivity([]));
    inputRef.current?.focus();
  }, [preset]);

  const term = mentionTerm(query);
  const filteredSources = React.useMemo(() => {
    const needle = (term ?? "").trim().toLowerCase();
    return sources.filter((s) => !needle || s.name.toLowerCase().includes(needle));
  }, [sources, term]);
  React.useEffect(() => {
    if (!mentionOpen) return;
    if (term === null) {
      setMentionOpen(false);
      return;
    }
    setMentionIndex(0);
  }, [mentionOpen, term]);

  const chooseSource = React.useCallback((source: Source | undefined) => {
    if (!source) return;
    setScoped((prev) =>
      prev.some((x) => x.id === source.id)
        ? prev.filter((x) => x.id !== source.id)
        : [...prev, { id: source.id, name: source.name }],
    );
    setQuery((q) => removeMentionTerm(q));
    setMentionOpen(false);
    setMentionIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  async function searchFor(raw: string, k?: number, requestedStrategy: SearchStrategy = strategy) {
    const q = raw.trim();
    if (!q) {
      searchRequestIdRef.current += 1;
      setBusy(false);
      setResults(null);
      setGraphEntities([]);
      setGraphRelations([]);
      setHasMoreResults(false);
      setLastQuery("");
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    const limit = k ?? 12;
    setTopK(limit);
    setBusy(true);
    setMentionOpen(false);
    try {
      const r = await api.globalSearch({
        query: q,
        source_ids: scoped.length ? scoped.map((s) => s.id) : undefined,
        top_k: limit,
        strategy: requestedStrategy,
      });
      if (requestId !== searchRequestIdRef.current) return;
      setResults(r.events);
      setGraphEntities(r.entities);
      setGraphRelations(r.relations);
      setHasMoreResults(r.sections.length >= limit);
      setLastQuery(q);
      setLastStrategy(requestedStrategy);
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      toast.error(err instanceof ApiError ? err.message : "检索失败");
    } finally {
      if (requestId === searchRequestIdRef.current) setBusy(false);
    }
  }

  function changeStrategy(value: SearchStrategy) {
    if (value === strategy) return;
    setStrategy(value);
    const activeQuery = query.trim() || lastQuery;
    if ((results !== null || busy) && activeQuery) {
      void searchFor(activeQuery, topK, value);
    }
  }

  async function run(e?: React.FormEvent, k?: number) {
    e?.preventDefault();
    await searchFor(query, k);
  }

  const graphViewActive = view === "graph" && Boolean(results?.length);

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-6 p-4 md:p-6",
        graphViewActive && "h-full min-h-0 overflow-hidden",
      )}
    >
      <form onSubmit={run} className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2">
        <div className="flex w-full items-center gap-2">
          <div className="relative flex-1">
            <div
              className={cn(
                "flex min-h-11 items-center gap-1 rounded-lg border border-input bg-card py-1.5 pl-10 pr-2 shadow-soft transition-[border-color,box-shadow]",
                "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
              )}
            >
              <button
                type="submit"
                aria-label="搜索"
                disabled={!query.trim() || busy}
                className="absolute left-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              >
                <SearchIcon className="size-4" />
              </button>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
                    const nextMentionOpen = mentionTerm(v) !== null;
                    setQuery(v);
                    if (!v.trim()) {
                      searchRequestIdRef.current += 1;
                      setBusy(false);
                      setResults(null);
                      setGraphEntities([]);
                      setGraphRelations([]);
                      setHasMoreResults(false);
                      setLastQuery("");
                    }
                    setMentionOpen(nextMentionOpen);
                  }}
                  onKeyDown={(e) => {
                    if (mentionOpen) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => (filteredSources.length ? (i + 1) % filteredSources.length : 0));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) =>
                          filteredSources.length ? (i - 1 + filteredSources.length) % filteredSources.length : 0,
                        );
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        chooseSource(filteredSources[mentionIndex]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMentionOpen(false);
                        return;
                      }
                    }
                    if (e.key === "@") {
                      setMentionOpen(true);
                      setMentionIndex(0);
                    }
                  }}
                  placeholder={scoped.length ? "继续输入关键词…" : "搜索知识库 · 输入 @ 限定范围"}
                  className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    searchRequestIdRef.current += 1;
                    setQuery("");
                    setBusy(false);
                    setResults(null);
                    setGraphEntities([]);
                    setGraphRelations([]);
                    setHasMoreResults(false);
                    setLastQuery("");
                    setMentionOpen(false);
                    inputRef.current?.focus();
                  }}
                  aria-label="清空"
                  className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              )}
              <SearchStrategyControl
                value={strategy}
                defaultValue={defaultStrategy}
                onValueChange={changeStrategy}
              />
            </div>
            {mentionOpen && (
              <div className="absolute left-0 top-full z-20 mt-2 w-full">
                <div className="overflow-hidden rounded-lg border bg-card shadow-lift">
                  <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    知识库范围
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1" role="listbox">
                    {filteredSources.length === 0 ? (
                      <p className="px-3 py-5 text-center text-sm text-muted-foreground">没有匹配的信源</p>
                    ) : (
                      filteredSources.map((s, index) => {
                        const on = scoped.some((x) => x.id === s.id);
                        const active = index === mentionIndex;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setMentionIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseSource(s)}
                            className={cn(
                              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors",
                              active && "bg-muted text-foreground",
                            )}
                          >
                            <Library className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            {on && <span className="text-xs text-muted-foreground">已选</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
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
        </div>
      </form>

      {busy && results === null ? (
        <div className="mx-auto w-full max-w-3xl">
          <SearchScanning />
        </div>
      ) : results !== null ? (
        <div
          className={cn(
            "flex w-full flex-col gap-2",
            view === "graph" && results.length > 0
              ? "mx-auto min-h-0 max-w-[1200px] flex-1"
              : "mx-auto max-w-3xl",
          )}
        >
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              检索结果
              <span
                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground"
                aria-live="polite"
              >
                {busy && <Spinner className="size-3" />}
                {getSearchStrategy(busy ? strategy : lastStrategy).label}
              </span>
            </h2>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {busy ? (
                  "正在更新结果…"
                ) : (
                  `召回 ${results.length} 条 · 点击查看原文`
                )}
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
            <SearchGraph events={results} entities={graphEntities} relations={graphRelations} />
          ) : (
            <>
              <ResultList results={results} />
              {hasMoreResults && topK < 48 && (
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              最近动态
            </h2>
            <span className="hidden text-xs text-muted-foreground sm:inline">点击查看原文</span>
          </div>
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
