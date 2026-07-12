"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  History,
  Library,
  List,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getSearchStrategy,
  type SearchStrategy,
} from "@/lib/retrieval-config";
import { cn } from "@/lib/utils";
import type {
  ActivityItem,
  Citation,
  SearchEvent,
  SearchResponse,
  Section,
  Source,
} from "@/lib/types";
import { useDetailPanel } from "@/components/features/detail-panel";
import { MarkdownContent } from "@/components/features/markdown-content";
import {
  useSearchWorkspace,
  type SearchContentView,
} from "@/components/features/search/search-provider";
import { SearchStrategyControl } from "@/components/features/search-strategy-control";
import { DocStatusBadge } from "@/components/features/status-badge";
import { EmptyState } from "@/components/features/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// 图谱视图较重，按需加载。
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
const ACTIVITY_PAGE_SIZE = 6;

function ActivityCard({
  item,
  compact,
  interactive,
  onOpen,
}: {
  item: ActivityItem;
  compact: boolean;
  interactive: boolean;
  onOpen?: (item: ActivityItem) => void;
}) {
  const { open } = useDetailPanel();
  const Icon = FileText;
  const cardClass = cn(
    "group flex w-full items-center gap-3 text-left outline-none transition-colors",
    compact ? "px-3 py-2.5" : "px-4 py-3",
    interactive && "hover:bg-muted/35 focus-visible:bg-muted/45",
  );
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
      {interactive && (
        compact ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            查看详情
            <ArrowUpRight className="size-3" />
          </span>
        )
      )}
    </>
  );

  if (!interactive) {
    return (
      <div data-activity-item={item.id} className={cardClass}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-activity-item={item.id}
      disabled={!item.source_id}
      onClick={() => {
        if (!item.source_id) return;
        if (onOpen) {
          onOpen(item);
          return;
        }
        open({
          kind: "document",
          sourceId: item.source_id,
          documentId: item.id,
          title: item.title,
        });
      }}
      className={cardClass}
    >
      {body}
    </button>
  );
}

