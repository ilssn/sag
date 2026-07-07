"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { ArrowUp, Quote, Square } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { streamAsk } from "@/lib/sse";
import type { Citation, Message } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";

const MarkdownContent = dynamic(
  () => import("@/components/features/markdown-content").then((m) => m.MarkdownContent),
  {
    loading: () => null,
    ssr: false,
  },
);

const CitationBlock = React.memo(function CitationBlock({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = React.useState(false);
  if (!citations || citations.length === 0) return null;
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
            <div
              key={c.n}
              className="flex gap-2.5 rounded-md border border-hairline bg-surface-2/50 p-2.5 text-xs"
            >
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
});

const MessageItem = React.memo(
  function MessageItem({ message, streaming }: { message: Message; streaming?: boolean }) {
    const isUser = message.role === "user";
    if (isUser) {
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-ink px-4 py-2.5 text-sm text-paper">
            {message.content}
          </div>
        </div>
      );
    }
    const thinking = streaming && !message.content;
    return (
      <div className="flex gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] bg-gold text-[12px] font-bold text-[#1b1a17]">
          m
        </span>
        <div className="min-w-0 flex-1">
          {thinking ? (
            <div className="flex items-center gap-1.5 py-1 text-sm text-ink-faint">
              <span className="size-1.5 animate-blink rounded-full bg-gold" />
              检索并生成中…
            </div>
          ) : streaming ? (
            <div className="answer-prose whitespace-pre-wrap text-ink">
              {message.content}
              <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-gold align-middle" />
            </div>
          ) : (
            <MarkdownContent content={message.content} />
          )}
          {!streaming && <CitationBlock citations={message.citations} />}
        </div>
      </div>
    );
  },
  (prev, next) => prev.message === next.message && prev.streaming === next.streaming,
);

export function ChatPanel({
  sourceId,
  sourceName,
  threadId,
  ensureThread,
  onActivity,
}: {
  sourceId: string;
  sourceName: string;
  threadId: string | null;
  ensureThread: () => Promise<string>;
  onActivity?: () => void;
}) {
  const { capabilities } = useApp();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const streamingId = React.useRef<string | null>(null);
  const activeThreadRef = React.useRef<string | null | undefined>(undefined);
  const streamingRef = React.useRef(false);
  const loadGeneration = React.useRef(0);
  const pendingTokens = React.useRef("");
  const rafId = React.useRef<number | null>(null);

  const loadMessages = React.useCallback(
    (tid: string, opts?: { force?: boolean }) => {
      const gen = ++loadGeneration.current;
      return api
        .listMessages(sourceId, tid)
        .then((msgs) => {
          if (gen !== loadGeneration.current) return;
          if (streamingRef.current && !opts?.force) return;
          setMessages(msgs);
        })
        .catch(() => {
          if (gen !== loadGeneration.current) return;
          if (streamingRef.current && !opts?.force) return;
          setMessages([]);
        });
    },
    [sourceId],
  );

  React.useEffect(() => {
    if (threadId === activeThreadRef.current) return;
    activeThreadRef.current = threadId;
    if (!threadId) {
      setMessages([]);
      return;
    }
    if (streamingRef.current) return;
    loadMessages(threadId);
  }, [sourceId, threadId, loadMessages]);

  const lastScrollAt = React.useRef(0);

  React.useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const now = Date.now();
    if (streaming && now - lastScrollAt.current < 120) return;
    lastScrollAt.current = now;
    el.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, streaming]);

  const flushTokens = React.useCallback((botId: string) => {
    const chunk = pendingTokens.current;
    if (!chunk) return;
    pendingTokens.current = "";
    setMessages((list) =>
      list.map((x) => (x.id === botId ? { ...x, content: x.content + chunk } : x)),
    );
  }, []);

  const scheduleTokenFlush = React.useCallback(
    (botId: string) => {
      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        flushTokens(botId);
      });
    },
    [flushTokens],
  );

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
      loadGeneration.current++;
      try {
        tid = await ensureThread();
        activeThreadRef.current = tid;
        loadGeneration.current++;
      } catch {
        toast.error("创建会话失败");
        return;
      }
    }

    const now = Date.now();
    const botId = `local-a-${now}`;
    streamingId.current = botId;
    streamingRef.current = true;
    pendingTokens.current = "";

    setMessages((m) => [
      ...m,
      {
        id: `local-u-${now}`,
        thread_id: tid!,
        role: "user",
        content: q,
        citations: [],
        created_at: new Date().toISOString(),
      },
      {
        id: botId,
        thread_id: tid!,
        role: "assistant",
        content: "",
        citations: [],
        created_at: new Date().toISOString(),
      },
    ]);

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (fn: (m: Message) => Message) =>
      setMessages((list) => list.map((x) => (x.id === botId ? fn(x) : x)));

    try {
      await streamAsk(
        sourceId,
        tid,
        { query: q },
        {
          onMeta: (citations) => patch((x) => ({ ...x, citations })),
          onToken: (t) => {
            pendingTokens.current += t;
            scheduleTokenFlush(botId);
          },
          onError: (msg) => {
            flushTokens(botId);
            toast.error(msg);
            patch((x) => ({ ...x, content: x.content || `⚠︎ ${msg}` }));
          },
          onDone: () => onActivity?.(),
        },
        ctrl.signal,
      );
    } catch {
      /* aborted or network */
    } finally {
      flushTokens(botId);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      setStreaming(false);
      abortRef.current = null;
      streamingId.current = null;
      streamingRef.current = false;
      loadGeneration.current++;
      await loadMessages(tid, { force: true });
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
    streamingRef.current = false;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center">
              <span className="grid size-10 place-items-center rounded-[10px] bg-gold text-lg font-bold text-[#1b1a17]">
                m
              </span>
              <div className="font-display text-xl text-ink">就「{sourceName}」提问</div>
              <p className="max-w-sm text-sm text-ink-muted">
                muse 会在该信源中检索相关段落，并据此生成带引用的回答。
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <MessageItem key={m.id} message={m} streaming={streaming && m.id === streamingId.current} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-hairline bg-paper px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-hairline bg-surface p-2 shadow-soft focus-within:border-gold/50">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="输入你的问题，Enter 发送 · Shift+Enter 换行"
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          {streaming ? (
            <Button variant="outline" size="icon" onClick={stop} title="停止">
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
