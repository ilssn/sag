"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  EyeOff,
  Hand,
  History,
  Loader2,
  MessageCircleQuestion,
  MessageSquarePlus,
  Music2,
  Plus,
  Rocket,
  Route,
  Search,
  Settings2,
  Smile,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { normalizeAvatar } from "@/lib/avatar";
import { chatLive, type ChatLiveState } from "@/lib/chat-live";
import {
  PetAgent,
  type PetAgentActivity,
  type PetAgentFacing,
} from "@/lib/pet-agent";
import {
  encodePetDraft,
  PET_DRAFT_EVENT,
  PET_DRAFT_KEY,
  type PetDraftPayload,
} from "@/lib/pet-events";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";

type PetVisualMode = PetAgentActivity | "jumping" | "flying" | "roaming" | "dancing";

interface PetActivity {
  streaming: boolean;
  mode: Exclude<PetAgentActivity, "done">;
  label: string;
  threadId: string | null;
  failed: boolean;
}

const DEFAULT_FACE_PRESETS = [
  "@_@",
  "^_^",
  "-_-",
  "o_o",
  "._.",
  ">_<",
  "x_x",
  "AI",
  "01",
  "S",
  "Z",
] as const;
const IDLE_EXPRESSIONS = ["^_^", "-_-", "o_o", "._.", "u_u"] as const;
const PET_FACE_KEY = "sag:pet-face";
const PET_FACE_MODE_KEY = "sag:pet-face-mode";
const PET_FACE_PRESETS_KEY = "sag:pet-face-presets";
const MAX_FACE_PRESETS = 24;
const PET_VIEWPORT_MARGIN = 24;
const MODE_EXPRESSIONS: Partial<Record<PetVisualMode, string>> = {
  thinking: "._.",
  searching: "o_o",
  working: ">_<",
  answering: "^_^",
  done: "^o^",
  error: "x_x",
  jumping: "^_^",
  flying: "^O^",
  roaming: "^o^",
  dancing: "^3^",
};
const RETRIEVAL_TOOL = /search|context|entity|retriev|knowledge|source|chunk/i;

function faceStyle(value: string): React.CSSProperties {
  const length = Array.from(value).length;
  const emojiLike = /\p{Extended_Pictographic}/u.test(value);
  if (emojiLike && length <= 2) {
    return { fontFamily: "system-ui, sans-serif", fontSize: length === 1 ? 28 : 23 };
  }
  if (length <= 1) return { fontSize: 22 };
  if (length <= 3) return { fontSize: 18 };
  if (length <= 5) return { fontSize: 13 };
  return { fontSize: 10 };
}

function normalizeFace(value: string) {
  const next = normalizeAvatar(value);
  return next === "s" ? "S" : next;
}

function nameplateStyle(value: string): React.CSSProperties {
  const length = Array.from(value).length;
  if (length <= 3) return { fontSize: 7 };
  if (length <= 5) return { fontSize: 6 };
  return { fontSize: 5 };
}

function deriveActivity(state: ChatLiveState): PetActivity {
  const active = [...state.steps].reverse().find((step) => step.status === "active");
  const failed =
    state.steps.some((step) => step.status === "error") && state.content.trim().length === 0;

  if (!state.streaming) {
    return { streaming: false, mode: failed ? "error" : "idle", label: "", threadId: state.threadId, failed };
  }
  if (!active || active.kind === "thinking") {
    return {
      streaming: true,
      mode: "thinking",
      label: "正在思考下一步",
      threadId: state.threadId,
      failed,
    };
  }
  if (active.kind === "answer") {
    return {
      streaming: true,
      mode: "answering",
      label: "正在组织回答",
      threadId: state.threadId,
      failed,
    };
  }
  if (RETRIEVAL_TOOL.test(active.name ?? "")) {
    return {
      streaming: true,
      mode: "searching",
      label: active.name === "get_entity" ? "正在翻找实体线索" : "正在翻找知识背包",
      threadId: state.threadId,
      failed,
    };
  }
  return {
    streaming: true,
    mode: "working",
    label: "正在使用工具处理",
    threadId: state.threadId,
    failed,
  };
}