function ActivityTimeline({
  items,
  compact,
  interactive,
  onItemOpen,
}: {
  items: ActivityItem[] | null;
  compact: boolean;
  interactive: boolean;
  onItemOpen?: (item: ActivityItem) => void;
}) {
  const [visibleCount, setVisibleCount] = React.useState(ACTIVITY_PAGE_SIZE);
  const orderedItems = React.useMemo(() => {
    if (!items) return [];
    return items
      .map((item, index) => ({
        item,
        index,
        timestamp: Date.parse(item.at),
      }))
      .sort((left, right) => {
        const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : 0;
        const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : 0;
        return rightTime - leftTime || left.index - right.index;
      })
      .map(({ item }) => item);
  }, [items]);

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

  const visibleItems = orderedItems.slice(0, visibleCount);
  const remaining = Math.max(orderedItems.length - visibleItems.length, 0);

  return (
    <div
      data-activity-list="recent"
      className="overflow-hidden rounded-lg border border-border/70 bg-card/45"
    >
      {visibleItems.map((item, index) => (
        <div key={`${item.type}-${item.id}`} className={cn(index > 0 && "border-t border-border/60")}>
          <ActivityCard
            item={item}
            compact={compact}
            interactive={interactive}
            onOpen={onItemOpen}
          />
        </div>
      ))}
      {remaining > 0 && (
        <div className="border-t border-border/60 p-1.5">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(current + ACTIVITY_PAGE_SIZE, orderedItems.length),
              )
            }
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`查看更多最近动态，剩余 ${remaining} 条`}
          >
            查看更多
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function SearchHistoryList({
  queries,
  compact,
  onSelect,
  onRemove,
  onClear,
}: {
  queries: string[];
  compact: boolean;
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}) {
  const pageSize = 5;
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);

  if (queries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="还没有查询历史"
        description="完成一次搜索后，查询词会保存在当前设备中。"
      />
    );
  }

  const shownQueries = queries.slice(0, visibleCount);
  const remaining = Math.max(queries.length - shownQueries.length, 0);
  const canCollapse = remaining === 0 && queries.length > pageSize;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-xs text-muted-foreground">
          {queries.length} 条本地记录
        </span>
        <button
          type="button"
          onClick={() => setClearConfirmOpen(true)}
          className="rounded px-1.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          清空全部
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/45">
        {shownQueries.map((query, index) => (
          <div
            key={query}
            className={cn(
              "group flex w-full items-center transition-colors hover:bg-muted/35 focus-within:bg-muted/35",
              index > 0 && "border-t border-border/60",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(query)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                compact ? "px-3 py-2.5" : "px-4 py-3",
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
                <History className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {query}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(query)}
              className="mr-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/65 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`删除查询历史：${query}`}
              title="删除"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {(remaining > 0 || canCollapse) && (
        <button
          type="button"
          onClick={() =>
            setVisibleCount((current) =>
              remaining > 0 ? Math.min(current + pageSize, queries.length) : pageSize,
            )
          }
          className="mx-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={remaining === 0}
        >
          {remaining > 0 ? (
            <>
              展开更多
              <ChevronDown className="size-3.5" />
            </>
          ) : (
            <>
              收起
              <ChevronUp className="size-3.5" />
            </>
          )}
        </button>
      )}
      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="清空查询历史？"
        description={`将删除当前设备保存的 ${queries.length} 条查询记录，此操作无法撤销。`}
        confirmLabel="清空全部"
        onConfirm={onClear}
      />
    </div>
  );
}

function sectionCitation(section: Section, index: number): Citation {
  return {
    n: index + 1,
    chunk_id: section.chunk_id,
    heading: section.heading,
    snippet: section.content,
    score: section.score,
    source_id: section.source_id,
    source_name: section.source_name,
  };
}

function ResultList({
  result,
  onEventClick,
  onCitationClick,
  compact,
}: {
  result: SearchResponse;
  onEventClick?: (event: SearchEvent, result: SearchResponse) => void;
  onCitationClick?: (citation: Citation, result: SearchResponse) => void;
  compact: boolean;
}) {
  const { open } = useDetailPanel();
  if (result.events.length === 0 && result.sections.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="没有找到足够相关的证据"
        description="换个更具体的说法，或通过 @ 缩小知识库范围。"
      />
    );
  }
  if (result.events.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {result.sections.map((section, index) => {
          const citation = sectionCitation(section, index);
          return (
            <button
              key={`${section.source_id}:${section.chunk_id}:${index}`}
              type="button"
              disabled={!section.chunk_id || !section.source_id}
              onClick={() => {
                if (onCitationClick) {
                  onCitationClick(citation, result);
                  return;
                }
                if (!section.chunk_id || !section.source_id) return;
                open({
                  kind: "chunk",
                  sourceId: section.source_id,
                  chunkId: section.chunk_id,
                  heading: section.heading,
                  sourceName: section.source_name ?? undefined,
                });
              }}
              className={cn(
                ROW_CARD,
                compact && "gap-2 px-3",
                "disabled:cursor-default disabled:hover:bg-card disabled:hover:shadow-soft",
              )}
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-xs text-primary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {section.heading || "相关资料"}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {section.score.toFixed(3)}
                  </span>
                </span>
                <span className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {section.content}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {result.events.map((event) => (
        <button
          key={event.id}
          type="button"
          disabled={!event.chunk_id || !event.source_id}
          onClick={() => {
            if (onEventClick) {
              onEventClick(event, result);
              return;
            }
            if (!event.chunk_id || !event.source_id) return;
            open({
              kind: "chunk",
              sourceId: event.source_id,
              chunkId: event.chunk_id,
              heading: event.title,
              sourceName: event.source_name ?? undefined,
            });
          }}
          className={cn(
            ROW_CARD,
            compact && "gap-2 px-3",
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
              {!compact && event.category && (
                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  {event.category}
                </span>
              )}
              {!compact && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {event.source_name}
                </span>
              )}
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {event.score.toFixed(3)}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {event.summary || "暂无事件摘要"}
            </span>
          </span>
          {!compact && event.chunk_id && event.source_id && (
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

export interface SearchPanelProps {
  active?: boolean;
  initialQuery?: string;
  initialSourceId?: string | null;
  saveInitialExploration?: boolean;
  showCancel?: boolean;
  showGraphView?: boolean;
  showRecentActivity?: boolean;
  showContentSwitcher?: boolean;
  activityInteractive?: boolean;
  onCancel?: () => void;
  onSearchStart?: (query: string) => void;
  onSearchComplete?: (result: SearchResponse) => void;
  onSearchError?: (message: string) => void;
  onActivityClick?: (item: ActivityItem) => void;
  onEventClick?: (event: SearchEvent, result: SearchResponse) => void;
  onCitationClick?: (citation: Citation, result: SearchResponse) => void;
  className?: string;
}

/** Complete adaptive search surface shared by the main workspace and mini entry. */
export function SearchPanel({
  active = true,
  initialQuery = "",
  initialSourceId,
  saveInitialExploration = false,
  showCancel = false,
  showGraphView = true,
  showRecentActivity = true,
  showContentSwitcher = true,
  activityInteractive = true,
  onCancel,
  onSearchStart,
  onSearchComplete,
  onSearchError,
  onActivityClick,
  onEventClick,
  onCitationClick,
  className,
}: SearchPanelProps) {
  const search = useSearchWorkspace();
  const ensureSources = search.ensureSources;
  const { open } = useDetailPanel();
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [view, setView] = React.useState<"list" | "graph">("graph");
  const [compact, setCompact] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hydrationKeyRef = React.useRef("");
  const contentView = search.contentView;
  const changeContentView = search.setContentView;

  const executeSearch = React.useCallback(
    async (options: {
      query?: string;
      topK?: number;
      strategy?: SearchStrategy;
      sourceIds?: string[];
      saveExploration?: boolean;
    } = {}) => {
      const query = (options.query ?? search.query).trim();
      if (!query) {
        search.clear();
        return null;
      }
      setMentionOpen(false);
      changeContentView("results");
      onSearchStart?.(query);
      try {
        const result = await search.run(options);
        if (result) onSearchComplete?.(result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "检索失败";
        if (onSearchError) onSearchError(message);
        else toast.error(message);
        return null;
      }
    },
    [changeContentView, onSearchComplete, onSearchError, onSearchStart, search],
  );

  React.useEffect(() => {
    if (showRecentActivity) void search.ensureActivity();
    const seedQuery = initialQuery.trim();
    const hydrationKey = `${seedQuery}\u0000${initialSourceId ?? ""}`;
    if (!seedQuery || hydrationKeyRef.current === hydrationKey) {
      if (active) inputRef.current?.focus();
      return;
    }
    hydrationKeyRef.current = hydrationKey;
    let cancelled = false;
    void ensureSources().then((sources) => {
      if (cancelled) return;
      const source = initialSourceId
        ? sources.find((item) => item.id === initialSourceId)
        : undefined;
      const sourceIds = source ? [source.id] : undefined;
      if (source) search.setScope([{ id: source.id, name: source.name }]);
      search.setQuery(seedQuery);
      if (search.result && search.lastQuery === seedQuery) return;
      void executeSearch({
        query: seedQuery,
        sourceIds,
        saveExploration: saveInitialExploration,
      });
    });
    return () => {
      cancelled = true;
    };
    // The URL seed is consumed once; live search state is owned by SearchProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialQuery, initialSourceId, saveInitialExploration, showRecentActivity]);

  React.useEffect(() => {
    void ensureSources();
    if (active) inputRef.current?.focus();
  }, [active, ensureSources]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = (width: number) => setCompact(width < 520);
    update(root.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const term = mentionTerm(search.query);
  const filteredSources = React.useMemo(() => {
    const needle = (term ?? "").trim().toLowerCase();
    return search.sources.filter((source) =>
      !needle || source.name.toLowerCase().includes(needle),
    );
  }, [search.sources, term]);
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
    search.toggleSource(source);
    search.setQuery(removeMentionTerm(search.query));
    setMentionOpen(false);
    setMentionIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [search]);

  function changeStrategy(value: SearchStrategy) {
    if (value === search.strategy) return;
    search.setStrategy(value);
    const activeQuery = search.query.trim() || search.lastQuery;
    if ((search.result !== null || search.busy) && activeQuery) {
      void executeSearch({
        query: activeQuery,
        topK: search.topK,
        strategy: value,
        saveExploration: false,
      });
    }
  }

  async function run(e?: React.FormEvent, k?: number) {
    e?.preventDefault();
    await executeSearch({
      topK: k,
      saveExploration: false,
    });
  }

  const activeView = showGraphView ? view : "list";
  const graphViewActive = activeView === "graph" && Boolean(search.result?.events.length);
  const citations = React.useMemo(
    () => search.result?.sections.map(sectionCitation) ?? [],
    [search.result],
  );

  return (
    <div
      ref={rootRef}
      data-compact={compact || undefined}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-y-auto",
        compact ? "gap-3 p-3" : "gap-6 p-6",
        graphViewActive && "h-full min-h-0 overflow-hidden",
        className,
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
                disabled={!search.query.trim() || search.busy}
                className="absolute left-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              >
                <SearchIcon className="size-4" />
              </button>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {search.scoped.map((sc) => (
                  <span
                    key={sc.id}
                    className="inline-flex max-w-[min(100%,12rem)] items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                  >
                    <Library className="size-3 shrink-0" />
                    <span className="truncate">{sc.name}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${sc.name}`}
                      onClick={() => search.removeSource(sc.id)}
                      className="rounded-sm text-primary/70 hover:bg-primary/15 hover:text-primary"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  type="text"
                  autoFocus={active}
                  value={search.query}
                  onChange={(e) => {
                    const v = e.target.value;
                    const nextMentionOpen = mentionTerm(v) !== null;
                    search.setQuery(v);
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
                  placeholder={search.scoped.length ? "继续输入关键词…" : "搜索知识库 · 输入 @ 限定范围"}
                  className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              {search.query && (
                <button
                  type="button"
                  onClick={() => {
                    search.clear();
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
                value={search.strategy}
                defaultValue={search.defaultStrategy}
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
                        const on = search.scoped.some((x) => x.id === s.id);
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
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              取消
            </button>
          )}
        </div>
      </form>

      {showRecentActivity && showContentSwitcher && (
        <div className="mx-auto flex w-full max-w-3xl items-center px-1">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={contentView}
            onValueChange={(value) =>
              value && changeContentView(value as SearchContentView)
            }
            aria-label="搜索内容面板"
          >
            <ToggleGroupItem
              value="activity"
              className="gap-1.5 px-3"
              disabled={search.busy}
            >
              <List className="size-3.5" />
              最近动态
            </ToggleGroupItem>
            <ToggleGroupItem
              value="history"
              className="gap-1.5 px-3"
              disabled={search.busy}
            >
              <History className="size-3.5" />
              查询历史
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {contentView === "results" && search.busy && search.result === null ? (
        <div className="mx-auto w-full max-w-3xl">
          <SearchScanning />
        </div>
      ) : contentView === "results" && search.result !== null ? (
        <div
          className={cn(
            "flex w-full flex-col gap-2",
            activeView === "graph" && search.result.events.length > 0
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
                {search.busy && <Spinner className="size-3" />}
                {getSearchStrategy(search.busy ? search.strategy : search.lastStrategy).label}
              </span>
            </h2>
            <div className="flex items-center gap-3">
              {!compact && <span className="text-xs text-muted-foreground">
                {search.busy ? (
                  "正在更新结果…"
                ) : (
                  `入选 ${search.result.sections.length} 条相关证据`
                )}
              </span>}
              {showGraphView && (
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
              )}
            </div>
          </div>
          {search.result.summary && (
            <div
              className={cn(
                "rounded-lg border border-amber-500/15 bg-amber-500/[0.04]",
                compact ? "px-3 py-2.5" : "px-4 py-3",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <Sparkles className="size-3.5" />
                基于相关证据的回答
              </div>
              <div className="mt-1.5 text-sm leading-6 text-foreground/80">
                <MarkdownContent
                  content={search.result.summary}
                  citations={citations}
                  onCitationClick={(citation) => {
                    if (onCitationClick) {
                      onCitationClick(citation, search.result!);
                      return;
                    }
                    if (!citation.chunk_id || !citation.source_id) return;
                    open({
                      kind: "chunk",
                      sourceId: citation.source_id,
                      chunkId: citation.chunk_id,
                      heading: citation.heading,
                      sourceName: citation.source_name ?? undefined,
                    });
                  }}
                />
              </div>
            </div>
          )}
          {activeView === "graph" && search.result.events.length > 0 ? (
            <SearchGraph
              events={search.result.events}
              entities={search.result.entities}
              relations={search.result.relations}
              onOpenEvent={
                onEventClick
                  ? (event) => onEventClick(event, search.result!)
                  : undefined
              }
            />
          ) : (
            <>
              <ResultList
                result={search.result}
                onEventClick={onEventClick}
                onCitationClick={onCitationClick}
                compact={compact}
              />
              {search.hasMore && search.topK < 48 && (
                <div className="flex justify-center pt-1">
                  <button
                    onClick={() => run(undefined, search.topK + 12)}
                    disabled={search.busy}
                    className="rounded-full border bg-card px-4 py-1.5 text-xs text-muted-foreground shadow-soft outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {search.busy ? "加载中…" : "显示更多结果"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : contentView === "history" ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <SearchHistoryList
            queries={search.history}
            compact={compact}
            onSelect={(query) => {
              search.setQuery(query);
              void executeSearch({ query, saveExploration: false });
            }}
            onRemove={search.removeHistory}
            onClear={search.clearHistory}
          />
        </div>
      ) : contentView === "activity" && showRecentActivity ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <ActivityTimeline
            items={search.activity}
            compact={compact}
            interactive={activityInteractive}
            onItemOpen={onActivityClick}
          />
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-6 text-center">
          <div>
            <SearchIcon className="mx-auto size-6 text-muted-foreground/55" />
            <p className="mt-2 text-sm font-medium">输入问题开始搜索</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              回答只会使用经过相关性重排的证据，并保留可点击引用。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
