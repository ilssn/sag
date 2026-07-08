"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Link2, Plus, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Binding, Agent, Thread } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BindingDialog } from "@/components/features/agent/binding-dialog";
import { PersonaDialog } from "@/components/features/agent/persona-dialog";
import { AgentChat } from "@/components/features/agent/agent-chat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentWorkbench() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [threadId, setThreadId] = React.useState<string | null>(null);

  const loadAgent = React.useCallback(async () => {
    try {
      setAgent(await api.getAgent(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) router.replace("/assistants");
    }
  }, [id, router]);

  const loadThreads = React.useCallback(() => {
    api.listThreads(id).then(setThreads).catch(() => {});
  }, [id]);

  const [bindings, setBindings] = React.useState<Binding[] | null>(null);
  const loadBindings = React.useCallback(() => {
    api.listBindings(id).then(setBindings).catch(() => {});
  }, [id]);

  React.useEffect(() => {
    loadAgent();
    loadThreads();
    loadBindings();
  }, [loadAgent, loadThreads, loadBindings]);

  const ensureThread = async () => {
    const t = await api.createThread(id);
    setThreads((p) => [t, ...p]);
    setThreadId(t.id);
    return t.id;
  };

  const deleteThread = async (tid: string) => {
    try {
      await api.deleteThread(id, tid);
      setThreads((p) => p.filter((t) => t.id !== tid));
      if (threadId === tid) setThreadId(null);
    } catch {
      /* ignore */
    }
  };

  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const deleteAgent = async () => {
    try {
      await api.deleteAgent(id);
      toast.success("助手已删除");
      router.push("/assistants");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-card/40 lg:flex">
        <div className="border-b p-3">
          <Link href="/assistants" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground">
            <ArrowLeft className="size-3.5" />
            全部助手
          </Link>
          {agent ? (
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-display text-base font-semibold text-foreground">
                {agent.avatar || agent.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-lg font-medium text-foreground">{agent.name}</div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-9 w-40" />
          )}
          {agent && (
            <div className="mt-3 flex items-center gap-1.5">
              <PersonaDialog
                agent={agent}
                onSaved={setAgent}
                trigger={
                  <Button variant="outline" size="sm" className="flex-1">
                    <SlidersHorizontal className="size-3.5" />
                    设定
                  </Button>
                }
              />
              <BindingDialog
                agentId={id}
                onChanged={() => {
                  loadAgent();
                  loadBindings();
                }}
                trigger={
                  <Button variant="outline" size="sm" className="flex-1">
                    <Link2 className="size-3.5" />
                    绑定
                  </Button>
                }
              />
              <Button
                variant="ghost"
                size="icon"
                title="删除助手"
                onClick={() => setConfirmDelete(true)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title="删除助手"
                description={`「${agent?.name ?? ""}」的设定、绑定与全部会话将被删除。此操作无法撤销。`}
                confirmLabel="删除助手"
                onConfirm={deleteAgent}
              />
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
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => setThreadId(t.id)}>
                  <div className="truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{relativeTime(t.updated_at)}</div>
                </button>
                <button
                  onClick={() => deleteThread(t.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  title="删除会话"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 零绑定引导：没有依据的回答只会说「资料中未提及」 */}
        {agent && bindings !== null && bindings.filter((b) => b.target_type === "source").length === 0 && (
          <Alert className="flex flex-wrap items-center gap-2.5 rounded-none border-x-0 border-t-0 [&>svg]:static [&>svg]:translate-y-0 [&>svg~*]:pl-0">
            <TriangleAlert className="size-4 shrink-0" />
            <AlertDescription className="min-w-0 flex-1">
              「{agent.name}」尚未绑定信源——回答将没有依据。
            </AlertDescription>
            <BindingDialog
              agentId={id}
              onChanged={() => {
                loadAgent();
                loadBindings();
              }}
              trigger={
                <Button size="sm">
                  <Link2 />
                  绑定信源
                </Button>
              }
            />
          </Alert>
        )}
        <div className="min-h-0 flex-1">
          {agent && (
            <AgentChat
              key={agent.id}
              agentId={agent.id}
              agentName={agent.name}
              avatar={agent.avatar}
              greeting={agent.persona?.greeting}
              threadId={threadId}
              ensureThread={ensureThread}
              onActivity={loadThreads}
            />
          )}
        </div>
      </div>
    </div>
  );
}
