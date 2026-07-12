"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import {
  CheckCircle2,
  CircleDot,
  Focus,
  GitBranch,
  Info,
  Loader2,
  LocateFixed,
  MessageCircleQuestion,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type {
  UniverseActivation,
  UniverseGraphPatch,
  UniverseManifest,
  UniverseNodeKind,
} from "@/lib/types";
import {
  UNIVERSE_ACTIVATE_EVENT,
  UNIVERSE_FOCUS_EVENT,
  UNIVERSE_RESET_EVENT,
  dispatchUniverseAsk,
  dispatchUniverseDetail,
  dispatchUniversePatch,
  dispatchUniverseView,
} from "@/lib/universe-events";
import {
  UNIVERSE_SCENE_BUDGET,
  emptyUniverseWorkingSet,
  mergeUniverseActivation,
  mergeUniverseGraphPatch,
  replaceUniverseWorkingSet,
  sourceTimelinePageTargetForLod,
  universeAnchorProgress,
  universeNodeKey,
  type UniverseWorkingSet,
} from "@/lib/universe-working-set";
import { cn } from "@/lib/utils";
import {
  UniverseScene,
  type UniverseSceneData,
  type UniverseSceneHandle,
  type UniverseSceneHover,
  type UniverseSceneLink,
  type UniverseSceneNode,
  type UniverseSceneView,
} from "@/components/features/universe-scene";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Universe3DNode extends UniverseSceneNode {
  root: boolean;
}

type UniverseConcrete3DNode = Universe3DNode & { kind: "event" | "entity" };

type Universe3DLink = UniverseSceneLink;

interface ActivationSummary {
  query: string;
  events: number;
  entities: number;
  relations: number;
}

interface Position3D {
  x: number;
  y: number;
  z: number;
}

interface SourceTimelinePageState {
  cursor: string | null;
  pages: number;
  targetPages: number;
  done: boolean;
  loading: boolean;
}

interface SourceContentLedger {
  events: Set<string>;
  entities: Set<string>;
}

interface SourceLoadMetric {
  loaded: number;
  total: number;
  done: boolean;
  loading: boolean;
}

interface SourceLoadProgress {
  sourceId: string;
  label: string;
  events: SourceLoadMetric;
  entities: SourceLoadMetric;
  allDone: boolean;
  loading: boolean;
}

const PARTITION_RENDER_LIMIT = { desktop: 160, mobile: 64 } as const;

function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function stableOffset(key: string, radius: number): Position3D {
  const azimuth = stableUnit(`${key}:azimuth`) * Math.PI * 2;
  const vertical = stableUnit(`${key}:vertical`) * 2 - 1;
  const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  const distance = radius * (0.46 + stableUnit(`${key}:distance`) * 0.5);
  return {
    x: Math.cos(azimuth) * planar * distance,
    y: Math.sin(azimuth) * planar * distance,
    z: vertical * distance,
  };
}

function compactCount(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function rememberLoadedContent(
  ledger: Map<string, SourceContentLedger>,
  nodes: ReadonlyArray<{
    id: string;
    kind: UniverseNodeKind;
    source_id?: string | null;
  }>,
  fallbackSourceId?: string,
) {
  let changed = false;
  nodes.forEach((node) => {
    const sourceId = node.source_id || fallbackSourceId;
    if (!sourceId) return;
    let source = ledger.get(sourceId);
    if (!source) {
      source = { events: new Set<string>(), entities: new Set<string>() };
      ledger.set(sourceId, source);
    }
    const target = node.kind === "event" ? source.events : source.entities;
    const previousSize = target.size;
    target.add(node.id);
    if (target.size !== previousSize) changed = true;
  });
  return changed;
}

function LoadProgressRow({
  label,
  metric,
  tone,
}: {
  label: string;
  metric: SourceLoadMetric;
  tone: "entity" | "event";
}) {
  const total = Math.max(metric.total, metric.loaded);
  const progress = total > 0
    ? Math.min(100, Math.max(0, metric.loaded / total * 100))
    : metric.done ? 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[10px] leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/85">
          {compactCount(metric.loaded)} / {compactCount(total)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]"
        role="progressbar"
        aria-label={`${label}加载进度`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(metric.loaded, total)}
        data-loaded={metric.loaded}
        data-total={total}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,filter] duration-500 ease-out",
            tone === "entity"
              ? "bg-cyan-300 shadow-[0_0_10px_rgb(103_232_249_/_0.48)]"
              : "bg-amber-300 shadow-[0_0_10px_rgb(252_211_77_/_0.42)]",
            metric.loading && "brightness-110",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function UniverseLoadProgressPanel({
  progress,
  reducedMotion,
}: {
  progress: SourceLoadProgress;
  reducedMotion: boolean;
}) {
  const started = progress.events.loaded > 0 || progress.entities.loaded > 0;
  const status = progress.allDone
    ? "全部内容已加载"
    : progress.loading
      ? "正在从星系中心显现"
      : started
        ? "继续拉近，加载更早内容"
        : "拉近星系，开始探索";
  return (
    <motion.div
      data-universe-load-progress="true"
      data-source-id={progress.sourceId}
      data-load-state={progress.allDone ? "complete" : progress.loading ? "loading" : "idle"}
      role="status"
      aria-live="polite"
      className="pointer-events-none w-[min(15rem,calc(100vw-1.5rem))] rounded-md border border-border/65 bg-background/76 p-3 shadow-soft backdrop-blur-xl sm:w-60"
      initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.985 }}
      transition={{
        duration: reducedMotion ? 0 : 0.22,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-foreground/90" title={progress.label}>
            内容加载进度
          </p>
          <p className="mt-0.5 truncate text-[9px] text-muted-foreground" title={status}>
            {status}
          </p>
        </div>
        {progress.allDone ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
        ) : progress.loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-300" aria-hidden="true" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-foreground/25" aria-hidden="true" />
        )}
      </div>
      <div className="space-y-2.5">
        <LoadProgressRow label="已加载事件" metric={progress.events} tone="event" />
        <LoadProgressRow label="已连接实体" metric={progress.entities} tone="entity" />
      </div>
    </motion.div>
  );
}

function isConcreteUniverseNode(
  node: Universe3DNode | null,
): node is UniverseConcrete3DNode {
  return Boolean(node && node.kind !== "source");
}

