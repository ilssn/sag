"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Link2, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Soul, SoulThread } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BindingDialog } from "@/components/features/soul/binding-dialog";
import { PersonaDialog } from "@/components/features/soul/persona-dialog";
import { SoulChat } from "@/components/features/soul/soul-chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function SoulWorkbench() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [soul, setSoul] = React.useState<Soul | null>(null);
  const [threads, setThreads] = React.useState<SoulThread[]>([]);
  const [threadId, setThreadId] = React.useState<string | null>(null);

  const loadSoul = React.useCallback(async () => {
    try {
      setSoul(await api.getSoul(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) router.replace("/souls");
    }
  }, [id, router]);

  const loadThreads = React.useCallback(() => {
    api.listSoulThreads(id).then(setThreads).catch(() => {});
  }, [id]);

  React.useEffect(() => {
    loadSoul();
    loadThreads();
  }, [loadSoul, loadThreads]);

  const ensureThread = async () => {
    const t = await api.createSoulThread(id);
    setThreads((p) => [t, ...p]);
    setThreadId(t.id);
    return t.id;
  };

  const deleteThread = async (tid: string) => {
    try {
      await api.deleteSoulThread(id, tid);
      setThreads((p) => p.filter((t) => t.id !== tid));
      if (threadId === tid) setThreadId(null);
    } catch {
      /* ignore */
    }
  };

  const deleteSoul = async () => {
    if (!window.confirm("确定删除该灵魂？其会话将一并删除。")) return;
    try {
      await api.deleteSoul(id);
      toast.success("灵魂已删除");
      router.push("/souls");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-hairline bg-surface/40 lg:flex">
        <div className="border-b border-hairline p-3">
          <Link href="/souls" className="mb-2 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink-muted">
            <ArrowLeft className="size-3.5" />
            全部灵魂
          </Link>
          {soul ? (
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-soft font-display text-base font-semibold text-gold-strong">
                {soul.avatar || soul.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-lg font-medium text-ink">{soul.name}</div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-9 w-40" />
          )}
          {soul && (
            <div className="mt-3 flex items-center gap-1.5">
              <PersonaDialog
                soul={soul}
                onSaved={setSoul}
                trigger={
                  <Button variant="outline" size="sm" className="flex-1">
                    <SlidersHorizontal className="size-3.5" />
                    人格
                  </Button>
                }
              />
              <BindingDialog
                soulId={id}
                onChanged={loadSoul}
                trigger={
                  <Button variant="outline" size="sm" className="flex-1">
                    <Link2 className="size-3.5" />
                    绑定
                  </Button>
                }
              />
              <Button variant="ghost" size="icon" title="删除灵魂" onClick={deleteSoul} className="text-ink-muted hover:text-danger">
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="p-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => setThreadId(null)}>
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
        {soul && (
          <SoulChat
            key={soul.id}
            soulId={soul.id}
            soulName={soul.name}
            avatar={soul.avatar}
            greeting={soul.persona?.greeting}
            threadId={threadId}
            ensureThread={ensureThread}
            onActivity={loadThreads}
          />
        )}
      </div>
    </div>
  );
}