function usePetActivity() {
  const [activity, setActivity] = React.useState(() => deriveActivity(chatLive.get()));

  React.useEffect(() => {
    const sync = () => {
      const next = deriveActivity(chatLive.get());
      setActivity((current) =>
        current.streaming === next.streaming &&
        current.mode === next.mode &&
        current.label === next.label &&
        current.threadId === next.threadId &&
        current.failed === next.failed
          ? current
          : next,
      );
    };
    sync();
    return chatLive.subscribe(sync);
  }, []);

  return activity;
}

function compactNumber(value: number) {
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

interface PetProps {
  character?: PetAgent;
  syncIdentity?: boolean;
  visible?: boolean;
}

interface PetRoamPath {
  x: number[];
  y: number[];
}

interface PetActionButtonProps {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  slot: "ask" | "wave" | "fly" | "roam" | "dance" | "hide";
}

function PetActionButton({
  children,
  disabled,
  label,
  onClick,
  slot,
}: PetActionButtonProps) {
  return (
    <button
      type="button"
      data-slot={slot}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="sag-pet__action"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** 视口级知识宇航员：角色对象负责状态与动作，组件只处理输入和渲染。 */
export function Pet({ character: providedCharacter, syncIdentity, visible = true }: PetProps = {}) {
  const { agent, capabilities, threads } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const activity = usePetActivity();
  const ownedCharacter = React.useMemo(
    () => new PetAgent({ name: "sag", avatar: "S", size: 1 }),
    [],
  );
  const character = providedCharacter ?? ownedCharacter;
  const shouldSyncIdentity = syncIdentity ?? !providedCharacter;
  const characterState = React.useSyncExternalStore(
    character.subscribe,
    character.getSnapshot,
    character.getSnapshot,
  );
  const [alignRight, setAlignRight] = React.useState(false);
  const [panelAbove, setPanelAbove] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [curious, setCurious] = React.useState(false);
  const [faceEditorOpen, setFaceEditorOpen] = React.useState(false);
  const [face, setFace] = React.useState<string | null>(null);
  const [facePresets, setFacePresets] = React.useState<string[]>(() => [
    ...DEFAULT_FACE_PRESETS,
  ]);
  const [roamPath, setRoamPath] = React.useState<PetRoamPath | null>(null);
  const [draft, setDraft] = React.useState("");
  const [knowledgeStats, setKnowledgeStats] = React.useState<{
    sources: number;
    chunks: number;
  } | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const dragRef = React.useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    lastX: number;
    facing: PetAgentFacing;
    moved: boolean;
  } | null>(null);
  const lastPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = React.useRef(false);
  const statsAttemptedRef = React.useRef(false);
  const wasStreamingRef = React.useRef(activity.streaming);
  const pointerFrameRef = React.useRef<number | null>(null);
  const pointerRef = React.useRef({ x: 0, y: 0 });
  const elRef = React.useRef<HTMLDivElement>(null);
  const visualRef = React.useRef<HTMLDivElement>(null);
  const agentFace = normalizeFace(agent?.avatar || agent?.name?.slice(0, 1) || "S") || "S";
  const identityFace = shouldSyncIdentity ? agentFace : characterState.identity.avatar;
  const displayFace = normalizeFace(face === null ? identityFace : face);

  React.useEffect(
    () => () => {
      if (!providedCharacter) ownedCharacter.destroy();
    },
    [ownedCharacter, providedCharacter],
  );

  React.useEffect(() => {
    if (!shouldSyncIdentity) return;
    character.configure({
      name: agent?.name || "sag",
      avatar: displayFace,
      size: 1,
    });
  }, [agent?.name, character, displayFace, shouldSyncIdentity]);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sag:pet-pos");
      if (saved) {
        const parsed = JSON.parse(saved) as { x?: unknown; y?: unknown };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          const width = 94 * character.getSnapshot().identity.size;
          const height = 118 * character.getSnapshot().identity.size;
          const next = {
            x: Math.min(
              Math.max(PET_VIEWPORT_MARGIN, parsed.x),
              Math.max(PET_VIEWPORT_MARGIN, window.innerWidth - width - PET_VIEWPORT_MARGIN),
            ),
            y: Math.min(
              Math.max(PET_VIEWPORT_MARGIN, parsed.y),
              Math.max(PET_VIEWPORT_MARGIN, window.innerHeight - height - PET_VIEWPORT_MARGIN),
            ),
          };
          character.moveTo(next);
          lastPosRef.current = next;
          setAlignRight(next.x + width / 2 > window.innerWidth / 2);
          setPanelAbove(next.y + height / 2 > window.innerHeight / 2);
        }
      }
      const savedFacing = window.localStorage.getItem("sag:pet-facing");
      if (savedFacing === "left" || savedFacing === "right") character.face(savedFacing);
      const savedFaceMode = window.localStorage.getItem(PET_FACE_MODE_KEY);
      const savedFace = window.localStorage.getItem(PET_FACE_KEY);
      const legacyFace = window.localStorage.getItem("sag:pet-emoji");
      if (savedFaceMode === "custom") setFace(normalizeFace(savedFace ?? ""));
      else if (savedFace !== null) setFace(normalizeFace(savedFace));
      else if (legacyFace !== null) setFace(normalizeFace(legacyFace));

      const savedPresets = window.localStorage.getItem(PET_FACE_PRESETS_KEY);
      if (savedPresets !== null) {
        const parsed = JSON.parse(savedPresets) as unknown;
        if (Array.isArray(parsed)) {
          const next = Array.from(
            new Set(
              parsed
                .filter((value): value is string => typeof value === "string")
                .map(normalizeFace)
                .filter(Boolean),
            ),
          ).slice(0, MAX_FACE_PRESETS);
          setFacePresets(next);
        }
      }
    } catch {
      /* ignore */
    }
  }, [character]);

  React.useEffect(() => {
    lastPosRef.current = characterState.position;
  }, [characterState.position]);

  React.useEffect(() => {
    const keepVisible = () => {
      const current = lastPosRef.current;
      if (!current) return;
      const width = visualRef.current?.offsetWidth ?? 94;
      const height = visualRef.current?.offsetHeight ?? 118;
      const next = {
        x: Math.min(
          Math.max(PET_VIEWPORT_MARGIN, current.x),
          Math.max(PET_VIEWPORT_MARGIN, window.innerWidth - width - PET_VIEWPORT_MARGIN),
        ),
        y: Math.min(
          Math.max(PET_VIEWPORT_MARGIN, current.y),
          Math.max(PET_VIEWPORT_MARGIN, window.innerHeight - height - PET_VIEWPORT_MARGIN),
        ),
      };
      lastPosRef.current = next;
      character.moveTo(next);
      setAlignRight(next.x + width / 2 > window.innerWidth / 2);
      setPanelAbove(next.y + height / 2 > window.innerHeight / 2);
    };
    keepVisible();
    window.addEventListener("resize", keepVisible);
    return () => window.removeEventListener("resize", keepVisible);
  }, [character]);

  React.useEffect(() => {
    if (!open || knowledgeStats || statsAttemptedRef.current) return;
    statsAttemptedRef.current = true;
    setStatsLoading(true);
    api
      .listSources()
      .then((sources) =>
        setKnowledgeStats({
          sources: sources.length,
          chunks: sources.reduce((total, source) => total + source.chunk_count, 0),
        }),
      )
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [knowledgeStats, open]);

  const recentThread = React.useMemo(
    () =>
      [...threads].sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
      )[0] ?? null,
    [threads],
  );
  const activeThread = activity.threadId
    ? threads.find((thread) => thread.id === activity.threadId) ?? null
    : null;
  const canAct = !reduceMotion && !activity.streaming && characterState.motion === "idle";

  const triggerWave = React.useCallback(() => {
    if (!canAct) return;
    character.wave();
  }, [canAct, character]);

  const triggerFlight = React.useCallback(() => {
    if (!canAct) return;
    const top = visualRef.current?.getBoundingClientRect().top ?? 140;
    const availableLift = top - 10;
    setOpen(false);
    if (availableLift < 42) character.jump();
    else character.fly({ height: Math.min(300, availableLift) });
  }, [canAct, character]);

  const triggerDance = React.useCallback(() => {
    if (!canAct) return;
    setOpen(false);
    character.dance();
  }, [canAct, character]);

  const triggerRoam = React.useCallback(() => {
    if (!canAct) return;
    const visual = visualRef.current;
    if (!visual) return;
    const rect = visual.getBoundingClientRect();
    const margin = 14;
    const left = margin - rect.left;
    const right = window.innerWidth - rect.width - margin - rect.left;
    const top = margin - rect.top;
    const bottom = window.innerHeight - rect.height - margin - rect.top;
    const startsBelowCenter = rect.top + rect.height / 2 > window.innerHeight / 2;
    setRoamPath(
      startsBelowCenter
        ? {
            x: [0, left, left, right, right, left, 0],
            y: [0, bottom, top, top, bottom, bottom, 0],
          }
        : {
            x: [0, left, left, right, right, left, 0],
            y: [0, top, bottom, bottom, top, top, 0],
          },
    );
    setOpen(false);
    character.roam();
  }, [canAct, character]);

  React.useEffect(() => {
    if (activity.streaming) {
      const options = {
        threadId: activity.threadId ?? undefined,
        detail: activeThread?.title,
        duration: null,
      } as const;
      if (activity.mode === "thinking") character.think(activity.label, options);
      else if (activity.mode === "searching") character.search(activity.label, options);
      else if (activity.mode === "answering") character.answer(activity.label, options);
      else character.work(activity.label, options);
    } else if (wasStreamingRef.current) {
      const options = {
        threadId: activity.threadId ?? undefined,
        detail: activeThread?.title,
      };
      if (activity.failed) character.fail("这次没有顺利完成", options);
      else character.complete("回答完成，来看看吧", options);
    }
    wasStreamingRef.current = activity.streaming;
  }, [
    activeThread?.title,
    activity.failed,
    activity.label,
    activity.mode,
    activity.streaming,
    activity.threadId,
    character,
  ]);

  React.useEffect(() => {
    if (
      reduceMotion ||
      !visible ||
      open ||
      characterState.activity !== "idle" ||
      characterState.motion !== "idle"
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const roll = Math.random();
      if (roll < 0.2) triggerDance();
      else if (roll < 0.44) triggerFlight();
      else triggerWave();
    }, 16_000 + Math.round(Math.random() * 12_000));
    return () => window.clearTimeout(timer);
  }, [
    characterState.activity,
    characterState.motion,
    open,
    reduceMotion,
    triggerDance,
    triggerFlight,
    triggerWave,
    visible,
  ]);

  React.useEffect(() => {
    if (
      reduceMotion ||
      !visible ||
      open ||
      curious ||
      displayFace.length === 0 ||
      characterState.activity !== "idle" ||
      characterState.motion !== "idle" ||
      characterState.expression
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const choices = IDLE_EXPRESSIONS.filter((expression) => expression !== displayFace);
      const expression = choices[Math.floor(Math.random() * choices.length)] ?? "^_^";
      character.emote(expression, 1_650 + Math.round(Math.random() * 900));
    }, 7_500 + Math.round(Math.random() * 8_500));
    return () => window.clearTimeout(timer);
  }, [
    character,
    characterState.activity,
    characterState.expression,
    characterState.motion,
    curious,
    displayFace,
    open,
    reduceMotion,
    visible,
  ]);

  React.useEffect(() => {
    if (reduceMotion) return;
    const updateLook = () => {
      pointerFrameRef.current = null;
      const visual = visualRef.current;
      if (!visual) return;
      const rect = visual.getBoundingClientRect();
      const dx = Math.max(-1, Math.min(1, (pointerRef.current.x - (rect.left + rect.width / 2)) / 340));
      const dy = Math.max(-1, Math.min(1, (pointerRef.current.y - (rect.top + rect.height / 2)) / 260));
      character.lookAt(dx, dy);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (pointerFrameRef.current === null) {
        pointerFrameRef.current = requestAnimationFrame(updateLook);
      }
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
    };
  }, [character, reduceMotion]);

  const visualMode: PetVisualMode =
    characterState.motion === "fly"
      ? "flying"
      : characterState.motion === "roam"
        ? "roaming"
        : characterState.motion === "dance"
          ? "dancing"
      : characterState.motion === "jump"
          ? "jumping"
          : characterState.activity;
  const statusText = characterState.speech?.text ?? "";
  const statusThread = characterState.speech?.threadId
    ? threads.find((thread) => thread.id === characterState.speech?.threadId) ?? null
    : activeThread;
  const isBusy = ["thinking", "searching", "working", "answering"].includes(
    characterState.activity,
  );
  const renderedFace =
    (characterState.motion === "wave" ? "^_^" : null) ??
    MODE_EXPRESSIONS[visualMode] ??
    (curious && !open && visualMode === "idle" ? "?_?" : null) ??
    characterState.expression ??
    displayFace;
  const petName = Array.from(characterState.identity.name || "sag").slice(0, 7).join("");
  const canAddFacePreset =
    Boolean(displayFace) &&
    !facePresets.includes(displayFace) &&
    facePresets.length < MAX_FACE_PRESETS;

  function saveFace(value: string) {
    const next = normalizeFace(value);
    setFace(next);
    character.setAvatar(next);
    window.localStorage.removeItem("sag:pet-emoji");
    window.localStorage.setItem(PET_FACE_MODE_KEY, "custom");
    window.localStorage.setItem(PET_FACE_KEY, next);
  }

  function persistFacePresets(next: string[]) {
    setFacePresets(next);
    window.localStorage.setItem(PET_FACE_PRESETS_KEY, JSON.stringify(next));
  }

  function addFacePreset() {
    if (!canAddFacePreset) return;
    persistFacePresets([...facePresets, displayFace]);
  }

  function removeFacePreset(preset: string) {
    persistFacePresets(facePresets.filter((value) => value !== preset));
  }

  function followAvatar() {
    setFace(null);
    character.setAvatar(identityFace);
    window.localStorage.removeItem(PET_FACE_MODE_KEY);
    window.localStorage.removeItem(PET_FACE_KEY);
    window.localStorage.removeItem("sag:pet-emoji");
  }

  function hide() {
    setOpen(false);
    window.localStorage.setItem("sag:pet", "off");
    window.dispatchEvent(new Event("sag:pet-toggle"));
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    setCurious(false);
    const visual = visualRef.current;
    const el = elRef.current;
    if (!visual || !el) return;
    suppressClickRef.current = false;
    const rect = visual.getBoundingClientRect();
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      facing: characterState.facing,
      moved: false,
    };
    el.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    suppressClickRef.current = true;
    const horizontalDelta = event.clientX - drag.lastX;
    if (Math.abs(horizontalDelta) >= 8) {
      drag.facing = horizontalDelta < 0 ? "left" : "right";
      character.face(drag.facing);
      drag.lastX = event.clientX;
    }
    const width = visualRef.current?.offsetWidth ?? 94;
    const height = visualRef.current?.offsetHeight ?? 118;
    const next = {
      x: Math.min(
        Math.max(PET_VIEWPORT_MARGIN, event.clientX - drag.dx),
        window.innerWidth - width - PET_VIEWPORT_MARGIN,
      ),
      y: Math.min(
        Math.max(PET_VIEWPORT_MARGIN, event.clientY - drag.dy),
        window.innerHeight - height - PET_VIEWPORT_MARGIN,
      ),
    };
    lastPosRef.current = next;
    character.moveTo(next);
    setAlignRight(next.x + width / 2 > window.innerWidth / 2);
    setPanelAbove(next.y + height / 2 > window.innerHeight / 2);
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved && lastPosRef.current) {
      window.localStorage.setItem("sag:pet-pos", JSON.stringify(lastPosRef.current));
      window.localStorage.setItem("sag:pet-facing", drag.facing);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function handoffDraft(event: React.FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    const payload: PetDraftPayload = { text: next, submit: true };
    try {
      window.sessionStorage.setItem(PET_DRAFT_KEY, encodePetDraft(payload));
    } catch {
      /* ignore */
    }
    if (pathname.startsWith("/chat")) {
      window.dispatchEvent(new CustomEvent(PET_DRAFT_EVENT, { detail: payload }));
    } else {
      router.push("/chat");
    }
    setDraft("");
    setOpen(false);
  }

  const style: React.CSSProperties = characterState.position
    ? { left: characterState.position.x, top: characterState.position.y, right: "auto", bottom: "auto" }
    : {};
  const panelSide = alignRight ? "right-0" : "left-0";
  const panelVertical = panelAbove ? "bottom-full mb-2" : "top-full mt-2";
  const scale = characterState.identity.size;
  const visualStyle = {
    width: 94 * scale,
    height: 118 * scale,
  } as React.CSSProperties;
  const characterStyle = {
    "--pet-scale": scale,
    "--pet-look-x": `${(characterState.look.x * 2.4).toFixed(2)}px`,
    "--pet-look-y": `${(characterState.look.y * 1.7).toFixed(2)}px`,
    "--pet-look-rotate": `${(characterState.look.x * 1.2).toFixed(2)}deg`,
  } as React.CSSProperties;
  const visualAnimate = reduceMotion
    ? undefined
    : characterState.motion === "fly"
      ? {
          x: [0, 1.8, -1.2, 0.8, -0.5, 0.3, -0.2, 0],
          y: [
            0,
            -characterState.flightLift * 0.18,
            -characterState.flightLift,
            -characterState.flightLift * 1.03,
            -characterState.flightLift * 0.97,
            -characterState.flightLift * 0.76,
            -characterState.flightLift * 0.38,
            0,
          ],
          rotate: [0, -3.2, 1.8, -1.4, 0.8, -0.5, 0.2, 0],
        }
      : characterState.motion === "roam"
        ? roamPath
          ? {
              x: roamPath.x,
              y: roamPath.y,
              rotate: [0, -2.4, 1.2, 2.2, -1.4, -2, 0],
            }
          : { x: 0, y: 0, rotate: 0 }
      : characterState.motion === "dance"
        ? {
            x: [0, -5, 5, -6, 6, -5, 5, 0],
            y: [0, -8, 0, -12, 0, -9, 0, 0],
            rotate: [0, -7, 7, -9, 9, -7, 7, 0],
          }
      : characterState.motion === "jump"
        ? { x: [0, 0.5, 0], y: [0, -8, 0], rotate: [0, -2, 0] }
        : visualMode === "idle"
          ? {
              x: [0, 4.2, 1.4, -4.6, -1.5, 0],
              y: [0, -5.8, -2.4, 3.8, 1.2, 0],
              rotate: [0, 0.62, 0.2, -0.56, -0.14, 0],
            }
          : { x: [0, 0.45, 0], y: [0, -1, 0], rotate: [0, 0, 0] };
  const visualTransition = reduceMotion
    ? undefined
    : characterState.motion === "fly"
      ? {
          duration: 6.8,
          times: [0, 0.04, 0.18, 0.28, 0.42, 0.6, 0.82, 1],
          ease: "easeInOut" as const,
        }
      : characterState.motion === "roam"
        ? {
            duration: roamPath ? 14 : 0,
            times: roamPath ? [0, 0.08, 0.27, 0.51, 0.73, 0.91, 1] : undefined,
            ease: "easeInOut" as const,
          }
      : characterState.motion === "dance"
        ? {
            duration: 5.2,
            times: [0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.8, 1],
            ease: "easeInOut" as const,
          }
      : characterState.motion === "jump"
        ? { duration: 0.76, times: [0, 0.46, 1], ease: "easeOut" as const }
        : {
            duration: visualMode === "idle" ? 9.2 : 3.5,
            repeat: Infinity,
            ease: "easeInOut" as const,
          };

  if (!visible) return null;

  return (
    <div
      ref={elRef}
      className="sag-pet-shell group/pet fixed bottom-24 left-5 z-40 hidden select-none md:block"
      data-facing={characterState.facing}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => setCurious(true)}
      onPointerLeave={() => setCurious(false)}
    >
      <AnimatePresence>
        {!open && statusText && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              characterState.speech?.threadId &&
              router.push(`/chat/${characterState.speech.threadId}`)
            }
            className={cn(
              "absolute flex w-60 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-left shadow-lift",
              panelVertical,
              panelSide,
            )}
            aria-live="polite"
          >
            {isBusy ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : characterState.speech?.tone === "success" ? (
              <Check className="size-3.5 shrink-0 text-success" />
            ) : characterState.speech?.tone === "error" ? (
              <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
            ) : (
              <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{statusText}</span>
              {statusThread && (
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {statusThread.title}
                </span>
              )}
            </span>
          </motion.button>
        )}

        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 7 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 5 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className={cn(
              "absolute w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-lift",
              panelVertical,
              panelSide,
            )}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <span
                className="sag-pet-status-dot"
                data-active={isBusy ? "true" : "false"}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {characterState.identity.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {isBusy
                    ? characterState.speech?.text
                    : capabilities?.llm_configured
                      ? knowledgeStats
                        ? `${knowledgeStats.sources} 个知识库 · ${compactNumber(knowledgeStats.chunks)} 段`
                        : statsLoading
                          ? "正在清点知识背包"
                          : "知识背包已就绪"
                      : "模型尚未配置"}
                </span>
              </span>
              <button
                type="button"
                onClick={triggerWave}
                aria-label="挥手"
                title="挥手"
                className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Hand className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={triggerFlight}
                aria-label="喷气起飞"
                title="喷气起飞"
                className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Rocket className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="收起面板"
                title="收起面板"
                className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="p-2.5">
              <form onSubmit={handoffDraft} className="flex items-center gap-1.5">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="问一个问题…"
                  aria-label="向助手提问"
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="发送消息"
                  title="发送消息"
                  className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
                >
                  <ArrowUp className="size-4" />
                </button>
              </form>

              {activity.streaming && activity.threadId && (
                <Link
                  href={`/chat/${activity.threadId}`}
                  onClick={() => setOpen(false)}
                  className="mt-2 flex items-center gap-2 rounded-md bg-muted/55 px-2.5 py-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{activity.label}</span>
                  <span className="text-[11px] text-muted-foreground">查看</span>
                </Link>
              )}

              {!capabilities?.llm_configured && (
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="mt-2 flex items-center gap-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Settings2 className="size-3.5" />
                  配置模型后即可提问
                </Link>
              )}

              <div className="mt-2 grid grid-cols-3 gap-1">
                <Link
                  href="/chat"
                  onClick={() => {
                    window.dispatchEvent(new Event("sag:new-chat"));
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1.5 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MessageSquarePlus className="size-4" />
                  <span>新对话</span>
                </Link>
                <Link
                  href="/search"
                  onClick={() => setOpen(false)}
                  className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1.5 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Search className="size-4" />
                  <span>搜知识</span>
                </Link>
                {recentThread ? (
                  <Link
                    href={`/chat/${recentThread.id}`}
                    onClick={() => setOpen(false)}
                    title={recentThread.title}
                    className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1.5 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <History className="size-4" />
                    <span>最近会话</span>
                  </Link>
                ) : (
                  <span className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1.5 py-2 text-xs text-muted-foreground/45">
                    <History className="size-4" />
                    <span>最近会话</span>
                  </span>
                )}
              </div>
            </div>

            <div className="border-t">
              <button
                type="button"
                onClick={() => setFaceEditorOpen((value) => !value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Smile className="size-3.5" />
                <span className="flex-1 text-left">面罩字符</span>
                <span className="max-w-20 truncate font-mono text-foreground">
                  {displayFace || "留空"}
                </span>
                <ChevronDown
                  className={cn("size-3.5 transition-transform", faceEditorOpen && "rotate-180")}
                />
              </button>
              <AnimatePresence initial={false}>
                {faceEditorOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={displayFace}
                          onChange={(event) => saveFace(event.target.value)}
                          aria-label="自定义面罩字符"
                          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-center font-mono text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={addFacePreset}
                          disabled={!canAddFacePreset}
                          aria-label="添加表情预设"
                          title="添加表情预设"
                          className="grid size-8 shrink-0 place-items-center rounded-md border text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {facePresets.map((preset) => (
                          <span
                            key={preset}
                            className={cn(
                              "group/preset inline-flex h-7 items-stretch overflow-hidden rounded-md border transition-colors",
                              displayFace === preset
                                ? "border-border bg-muted"
                                : "border-transparent hover:border-border/70 hover:bg-muted/50",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => saveFace(preset)}
                              aria-label={`使用表情 ${preset}`}
                              className="min-w-8 max-w-20 truncate px-1.5 font-mono text-xs outline-none focus-visible:bg-muted"
                            >
                              {preset}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFacePreset(preset)}
                              aria-label={`删除表情 ${preset}`}
                              title={`删除 ${preset}`}
                              className="grid w-5 place-items-center border-l border-border/60 text-muted-foreground/45 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                            >
                              <X className="size-2.5" />
                            </button>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => saveFace("")}
                          className={cn(
                            "h-7 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                            face !== null && !displayFace && "bg-muted text-foreground ring-1 ring-border",
                          )}
                        >
                          留空
                        </button>
                        <button
                          type="button"
                          onClick={followAvatar}
                          className={cn(
                            "h-7 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                            face === null && "bg-muted text-foreground ring-1 ring-border",
                          )}
                        >
                          跟随头像
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        ref={visualRef}
        animate={visualAnimate}
        transition={visualTransition}
        style={visualStyle}
        data-facing={characterState.facing}
        className="sag-pet-rig relative"
      >
        {!open && (
          <div className="sag-pet__actions" role="toolbar" aria-label="宠物动作">
            <PetActionButton
              slot="ask"
              label={`向${characterState.identity.name}提问`}
              onClick={() => {
                setCurious(false);
                setOpen(true);
              }}
            >
              <MessageCircleQuestion />
            </PetActionButton>
            <PetActionButton slot="wave" label="挥手" onClick={triggerWave} disabled={!canAct}>
              <Hand />
            </PetActionButton>
            <PetActionButton slot="fly" label="升空" onClick={triggerFlight} disabled={!canAct}>
              <Rocket />
            </PetActionButton>
            <PetActionButton slot="roam" label="沿边漫游" onClick={triggerRoam} disabled={!canAct}>
              <Route />
            </PetActionButton>
            <PetActionButton slot="dance" label="跳舞" onClick={triggerDance} disabled={!canAct}>
              <Music2 />
            </PetActionButton>
            <PetActionButton slot="hide" label="隐藏宠物" onClick={hide}>
              <EyeOff />
            </PetActionButton>
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          data-mode={visualMode}
          data-wave={characterState.motion === "wave" ? "true" : "false"}
          data-facing={characterState.facing}
          data-curious={curious && !open && visualMode === "idle" ? "true" : "false"}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setCurious(false);
            setOpen((value) => !value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setCurious(false);
              setOpen((value) => !value);
            }
          }}
          aria-label={`${characterState.identity.name} 宇航员${statusText ? `，${statusText}` : ""}`}
          title={characterState.identity.name}
          style={characterStyle}
          className="sag-pet-astronaut relative h-full w-full cursor-grab outline-none active:cursor-grabbing"
        >
          <div className="sag-pet__scale" aria-hidden>
            <div className="sag-pet__stage">
              <span className="sag-pet__orbit" />
              <span className="sag-pet__shadow" />
              <span className="sag-pet__thoughts">
                <span />
                <span />
                <span />
              </span>
              <span className="sag-pet__celebrate">
                <Sparkles />
                <Sparkles />
                <Sparkles />
              </span>
              <div className="sag-pet__backpack">
                <span className="sag-pet__pack-lid" />
                <span className="sag-pet__found-card" />
                <span className="sag-pet__beacon" />
                <span className="sag-pet__pack-status" />
                <span className="sag-pet__knowledge">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="sag-pet__thrusters">
                  <span />
                  <span />
                </span>
              </div>
              <div className="sag-pet__body">
                <span className="sag-pet__arm sag-pet__arm--left" />
                <span className="sag-pet__arm sag-pet__arm--right" />
                <span className="sag-pet__harness" />
                <span className="sag-pet__panel">
                  <span className="sag-pet__nameplate-text" style={nameplateStyle(petName)}>
                    {petName}
                  </span>
                  <span className="sag-pet__panel-light" />
                </span>
                <span className="sag-pet__leg sag-pet__leg--left" />
                <span className="sag-pet__leg sag-pet__leg--right" />
              </div>
              <div className="sag-pet__helmet">
                <div className="sag-pet__visor">
                  <span className="sag-pet__glass" />
                  <span className="sag-pet__face" style={faceStyle(renderedFace)}>
                    <AnimatePresence initial={false} mode="wait">
                      <motion.span
                        key={renderedFace}
                        initial={{ opacity: 0, scale: 0.82, y: 1 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.88, y: -1 }}
                        transition={{ duration: 0.16 }}
                        className="sag-pet__face-glyph"
                      >
                        {renderedFace}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </div>
                <span className="sag-pet__shine" />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** 宠物开关（localStorage sag:pet，默认开）。 */
export function usePetEnabled(): [boolean, (on: boolean) => void] {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const sync = () => setOn(window.localStorage.getItem("sag:pet") !== "off");
    sync();
    window.addEventListener("sag:pet-toggle", sync);
    return () => window.removeEventListener("sag:pet-toggle", sync);
  }, []);
  const set = React.useCallback((value: boolean) => {
    window.localStorage.setItem("sag:pet", value ? "on" : "off");
    window.dispatchEvent(new Event("sag:pet-toggle"));
  }, []);
  return [on, set];
}
