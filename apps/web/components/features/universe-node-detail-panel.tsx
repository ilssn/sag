"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Network,
  Quote,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, ApiError } from "@/lib/api";
import { stripCitationTransportTokens } from "@/lib/citation-presentation";
import { formatDate } from "@/lib/format";
import type { UniverseNodeDetail, UniverseNodeKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface UniverseNodeDetailPanelNode {
  kind: UniverseNodeKind;
  rawId: string;
  sourceId: string;
  label: string;
  description?: string;
  category?: string;
  startTime?: string | null;
  relatedProgress?: number;
  relatedTotal?: number | null;
}

export interface UniverseNodeDetailPanelText {
  panelLabel: string;
  event: string;
  entity: string;
  details: string;
  sourceEvidence: string;
  sourceDocument: string;
  sourceSection: string;
  relatedProgress: string;
  exploreMore: string;
  askAi: string;
  previousEvent: string;
  nextEvent: string;
  close: string;
  loading: string;
  loadFailed: string;
  retry: string;
  noDetails: string;
  noEvidence: string;
  unknownSource: string;
}

export interface UniverseNodeDetailPanelProps {
  node: UniverseNodeDetailPanelNode;
  locale: string;
  text: UniverseNodeDetailPanelText;
  onClose: () => void;
  onExploreMore: () => void;
  onAsk: () => void;
  onPreviousEvent?: () => void;
  onNextEvent?: () => void;
  canExploreMore?: boolean;
  exploreMoreLoading?: boolean;
  askLoading?: boolean;
  previousEventAvailable?: boolean;
  previousEventLoading?: boolean;
  nextEventAvailable?: boolean;
  nextEventLoading?: boolean;
  eventPositionLabel?: string;
  className?: string;
}

interface KeyedDetail {
  key: string;
  value: UniverseNodeDetail;
}

interface KeyedError {
  key: string;
  message: string;
}

function detailKey(node: UniverseNodeDetailPanelNode) {
  return `${node.kind}:${node.sourceId}:${node.rawId}`;
}

function fallbackDetail(node: UniverseNodeDetailPanelNode): UniverseNodeDetail {
  return {
    id: node.rawId,
    kind: node.kind,
    source_id: node.sourceId,
    source_name: "",
    label: node.label,
    description: node.description ?? "",
    category: node.category ?? "",
    start_time: node.startTime ?? null,
    evidence: null,
  };
}

/**
 * Reading surface for a locked universe node.
 *
 * The panel deliberately owns only detail retrieval and reading actions. The
 * graph remains the source of truth for selection, event order and expansion.
 */
export function UniverseNodeDetailPanel({
  node,
  locale,
  text,
  onClose,
  onExploreMore,
  onAsk,
  onPreviousEvent,
  onNextEvent,
  canExploreMore = true,
  exploreMoreLoading = false,
  askLoading = false,
  previousEventAvailable = false,
  previousEventLoading = false,
  nextEventAvailable = false,
  nextEventLoading = false,
  eventPositionLabel,
  className,
}: UniverseNodeDetailPanelProps) {
  const reduceMotion = useReducedMotion();
  const key = detailKey(node);
  const requestSequenceRef = React.useRef(0);
  const [requestVersion, setRequestVersion] = React.useState(0);
  const [loadedDetail, setLoadedDetail] = React.useState<KeyedDetail | null>(null);
  const [loadError, setLoadError] = React.useState<KeyedError | null>(null);
  const [loadingKey, setLoadingKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    const sequence = ++requestSequenceRef.current;
    setLoadingKey(key);
    setLoadError(null);

    Promise.resolve()
      .then(() => api.universeNode(node.kind, node.rawId, node.sourceId))
      .then((value) => {
        if (requestSequenceRef.current !== sequence) return;
        setLoadedDetail({ key, value });
      })
      .catch((reason: unknown) => {
        if (requestSequenceRef.current !== sequence) return;
        setLoadError({
          key,
          message: reason instanceof ApiError && reason.message
            ? reason.message
            : text.loadFailed,
        });
      })
      .finally(() => {
        if (requestSequenceRef.current === sequence) setLoadingKey(null);
      });

    // Invalidating the request identity prevents a response from a previously
    // locked node from ever replacing the current node's detail.
    return () => {
      if (requestSequenceRef.current === sequence) {
        requestSequenceRef.current += 1;
      }
    };
  }, [key, node.kind, node.rawId, node.sourceId, requestVersion, text.loadFailed]);

  const detail = loadedDetail?.key === key
    ? loadedDetail.value
    : fallbackDetail(node);
  const error = loadError?.key === key ? loadError.message : "";
  const loading = loadingKey === key;
  const typeLabel = detail.kind === "event" ? text.event : text.entity;
  const formattedTime = detail.start_time
    ? formatDate(detail.start_time, undefined, { dateStyle: "medium" }, locale)
    : "";
  const evidence = detail.evidence;
  const evidenceContent = evidence
    ? stripCitationTransportTokens(evidence.content).trim()
    : "";
  const evidenceSource = evidence?.document_name
    || evidence?.source_name
    || detail.source_name
    || text.unknownSource;
  const progress = Math.max(0, node.relatedProgress ?? 0);
  const total = node.relatedTotal == null
    ? null
    : Math.max(progress, node.relatedTotal);
  const progressPercent = total && total > 0
    ? Math.min(100, (progress / total) * 100)
    : 0;
  const showEventNavigation = detail.kind === "event"
    && Boolean(onPreviousEvent || onNextEvent);

  return (
    <motion.aside
      data-universe-detail-panel="true"
      data-node-kind={detail.kind}
      aria-label={text.panelLabel}
      initial={reduceMotion ? false : { opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      className={cn(
        "absolute bottom-20 left-4 top-20 z-40 flex w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/92 text-foreground shadow-2xl backdrop-blur-xl",
        "max-sm:inset-x-3 max-sm:bottom-3 max-sm:top-auto max-sm:max-h-[min(72dvh,38rem)] max-sm:w-auto max-sm:rounded-[1.35rem]",
        className,
      )}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border/60 px-4 py-3.5">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border",
            detail.kind === "event"
              ? "border-amber-400/25 bg-amber-400/10 text-amber-400"
              : "border-cyan-400/25 bg-cyan-400/10 text-cyan-400",
          )}
        >
          {detail.kind === "event" ? (
            <Sparkles className="size-3.5" />
          ) : (
            <CircleDot className="size-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{typeLabel}</span>
            {detail.category && <span>· {detail.category}</span>}
            {formattedTime && <time dateTime={detail.start_time ?? undefined}>· {formattedTime}</time>}
            {detail.kind === "event" && eventPositionLabel && (
              <span>· {eventPositionLabel}</span>
            )}
          </div>
          <h2 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
            {detail.label}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-8 shrink-0 rounded-full"
          onClick={onClose}
          aria-label={text.close}
          title={text.close}
        >
          <X className="size-4" />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            className="space-y-5 p-4"
          >
            <section aria-labelledby={`${key}-details`}>
              <div className="flex items-center justify-between gap-3">
                <h3
                  id={`${key}-details`}
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {text.details}
                </h3>
                {loading && (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
                  >
                    <Loader2 className="size-3 animate-spin" />
                    {text.loading}
                  </span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground/75">
                {detail.description || text.noDetails}
              </p>
            </section>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs"
              >
                <p className="text-destructive">{error}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 px-2 text-xs"
                  onClick={() => setRequestVersion((version) => version + 1)}
                >
                  <RefreshCw className="size-3" />
                  {text.retry}
                </Button>
              </div>
            )}

            <section className="border-t border-border/60 pt-4" aria-labelledby={`${key}-evidence`}>
              <div className="flex items-center gap-2">
                <Quote className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <h3
                  id={`${key}-evidence`}
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {text.sourceEvidence}
                </h3>
              </div>
              {evidenceContent ? (
                <blockquote className="mt-3 rounded-xl border border-border/60 bg-muted/25 px-3.5 py-3">
                  <p className="whitespace-pre-wrap text-xs leading-5 text-foreground/75">
                    {evidenceContent}
                  </p>
                  <footer className="mt-3 border-t border-border/50 pt-2.5 text-[10px] leading-4 text-muted-foreground">
                    <cite className="not-italic">{evidenceSource}</cite>
                  </footer>
                </blockquote>
              ) : (
                !loading && (
                  <p className="mt-3 text-xs text-muted-foreground">{text.noEvidence}</p>
                )
              )}

              {evidence && (
                <dl className="mt-3 space-y-2 text-[11px]">
                  <div className="flex gap-2">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <dt className="shrink-0 text-muted-foreground">{text.sourceDocument}</dt>
                    <dd className="min-w-0 flex-1 truncate text-right" title={evidenceSource}>
                      {evidenceSource}
                    </dd>
                  </div>
                  {evidence.heading && (
                    <div className="flex gap-2">
                      <BookOpenText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <dt className="shrink-0 text-muted-foreground">{text.sourceSection}</dt>
                      <dd className="min-w-0 flex-1 text-right leading-4">{evidence.heading}</dd>
                    </div>
                  )}
                </dl>
              )}
            </section>

            {(node.relatedProgress !== undefined || node.relatedTotal != null) && (
              <section className="border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Network className="size-3.5" aria-hidden="true" />
                    {text.relatedProgress}
                  </span>
                  <span className="tabular-nums">
                    {new Intl.NumberFormat(locale).format(progress)}
                    {total == null ? "" : ` / ${new Intl.NumberFormat(locale).format(total)}`}
                  </span>
                </div>
                {total != null && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={progress}
                    className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
                  >
                    <motion.div
                      className="h-full rounded-full bg-cyan-400/80"
                      initial={false}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: reduceMotion ? 0 : 0.25 }}
                    />
                  </div>
                )}
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </ScrollArea>

      <footer className="shrink-0 space-y-2.5 border-t border-border/60 bg-background/75 p-3 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-0"
            onClick={onExploreMore}
            disabled={!canExploreMore || exploreMoreLoading}
          >
            {exploreMoreLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Network className="size-3.5" />
            )}
            <span className="truncate">{text.exploreMore}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-0"
            onClick={onAsk}
            disabled={askLoading}
          >
            {askLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MessageCircleQuestion className="size-3.5" />
            )}
            <span className="truncate">{text.askAi}</span>
          </Button>
        </div>

        {showEventNavigation && (
          <nav aria-label={`${text.previousEvent} / ${text.nextEvent}`} className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start text-xs"
              onClick={onPreviousEvent}
              disabled={!previousEventAvailable || previousEventLoading}
            >
              {previousEventLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ChevronLeft className="size-3.5" />
              )}
              <span className="truncate">{text.previousEvent}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-end text-xs"
              onClick={onNextEvent}
              disabled={!nextEventAvailable || nextEventLoading}
            >
              <span className="truncate">{text.nextEvent}</span>
              {nextEventLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </Button>
          </nav>
        )}
      </footer>
    </motion.aside>
  );
}
