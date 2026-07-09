"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { ArrowUp, AtSign, Check, Copy, FileUp, ImagePlus, Paperclip, RotateCcw, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { AskHandlers } from "@/lib/sse";
import type { Citation } from "@/lib/types";
import { api } from "@/lib/api";
import type { Source } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { chatLive } from "@/lib/chat-live";
import { useApp } from "@/components/features/app-shell";
import { CitationBlock } from "@/components/features/chat/citation-block";
import { PromptPreview } from "@/components/features/chat/prompt-preview";
import { AuthImage } from "@/components/features/auth-image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MarkdownContent = dynamic(
  () => import("@/components/features/markdown-content").then((m) => m.MarkdownContent),
  { loading: () => null, ssr: false },
);

export interface ConvMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  attachments?: { id?: string; url?: string }[];
  created_at?: string;
  author?: string | null;
  promptPreview?: string;
}

type Streamer = (
  threadId: string,
  query: string,
  handlers: AskHandlers,
  signal: AbortSignal,
  attachments?: string[],
  sourceIds?: string[],
) => Promise<void>;

function MessageActions({
  content,
  createdAt,
  onRetry,
  onDelete,
}: {
  content: string;
  createdAt?: string;
  onRetry?: () => void;
  onDelete?: () => void;
}) {
  const [done, setDone] = React.useState(false);
  const btn =
    "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
      <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(content);
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            } catch {
              toast.error("复制失败");
            }
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="复制回答"
        >
          {done ? <Check className="size-3" /> : <Copy className="size-3" />}
          {done ? "已复制" : "复制"}
        </button>
        {onRetry && (
          <button type="button" onClick={onRetry} className={btn} aria-label="重新回答">
            <RotateCcw className="size-3" />
            重试
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className={btn + " hover:text-destructive"}
            aria-label="删除消息"
          >
            <Trash2 className="size-3" />
            删除
          </button>
        )}
        {createdAt && (
          <span className="px-1.5 text-[11px] tabular-nums text-muted-foreground/70">
            {relativeTime(createdAt)}
          </span>
        )}
      </div>
    );
}

const MessageItem = React.memo(
  function MessageItem({
    message,
    streaming,
    toolNote,
    avatar,
    onRetry,
    onDelete,
  }: {
    message: ConvMessage;
    streaming?: boolean;
    toolNote?: string | null;
    avatar: React.ReactNode;
    onRetry?: () => void;
    onDelete?: () => void;
  }) {
    if (message.role === "user") {
      return (
        <div className="flex flex-col items-end gap-1.5">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
              {message.attachments.map((a, i) => (
                <AuthImage
                  key={a.id ?? a.url ?? i}
                  id={a.id}
                  url={a.url}
                  className="max-h-40 max-w-56 rounded-lg border object-cover shadow-soft"
                />
              ))}
            </div>
          )}
          {message.content && (
            <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
              {message.content}
            </div>
          )}
        </div>
      );
    }
    const thinking = streaming && !message.content;
    return (
      <div className="group/msg flex gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          {thinking ? (
            <div className="flex items-center gap-1.5 py-1 text-sm">
              <span className="size-1.5 animate-blink rounded-full bg-primary" />
              <span className="text-shimmer">
                {toolNote ? `正在调用 ${toolNote}…` : "检索并生成中…"}
              </span>
            </div>
          ) : streaming ? (
            <div className="answer-prose whitespace-pre-wrap text-foreground">
              {message.content}
              <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-primary align-middle" />
            </div>
          ) : (
            <MarkdownContent content={message.content} />
          )}
          {!streaming && message.content && (
            <MessageActions
              content={message.content}
              createdAt={message.created_at}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          )}
          {!streaming && <CitationBlock citations={message.citations} />}
          {!streaming && message.promptPreview && <PromptPreview preview={message.promptPreview} />}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message && prev.streaming === next.streaming && prev.avatar === next.avatar,
);

