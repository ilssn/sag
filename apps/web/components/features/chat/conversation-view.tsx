"use client";

import * as React from "react";
import { ArrowUp, Check, ChevronDown, ChevronRight, Copy, FileUp, ImagePlus, Library, Plus, RotateCcw, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { AgentEvent, AgentRunOutcome } from "@/lib/sse";
import type { Citation, MessageStep, Source } from "@/lib/types";
import { api } from "@/lib/api";
import { parsePetDraft, PET_DRAFT_EVENT, PET_DRAFT_KEY } from "@/lib/pet-events";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { chatLive, type LiveStep } from "@/lib/chat-live";
import { copyText } from "@/lib/clipboard";
import { useApp } from "@/components/features/app-shell";
import { useDetailPanel } from "@/components/features/detail-panel";
import { CitationBlock } from "@/components/features/chat/citation-block";
import { PromptPreview } from "@/components/features/chat/prompt-preview";
import { AuthImage } from "@/components/features/auth-image";
import { MarkdownContent } from "@/components/features/markdown-content";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STREAM_RENDER_INTERVAL_MS = 50;

export interface ConvMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  attachments?: { id?: string; url?: string }[];
  steps?: MessageStep[];
  created_at?: string;
  author?: string | null;
  promptPreview?: string;
}

type Streamer = (
  threadId: string,
  query: string,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
  attachments?: string[],
  sourceIds?: string[],
) => Promise<AgentRunOutcome>;

