"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { ArrowUp, Quote, Square } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { streamSoulAsk } from "@/lib/sse";
import type { Citation, SoulMessage } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";

const MarkdownContent = dynamic(
  () => import("@/components/features/markdown-content").then((m) => m.MarkdownContent),
  { ssr: false, loading: () => null },
);

function Citations({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = React.useState(false);
  if (!citations?.length) return null;
  return (
    <div className="mt-3 border-t border-hairline pt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-gold-strong"
      >
        <Quote className="size-3.5" />
        来源 · {citations.length}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {citations.map((c) => (
            <div key={c.n} className="flex gap-2.5 rounded-md border border-hairline bg-surface-2/50 p-2.5 text-xs">
              <span className="grid size-5 shrink-0 place-items-center rounded bg-gold-soft font-mono text-[11px] font-semibold text-gold-strong">
                {c.n}
              </span>
              <div className="min-w-0">
                {c.heading && <div className="font-medium text-ink">{c.heading}</div>}
                <div className="mt-0.5 line-clamp-3 text-ink-muted">{c.snippet}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SoulChat({
  soulId,
  soulName,
  avatar,
  greeting,
  threadId,
  ensureThread,
  onActivity,
}: {
  soulId: string;
  soulName: string;
  avatar: string;
  greeting?: string;
  threadId: string | null;
  ensureThread: () => Promise<string>;
  onActivity?: () => void;
}) {
  const { capabilities } = useApp();
  const [messages, setMessages] = React.useState<SoulMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const streamingId = React.useRef<string | null>(null);
  const activeRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (threadId === activeRef.current) return;
    activeRef.current = threadId;
    if (!threadId) {
      setMessages([]);
      return;
    }
    api.listSoulMessages(soulId, threadId).then(setMessages).catch(() => setMessages([]));
  }, [soulId, threadId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    if (!capabilities?.llm_configured) {
      toast.error("尚未配置模型，无法问答。请前往设置。");
      return;
    }
    setInput("");
    let tid = threadId;
    if (!tid) {
      try {
        tid = await ensureThread();
        activeRef.current = tid;
      } catch {
        toast.error("创建会话失败");
        return;
      }
    }
    const now = Date.now();
    const botId = `local-a-${now}`;
    streamingId.current = botId;
    setMessages((m) => [
      ...m,
      { id: `local-u-${now}`, thread_id: tid!, role: "user", content: q, author: null, citations: [], created_at: new Date().toISOString() },
      { id: botId, thread_id: tid!, role: "assistant", content: "", author: null, citations: [], created_at: new Date().toISOString() },
    ]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (fn: (m: SoulMessage) => SoulMessage) =>
      setMessages((list) => list.map((x) => (x.id === botId ? fn(x) : x)));
    try {
      await streamSoulAsk(
        soulId,
        tid,
        { query: q },
        {
          onMeta: (citations) => patch((x) => ({ ...x, citations })),
          onToken: (t) => patch((x) => ({ ...x, content: x.content + t })),
          onError: (msg) => {
            toast.error(msg);
            patch((x) => ({ ...x, content: x.content || `⚠︎ ${msg}` }));
          },
          onDone: () => onActivity?.(),
        },
        ctrl.signal,
      );
    } catch {
      /* aborted */
    } finally {
      setStreaming(false);
      abortRef.current = null;
      streamingId.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-gold-soft font-display text-xl font-semibold text-gold-strong">
                {avatar || soulName.slice(0, 1)}
              </span>
              <div className="font-display text-xl text-ink">{soulName}</div>
              <p className="max-w-sm text-sm text-ink-muted">{greeting || "开始对话吧。"}</p>
            </div>
          ) : (
            messages.map((m) => {
              const streamingThis = streaming && m.id === streamingId.current;
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-ink px-4 py-2.5 text-sm text-paper">
                      {m.content}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gold-soft text-[11px] font-semibold text-gold-strong">
                    {avatar || soulName.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {streamingThis && !m.content ? (
                      <div className="flex items-center gap-1.5 py-1 text-sm text-ink-faint">
                        <span className="size-1.5 animate-blink rounded-full bg-gold" />
                        检索并生成中…
                      </div>
                    ) : streamingThis ? (
                      <div className="answer-prose whitespace-pre-wrap text-ink">
                        {m.content}
                        <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-gold align-middle" />
                      </div>
                    ) : (
                      <MarkdownContent content={m.content} />
                    )}
                    {!streamingThis && <Citations citations={m.citations} />}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-hairline bg-paper/80 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-hairline bg-surface p-2 shadow-soft focus-within:border-gold/50">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={`对 ${soulName} 说点什么…  Enter 发送 · Shift+Enter 换行`}
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          {streaming ? (
            <Button variant="outline" size="icon" onClick={() => abortRef.current?.abort()} title="停止">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button variant="gold" size="icon" onClick={send} disabled={!input.trim()} title="发送">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