/**
 * 统一对话视图：信源问答与Agent对话共用。
 * 承载流式（rAF 批量刷新 token）、竞态防护（loadGeneration）、结束后强制回读的完整状态机。
 * `avatarNode` / `heroNode` 应在调用方 useMemo 保持稳定，以维持消息列表的 memo 优化。
 */
export function ConversationView({
  conversationKey,
  threadId,
  listMessages,
  deleteMessage,
  stream,
  ensureThread,
  onActivity,
  avatarNode,
  heroNode,
  emptyTitle,
  emptyHint,
  suggestions,
  placeholder = "输入你的问题，Enter 发送 · Shift+Enter 换行",
}: {
  conversationKey: string;
  threadId: string | null;
  listMessages: (threadId: string) => Promise<ConvMessage[]>;
  deleteMessage?: (threadId: string, messageId: string) => Promise<unknown>;
  stream: Streamer;
  ensureThread: () => Promise<string>;
  onActivity?: () => void;
  avatarNode: React.ReactNode;
  heroNode: React.ReactNode;
  emptyTitle: string;
  emptyHint: string;
  /** 空态建议提问：点击即发送 */
  suggestions?: string[];
  placeholder?: string;
}) {
  const { capabilities } = useApp();
  const [messages, setMessages] = React.useState<ConvMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [images, setImages] = React.useState<{ file: File; url: string }[]>([]);
  const [scoped, setScoped] = React.useState<{ id: string; name: string }[]>([]);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const docRef = React.useRef<HTMLInputElement>(null);
  const { capabilities: caps } = useApp();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [toolNote, setToolNote] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const streamingId = React.useRef<string | null>(null);
  const activeThreadRef = React.useRef<string | null | undefined>(undefined);
  const streamingRef = React.useRef(false);
  const loadGeneration = React.useRef(0);
  const pendingTokens = React.useRef("");
  const rafId = React.useRef<number | null>(null);
  const lastScrollAt = React.useRef(0);

  const loadMessages = React.useCallback(
    (tid: string, opts?: { force?: boolean }) => {
      const gen = ++loadGeneration.current;
      return listMessages(tid)
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
    [listMessages],
  );

  React.useEffect(() => {
    if (threadId === activeThreadRef.current) return;
    activeThreadRef.current = threadId;
    if (!threadId) {
      setMessages([]);
      return;
    }
    if (streamingRef.current) return;
    const live = chatLive.get();
    if (live.streaming && live.threadId === threadId) {
      // 采纳进行中的流：种入已缓冲内容，订阅后续 token 直至结束
      const botId = `live-${live.session}`;
      streamingId.current = botId;
      streamingRef.current = true;
      setStreaming(true);
      loadGeneration.current++;
      listMessages(threadId)
        .then((msgs) => {
          setMessages([
            ...msgs,
            {
              id: botId,
              role: "assistant",
              content: chatLive.get().content,
              citations: (chatLive.get().citations as ConvMessage["citations"]) ?? [],
            },
          ]);
        })
        .catch(() => {});
      let disposed = false;
      const unsub = chatLive.subscribe(() => {
        const cur = chatLive.get();
        if (cur.session !== live.session) return;
        setMessages((list) =>
          list.map((x) =>
            x.id === botId
              ? {
                  ...x,
                  content: cur.content,
                  citations: (cur.citations as ConvMessage["citations"]) ?? x.citations,
                }
              : x,
          ),
        );
        if (!cur.streaming) {
          unsub();
          if (disposed) return;
          streamingRef.current = false;
          streamingId.current = null;
          setStreaming(false);
          loadGeneration.current++;
          loadMessages(threadId, { force: true });
        }
      });
      // 中途再次离开：解除订阅并复位流式标记，避免泄漏与陈旧闭包
      return () => {
        disposed = true;
        unsub();
        streamingRef.current = false;
      };
    }
    loadMessages(threadId);
  }, [conversationKey, threadId, loadMessages, listMessages]);

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
    setMessages((list) => list.map((x) => (x.id === botId ? { ...x, content: x.content + chunk } : x)));
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

  React.useEffect(() => {
    api.listSources().then(setSources).catch(() => {});
  }, []);

  // 上下文用量估算（历史+输入，≈4 字符/词元）
  const ctxTokens = React.useMemo(() => {
    const chars =
      messages.reduce((a, m) => a + (m.content?.length ?? 0), 0) + input.length;
    return Math.round(chars / 4);
  }, [messages, input]);

  async function addDocToKnowledge(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      let src = sources.find((s) => s.name === "对话上传");
      if (!src) {
        src = await api.createSource({ name: "对话上传", description: "对话输入框上传的文档" });
        setSources((p) => [...p, src!]);
      }
      await api.uploadDocument(src.id, f);
      setScoped((p) => (p.some((x) => x.id === src!.id) ? p : [...p, { id: src!.id, name: src!.name }]));
      toast.success(`已入知识库「对话上传」，处理完成后可针对提问`);
    } catch {
      toast.error("文档上传失败");
    }
  }

  const MAX_IMAGES = 4;
  function addImages(files: FileList | File[] | null) {
    if (!files) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) return;
    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      const accepted = incoming.slice(0, Math.max(0, room));
      if (incoming.length > room) toast.error(`最多 ${MAX_IMAGES} 张图片`);
      const oversize = accepted.filter((f) => f.size > 10 * 1024 * 1024);
      if (oversize.length) toast.error("图片过大（上限 10MB）");
      return [
        ...prev,
        ...accepted
          .filter((f) => f.size <= 10 * 1024 * 1024)
          .map((f) => ({ file: f, url: URL.createObjectURL(f) })),
      ];
    });
  }
  function removeImage(url: string) {
    setImages((prev) => {
      URL.revokeObjectURL(url);
      return prev.filter((i) => i.url !== url);
    });
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    const pending = images;
    if ((!q && pending.length === 0) || streaming) return;
    if (!capabilities?.llm_configured) {
      toast.error("尚未配置模型，无法问答。请前往设置。");
      return;
    }
    setInput("");
    setImages([]);

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

    // 先上传附件（失败即中止本次发送，恢复输入与图片）
    let attachmentIds: string[] = [];
    if (pending.length) {
      try {
        const uploaded = await Promise.all(pending.map((i) => api.uploadAttachment(i.file)));
        attachmentIds = uploaded.map((u) => u.id);
      } catch {
        toast.error("图片上传失败，请重试");
        setImages(pending);
        setInput(q);
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
        role: "user",
        content: q,
        citations: [],
        attachments: pending.map((i) => ({ url: i.url })),
      },
      { id: botId, role: "assistant", content: "", citations: [] },
    ]);

    setStreaming(true);
    chatLive.start(tid);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (fn: (m: ConvMessage) => ConvMessage) =>
      setMessages((list) => list.map((x) => (x.id === botId ? fn(x) : x)));

    try {
      await stream(
        tid,
        q,
        {
          onMeta: (citations, promptPreview) => {
            chatLive.meta(citations);
            patch((x) => ({ ...x, citations, promptPreview }));
          },
          onTool: (name) => setToolNote(name),
          onToken: (t) => {
            setToolNote(null);
            chatLive.token(t);
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
        attachmentIds.length ? attachmentIds : undefined,
        scoped.length ? scoped.map((s) => s.id) : undefined,
      );
    } catch {
      /* aborted or network */
    } finally {
      flushTokens(botId);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      chatLive.end();
      setStreaming(false);
      setToolNote(null);
      abortRef.current = null;
      streamingId.current = null;
      streamingRef.current = false;
      loadGeneration.current++;
      await loadMessages(tid, { force: true });
    }
  }

  function stop() {
    chatLive.end();
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              {heroNode}
              <div className="font-display text-xl text-foreground">{emptyTitle}</div>
              <p className="max-w-sm text-sm text-muted-foreground">{emptyHint}</p>
              {suggestions && suggestions.length > 0 && (
                <div className="mt-3 flex max-w-md flex-wrap justify-center gap-2">
                  {suggestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => send(q)}
                      className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-soft outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((m, idx) => (
              <MessageItem
                key={m.id}
                message={m}
                avatar={avatarNode}
                streaming={streaming && m.id === streamingId.current}
                toolNote={m.id === streamingId.current ? toolNote : null}
                onRetry={
                  m.role === "assistant" && !streaming
                    ? () => {
                        const prev = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
                        if (prev?.content) send(prev.content);
                      }
                    : undefined
                }
                onDelete={
                  m.role === "assistant" &&
                  !streaming &&
                  deleteMessage &&
                  threadId &&
                  !m.id.startsWith("local-")
                    ? async () => {
                        try {
                          await deleteMessage(threadId, m.id);
                          loadGeneration.current++;
                          await loadMessages(threadId, { force: true });
                        } catch {
                          toast.error("删除失败");
                        }
                      }
                    : undefined
                }
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t bg-background px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-xl border bg-card p-2 shadow-soft transition-shadow focus-within:border-foreground/20 focus-within:shadow-lift">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              {images.map((img) => (
                <div key={img.url} className="group/thumb relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.file.name}
                    className="size-14 rounded-md border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(img.url)}
                    aria-label="移除图片"
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-soft transition-opacity hover:text-destructive group-hover/thumb:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {scoped.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {scoped.map((sc) => (
                <span
                  key={sc.id}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[11px]"
                >
                  <AtSign className="size-3" />
                  {sc.name}
                  <button
                    type="button"
                    aria-label="移除范围"
                    onClick={() => setScoped((p) => p.filter((x) => x.id !== sc.id))}
                    className="hover:text-destructive"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative flex items-end gap-2">
          {mentionOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-64 overflow-y-auto rounded-lg border bg-card p-1 shadow-lift">
              <p className="px-2 py-1 text-[11px] text-muted-foreground">@ 知识库范围（可多选）</p>
              {sources.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">还没有信源</p>
              )}
              {sources.map((src) => {
                const on = scoped.some((x) => x.id === src.id);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => {
                      setScoped((p) =>
                        on ? p.filter((x) => x.id !== src.id) : [...p, { id: src.id, name: src.name }],
                      );
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                      on && "bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{src.name}</span>
                    {on && <Check className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              addImages(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={docRef}
            type="file"
            accept=".pdf,.md,.markdown,.txt,.docx,.html,.epub"
            className="hidden"
            onChange={(e) => {
              addDocToKnowledge(e.target.files);
              e.target.value = "";
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={streaming} aria-label="添加附件" title="添加附件">
                <Paperclip className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem
                disabled={images.length >= MAX_IMAGES}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="size-4" />
                图片（可直接粘贴）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => docRef.current?.click()}>
                <FileUp className="size-4" />
                文档 → 入知识库
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMentionOpen((v) => !v)}
            disabled={streaming}
            aria-label="限定知识库范围"
            title="@ 知识库范围"
            className={cn(scoped.length > 0 && "text-primary")}
          >
            <AtSign className="size-4" />
          </Button>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "@" ) setMentionOpen(true);
              if (e.key === "Escape") setMentionOpen(false);
              onKeyDown(e);
            }}
            onPaste={(e) => {
              if (e.clipboardData?.files?.length) {
                e.preventDefault();
                addImages(e.clipboardData.files);
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="mb-1 hidden items-center gap-2 pr-1 text-[11px] tabular-nums text-muted-foreground sm:flex">
            <span title="上下文用量估算">≈{ctxTokens >= 1000 ? (ctxTokens / 1000).toFixed(1) + "k" : ctxTokens} tok</span>
            <a
              href="/settings"
              className="max-w-32 truncate rounded-full border bg-muted/50 px-2 py-0.5 font-mono transition-colors hover:bg-muted"
              title="当前模型（点击去设置）"
            >
              {caps?.llm_model ?? "未配置"}
            </a>
          </span>
          {streaming ? (
            <Button variant="outline" size="icon" onClick={stop} title="停止">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => send()}
              disabled={!input.trim() && images.length === 0}
              title="发送"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
