"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";

import type { MessageStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export type AgentActivityStatus = "active" | "done" | "error";

export interface AgentActivityStep extends MessageStep {
  id?: string;
  status?: AgentActivityStatus;
  startedAt?: number;
  progress?: string;
}

export type AgentActivityMatch = NonNullable<
  NonNullable<MessageStep["details"]>["matches"]
>[number];

export interface AgentActivityTimelineProps {
  steps: readonly AgentActivityStep[];
  collapsed?: boolean;
  onToggle?: () => void;
  onMatchClick?: (match: AgentActivityMatch, step: AgentActivityStep) => void;
  className?: string;
}

function formatDuration(value: number) {
  const milliseconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)}s`
    : `${Math.max(Math.round(milliseconds), 1)}ms`;
}

function argumentPreview(value: unknown, limit = 60) {
  const values = value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : [];
  const text = values
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join("; ");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function elapsedFor(step: AgentActivityStep, now: number) {
  if (typeof step.ms === "number") return step.ms;
  if (step.status === "active" && typeof step.startedAt === "number") {
    return Math.max(0, now - step.startedAt);
  }
  return 0;
}

function ToolRunDetails({
  step,
  onMatchClick,
}: {
  step: AgentActivityStep;
  onMatchClick?: AgentActivityTimelineProps["onMatchClick"];
}) {
  const details = step.details;
  const entries = Object.entries(step.arguments ?? {});
  const sources = details?.sources?.filter((source) => source.name) ?? [];
  const matches = details?.matches ?? [];
  const hasHeader = entries.length > 0 || sources.length > 0;

  return (
    <div
      className="mb-2 ml-5 mt-1.5 max-w-2xl rounded-md border bg-muted/25 p-2.5 text-[11px] text-muted-foreground"
    >
      {hasHeader && (
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
        <div className={cn("space-y-1.5", hasHeader && "mt-2 border-t pt-2")}>
          <div className="font-medium text-foreground/70">命中内容</div>
          {matches.map((match, index) => {
            const traceable = Boolean(match.chunk_id && match.source_id && onMatchClick);
            return (
              <button
                key={`${match.chunk_id ?? index}-${match.n ?? index}`}
                type="button"
                disabled={!traceable}
                onClick={() => {
                  if (traceable) onMatchClick?.(match, step);
                }}
                className={cn(
                  "block w-full rounded px-2 py-1.5 text-left",
                  traceable &&
                    "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                {match.snippet && (
                  <span className="mt-0.5 line-clamp-2 block break-words">{match.snippet}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {details?.output_preview && (
        <div className={cn("whitespace-pre-wrap break-words", hasHeader && "mt-2 border-t pt-2")}>
          {details.output_preview}
        </div>
      )}
    </div>
  );
}

export function AgentActivityTimeline({
  steps,
  collapsed: collapsedProp,
  onToggle,
  onMatchClick,
  className,
}: AgentActivityTimelineProps) {
  const [innerCollapsed, setInnerCollapsed] = React.useState(true);
  const [expandedTools, setExpandedTools] = React.useState<Set<string>>(() => new Set());
  const [now, setNow] = React.useState(() => Date.now());
  const controlled = collapsedProp !== undefined;
  const collapsed = controlled ? collapsedProp : innerCollapsed;
  const active = steps.some((step) => step.status === "active");

  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, [active]);

  const toolRuns = steps.filter((step) => step.kind === "tool");
  const failedRuns = toolRuns.filter(
    (step) => step.status === "error" || Boolean(step.error),
  );
  if (steps.length === 0) return null;

  const totalDuration = steps.reduce((total, step) => total + elapsedFor(step, now), 0);
  const actionLabel = active
    ? "正在处理"
    : failedRuns.length
      ? `${failedRuns.length} 项操作未完成`
      : toolRuns.length
        ? `完成了 ${toolRuns.length} 项工具操作`
        : "已完成思考与回答";
  const expanded = active || !collapsed;

  const toggleCollapsed = () => {
    if (active) return;
    if (controlled) onToggle?.();
    else setInnerCollapsed((value) => !value);
  };

  return (
    <div
      className={cn(
        collapsed && !active ? "mb-2" : "mb-3",
        "text-[11px]",
        className,
      )}
    >
      <button
        type="button"
        disabled={active}
        onClick={toggleCollapsed}
        aria-expanded={expanded}
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
        <span className="tabular-nums">{formatDuration(totalDuration)}</span>
        {!active && (
          <ChevronDown
            className={cn(
              "size-2.5 shrink-0 transition-transform",
              !collapsed && "rotate-180",
            )}
          />
        )}
      </button>

      {expanded && (
        <div className="ml-1.5 mt-1 border-l pl-3">
          {steps.map((step, index) => {
            const isActive = step.status === "active";
            const isError = step.status === "error" || Boolean(step.error);
            const elapsed = elapsedFor(step, now);
            const key = step.id ?? `${step.kind}-${step.step}-${index}`;
            const args = step.arguments?.query !== undefined
              ? String(step.arguments.query)
              : step.arguments?.name !== undefined
                ? String(step.arguments.name)
                : step.args || argumentPreview(step.arguments);
            const hasDetails =
              step.kind === "tool" &&
              (Boolean(step.arguments && Object.keys(step.arguments).length) ||
                Boolean(step.details?.matches?.length) ||
                Boolean(step.details?.sources?.length) ||
                Boolean(step.details?.output_preview));
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

                  {step.kind === "thinking" ? (
                    <span className={isActive ? "text-shimmer" : "text-muted-foreground"}>
                      {isActive ? "正在思考" : "思考"} · 第 {step.step} 轮 · {formatDuration(elapsed)}
                    </span>
                  ) : step.kind === "answer" ? (
                    <span className={isActive ? "text-shimmer" : "text-muted-foreground"}>
                      {isActive ? "正在整理回答" : "整理回答"} · {formatDuration(elapsed)}
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
                      title={step.error}
                    >
                      {step.label || step.name || "工具"}
                      {args ? `「${args}」` : ""}
                      {isActive && step.progress ? ` · ${step.progress}` : ""}
                      {isError && step.error ? ` · ${step.error}` : ""}
                      {!isActive && (
                        <>
                          {" · "}
                          {step.name === "search_context" && typeof step.count === "number"
                            ? `检索到 ${step.count} 条 · `
                            : ""}
                          {formatDuration(elapsed)}
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
                {expanded && (
                  <ToolRunDetails
                    step={step}
                    onMatchClick={onMatchClick}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
