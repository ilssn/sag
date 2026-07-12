"use client";

import * as React from "react";
import { Archive, ArchiveRestore, ChevronDown, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useApp } from "@/components/features/app-shell";
import { SettingsSection } from "@/components/features/settings-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { ARCHIVED_THREADS_PAGE_SIZE } from "@/lib/settings-config";
import type { Thread } from "@/lib/types";

/** 归档会话 —— 最近优先、按页加载，并支持恢复或彻底删除。 */
export function ArchivedThreadsCard() {
  const { agent, refreshThreads, timezone } = useApp();
  const [rows, setRows] = React.useState<Thread[]>([]);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Thread | null>(null);

  const loadPage = React.useCallback(
    async (offset: number, append: boolean) => {
      if (!agent) return;
      if (append) setLoadingMore(true);
      else setInitialLoading(true);
      setLoadError(null);

      try {
        const page = await api.listThreads(agent.id, {
          archived: true,
          limit: ARCHIVED_THREADS_PAGE_SIZE + 1,
          offset,
        });
        const visible = page.slice(0, ARCHIVED_THREADS_PAGE_SIZE);
        setHasMore(page.length > ARCHIVED_THREADS_PAGE_SIZE);
        setRows((current) => {
          if (!append) return visible;
          const knownIds = new Set(current.map((thread) => thread.id));
          return [...current, ...visible.filter((thread) => !knownIds.has(thread.id))];
        });
      } catch (error) {
        setLoadError(error instanceof ApiError ? error.message : "无法加载归档会话");
      } finally {
        if (append) setLoadingMore(false);
        else setInitialLoading(false);
      }
    },
    [agent],
  );

  React.useEffect(() => {
    setRows([]);
    setHasMore(false);
    setLoadError(null);
    void loadPage(0, false);
  }, [loadPage]);

  if (!agent) return null;
  const agentId = agent.id;

  async function restore(thread: Thread) {
    setRestoringId(thread.id);
    try {
      await api.updateThread(agentId, thread.id, { archived: false });
      setRows((current) => current.filter((item) => item.id !== thread.id));
      await refreshThreads();
      toast.success("会话已恢复到侧栏");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "恢复失败");
    } finally {
      setRestoringId(null);
    }
  }

  async function remove(thread: Thread) {
    try {
      await api.deleteThread(agentId, thread.id);
      setRows((current) => current.filter((item) => item.id !== thread.id));
      toast.success("归档会话已彻底删除");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "删除失败");
      throw error;
    }
  }

  const footer = rows.length ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 text-xs text-muted-foreground">
        {loadError ? (
          <span className="text-destructive">{loadError}</span>
        ) : hasMore ? (
          `已显示最近 ${rows.length} 条`
        ) : (
          `共 ${rows.length} 条，已全部加载`
        )}
      </div>
      {hasMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loadingMore}
          onClick={() => void loadPage(rows.length, true)}
        >
          {loadingMore ? <Spinner /> : loadError ? <RotateCw /> : <ChevronDown />}
          {loadingMore ? "加载中…" : loadError ? "重试加载" : "加载更多"}
        </Button>
      )}
    </div>
  ) : undefined;

  return (
    <>
      <SettingsSection
        title="归档会话"
        description="最近归档的会话优先显示，可恢复或永久删除。"
        footer={footer}
      >
        {initialLoading ? (
          <ArchivedThreadsSkeleton />
        ) : loadError && rows.length === 0 ? (
          <div className="p-4 sm:p-5">
            <Alert variant="destructive">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{loadError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadPage(0, false)}
                >
                  <RotateCw />
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : rows.length === 0 ? (
          <Empty className="min-h-44 rounded-none p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Archive />
              </EmptyMedia>
              <EmptyTitle className="text-base">暂无归档会话</EmptyTitle>
              <EmptyDescription>从侧栏归档的会话会出现在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div>
            {rows.map((thread) => {
              const restoring = restoringId === thread.id;
              return (
                <div
                  key={thread.id}
                  className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:px-5"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Archive className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={thread.title}>
                      {thread.title}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {relativeTime(thread.updated_at, timezone)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={restoring}
                          onClick={() => void restore(thread)}
                          aria-label={`恢复 ${thread.title}`}
                          title="恢复会话"
                        >
                          {restoring ? <Spinner /> : <ArchiveRestore />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>恢复会话</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          disabled={restoring}
                          onClick={() => setDeleteTarget(thread)}
                          aria-label={`彻底删除 ${thread.title}`}
                          title="彻底删除"
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>彻底删除</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="彻底删除会话"
        description={`「${deleteTarget?.title ?? "此会话"}」及其消息会被永久删除，无法恢复。`}
        confirmLabel="彻底删除"
        onConfirm={() => (deleteTarget ? remove(deleteTarget) : undefined)}
      />
    </>
  );
}

function ArchivedThreadsSkeleton() {
  return (
    <div aria-label="正在加载归档会话">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:px-5"
        >
          <Skeleton className="size-8 shrink-0" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="size-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}