function visualNebulaRadius(eventCount: number, entityCount: number, sourceCount: number) {
  const total = Math.max(1, eventCount + entityCount * 0.72);
  const dataScale = 54 + Math.min(62, Math.log2(total + 1) * 9.2);
  const crowdScale = Math.min(
    1.04,
    Math.max(0.52, 1.18 - Math.log2(Math.max(2, sourceCount + 1)) * 0.09),
  );
  return Math.max(38, dataScale * crowdScale);
}

function dominantSource(activation: UniverseActivation) {
  if (activation.source_hits?.[0]?.source_id) return activation.source_hits[0].source_id;
  const counts = new Map<string, number>();
  activation.nodes.forEach((node) => {
    if (!node.source_id || node.kind !== "event") return;
    counts.set(node.source_id, (counts.get(node.source_id) ?? 0) + 1);
  });
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function IconControl({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 border-border/70 bg-background/75 text-muted-foreground shadow-soft backdrop-blur-md hover:bg-background hover:text-foreground"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function KnowledgeUniverse({
  interactive = true,
  workspacePanel = "hidden",
}: {
  interactive?: boolean;
  workspacePanel?: "hidden" | "mini" | "normal";
}) {
  const reducedMotion = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const darkTheme = resolvedTheme === "dark";
  const containerRef = React.useRef<HTMLDivElement>(null);
  const graphRef = React.useRef<UniverseSceneHandle | null>(null);
  const stageTimerRef = React.useRef<number | null>(null);
  const focusTimerRef = React.useRef<number | null>(null);
  const cameraFrameRef = React.useRef<number | null>(null);
  const epochRef = React.useRef(0);
  const workingRef = React.useRef<UniverseWorkingSet>(emptyUniverseWorkingSet());
  const budgetEpochRef = React.useRef(0);
  const budgetRef = React.useRef<{ nodes: number; edges: number }>(
    UNIVERSE_SCENE_BUDGET.mobile,
  );
  const visibleCountRef = React.useRef(0);
  const expandAbortRef = React.useRef<AbortController | null>(null);
  const expansionCacheRef = React.useRef(new Map<string, UniverseGraphPatch>());
  const expansionInflightRef = React.useRef(new Map<string, Promise<UniverseGraphPatch>>());
  const rebuildAbortRef = React.useRef<AbortController | null>(null);
  const autoRebuildAttemptedRef = React.useRef(false);
  const timelineAbortRef = React.useRef<AbortController | null>(null);
  const sourceTimelinePagesRef = React.useRef(new Map<string, SourceTimelinePageState>());
  const sourceContentLedgerRef = React.useRef(new Map<string, SourceContentLedger>());
  const completedSourcesRef = React.useRef(new Set<string>());
  const searchActivationRef = React.useRef(false);
  const viewportSourceRef = React.useRef<string | null>(null);
  const previousWorkspacePanelRef = React.useRef(workspacePanel);
  const cursorsRef = React.useRef(new Map<string, string>());
  const expandedAnchorsRef = React.useRef(new Set<string>());
  const nodeByIdRef = React.useRef(new Map<string, Universe3DNode>());
  const [dimensions, setDimensions] = React.useState({ width: 1, height: 1 });
  const [manifest, setManifest] = React.useState<UniverseManifest | null>(null);
  const [working, setWorking] = React.useState<UniverseWorkingSet>(emptyUniverseWorkingSet());
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [activePartition, setActivePartition] = React.useState<string | null>(null);
  const [viewportSourceId, setViewportSourceId] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [hoveredConcreteKey, setHoveredConcreteKey] = React.useState<string | null>(null);
  const [sourceHits, setSourceHits] = React.useState<
    NonNullable<UniverseActivation["source_hits"]>
  >([]);
  const [summary, setSummary] = React.useState<ActivationSummary | null>(null);
  const [expandingKey, setExpandingKey] = React.useState<string | null>(null);
  const [moreHint, setMoreHint] = React.useState("");
  const [, setLoadProgressRevision] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [error, setError] = React.useState("");
  const [webglAvailable, setWebglAvailable] = React.useState<boolean | null>(null);

  const mobile = dimensions.width < 768;
  const budget = React.useMemo(
    () => manifest
      ? mobile
        ? {
            nodes: manifest.policy.node_budget_mobile,
            edges: manifest.policy.edge_budget_mobile,
          }
        : {
            nodes: manifest.policy.node_budget_desktop,
            edges: manifest.policy.edge_budget_desktop,
          }
      : mobile
        ? UNIVERSE_SCENE_BUDGET.mobile
        : UNIVERSE_SCENE_BUDGET.desktop,
    [manifest, mobile],
  );
  if (budgetEpochRef.current !== epochRef.current) {
    budgetEpochRef.current = epochRef.current;
    budgetRef.current = budget;
  } else {
    budgetRef.current = {
      nodes: Math.max(budgetRef.current.nodes, budget.nodes),
      edges: Math.max(budgetRef.current.edges, budget.edges),
    };
  }

  const refreshLoadProgress = React.useCallback(() => {
    setLoadProgressRevision((current) => current + 1);
  }, []);

  const recordLoadedContent = React.useCallback((
    nodes: ReadonlyArray<{
      id: string;
      kind: UniverseNodeKind;
      source_id?: string | null;
    }>,
    fallbackSourceId?: string,
  ) => {
    if (rememberLoadedContent(sourceContentLedgerRef.current, nodes, fallbackSourceId)) {
      refreshLoadProgress();
    }
  }, [refreshLoadProgress]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const bounds = container.getBoundingClientRect();
      setDimensions({
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = (
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
      || canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true })
    );
    setWebglAvailable(Boolean(context));
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  }, []);

  const loadManifest = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setManifest(await api.universeManifest());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "知识宇宙暂时无法抵达");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  React.useEffect(() => {
    if (manifest?.status !== "building") return;
    let alive = true;
    const timer = window.setInterval(() => {
      void api.universeManifest().then((next) => {
        if (alive) setManifest(next);
      }).catch(() => undefined);
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [manifest?.status]);

  const sourcePartitions = React.useMemo(
    () => manifest?.partitions.filter((partition) => partition.kind === "source") ?? [],
    [manifest],
  );
  const sourceById = React.useMemo(
    () => new Map(sourcePartitions.map((partition) => [partition.source_id, partition])),
    [sourcePartitions],
  );
  const viewportSource = viewportSourceId
    ? sourceById.get(viewportSourceId) ?? null
    : null;
  const viewportLoadProgress: SourceLoadProgress | null = (() => {
    if (!viewportSource) return null;
    const ledger = sourceContentLedgerRef.current.get(viewportSource.source_id);
    const eventState = sourceTimelinePagesRef.current.get(viewportSource.source_id);
    const entityTotal = Math.max(0, viewportSource.entity_count);
    const eventTotal = Math.max(0, viewportSource.event_count);
    const entityLoaded = Math.min(entityTotal, ledger?.entities.size ?? 0);
    const eventLoaded = Math.min(eventTotal, ledger?.events.size ?? 0);
    const entities = {
      loaded: entityLoaded,
      total: entityTotal,
      done: entityTotal === 0 || entityLoaded >= entityTotal || Boolean(eventState?.done),
      loading: Boolean(eventState?.loading),
    };
    const events = {
      loaded: eventLoaded,
      total: eventTotal,
      done: eventTotal === 0 || eventLoaded >= eventTotal || Boolean(eventState?.done),
      loading: Boolean(eventState?.loading),
    };
    return {
      sourceId: viewportSource.source_id,
      label: viewportSource.label,
      entities,
      events,
      allDone: entities.done && events.done,
      loading: entities.loading || events.loading,
    };
  })();
  const renderedSourcePartitions = React.useMemo(() => {
    const limit = mobile
      ? PARTITION_RENDER_LIMIT.mobile
      : PARTITION_RENDER_LIMIT.desktop;
    const ranked = [...sourcePartitions].sort(
      (left, right) => right.importance - left.importance || left.id.localeCompare(right.id),
    );
    const rendered = ranked.slice(0, limit);
    if (activePartition && !rendered.some((item) => item.source_id === activePartition)) {
      const active = sourceById.get(activePartition);
      if (active) {
        if (rendered.length >= limit) rendered.pop();
        rendered.push(active);
      }
    }
    return rendered;
  }, [activePartition, mobile, sourceById, sourcePartitions]);

  const focusOverview = React.useCallback(() => {
    graphRef.current?.focusOverview();
  }, []);

  const focusResult = React.useCallback(() => {
    graphRef.current?.focusResult();
  }, []);

  const focusPartition = React.useCallback(
    (sourceId: string) => {
      if (!sourceById.has(sourceId)) return;
      setActivePartition(sourceId);
      graphRef.current?.focusSource(sourceId);
    },
    [sourceById],
  );

  const focusNode = React.useCallback((node: Universe3DNode) => {
    graphRef.current?.focusNode(node.id);
  }, []);

  const clearStageTimer = React.useCallback(() => {
    if (stageTimerRef.current !== null) window.clearTimeout(stageTimerRef.current);
    stageTimerRef.current = null;
  }, []);

  const clearCameraSchedule = React.useCallback(() => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    if (cameraFrameRef.current !== null) window.cancelAnimationFrame(cameraFrameRef.current);
    focusTimerRef.current = null;
    cameraFrameRef.current = null;
  }, []);

  const pruneExpansionState = React.useCallback((nodes: UniverseWorkingSet["nodes"]) => {
    const kept = new Set(
      nodes.map((node) => universeNodeKey(node.kind, node.id, node.source_id)),
    );
    for (const key of cursorsRef.current.keys()) {
      if (!kept.has(key)) cursorsRef.current.delete(key);
    }
    for (const key of expandedAnchorsRef.current) {
      if (!kept.has(key)) expandedAnchorsRef.current.delete(key);
    }
  }, []);

  const stageTo = React.useCallback(
    (_from: number, target: number) => {
      clearStageTimer();
      visibleCountRef.current = target;
      setVisibleCount(target);
    },
    [clearStageTimer],
  );

  const resetScene = React.useCallback(
    (epoch: number) => {
      if (epoch < epochRef.current) return;
      epochRef.current = epoch;
      expandAbortRef.current?.abort();
      expandAbortRef.current = null;
      timelineAbortRef.current?.abort();
      timelineAbortRef.current = null;
      sourceTimelinePagesRef.current.clear();
      sourceContentLedgerRef.current.clear();
      completedSourcesRef.current.clear();
      refreshLoadProgress();
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      clearStageTimer();
      clearCameraSchedule();
      cursorsRef.current.clear();
      expandedAnchorsRef.current.clear();
      const empty = emptyUniverseWorkingSet(epoch);
      workingRef.current = empty;
      setWorking(empty);
      visibleCountRef.current = 0;
      setVisibleCount(0);
      setSummary(null);
      searchActivationRef.current = false;
      setSelectedKey(null);
      setHoveredConcreteKey(null);
      setSourceHits([]);
      setActivePartition(null);
      setExpandingKey(null);
      setMoreHint("");
      const resetEpoch = epoch;
      cameraFrameRef.current = window.requestAnimationFrame(() => {
        cameraFrameRef.current = null;
        if (epochRef.current === resetEpoch) focusOverview();
      });
    },
    [clearCameraSchedule, clearStageTimer, focusOverview, refreshLoadProgress],
  );

  React.useEffect(() => {
    const onActivate = (event: Event) => {
      const activation = (event as CustomEvent<UniverseActivation>).detail;
      const epoch = activation?.epoch ?? epochRef.current + 1;
      if (!activation || epoch < epochRef.current) return;
      epochRef.current = epoch;
      expandAbortRef.current?.abort();
      timelineAbortRef.current?.abort();
      sourceTimelinePagesRef.current.clear();
      sourceContentLedgerRef.current.clear();
      completedSourcesRef.current.clear();
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      clearCameraSchedule();
      cursorsRef.current.clear();
      expandedAnchorsRef.current.clear();
      const next = replaceUniverseWorkingSet({ ...activation, epoch }, budget);
      recordLoadedContent(activation.nodes);
      workingRef.current = next;
      setWorking(next);
      setSelectedKey(null);
      setHoveredConcreteKey(null);
      setSourceHits(activation.source_hits ?? []);
      searchActivationRef.current = true;
      setMoreHint("");
      setSummary({
        query: activation.query,
        events: new Set(
          next.nodes.filter((node) => node.kind === "event").map((node) => node.id),
        ).size,
        entities: new Set(
          next.nodes.filter((node) => node.kind === "entity").map((node) => node.id),
        ).size,
        relations: next.relations.length,
      });
      const sourceId = dominantSource(activation);
      setActivePartition(sourceId);
      stageTo(0, next.nodes.length);
      if (sourceId) {
        const activationEpoch = epoch;
        focusTimerRef.current = window.setTimeout(() => {
          focusTimerRef.current = null;
          if (epochRef.current === activationEpoch) focusPartition(sourceId);
        }, reducedMotion ? 0 : 80);
      }
    };
    const onReset = (event: Event) => {
      const value = (event as CustomEvent<{ epoch: number }>).detail;
      resetScene(value?.epoch ?? epochRef.current + 1);
    };
    const onFocus = (event: Event) => {
      const value = (
        event as CustomEvent<{ kind: UniverseNodeKind; id: string; source_id: string }>
      ).detail;
      if (!value) return;
      clearCameraSchedule();
      const exactKey = universeNodeKey(value.kind, value.id, value.source_id);
      const node = nodeByIdRef.current.get(exactKey);
      if (!node) return;
      setSelectedKey(node.id);
      focusNode(node);
    };
    window.addEventListener(UNIVERSE_ACTIVATE_EVENT, onActivate);
    window.addEventListener(UNIVERSE_RESET_EVENT, onReset);
    window.addEventListener(UNIVERSE_FOCUS_EVENT, onFocus);
    return () => {
      window.removeEventListener(UNIVERSE_ACTIVATE_EVENT, onActivate);
      window.removeEventListener(UNIVERSE_RESET_EVENT, onReset);
      window.removeEventListener(UNIVERSE_FOCUS_EVENT, onFocus);
    };
  }, [
    budget,
    clearCameraSchedule,
    focusNode,
    focusPartition,
    recordLoadedContent,
    reducedMotion,
    resetScene,
    stageTo,
  ]);

  const graphData = React.useMemo(() => {
    const visualRadiusBySource = new Map(
      renderedSourcePartitions.map((partition) => [
        partition.source_id,
        visualNebulaRadius(
          partition.event_count,
          partition.entity_count,
          renderedSourcePartitions.length,
        ),
      ]),
    );
    const nodes: Universe3DNode[] = renderedSourcePartitions.map((partition) => ({
      id: `partition:${partition.source_id}`,
      kind: "source",
      rawId: partition.id,
      sourceId: partition.source_id,
      label: partition.label,
      description: "",
      category: "信息源",
      radius: visualRadiusBySource.get(partition.source_id) ?? partition.radius,
      density: partition.density,
      eventCount: partition.event_count,
      entityCount: partition.entity_count,
      relationCount: partition.relation_count,
      relatedCount: partition.relation_count,
      importance: partition.importance,
      statsReady: Boolean(manifest?.version),
      state: "active",
      root: true,
      x: partition.x,
      y: partition.y,
      z: partition.z,
    }));
    const links: Universe3DLink[] = [];

    const workingNodeByKey = new Map(
      working.nodes.map((node) => [
        universeNodeKey(node.kind, node.id, node.source_id),
        node,
      ]),
    );
    const visibleNodes = working.nodes.slice(
      0,
      Math.min(visibleCount, working.nodes.length),
    ).map((node) => workingNodeByKey.get(
      universeNodeKey(node.kind, node.id, node.source_id),
    ) ?? node);
    const resolvedSource = (kind: UniverseNodeKind, id: string, sourceId: string) => {
      if (sourceId) return sourceId;
      const relation = working.relations.find(
        (item) =>
          (kind === "event" && item.from_id === id)
          || (kind === "entity" && item.kind === "mentions" && item.to_id === id),
      );
      return relation?.source_id || activePartition || "";
    };
    const exactByRaw = new Map<string, string>();
    const positionByRaw = new Map<string, Position3D>();

    const addExactNode = (node: (typeof visibleNodes)[number], anchor?: Position3D) => {
      const sourceId = resolvedSource(node.kind, node.id, node.source_id);
      const key = universeNodeKey(node.kind, node.id, sourceId);
      const partition = sourceById.get(sourceId);
      const center = anchor ?? {
        x: partition?.x ?? 0,
        y: partition?.y ?? 0,
        z: partition?.z ?? 0,
      };
      const radius = anchor
        ? 34 + stableUnit(`${key}:local-radius`) * 42
        : Math.max(72, (visualRadiusBySource.get(sourceId) ?? 72) * 1.02);
      const offset = stableOffset(key, radius);
      const position = {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      };
      nodes.push({
        id: key,
        kind: node.kind,
        rawId: node.id,
        sourceId,
        label: node.label,
        description: node.description ?? "",
        category: node.category ?? (node.kind === "event" ? "事件" : "实体"),
        radius: 0,
        density: 0,
        eventCount: 0,
        entityCount: 0,
        relationCount: 0,
        relatedCount: node.related_count ?? 0,
        importance: node.importance ?? 0.5,
        statsReady: true,
        state: node.state ?? "active",
        root: node.root,
        ...position,
      });
      exactByRaw.set(key, key);
      positionByRaw.set(key, position);
    };

    visibleNodes
      .filter((node) => node.root && node.kind === "event")
      .forEach((node) => addExactNode(node));
    visibleNodes
      .filter((node) => node.root && node.kind === "entity")
      .forEach((node) => {
        const relation = working.relations.find(
          (item) =>
            item.source_id === node.source_id
            && item.kind === "mentions"
            && item.to_id === node.id,
        );
        addExactNode(
          node,
          relation
            ? positionByRaw.get(universeNodeKey("event", relation.from_id, relation.source_id))
            : undefined,
        );
      });
    visibleNodes
      .filter((node) => !node.root)
      .forEach((node) => {
        const relation = working.relations.find((item) =>
          item.source_id === node.source_id && (node.kind === "entity"
            ? item.kind === "mentions" && item.to_id === node.id
            : item.from_id === node.id),
        );
        const anchor = relation
          ? node.kind === "entity"
            ? positionByRaw.get(
                universeNodeKey("event", relation.from_id, relation.source_id),
              )
            : positionByRaw.get(
                universeNodeKey("entity", relation.to_id, relation.source_id),
              )
          : undefined;
        addExactNode(node, anchor);
      });

    working.relations.forEach((relation) => {
      const source = exactByRaw.get(
        universeNodeKey("event", relation.from_id, relation.source_id),
      );
      const targetKind = relation.kind === "subevent" ? "event" : "entity";
      const target = exactByRaw.get(
        universeNodeKey(targetKind, relation.to_id, relation.source_id),
      );
      if (!source || !target) return;
      links.push({
        id: `${relation.source_id}:${relation.kind}:${relation.from_id}:${relation.to_id}`,
        source,
        target,
        weight: relation.weight,
        virtual: false,
      });
    });
    nodeByIdRef.current = new Map(nodes.map((node) => [node.id, node]));
    return { epoch: working.epoch, nodes, links } satisfies UniverseSceneData;
  }, [
    activePartition,
    manifest?.version,
    renderedSourcePartitions,
    sourceById,
    visibleCount,
    working,
  ]);
  const selectedNode = React.useMemo(
    () => selectedKey
      ? graphData.nodes.find((node) => node.id === selectedKey) ?? null
      : null,
    [graphData, selectedKey],
  );
  const selectedConcreteNode = React.useMemo(
    () => isConcreteUniverseNode(selectedNode) ? selectedNode : null,
    [selectedNode],
  );
  const hoveredConcreteNode = React.useMemo(() => {
    if (!hoveredConcreteKey) return null;
    const node = graphData.nodes.find((item) => item.id === hoveredConcreteKey) ?? null;
    return isConcreteUniverseNode(node) ? node : null;
  }, [graphData.nodes, hoveredConcreteKey]);
  const inspectorNode = hoveredConcreteNode ?? selectedConcreteNode;
  const inspectorProgress = inspectorNode
    ? universeAnchorProgress(
        working,
        inspectorNode.kind,
        inspectorNode.rawId,
        inspectorNode.sourceId,
      )
    : 0;
  const inspectorTotal = inspectorNode
    ? Math.max(inspectorProgress, inspectorNode.relatedCount)
    : 0;
  const inspectorRemaining = Math.max(0, inspectorTotal - inspectorProgress);
  const inspectorAnchorKey = inspectorNode
    ? universeNodeKey(inspectorNode.kind, inspectorNode.rawId, inspectorNode.sourceId)
    : null;
  const inspectorExhausted = Boolean(
    inspectorAnchorKey
    && expandedAnchorsRef.current.has(inspectorAnchorKey)
    && !cursorsRef.current.has(inspectorAnchorKey),
  );
  const inspectorCanExpand = inspectorRemaining > 0 && !inspectorExhausted;

  const requestExpansion = React.useCallback(
    (
      node: Universe3DNode & { kind: "event" | "entity" },
      cursor: string | null,
      signal?: AbortSignal,
    ) => {
      const epoch = epochRef.current;
      const cacheKey = [epoch, node.sourceId, node.kind, node.rawId, cursor ?? "root"].join(":");
      const cached = expansionCacheRef.current.get(cacheKey);
      if (cached) {
        expansionCacheRef.current.delete(cacheKey);
        expansionCacheRef.current.set(cacheKey, cached);
        return Promise.resolve(cached);
      }
      const pending = expansionInflightRef.current.get(cacheKey);
      if (pending) return pending;
      const request = api
        .universeExpand(
          {
            epoch,
            source_id: node.sourceId,
            node_kind: node.kind,
            node_id: node.rawId,
            limit: node.kind === "event"
              ? manifest?.policy.event_entity_limit ?? 96
              : Math.min(
                  manifest?.policy.timeline_event_page_size ?? 8,
                  mobile ? 4 : 8,
                ),
            cursor,
          },
          signal,
        )
        .then((patch) => {
          if (patch.epoch === epochRef.current) {
            expansionCacheRef.current.set(cacheKey, patch);
            while (expansionCacheRef.current.size > 24) {
              const oldest = expansionCacheRef.current.keys().next().value;
              if (typeof oldest !== "string") break;
              expansionCacheRef.current.delete(oldest);
            }
          }
          return patch;
        })
        .finally(() => expansionInflightRef.current.delete(cacheKey));
      expansionInflightRef.current.set(cacheKey, request);
      return request;
    },
    [manifest?.policy.event_entity_limit, manifest?.policy.timeline_event_page_size, mobile],
  );

  const expandNode = React.useCallback(
    async (node: Universe3DNode) => {
      if ((node.kind !== "event" && node.kind !== "entity") || !node.sourceId) return;
      const exactNode = node as Universe3DNode & { kind: "event" | "entity" };
      const anchorKey = universeNodeKey(exactNode.kind, exactNode.rawId, exactNode.sourceId);
      const cursor = cursorsRef.current.get(anchorKey) ?? null;
      if (expandedAnchorsRef.current.has(anchorKey) && !cursor) return;
      expandAbortRef.current?.abort();
      const controller = new AbortController();
      expandAbortRef.current = controller;
      const requestEpoch = epochRef.current;
      setExpandingKey(node.id);
      setMoreHint("");
      try {
        const patch = await requestExpansion(
          exactNode,
          cursor,
          controller.signal,
        );
        if (patch.epoch !== epochRef.current || controller.signal.aborted) return;
        recordLoadedContent(patch.nodes, exactNode.sourceId);
        dispatchUniversePatch(patch);
        const previousCount = workingRef.current.nodes.length;
        const next = mergeUniverseGraphPatch(
          workingRef.current,
          patch,
          budgetRef.current,
        );
        workingRef.current = next;
        pruneExpansionState(next.nodes);
        setWorking(next);
        setSummary((current) => ({
          query: current?.query ?? node.label,
          events: next.nodes.filter((item) => item.kind === "event").length,
          entities: next.nodes.filter((item) => item.kind === "entity").length,
          relations: next.relations.length,
        }));
        expandedAnchorsRef.current.add(anchorKey);
        if (patch.page.next_cursor) cursorsRef.current.set(anchorKey, patch.page.next_cursor);
        else cursorsRef.current.delete(anchorKey);
        const committedCount = universeAnchorProgress(
          next,
          exactNode.kind,
          exactNode.rawId,
          exactNode.sourceId,
        );
        const totalCount = Math.max(committedCount, patch.anchor.related_count);
        const relationLabel = exactNode.kind === "entity" ? "关联事件" : "关联实体";
        setMoreHint(
          patch.page.has_more
            ? `已展示 ${committedCount} / ${totalCount} 个${relationLabel}，再次点击继续向更早内容探索`
            : `已展示全部 ${totalCount} 个${relationLabel}`,
        );
        stageTo(Math.min(previousCount, next.nodes.length), next.nodes.length);
      } catch (reason) {
        if (reason instanceof ApiError && reason.code === "aborted") return;
        setMoreHint(reason instanceof ApiError ? reason.message : "关联星点加载失败");
      } finally {
        if (expandAbortRef.current === controller) {
          expandAbortRef.current = null;
          if (requestEpoch === epochRef.current) setExpandingKey(null);
        }
      }
    },
    [pruneExpansionState, recordLoadedContent, requestExpansion, stageTo],
  );

  const loadSourceTimeline = React.useCallback(
    async (sourceId: string, requestedPages: number) => {
      if (!manifest) return;
      let state = sourceTimelinePagesRef.current.get(sourceId);
      if (!state) {
        state = { cursor: null, pages: 0, targetPages: 0, done: false, loading: false };
        sourceTimelinePagesRef.current.set(sourceId, state);
      }
      state.targetPages = Math.max(
        state.targetPages,
        requestedPages,
      );
      if (state.loading || state.done || state.pages >= state.targetPages) return;

      if (epochRef.current === 0) {
        epochRef.current = 1;
        const empty = emptyUniverseWorkingSet(1);
        workingRef.current = empty;
        setWorking(empty);
      }
      const epoch = epochRef.current;
      const source = sourceById.get(sourceId);
      state.loading = true;
      refreshLoadProgress();
      timelineAbortRef.current?.abort();
      const controller = new AbortController();
      timelineAbortRef.current = controller;
      setMoreHint("正在沿时间轴显现最近事件与关联实体");
      try {
        while (!state.done && state.pages < state.targetPages) {
          const page = await api.universeTimeline(
            {
              epoch,
              source_id: sourceId,
              limit: mobile
                ? Math.min(4, manifest.policy.timeline_event_page_size)
                : manifest.policy.timeline_event_page_size,
              cursor: state.cursor,
            },
            controller.signal,
          );
          if (page.epoch !== epochRef.current || controller.signal.aborted) return;
          recordLoadedContent(page.nodes, sourceId);
          const previousCount = workingRef.current.nodes.length;
          const next = mergeUniverseActivation(
            workingRef.current,
            {
              epoch,
              query: source?.label ?? "知识时间轴",
              nodes: page.nodes,
              relations: page.relations,
            },
            budgetRef.current,
            Date.now(),
            { roots: state.pages === 0 },
          );
          workingRef.current = next;
          setWorking(next);
          stageTo(previousCount, next.nodes.length);
          state.pages += 1;
          state.cursor = page.page.next_cursor;
          state.done = !page.page.has_more || !page.page.next_cursor;
          refreshLoadProgress();
          if (!searchActivationRef.current) {
            setSummary({
              query: source?.label ?? "知识时间轴",
              events: next.nodes.filter((item) => item.kind === "event").length,
              entities: next.nodes.filter((item) => item.kind === "entity").length,
              relations: next.relations.length,
            });
          }
        }
        const loadedEvents = workingRef.current.nodes.filter(
          (item) => item.source_id === sourceId && item.kind === "event",
        ).length;
        setMoreHint(
          state.done
            ? `已抵达 ${source?.label ?? "这个星系"} 的时间轴起点`
            : `已显现 ${loadedEvents} 个事件，继续拉近可查看更早内容`,
        );
      } catch (reason) {
        if (reason instanceof ApiError && reason.code === "aborted") return;
        setMoreHint(reason instanceof ApiError ? reason.message : "知识时间轴加载失败");
      } finally {
        state.loading = false;
        refreshLoadProgress();
        if (timelineAbortRef.current === controller) timelineAbortRef.current = null;
      }
    },
    [manifest, mobile, recordLoadedContent, refreshLoadProgress, sourceById, stageTo],
  );

  const activatePartition = React.useCallback(
    (node: Universe3DNode) => {
      clearCameraSchedule();
      setActivePartition(node.sourceId);
      focusPartition(node.sourceId);
      void loadSourceTimeline(node.sourceId, 1);
    },
    [clearCameraSchedule, focusPartition, loadSourceTimeline],
  );

  const handleSourceLod = React.useCallback(
    (sourceId: string, level: 0 | 1 | 2 | 3) => {
      if (level < 1) return;
      setActivePartition(sourceId);
      if (level >= 2) {
        const timelinePages = sourceTimelinePagesRef.current.get(sourceId)?.pages ?? 0;
        const requestedTimelinePages = sourceTimelinePageTargetForLod(level, timelinePages);
        void loadSourceTimeline(sourceId, requestedTimelinePages);
      }
    },
    [loadSourceTimeline],
  );

  const handleSceneViewChange = React.useCallback(
    (view: UniverseSceneView) => {
      dispatchUniverseView({
        mode: view.mode,
        source_id: view.sourceId,
        progress: view.progress,
      });
      if (viewportSourceRef.current === view.sourceId) return;
      viewportSourceRef.current = view.sourceId;
      setViewportSourceId(view.sourceId);
      if (!view.sourceId) {
        setHoveredConcreteKey(null);
      }
    },
    [],
  );

  const handleNodeClick = React.useCallback(
    (node: UniverseSceneNode) => {
      if (node.kind === "source") {
        setHoveredConcreteKey(null);
        activatePartition(node as Universe3DNode);
        return;
      }
      const exact = node as Universe3DNode & { kind: "event" | "entity" };
      setSelectedKey(exact.id);
      graphRef.current?.lockNode(exact.id);
      if (exact.kind === "event") {
        const loadedEntities = universeAnchorProgress(
          workingRef.current,
          "event",
          exact.rawId,
          exact.sourceId,
        );
        if (loadedEntities >= exact.relatedCount) {
          setMoreHint(
            exact.relatedCount > 0
              ? `事件关联的 ${exact.relatedCount} 个实体已全部呈现`
              : "这个事件暂未抽取到关联实体",
          );
          return;
        }
      }
      void expandNode(exact);
    },
    [activatePartition, expandNode],
  );

  const clearSelection = React.useCallback(() => {
    setSelectedKey(null);
    setHoveredConcreteKey(null);
  }, []);

  const handleSceneHover = React.useCallback((value: UniverseSceneHover | null) => {
    if (!value || value.node.kind === "source") {
      setHoveredConcreteKey(null);
      return;
    }
    const node = value.node as Universe3DNode & { kind: "event" | "entity" };
    setHoveredConcreteKey(node.id);
  }, []);

  React.useEffect(() => {
    if (!manifest || !webglAvailable) return;
    const frame = window.requestAnimationFrame(() => {
      focusOverview();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOverview, manifest, webglAvailable]);

  React.useEffect(() => {
    const previous = previousWorkspacePanelRef.current;
    previousWorkspacePanelRef.current = workspacePanel;
    if (previous === workspacePanel || workspacePanel === "normal") return;
    const timer = window.setTimeout(() => {
      if (summary) graphRef.current?.focusResult();
      else graphRef.current?.focusOverview();
    }, workspacePanel === "hidden" ? 220 : 80);
    return () => window.clearTimeout(timer);
  }, [summary, workspacePanel]);

  React.useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (interactive && document.visibilityState === "visible") graph.resume();
    else graph.pause();
  }, [interactive]);

  React.useEffect(() => {
    if (!viewportLoadProgress) return;
    if (!viewportLoadProgress.allDone) {
      completedSourcesRef.current.delete(viewportLoadProgress.sourceId);
      return;
    }
    if (viewportLoadProgress.loading) return;
    if (completedSourcesRef.current.has(viewportLoadProgress.sourceId)) return;
    completedSourcesRef.current.add(viewportLoadProgress.sourceId);
    setMoreHint(
      `${viewportLoadProgress.label} 已全部加载：${viewportLoadProgress.events.total} 个事件、${viewportLoadProgress.entities.total} 个实体`,
    );
  }, [viewportLoadProgress]);

  React.useEffect(() => {
    const onVisibility = () => {
      const graph = graphRef.current;
      if (!graph) return;
      if (interactive && document.visibilityState === "visible") graph.resume();
      else graph.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [interactive]);

  React.useEffect(
    () => () => {
      expandAbortRef.current?.abort();
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      rebuildAbortRef.current?.abort();
      timelineAbortRef.current?.abort();
      clearStageTimer();
      clearCameraSchedule();
    },
    [clearCameraSchedule, clearStageTimer],
  );

  const rebuild = React.useCallback(async () => {
    rebuildAbortRef.current?.abort();
    const controller = new AbortController();
    rebuildAbortRef.current = controller;
    setRebuilding(true);
    setError("");
    try {
      const queued = await api.rebuildUniverse(controller.signal);
      setMoreHint("统计刷新已进入后台队列");
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        if (controller.signal.aborted) return;
        const job = await api.getJob(queued.id, controller.signal);
        if (job.status === "failed") {
          throw new ApiError(0, "rebuild_failed", job.error || "知识宇宙统计刷新失败");
        }
        if (job.status !== "succeeded") continue;
        setManifest(await api.universeManifest());
        setMoreHint("统计轮廓已刷新");
        return;
      }
      throw new ApiError(0, "rebuild_timeout", "统计仍在后台构建，请稍后再看");
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "aborted") return;
      setError(reason instanceof ApiError ? reason.message : "知识宇宙统计刷新失败");
    } finally {
      if (rebuildAbortRef.current === controller) {
        rebuildAbortRef.current = null;
        setRebuilding(false);
      }
    }
  }, []);

  React.useEffect(() => {
    if (
      !interactive
      || !manifest?.stale
      || manifest.status !== "stale"
      || autoRebuildAttemptedRef.current
    ) return;
    autoRebuildAttemptedRef.current = true;
    void rebuild();
  }, [interactive, manifest, rebuild]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "sag-knowledge-universe absolute inset-0 z-[2] overflow-hidden",
        !interactive && "pointer-events-none",
      )}
      aria-label="SAG 动态知识宇宙"
    >
      {webglAvailable === true && manifest ? (
        <div className="sag-universe-graph absolute inset-0">
          <UniverseScene
            ref={graphRef}
            data={graphData}
            policy={manifest.policy}
            sourceHits={sourceHits}
            selectedId={selectedKey}
            darkTheme={darkTheme}
            interactive={interactive}
            reducedMotion={Boolean(reducedMotion)}
            onNodeClick={handleNodeClick}
            onHover={handleSceneHover}
            onViewChange={handleSceneViewChange}
            onSourceLod={handleSourceLod}
            onSelectionClear={clearSelection}
          />
        </div>
      ) : webglAvailable === false ? (
        <div className="absolute inset-0 grid place-items-center p-8">
          <div className="max-w-sm rounded-lg border border-border/70 bg-background/75 p-5 text-center shadow-soft backdrop-blur-md">
            <p className="text-sm font-medium">当前设备无法启用 WebGL</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              统计和搜索仍可正常使用；启用硬件加速后可进入 3D 知识宇宙。
            </p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-col items-start gap-2 sm:left-5 sm:top-5">
        <div
          data-universe-summary="true"
          className="flex max-w-[calc(100vw-4.75rem)] items-center gap-2 overflow-hidden rounded-md border border-border/60 bg-background/62 px-2.5 py-2 text-[11px] text-muted-foreground shadow-soft backdrop-blur-md sm:gap-3 sm:px-3"
        >
          <AnimatePresence initial={false} mode="wait">
            {viewportSource ? (
              <motion.div
                key={`detail:${viewportSource.source_id}`}
                className="flex min-w-0 items-center gap-2"
                initial={reducedMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 3 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.18,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_rgb(103_232_249_/_0.65)]" />
                <span
                  className="min-w-0 max-w-72 truncate font-medium text-foreground/90"
                  title={viewportSource.label}
                >
                  {viewportSource.label}
                </span>
                <span
                  className="min-w-0 max-w-52 truncate border-l border-border/70 pl-2 tabular-nums sm:pl-3"
                  title={manifest?.version
                    ? `${viewportSource.entity_count} 实体 · ${viewportSource.event_count} 事件`
                    : `${viewportSource.event_count} 事件 · 实体统计构建中`}
                >
                  {manifest?.version
                    ? `${compactCount(viewportSource.entity_count)} 实体 · ${compactCount(viewportSource.event_count)} 事件`
                    : `${compactCount(viewportSource.event_count)} 事件 · 实体统计构建中`}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="overview"
                className="flex min-w-0 items-center gap-2 sm:gap-3"
                initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.18,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <CircleDot className="size-3.5 text-cyan-200" />
                  <span className="hidden sm:inline">主题实体</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <Sparkles className="size-3.5 text-amber-300" />
                  <span className="hidden sm:inline">关联事件</span>
                </span>
                {summary ? (
                  <span className="min-w-0 max-w-64 truncate border-l border-border/70 pl-2 tabular-nums sm:pl-3" title={summary.query}>
                    {summary.events} 事件 · {summary.entities} 实体 · {summary.relations} 关系
                  </span>
                ) : manifest ? (
                  <span className="min-w-0 truncate border-l border-border/70 pl-2 tabular-nums sm:pl-3">
                    {manifest.version
                      ? `${manifest.counts.sources ?? 0} 信息源 · ${compactCount(manifest.counts.entities ?? 0)} 实体 · ${compactCount(manifest.counts.events ?? 0)} 事件`
                      : `${manifest.counts.sources ?? 0} 信息源 · ${compactCount(manifest.counts.events ?? 0)} 事件 · 实体统计构建中`}
                    {(manifest.counts.sources ?? 0) > renderedSourcePartitions.length
                      ? ` · 当前显示 ${renderedSourcePartitions.length} 个高密度轮廓`
                      : ""}
                  </span>
                ) : null}
                {(manifest?.status === "failed" || manifest?.stale || manifest?.status === "building") && (
                  <TooltipProvider delayDuration={220}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            manifest.status === "failed"
                              ? "bg-rose-400 shadow-[0_0_8px_rgb(251_113_133_/_0.5)]"
                              : "bg-amber-300 shadow-[0_0_8px_rgb(252_211_77_/_0.45)]",
                          )}
                          role="status"
                          aria-label={manifest.status === "failed"
                            ? "统计刷新失败"
                            : manifest.status === "building" || rebuilding
                              ? "统计正在后台刷新"
                              : "统计准备刷新"}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {manifest.status === "failed"
                          ? "统计刷新失败"
                          : manifest.status === "building" || rebuilding
                            ? "统计正在后台刷新"
                            : "统计准备刷新"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {expandingKey && <Loader2 className="size-3 animate-spin" />}
        </div>

        <AnimatePresence initial={false}>
          {interactive && viewportLoadProgress && (
            <UniverseLoadProgressPanel
              key={viewportLoadProgress.sourceId}
              progress={viewportLoadProgress}
              reducedMotion={Boolean(reducedMotion)}
            />
          )}
        </AnimatePresence>
      </div>

      {(moreHint || error) && (
        <div className={cn(
          "pointer-events-none absolute bottom-5 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-md border border-border/60 bg-background/72 px-3 py-2 text-[11px] text-muted-foreground shadow-soft backdrop-blur-md",
          inspectorNode && viewportSource && "bottom-44",
        )} role="status" aria-live="polite">
          {error || moreHint}
        </div>
      )}

      {interactive && inspectorNode && viewportSource && (
        <TooltipProvider delayDuration={180}>
          <div
            data-universe-inspector="true"
            className="absolute bottom-48 left-4 z-20 w-[min(360px,calc(100vw-5.5rem))] rounded-md border border-border/70 bg-background/90 p-3 shadow-soft backdrop-blur-xl sm:bottom-5 sm:left-6"
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-1 size-2 shrink-0 rounded-full",
                  inspectorNode.kind === "entity"
                    ? "bg-cyan-300 shadow-[0_0_10px_rgb(103_232_249_/_0.75)]"
                    : "bg-amber-300 shadow-[0_0_10px_rgb(252_211_77_/_0.75)]",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-medium">{inspectorNode.label}</p>
                  {hoveredConcreteNode && (
                    <span className="shrink-0 text-[9px] text-muted-foreground">悬停</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {inspectorNode.kind === "entity" ? "实体" : "事件"}
                  {" · "}
                  {sourceById.get(inspectorNode.sourceId)?.label ?? inspectorNode.category}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => dispatchUniverseDetail(
                        inspectorNode.kind,
                        inspectorNode.rawId,
                        inspectorNode.sourceId,
                      )}
                      aria-label="查看原文详情"
                    >
                      <Info className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>查看原文详情</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => dispatchUniverseAsk(inspectorNode)}
                      aria-label="向宇航员提问"
                    >
                      <MessageCircleQuestion className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>向宇航员提问</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={clearSelection}
                      aria-label="取消选择"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>取消选择</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {inspectorNode.description || (
                inspectorNode.kind === "entity"
                  ? `${inspectorNode.category}，可继续探索它关联的事件。`
                  : `${inspectorNode.category}，关联实体已随事件一同呈现。`
              )}
            </p>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/70">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    inspectorNode.kind === "entity" ? "bg-cyan-400/75" : "bg-amber-400/75",
                  )}
                  style={{
                    width: `${inspectorTotal > 0
                      ? Math.min(100, Math.max(3, inspectorProgress / inspectorTotal * 100))
                      : 0}%`,
                  }}
                />
              </div>
              <span className="shrink-0 tabular-nums">
                {inspectorProgress} / {inspectorTotal}
              </span>
            </div>
            <div className="mt-2 flex min-h-7 items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[10px] text-muted-foreground">
                {expandingKey === inspectorNode.id
                  ? "正在拓展下一批关联"
                  : inspectorCanExpand
                    ? `还有 ${inspectorRemaining} 个关联可探索`
                    : inspectorExhausted && inspectorRemaining > 0
                      ? "已到达当前时间范围的起点"
                    : inspectorTotal > 0
                      ? "关联内容已全部呈现"
                      : "暂无可探索的关联"}
              </p>
              {inspectorCanExpand && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 border-border/70 bg-background/70 px-2.5 text-[10px] shadow-none"
                  onClick={() => handleNodeClick(inspectorNode)}
                  disabled={expandingKey === inspectorNode.id}
                >
                  {expandingKey === inspectorNode.id
                    ? <Loader2 className="size-3 animate-spin" />
                    : <GitBranch className="size-3" />}
                  探索更多
                </Button>
              )}
            </div>
          </div>
        </TooltipProvider>
      )}

      {(loading || webglAvailable === null) && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {interactive && (
        <TooltipProvider delayDuration={240}>
          <div className="absolute bottom-5 right-5 z-10 flex flex-col gap-1.5">
            <IconControl
              label="回到当前结果"
              onClick={focusResult}
              disabled={!summary && !selectedKey}
            >
              <LocateFixed className="size-3.5" />
            </IconControl>
            <IconControl label="回到完整宇宙" onClick={focusOverview} disabled={!manifest}>
              <Focus className="size-3.5" />
            </IconControl>
            <IconControl
              label="重置探索并归位"
              onClick={() => resetScene(epochRef.current + 1)}
              disabled={!working.nodes.length}
            >
              <RotateCcw className="size-3.5" />
            </IconControl>
            <IconControl label="刷新统计轮廓" onClick={() => void rebuild()} disabled={rebuilding}>
              <RefreshCw className={cn("size-3.5", rebuilding && "animate-spin")} />
            </IconControl>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
