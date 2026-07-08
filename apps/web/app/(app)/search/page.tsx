"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clock, FileText, MessageSquare, Search as SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { ActivityItem, Section, Source } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useDetailPanel } from "@/components/features/detail-panel";
import { DocStatusBadge } from "@/components/features/status-badge";
import { EmptyState } from "@/components/features/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const ALL = "__all__";

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
                  className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50 ${i > 0 ? "border-t" : ""}`}
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
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 ${i > 0 ? "border-t" : ""}`}
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
          className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${i > 0 ? "border-t" : ""}`}
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

export default function SearchPage() {
  const params = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<string>(params.get("source") ?? ALL);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [results, setResults] = React.useState<Section[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [activity, setActivity] = React.useState<ActivityItem[] | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api.listSources().then(setSources).catch(() => {});
    api.getActivity().then(setActivity).catch(() => setActivity([]));
    inputRef.current?.focus();
  }, []);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const r = await api.globalSearch({
        query: q,
        source_ids: scope === ALL ? undefined : [scope],
        top_k: 12,
      });
      setResults(r.sections);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "检索失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <form onSubmit={run} className="flex flex-col gap-2">
        <div className="relative">
          {busy ? (
            <Spinner className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          ) : (
            <SearchIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) setResults(null);
            }}
            placeholder="搜索你的知识库…  Enter 检索"
            className="h-12 rounded-lg pl-10 pr-36 text-base shadow-soft"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="h-9 w-32 border-0 bg-muted/50 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ALL}>全部信源</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </form>

      {results !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-medium">检索结果</h2>
            <span className="text-xs text-muted-foreground">召回 {results.length} 条 · 点击查看原文</span>
          </div>
          <ResultList results={results} />
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
