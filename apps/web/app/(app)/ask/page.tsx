"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronsUpDown, Layers, Plus, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import type { Source, Thread } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/features/chat/chat-panel";
import { EmptyState } from "@/components/features/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

function AskInner() {
  const params = useSearchParams();
  const initialSource = params.get("source");
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [threadId, setThreadId] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .listSources()
      .then((s) => {
        setSources(s);
        setSourceId((prev) => {
          if (prev) return prev;
          if (initialSource && s.some((x) => x.id === initialSource)) return initialSource;
          return s[0]?.id ?? null;
        });
      })
      .catch(() => setSources([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!sourceId) {
      setThreads([]);
      return;
    }
    setThreadId(null);
    api.listThreads(sourceId).then(setThreads).catch(() => setThreads([]));
  }, [sourceId]);

  const source = sources?.find((s) => s.id === sourceId) ?? null;

  const ensureThread = async () => {
    const t = await api.createThread(sourceId!);
    setThreads((p) => [t, ...p]);
    setThreadId(t.id);
    return t.id;
  };

  const reloadThreads = () => {
    if (sourceId) api.listThreads(sourceId).then(setThreads).catch(() => {});
  };

  const deleteThread = async (id: string) => {
    try {
      await api.deleteThread(sourceId!, id);
      setThreads((p) => p.filter((t) => t.id !== id));
      if (threadId === id) setThreadId(null);
    } catch {
      /* ignore */
    }
  };

  if (sources === null) {
    return (
      <div className="flex h-full">
        <div className="w-72 border-r border-hairline p-4">
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="p-6 md:p-8">
        <EmptyState
          icon={Layers}
          title="先创建一个信源"
          description="问答需要一个已上传文档的信源作为知识来源。"
          action={
            <Button asChild variant="gold">
              <Link href="/sources">前往信源</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-hairline bg-surface/40 lg:flex">
        <div className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm transition-colors hover:border-ink-faint">
                <span className="truncate font-medium text-ink">{source?.name ?? "选择信源"}</span>
                <ChevronsUpDown className="size-4 shrink-0 text-ink-faint" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {sources.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => setSourceId(s.id)}>
                  <Layers className="size-4" />
                  <span className="truncate">{s.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" className="mt-2 w-full justify-start" onClick={() => setThreadId(null)}>
            <Plus className="size-4" />
            新会话
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {threads.map((t) => {
            const active = t.id === threadId;
            return (
              <div
                key={t.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active ? "bg-gold-soft text-gold-strong" : "text-ink-muted hover:bg-surface-2",
                )}
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => setThreadId(t.id)}>
                  <div className="truncate">{t.title}</div>
                  <div className="text-[11px] text-ink-faint">{relativeTime(t.updated_at)}</div>
                </button>
                <button
                  onClick={() => deleteThread(t.id)}
                  className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  title="删除会话"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {source && (
          <ChatPanel
            key={source.id}
            sourceId={source.id}
            sourceName={source.name}
            threadId={threadId}
            ensureThread={ensureThread}
            onActivity={reloadThreads}
          />
        )}
      </div>
    </div>
  );
}

export default function AskPage() {
  return (
    <React.Suspense fallback={<div className="p-8 text-sm text-ink-faint">载入中…</div>}>
      <AskInner />
    </React.Suspense>
  );
}