interface PendingToolApproval {
  runId: string;
  threadId: string;
  toolCallId: string;
  label: string;
  risk: string;
  arguments: unknown;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.max(ms, 1)}ms`;
}

const TOOL_LABEL: Record<string, string> = {
  search_context: "检索知识库",
  get_entity: "查询实体",
};

function toolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function citationsFromArtifacts(value: unknown): Citation[] {
  const citations = toolArguments(value).citations;
  if (!Array.isArray(citations)) return [];
  return citations.filter(
    (citation): citation is Citation =>
      Boolean(citation) &&
      typeof citation === "object" &&
      typeof (citation as Partial<Citation>).n === "number",
  );
}

function mergeCitations(current: Citation[], incoming: Citation[]): Citation[] {
  if (!incoming.length) return current;
  const byNumber = new Map(current.map((citation) => [citation.n, citation]));
  incoming.forEach((citation) => byNumber.set(citation.n, citation));
  return [...byNumber.values()].sort((a, b) => a.n - b.n);
}

function toolArgsPreview(value: unknown, limit = 60): string {
  const text = Object.entries(toolArguments(value))
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join("; ");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Agent 工作记录：只展示可观察的模型轮次、工具输入输出与耗时，不伪造思维链。 */
type TimelineStep = Omit<LiveStep, "status" | "startedAt"> & {
  status?: LiveStep["status"];
  startedAt?: number;
};

function ToolRunDetails({ step }: { step: TimelineStep }) {
  const panel = useDetailPanel();
  const details = step.details;
  const args = step.arguments ?? {};
  const entries = Object.entries(args);
  const sources = details?.sources?.filter((source) => source.name) ?? [];
  const matches = details?.matches ?? [];

  return (
    <div className="mb-2 ml-5 mt-1.5 max-w-2xl rounded-md border bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
      {(entries.length > 0 || sources.length > 0) && (
        <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1">
          {entries.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key === "query" ? "查询" : key === "name" ? "实体" : key}</dt>
              <dd className="break-words font-mono text-foreground/80">{String(value)}</dd>
            </React.Fragment>
          ))}
          {sources.length > 0 && (
            <>
              <dt>范围</dt>
              <dd className="break-words text-foreground/80">
                {sources.map((source) => source.name).join("、")}
              </dd>
            </>
          )}
        </dl>
      )}
      {matches.length > 0 && (
        <div
          className={cn(
            "space-y-1.5",
            (entries.length > 0 || sources.length > 0) && "mt-2 border-t pt-2",
          )}
        >
          <div className="font-medium text-foreground/70">命中内容</div>
          {matches.map((match, index) => {
            const traceable = Boolean(match.chunk_id && match.source_id);
            return (
              <button
                key={`${match.chunk_id ?? index}-${match.n ?? index}`}
                type="button"
                disabled={!traceable}
                onClick={() => {
                  if (!match.chunk_id || !match.source_id) return;
                  panel.open({
                    kind: "chunk",
                    sourceId: match.source_id,
                    chunkId: match.chunk_id,
                    heading: match.heading,
                    sourceName: match.source_name,
                  });
                }}
                className={cn(
                  "block w-full rounded px-2 py-1.5 text-left",
                  traceable && "transition-colors hover:bg-muted",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-foreground/85">
                  <span className="shrink-0 font-mono">[{match.n ?? index + 1}]</span>
                  <span className="truncate font-medium">{match.heading || "资料片段"}</span>
                  {typeof match.score === "number" && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                      {match.score.toFixed(3)}
                    </span>
                  )}
                </span>
                {match.snippet && <span className="mt-0.5 line-clamp-2 block">{match.snippet}</span>}
              </button>
            );
          })}
        </div>
      )}
      {details?.output_preview && (
        <div
          className={cn(
            "whitespace-pre-wrap break-words",
            (entries.length > 0 || sources.length > 0) && "mt-2 border-t pt-2",
          )}
        >
          {details.output_preview}
        </div>
      )}
    </div>
  );
}

function StepsTimeline({
  steps,
  now = Date.now(),
  collapsed: collapsedProp,
  onToggle: onToggleProp,
}: {
  steps: TimelineStep[];
  now?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [innerCollapsed, setInnerCollapsed] = React.useState(true);
  const [expandedTools, setExpandedTools] = React.useState<Set<string>>(() => new Set());
  const controlled = collapsedProp !== undefined;
  const collapsed = controlled ? collapsedProp! : innerCollapsed;
  const onToggle = controlled ? onToggleProp : () => setInnerCollapsed((v) => !v);
  const toolRuns = steps.filter((x) => x.kind === "tool");
  const failedRuns = toolRuns.filter((x) => x.status === "error");
  const active = steps.some((x) => x.status === "active");
  // 没有实际工具调用（纯思考）且已结束 → 不渲染，避免「已完成 0 次调用」噪音
  if (!active && toolRuns.length === 0) return null;
  const totalMs = steps.reduce(
    (a, x) => a + (x.ms ?? (x.status === "active" && x.startedAt ? now - x.startedAt : 0)),
    0,
  );
  const actionLabel = active
    ? "正在处理"
    : failedRuns.length
      ? `${failedRuns.length} 项操作未完成`
      : toolRuns.length === 1 && toolRuns[0].name === "search_context"
        ? "检索了知识库"
        : toolRuns.length === 1 && toolRuns[0].name === "get_entity"
          ? "查询了实体"
          : `完成了 ${toolRuns.length} 项工具操作`;

  return (
    <div className={cn(collapsed && !active ? "mb-2" : "mb-3", "text-[11px]")}>
      <button
        type="button"
        disabled={active}
        onClick={active ? undefined : onToggle}
        aria-expanded={active ? undefined : !collapsed}
        aria-label={active ? actionLabel : `${collapsed ? "展开" : "收起"}${actionLabel}`}
        className={cn(
          "inline-flex h-5 items-center gap-1 text-[10px] text-muted-foreground outline-none",
          !active &&
            "rounded transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-border",
        )}
      >
        {active ? (
          <Spinner className="size-2.5 shrink-0" />
        ) : failedRuns.length ? (
          <X className="size-2.5 shrink-0 text-destructive" />
        ) : (
          <Check className="size-2.5 shrink-0" />
        )}
        <span className="font-medium">{actionLabel}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{fmtMs(totalMs)}</span>
        {!active && (
          <ChevronDown
            className={cn(
              "size-2.5 shrink-0 transition-transform",
              !collapsed && "rotate-180",
            )}
          />
        )}
      </button>
      {!collapsed && (
        <div className="ml-1.5 mt-1 border-l pl-3">
        {steps.map((x, i) => {
          const isActive = x.status === "active";
          const isError = x.status === "error";
          const elapsed = x.ms ?? (isActive && x.startedAt ? now - x.startedAt : 0);
          const key = x.id ?? `${x.kind}-${x.step}-${i}`;
          const args =
            x.arguments?.query !== undefined
              ? String(x.arguments.query)
              : x.arguments?.name !== undefined
                ? String(x.arguments.name)
                : x.args || toolArgsPreview(x.arguments);
          const hasDetails =
            x.kind === "tool" &&
            (Boolean(x.arguments && Object.keys(x.arguments).length) ||
              Boolean(x.details?.matches?.length) ||
              Boolean(x.details?.sources?.length) ||
              Boolean(x.details?.output_preview));
          const expanded = expandedTools.has(key);
          return (
            <div key={key}>
              <button
                type="button"
                disabled={!hasDetails}
                onClick={() => {
                  if (!hasDetails) return;
                  setExpandedTools((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
                className={cn(
                  "flex w-full items-center gap-2 py-1 text-left outline-none",
                  hasDetails &&
                    "rounded transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {isActive ? (
                  <Spinner className="size-3 shrink-0 text-muted-foreground" />
                ) : isError ? (
                  <X className="size-3 shrink-0 text-destructive" />
                ) : (
                  <Check className="size-3 shrink-0 text-success" />
                )}
                {x.kind === "thinking" ? (
                  <span className={isActive ? "text-shimmer" : "text-muted-foreground"}>
                    {isActive ? "正在选择工具" : "选择工具"} · 第 {x.step} 轮 · {fmtMs(elapsed)}
                  </span>
                ) : x.kind === "answer" ? (
                  <span className={isActive ? "text-shimmer" : "text-muted-foreground"}>
                    {isActive ? "正在整理回答" : "整理回答"} · {fmtMs(elapsed)}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isActive
                        ? "text-shimmer"
                        : isError
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                    title={x.error}
                  >
                    {x.label || TOOL_LABEL[x.name ?? ""] || x.name}
                    {args ? `「${args}」` : ""}
                    {isError && x.error ? ` · ${x.error}` : ""}
                    {!isActive && (
                      <>
                        {" · "}
                        {x.name === "search_context" && typeof x.count === "number"
                          ? `检索到 ${x.count} 条 · `
                          : ""}
                        {fmtMs(elapsed)}
                      </>
                    )}
                  </span>
                )}
                {hasDetails && (
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                )}
              </button>
              {expanded && <ToolRunDetails step={x} />}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}

function MessageActions({
  content,
  citations,
  createdAt,
  onRetry,
  onDelete,
}: {
  content: string;
  citations: Citation[];
  createdAt?: string;
  onRetry?: () => void;
  onDelete?: () => void;
}) {
  const [done, setDone] = React.useState(false);
  const btn =
    "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div className="mt-1 flex min-h-7 items-center gap-1">
      <CitationBlock citations={citations} />
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={async () => {
                try {
                  await copyText(content);
                  setDone(true);
                  setTimeout(() => setDone(false), 1500);
                } catch {
                  toast.error("复制失败");
                }
              }}
              className={btn}
              aria-label={done ? "已复制" : "复制回答"}
            >
              {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{done ? "已复制" : "复制"}</TooltipContent>
        </Tooltip>
        {onRetry && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onRetry} className={btn} aria-label="重新回答">
                <RotateCcw className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>重试</TooltipContent>
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onDelete}
                className={btn + " hover:text-destructive"}
                aria-label="删除消息"
              >
                <Trash2 className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>删除</TooltipContent>
          </Tooltip>
        )}
        {createdAt && (
          <span className="px-1.5 text-[11px] tabular-nums text-muted-foreground/70">
            {relativeTime(createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

const MessageItem = React.memo(
  function MessageItem({
    message,
    streaming,
    steps,
    clock,
    stepsCollapsed,
    onToggleSteps,
    avatar,
    onRetry,
    onDelete,
  }: {
    message: ConvMessage;
    streaming?: boolean;
    steps?: LiveStep[];
    clock?: number;
    stepsCollapsed?: boolean;
    onToggleSteps?: () => void;
    avatar: React.ReactNode;
    onRetry?: () => void;
    onDelete?: () => void;
  }) {
    const panel = useDetailPanel();
    const openCitation = React.useCallback(
      (citation: Citation) => {
        if (!citation.chunk_id || !citation.source_id) return;
        panel.open({
          kind: "chunk",
          sourceId: citation.source_id,
          chunkId: citation.chunk_id,
          heading: citation.heading ?? undefined,
          sourceName: citation.source_name ?? undefined,
        });
      },
      [panel],
    );

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
          {steps && steps.length > 0 ? (
            <StepsTimeline
              steps={steps}
              now={clock}
              collapsed={stepsCollapsed}
              onToggle={onToggleSteps}
            />
          ) : message.steps && message.steps.length > 0 ? (
            <StepsTimeline steps={message.steps} />
          ) : null}
          {thinking && (!steps || steps.length === 0) ? (
            <div className="flex items-center gap-1.5 py-1 text-sm">
              <span className="size-1.5 animate-blink rounded-full bg-primary" />
              <span className="text-shimmer">正在思考…</span>
            </div>
          ) : thinking ? null : (
            <MarkdownContent
              content={message.content}
              citations={message.citations}
              onCitationClick={openCitation}
              streaming={streaming}
            />
          )}
          {!streaming && message.content && (
            <MessageActions
              content={message.content}
              citations={message.citations}
              createdAt={message.created_at}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          )}
          {!streaming && message.promptPreview && <PromptPreview preview={message.promptPreview} />}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.streaming === next.streaming &&
    prev.steps === next.steps &&
    prev.clock === next.clock &&
    prev.stepsCollapsed === next.stepsCollapsed &&
    prev.avatar === next.avatar,
);

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    const n = value / 1_000_000;
    return `${n >= 10 ? Math.round(n) : n.toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`;
  }
  return String(value);
}

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
  cancelRun,
  approveTool,
  rejectTool,
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
  cancelRun: (threadId: string, runId: string) => Promise<unknown>;
  approveTool: (threadId: string, runId: string, toolCallId: string) => Promise<unknown>;
  rejectTool: (
    threadId: string,
    runId: string,
    toolCallId: string,
    reason: string,
  ) => Promise<unknown>;
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
  const [mentionIdx, setMentionIdx] = React.useState(0);
  const mentionListRef = React.useRef<HTMLDivElement>(null);

  const mentionQuery = React.useMemo(() => {
    if (!mentionOpen) return "";
    const at = input.lastIndexOf("@");
    return at >= 0 ? input.slice(at + 1) : "";
  }, [mentionOpen, input]);
  const mentionMatches = React.useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    return q ? sources.filter((s) => s.name.toLowerCase().includes(q)) : sources;
  }, [sources, mentionQuery]);
  React.useEffect(() => setMentionIdx(0), [mentionQuery]);
  React.useEffect(() => {
    mentionListRef.current
      ?.querySelector(`[data-idx="${mentionIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [mentionIdx]);

  const selectMention = React.useCallback(
    (src: { id: string; name: string }) => {
      setScoped((p) =>
        p.some((x) => x.id === src.id) ? p : [...p, { id: src.id, name: src.name }],
      );
      setInput((v) => {
        const at = v.lastIndexOf("@");
        return at >= 0 ? v.slice(0, at) : v;
      });
      setMentionOpen(false);
      textareaRef.current?.focus();
    },
    [],
  );
  const docRef = React.useRef<HTMLInputElement>(null);
  const { capabilities: caps } = useApp();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [approvalBusy, setApprovalBusy] = React.useState(false);
  const [pendingApproval, setPendingApproval] = React.useState<PendingToolApproval | null>(null);
  const sendLockRef = React.useRef(false);
  const sendRef = React.useRef<(text: string) => void>(() => {});
  const [steps, setSteps] = React.useState<LiveStep[]>([]);
  const [stepsCollapsed, setStepsCollapsed] = React.useState(true);
  const [clock, setClock] = React.useState(() => Date.now());
  const stepsRef = React.useRef<LiveStep[]>([]);
  const liveSessionRef = React.useRef(0);
  const setStepsBoth = React.useCallback((updater: (prev: LiveStep[]) => LiveStep[]) => {
    stepsRef.current = updater(stepsRef.current);
    setSteps(stepsRef.current);
    chatLive.setSteps(stepsRef.current, liveSessionRef.current);
  }, []);
  const abortRef = React.useRef<AbortController | null>(null);
  const runIdRef = React.useRef<string | null>(null);
  const runThreadRef = React.useRef<string | null>(null);
  const stopRequestedRef = React.useRef(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const streamingId = React.useRef<string | null>(null);
  const activeThreadRef = React.useRef<string | null | undefined>(undefined);
  const streamingRef = React.useRef(false);
  const loadGeneration = React.useRef(0);
  const pendingTokens = React.useRef("");
  const tokenFlushTimer = React.useRef<number | null>(null);
  const rafId = React.useRef<number | null>(null);
  const lastTokenFlushAt = React.useRef(0);
  const lastScrollAt = React.useRef(0);
  const followOutputRef = React.useRef(true);
  sendRef.current = (text) => {
    void send(text);
  };

  React.useEffect(() => {
    const applyDraft = (value: unknown) => {
      const payload = parsePetDraft(value);
      if (!payload) return;
      if (payload.submit) {
        requestAnimationFrame(() => sendRef.current(payload.text));
        return;
      }
      setInput(payload.text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const onPetDraft = (event: Event) => {
      window.sessionStorage.removeItem(PET_DRAFT_KEY);
      applyDraft((event as CustomEvent<unknown>).detail);
    };

    window.addEventListener(PET_DRAFT_EVENT, onPetDraft);
    try {
      const pending = window.sessionStorage.getItem(PET_DRAFT_KEY);
      if (pending) {
        window.sessionStorage.removeItem(PET_DRAFT_KEY);
        applyDraft(pending);
      }
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener(PET_DRAFT_EVENT, onPetDraft);
  }, [conversationKey]);

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
      stepsRef.current = [];
      setSteps([]);
      runIdRef.current = null;
      runThreadRef.current = null;
      return;
    }
    stepsRef.current = [];
    setSteps([]);
    if (streamingRef.current) return;
    const live = chatLive.get();
    if (live.streaming && live.threadId === threadId) {
      // 采纳进行中的流：种入已缓冲内容，订阅后续 token 直至结束
      const botId = `live-${live.session}`;
      streamingId.current = botId;
      streamingRef.current = true;
      runIdRef.current = live.runId;
      runThreadRef.current = threadId;
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
      liveSessionRef.current = live.session;
      stepsRef.current = live.steps;
      setSteps(live.steps);
      setStepsCollapsed(false);
      const unsub = chatLive.subscribe(() => {
        const cur = chatLive.get();
        if (cur.session !== live.session) return;
        stepsRef.current = cur.steps;
        setSteps(cur.steps);
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
          runIdRef.current = null;
          runThreadRef.current = null;
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
    if (!streaming) return;
    const t = window.setInterval(() => setClock(Date.now()), 300);
    return () => window.clearInterval(t);
  }, [streaming]);

  React.useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    if (streaming && !followOutputRef.current) return;
    const now = Date.now();
    if (streaming && now - lastScrollAt.current < 120) return;
    lastScrollAt.current = now;
    el.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, streaming]);

  const flushTokens = React.useCallback((botId: string) => {
    const chunk = pendingTokens.current;
    if (!chunk) return;
    pendingTokens.current = "";
    lastTokenFlushAt.current = performance.now();
    setMessages((list) => list.map((x) => (x.id === botId ? { ...x, content: x.content + chunk } : x)));
  }, []);

  const scheduleTokenFlush = React.useCallback(
    (botId: string) => {
      if (tokenFlushTimer.current !== null || rafId.current !== null) return;
      const elapsed = performance.now() - lastTokenFlushAt.current;
      const delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);
      tokenFlushTimer.current = window.setTimeout(() => {
        tokenFlushTimer.current = null;
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          flushTokens(botId);
        });
      }, delay);
    },
    [flushTokens],
  );

  React.useEffect(() => {
    api.listSources().then(setSources).catch(() => {});
  }, []);

  // 上下文用量估算：CJK ≈1 token/字，其余 ≈1 token/4 字符（无 tokenizer 的专业近似）
  const ctxTokens = React.useMemo(() => {
    const est = (t: string) => {
      let cjk = 0;
      for (const ch of t) if (/[\u3000-\u9fff\uf900-\ufaff]/.test(ch)) cjk++;
      return cjk + Math.ceil((t.length - cjk) / 4);
    };
    return messages.reduce((a, m) => a + est(m.content ?? ""), 0) + est(input);
  }, [messages, input]);
  const ctxWindow = caps?.context_window ?? 128000;
  const ctxPctRaw = Math.min(100, (ctxTokens / ctxWindow) * 100);
  const ctxPctLabel = `${ctxPctRaw > 0 && ctxPctRaw < 10 ? ctxPctRaw.toFixed(1) : Math.round(ctxPctRaw)}%`;

  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

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
    if ((!q && pending.length === 0) || streaming || sendLockRef.current) return;
    if (!capabilities?.llm_configured) {
      toast.error("尚未配置模型，无法问答。请前往设置。");
      return;
    }

    sendLockRef.current = true;
    setSubmitting(true);
    let tid = threadId ?? activeThreadRef.current ?? null;
    if (!tid) {
      loadGeneration.current++;
      try {
        tid = await ensureThread();
        activeThreadRef.current = tid;
        loadGeneration.current++;
      } catch {
        sendLockRef.current = false;
        setSubmitting(false);
        toast.error("创建会话失败");
        return;
      }
    }

    let attachmentIds: string[] = [];
    if (pending.length) {
      try {
        const uploaded = await Promise.all(pending.map((item) => api.uploadAttachment(item.file)));
        attachmentIds = uploaded.map((item) => item.id);
      } catch {
        sendLockRef.current = false;
        setSubmitting(false);
        toast.error("图片上传失败，请重试");
        return;
      }
    }

    setInput("");
    setImages([]);
    stepsRef.current = [];
    setSteps([]);
    setStepsCollapsed(false);
    stopRequestedRef.current = false;
    followOutputRef.current = true;
    runIdRef.current = null;
    runThreadRef.current = tid;

    const now = Date.now();
    const botId = `local-a-${now}`;
    streamingId.current = botId;
    streamingRef.current = true;
    pendingTokens.current = "";
    setMessages((current) => [
      ...current,
      {
        id: `local-u-${now}`,
        role: "user",
        content: q,
        citations: [],
        attachments: pending.map((item) => ({ url: item.url })),
      },
      { id: botId, role: "assistant", content: "", citations: [] },
    ]);

    let streamOk = false;
    setSubmitting(false);
    setStreaming(true);
    const liveSession = chatLive.start(tid);
    liveSessionRef.current = liveSession;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (update: (message: ConvMessage) => ConvMessage) =>
      setMessages((list) => list.map((item) => (item.id === botId ? update(item) : item)));
    const settleActive = (status: "done" | "error", error?: string) =>
      setStepsBoth((current) =>
        current.map((item) =>
          item.status === "active"
            ? {
                ...item,
                status,
                error: error ?? item.error,
                ms: item.ms ?? Date.now() - item.startedAt,
              }
            : item,
        ),
      );

    const onEvent = (event: AgentEvent) => {
      const payload = event.payload;
      if (event.run_id) {
        runIdRef.current = event.run_id;
        chatLive.setRunId(event.run_id, liveSession);
      }

      if (event.type === "run.started") {
        const citations = (payload.citations as Citation[] | undefined) ?? [];
        if (citations.length) {
          chatLive.meta(citations, liveSession);
          patch((message) => ({ ...message, citations }));
        }
      } else if (event.type === "turn.started") {
        settleActive("done");
        setStepsBoth((current) => [
          ...current,
          {
            id: `thinking-${event.turn}`,
            kind: "thinking",
            step: event.turn,
            status: "active",
            startedAt: Date.now(),
          },
        ]);
      } else if (event.type === "tool.approval_required") {
        const toolCallId = String(payload.tool_call_id ?? "");
        const argumentsValue = toolArguments(payload.arguments);
        setStepsBoth((current) => {
          const settled = current.map((item) =>
            item.status === "active" && item.kind !== "tool"
              ? { ...item, status: "done" as const, ms: item.ms ?? Date.now() - item.startedAt }
              : item,
          );
          if (settled.some((item) => item.id === toolCallId)) return settled;
          return [
            ...settled,
            {
              id: toolCallId,
              kind: "tool",
              name: String(payload.name ?? ""),
              label: String(payload.label ?? payload.name ?? "工具"),
              args: toolArgsPreview(argumentsValue),
              arguments: argumentsValue,
              step: event.turn,
              status: "active",
              startedAt: Date.now(),
            },
          ];
        });
        setPendingApproval({
          runId: event.run_id,
          threadId: tid,
          toolCallId,
          label: String(payload.label ?? payload.name ?? "工具"),
          risk: String(payload.risk ?? "write"),
          arguments: payload.arguments,
        });
      } else if (event.type === "tool.started") {
        const toolCallId = String(payload.tool_call_id ?? "");
        const argumentsValue = toolArguments(payload.arguments);
        setStepsBoth((current) => [
          ...current.map((item) =>
            item.status === "active" && item.kind !== "tool"
              ? { ...item, status: "done" as const, ms: item.ms ?? Date.now() - item.startedAt }
              : item,
          ),
          ...(current.some((item) => item.id === toolCallId)
            ? []
            : [
                {
                  id: toolCallId,
                  kind: "tool" as const,
                  name: String(payload.name ?? ""),
                  label: String(payload.label ?? payload.name ?? "工具"),
                  args: toolArgsPreview(argumentsValue),
                  arguments: argumentsValue,
                  step: event.turn,
                  status: "active" as const,
                  startedAt: Date.now(),
                },
              ]),
        ]);
      } else if (event.type === "tool.completed") {
        const id = String(payload.tool_call_id ?? "");
        const details = toolArguments(payload.details) as NonNullable<MessageStep["details"]>;
        const toolCitations = citationsFromArtifacts(payload.artifacts);
        if (toolCitations.length) {
          const liveCitations = mergeCitations(
            (chatLive.get().citations as Citation[]) ?? [],
            toolCitations,
          );
          chatLive.meta(liveCitations, liveSession);
          patch((message) => ({
            ...message,
            citations: mergeCitations(message.citations, toolCitations),
          }));
        }
        setStepsBoth((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "done",
                  ms: Number(payload.duration_ms ?? 0),
                  count: Number(details.count ?? 0),
                  details,
                }
              : item,
          ),
        );
      } else if (event.type === "tool.failed") {
        const id = String(payload.tool_call_id ?? "");
        const failure = payload.error as { message?: string } | undefined;
        setStepsBoth((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "error",
                  error: failure?.message ?? "工具执行失败",
                  ms: Number(payload.duration_ms ?? 0),
                }
              : item,
          ),
        );
      } else if (event.type === "message.delta") {
        if (!stepsRef.current.some((item) => item.kind === "answer" && item.status === "active")) {
          setStepsBoth((current) => {
            const turnStep = current.find(
              (item) =>
                item.kind === "thinking" && item.step === event.turn && item.status === "active",
            );
            if (turnStep) {
              return current.map((item) =>
                item === turnStep
                  ? { ...item, id: `answer-${event.turn}`, kind: "answer" as const }
                  : item,
              );
            }
            return [
              ...current.map((item) =>
                item.status === "active"
                  ? {
                      ...item,
                      status: "done" as const,
                      ms: item.ms ?? Date.now() - item.startedAt,
                    }
                  : item,
              ),
              {
                id: `answer-${event.turn}`,
                kind: "answer" as const,
                step: event.turn,
                status: "active" as const,
                startedAt: Date.now(),
              },
            ];
          });
        }
        const token = String(payload.delta ?? "");
        chatLive.token(token, liveSession);
        pendingTokens.current += token;
        scheduleTokenFlush(botId);
      } else if (event.type === "message.completed") {
        const message = payload.message as { role?: string } | undefined;
        if (message?.role === "assistant") {
          const kind = payload.has_tool_calls ? "thinking" : "answer";
          setStepsBoth((current) =>
            current.map((item) =>
              item.kind === kind && item.step === event.turn
                ? { ...item, status: "done", ms: Number(payload.duration_ms ?? item.ms ?? 0) }
                : item,
            ),
          );
        }
      } else if (event.type === "run.completed") {
        setPendingApproval(null);
        settleActive("done");
        const citations = (payload.citations as Citation[] | undefined) ?? [];
        const promptPreview = payload.prompt_preview as string | undefined;
        chatLive.meta(citations, liveSession);
        patch((message) => ({ ...message, citations, promptPreview }));
        onActivity?.();
      } else if (event.type === "run.failed" || event.type === "run.cancelled") {
        setPendingApproval(null);
        const failure = payload.error as { message?: string } | undefined;
        const message = failure?.message ?? "生成失败";
        settleActive("error", event.type === "run.cancelled" ? "已停止" : message);
        flushTokens(botId);
        if (event.type === "run.cancelled") {
          patch((item) => ({ ...item, content: item.content || "已停止" }));
        } else {
          patch((item) => ({ ...item, content: item.content || `⚠︎ ${message}` }));
          toast.error(message);
        }
      }
    };

    try {
      const outcome = await stream(
        tid,
        q,
        onEvent,
        ctrl.signal,
        attachmentIds.length ? attachmentIds : undefined,
        scoped.length ? scoped.map((source) => source.id) : undefined,
      );
      streamOk = outcome.status === "completed";
    } catch (error) {
      flushTokens(botId);
      if (stopRequestedRef.current) {
        patch((message) => ({ ...message, content: message.content || "已停止" }));
      } else {
        const detail = error instanceof Error ? error.message : "连接中断，回答未完成";
        settleActive("error", detail);
        patch((message) => ({ ...message, content: message.content || `⚠︎ ${detail}` }));
        toast.error(detail);
      }
    } finally {
      if (tokenFlushTimer.current !== null) {
        window.clearTimeout(tokenFlushTimer.current);
        tokenFlushTimer.current = null;
      }
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      flushTokens(botId);
      chatLive.end(liveSession);
      setStreaming(false);
      setStopping(false);
      setStepsCollapsed(true);
      abortRef.current = null;
      streamingId.current = null;
      streamingRef.current = false;
      runIdRef.current = null;
      runThreadRef.current = null;
      stopRequestedRef.current = false;
      sendLockRef.current = false;
      loadGeneration.current++;
      if (streamOk) await loadMessages(tid, { force: true });
    }
  }

  async function stop() {
    if (stopping || !streaming) return;
    stopRequestedRef.current = true;
    setPendingApproval(null);
    setStopping(true);
    const ctrl = abortRef.current;
    const runId = runIdRef.current ?? chatLive.get().runId;
    const activeThread = runThreadRef.current ?? chatLive.get().threadId;
    if (runId && activeThread) {
      try {
        await cancelRun(activeThread, runId);
        window.setTimeout(() => {
          if (stopRequestedRef.current && abortRef.current === ctrl) ctrl?.abort();
        }, 5000);
        return;
      } catch {
        // The request may have completed between the click and cancellation.
      }
    }
    ctrl?.abort();
  }

  async function resolveApproval(approved: boolean) {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    try {
      if (approved) {
        await approveTool(
          pendingApproval.threadId,
          pendingApproval.runId,
          pendingApproval.toolCallId,
        );
      } else {
        await rejectTool(
          pendingApproval.threadId,
          pendingApproval.runId,
          pendingApproval.toolCallId,
          "用户拒绝执行",
        );
      }
      setPendingApproval(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "处理工具审批失败");
    } finally {
      setApprovalBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (!element) return;
          followOutputRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
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
                clock={clock}
                streaming={streaming && m.id === streamingId.current}
                steps={
                  m.id === streamingId.current ||
                  (!streaming && m.role === "assistant" && idx === messages.length - 1)
                    ? steps
                    : undefined
                }
                stepsCollapsed={stepsCollapsed}
                onToggleSteps={() => setStepsCollapsed((v) => !v)}
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
          <div ref={bottomRef} aria-hidden className="h-8 shrink-0 sm:h-10" />
        </div>
      </div>

      <div className="shrink-0 border-t bg-background/95 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative flex flex-col gap-1.5 rounded-2xl border bg-card px-3 py-2 shadow-soft transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-lift">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1">
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
          {mentionOpen && (
            <div
              ref={mentionListRef}
              className="absolute bottom-full left-3 z-20 mb-2 max-h-56 w-72 overflow-y-auto rounded-lg border bg-card p-1 shadow-lift"
            >
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                @ 知识库范围{mentionQuery ? `：${mentionQuery}` : ""}（↑↓ 选择 · Enter 确认）
              </p>
              {mentionMatches.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">没有匹配的信源</p>
              )}
              {mentionMatches.map((src, i) => {
                const on = scoped.some((x) => x.id === src.id);
                return (
                  <button
                    key={src.id}
                    type="button"
                    data-idx={i}
                    onMouseEnter={() => setMentionIdx(i)}
                    onClick={() => selectMention(src)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors",
                      i === mentionIdx ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{src.name}</span>
                    {on && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
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
          <div className="flex flex-wrap items-center gap-1 px-0.5">
            {scoped.map((sc) => (
              <span
                key={sc.id}
                className="inline-flex h-6 max-w-[min(100%,12rem)] items-center gap-1 rounded-md bg-primary/10 px-1.5 text-xs font-medium leading-6 text-primary"
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
            <textarea
              ref={textareaRef}
              autoFocus
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                if (v.endsWith("@")) {
                  setMentionOpen(true);
                } else if (mentionOpen) {
                  const at = v.lastIndexOf("@");
                  if (at < 0 || /\s/.test(v.slice(at + 1))) setMentionOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (mentionOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIdx((i) => Math.min(i + 1, Math.max(mentionMatches.length - 1, 0)));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIdx((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const pick = mentionMatches[mentionIdx];
                    if (pick) selectMention(pick);
                    return;
                  }
                  if (e.key === "Escape") {
                    setMentionOpen(false);
                    return;
                  }
                }
                onKeyDown(e);
              }}
              onPaste={(e) => {
                if (e.clipboardData?.files?.length) {
                  e.preventDefault();
                  addImages(e.clipboardData.files);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={scoped.length ? "继续输入…" : placeholder}
              className="max-h-28 min-h-6 min-w-[12ch] flex-1 resize-none overflow-y-auto bg-transparent py-0 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={streaming || submitting}
                    aria-label="添加"
                    title="添加"
                    className="size-8 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-4" />
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="min-w-0 max-w-[42vw] truncate px-1 text-xs text-muted-foreground sm:max-w-56">
                    {caps?.llm_model ?? "未配置模型"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-72">
                  当前模型：{caps?.llm_model ?? "未配置模型"}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label="上下文占用"
                    className="size-4 shrink-0 cursor-default rounded-full"
                    style={{
                      background: `conic-gradient(hsl(var(--primary)) ${ctxPctRaw * 3.6}deg, hsl(var(--muted)) 0deg)`,
                      WebkitMask: "radial-gradient(farthest-side, transparent 56%, black 58%)",
                      mask: "radial-gradient(farthest-side, transparent 56%, black 58%)",
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="w-64 rounded-lg border bg-card p-3 text-card-foreground shadow-lift"
                >
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-medium">窗口使用情况</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        当前对话占模型上下文窗口的比例
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span>{ctxPctLabel}</span>
                      <span className="text-muted-foreground">
                        {formatTokenCount(ctxTokens)} / {formatTokenCount(ctxWindow)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(ctxPctRaw, ctxTokens > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>

            {streaming ? (
              <Button
                variant="outline"
                size="icon"
                onClick={stop}
                disabled={stopping}
                title="停止"
                className="size-8 rounded-full"
              >
                {stopping ? <Spinner className="size-4" /> : <Square className="size-4" />}
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => send()}
                disabled={submitting || (!input.trim() && images.length === 0)}
                title="发送"
                className="size-8 rounded-full shadow-none disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              >
                {submitting ? <Spinner className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>
      </div>
      <AlertDialog open={pendingApproval !== null}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>允许执行工具？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingApproval?.label ?? "工具"} 请求执行
              {pendingApproval?.risk === "destructive"
                ? "，此操作可能删除数据"
                : pendingApproval?.risk === "write"
                  ? "，此操作会修改数据"
                  : ""}
              。{pendingApproval ? toolArgsPreview(pendingApproval.arguments, 120) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" disabled={approvalBusy} onClick={() => resolveApproval(false)}>
              拒绝
            </Button>
            <Button disabled={approvalBusy} onClick={() => resolveApproval(true)}>
              {approvalBusy && <Spinner />}
              允许一次
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
