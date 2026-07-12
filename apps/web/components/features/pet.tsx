"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Hand,
  Library,
  Loader2,
  MessageCircle,
  Maximize2,
  Minimize2,
  Music2,
  Palette,
  Plus,
  Rocket,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-react";

import { normalizeAvatar } from "@/lib/avatar";
import { DEFAULT_AGENT_AVATAR, DEFAULT_AGENT_NAME } from "@/lib/branding";
import type { ConversationSessionSnapshot } from "@/lib/conversation-runtime";
import {
  PetAgent,
  type PetAgentActivity,
  type PetAgentFacing,
} from "@/lib/pet-agent";
import { setPetEnabled, usePetEnabled } from "@/lib/pet-preferences";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";
import {
  useOptionalConversationIndex,
  useOptionalConversationSession,
} from "@/components/features/chat/conversation-provider";
import { PetMiniWorkspace } from "@/components/features/pet-mini-workspace";
import { petFaceStyle } from "@/components/features/pet-head-avatar";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

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
const PET_COLLAPSED_KEY = "sag:pet-collapsed";
const PET_SIZE_KEY = "sag:pet-size";
const PET_FLOAT_KEY = "sag:pet-float-strength";
const PET_ACTION_RATE_KEY = "sag:pet-action-rate";
const PET_EXPRESSION_DELAY_KEY = "sag:pet-expression-delay";
const PET_REDUCE_MOTION_KEY = "sag:pet-reduce-motion";
const MAX_FACE_PRESETS = 24;
const PET_VIEWPORT_MARGIN = 24;
const MODE_EXPRESSIONS: Partial<Record<PetVisualMode, string>> = {
  thinking: "◔_◔",
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

function deriveActivity(state: ConversationSessionSnapshot | null): PetActivity {
  const steps = state?.run?.steps ?? [];
  const active = [...steps].reverse().find((step) => step.status === "active");
  const failed = Boolean(state?.error) && !state?.run;

  if (!state?.run) {
    return {
      streaming: false,
      mode: failed ? "error" : "idle",
      label: "",
      threadId: state?.threadId ?? null,
      failed,
    };
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
  return {
    streaming: true,
    mode: "working",
    label: active.label || active.name || "正在使用工具处理",
    threadId: state.threadId,
    failed,
  };
}

function usePetActivity() {
  const index = useOptionalConversationIndex();
  const session = useOptionalConversationSession(
    index.activeRunSessionId ?? index.activeSessionId,
  );
  return React.useMemo(() => deriveActivity(session), [session]);
}

interface PetProps {
  ambient?: boolean;
  character?: PetAgent;
  syncIdentity?: boolean;
  visible?: boolean;
}

interface PetRoamPath {
  x: number[];
  y: number[];
}

export function PetWithPreference(props: Omit<PetProps, "visible">) {
  const [visible] = usePetEnabled();
  return <Pet {...props} visible={visible} />;
}

interface PetActionButtonProps {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  slot:
    | "ask"
    | "search"
    | "answer"
    | "knowledge"
    | "actions"
    | "appearance"
    | "wave"
    | "fly"
    | "roam"
    | "dance"
    | "collapse"
    | "expand"
    | "hide";
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
export function Pet({
  ambient = false,
  character: providedCharacter,
  syncIdentity,
  visible = true,
}: PetProps = {}) {
  const {
    agent,
    threads,
    panelMode,
    workspaceSection,
    openMiniWorkspace,
    hideWorkspace,
  } = useApp();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const activity = usePetActivity();
  const ownedCharacter = React.useMemo(
    () => new PetAgent({ name: DEFAULT_AGENT_NAME, avatar: DEFAULT_AGENT_AVATAR, size: 1 }),
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
  const [collapsed, setCollapsed] = React.useState(false);
  const [revealing, setRevealing] = React.useState(false);
  const [curious, setCurious] = React.useState(false);
  const [petOverlay, setPetOverlay] = React.useState<"none" | "actions" | "appearance">("none");
  const [face, setFace] = React.useState<string | null>(null);
  const [facePresets, setFacePresets] = React.useState<string[]>(() => [
    ...DEFAULT_FACE_PRESETS,
  ]);
  const [roamPath, setRoamPath] = React.useState<PetRoamPath | null>(null);
  const [petSize, setPetSize] = React.useState(1);
  const [floatStrength, setFloatStrength] = React.useState(1);
  const [actionRate, setActionRate] = React.useState(1);
  const [expressionDelay, setExpressionDelay] = React.useState(1);
  const [petReduceMotion, setPetReduceMotion] = React.useState(false);
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
  const expandActionTimerRef = React.useRef<number | null>(null);
  const commandCloseTimerRef = React.useRef<number | null>(null);
  const wasStreamingRef = React.useRef(activity.streaming);
  const pointerFrameRef = React.useRef<number | null>(null);
  const pointerRef = React.useRef({ x: 0, y: 0 });
  const elRef = React.useRef<HTMLDivElement>(null);
  const visualRef = React.useRef<HTMLDivElement>(null);
  const agentFace =
    normalizeFace(agent?.avatar || DEFAULT_AGENT_AVATAR) ||
    DEFAULT_AGENT_AVATAR;
  const identityFace = shouldSyncIdentity ? agentFace : characterState.identity.avatar;
  const displayFace = normalizeFace(face === null ? identityFace : face);
  const motionReduced = Boolean(reduceMotion || petReduceMotion);

  React.useEffect(
    () => () => {
      if (!providedCharacter) ownedCharacter.destroy();
    },
    [ownedCharacter, providedCharacter],
  );

  React.useEffect(() => {
    if (!shouldSyncIdentity) return;
    character.configure({
      name: agent?.name || DEFAULT_AGENT_NAME,
      avatar: displayFace,
      size: petSize,
    });
  }, [agent?.name, character, displayFace, petSize, shouldSyncIdentity]);

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
      if (!ambient) setCollapsed(window.localStorage.getItem(PET_COLLAPSED_KEY) === "true");
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
      const savedSize = Number(window.localStorage.getItem(PET_SIZE_KEY));
      if (Number.isFinite(savedSize) && savedSize >= 0.72 && savedSize <= 1.35) {
        setPetSize(savedSize);
      }
      const savedFloat = Number(window.localStorage.getItem(PET_FLOAT_KEY));
      if (Number.isFinite(savedFloat) && savedFloat >= 0.4 && savedFloat <= 1.8) {
        setFloatStrength(savedFloat);
      }
      const savedActionRate = Number(window.localStorage.getItem(PET_ACTION_RATE_KEY));
      if (Number.isFinite(savedActionRate) && savedActionRate >= 0 && savedActionRate <= 2) {
        setActionRate(savedActionRate);
      }
      const savedExpressionDelay = Number(
        window.localStorage.getItem(PET_EXPRESSION_DELAY_KEY),
      );
      if (
        Number.isFinite(savedExpressionDelay) &&
        savedExpressionDelay >= 0.5 &&
        savedExpressionDelay <= 2
      ) {
        setExpressionDelay(savedExpressionDelay);
      }
      setPetReduceMotion(window.localStorage.getItem(PET_REDUCE_MOTION_KEY) === "true");
    } catch {
      /* ignore */
    }
  }, [ambient, character]);

  React.useEffect(() => {
    setOpen(panelMode === "mini");
    if (panelMode === "mini") setPetOverlay("none");
  }, [panelMode]);

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
  }, [character, collapsed]);

  const activeThread = activity.threadId
    ? threads.find((thread) => thread.id === activity.threadId) ?? null
    : null;
  const canAct = !motionReduced && !activity.streaming && characterState.motion === "idle";

  const triggerWave = React.useCallback(() => {
    if (!canAct) return;
    character.wave();
  }, [canAct, character]);

  const triggerFlight = React.useCallback(() => {
    if (!canAct) return;
    const top = visualRef.current?.getBoundingClientRect().top ?? 140;
    const availableLift = top - 10;
    setPetOverlay("none");
    if (availableLift < 42) character.jump();
    else character.fly({ height: Math.min(300, availableLift) });
  }, [canAct, character]);

  const triggerDance = React.useCallback(() => {
    if (!canAct) return;
    setPetOverlay("none");
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
    setPetOverlay("none");
    character.roam();
  }, [canAct, character]);

  React.useEffect(() => {
    if (!revealing) return;
    const timer = window.setTimeout(() => setRevealing(false), 560);
    return () => window.clearTimeout(timer);
  }, [revealing]);

  React.useEffect(
    () => () => {
      if (expandActionTimerRef.current !== null) {
        window.clearTimeout(expandActionTimerRef.current);
      }
    },
    [],
  );

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
      motionReduced ||
      !visible ||
      collapsed ||
      open ||
      actionRate <= 0.05 ||
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
    }, (16_000 + Math.round(Math.random() * 12_000)) / actionRate);
    return () => window.clearTimeout(timer);
  }, [
    characterState.activity,
    characterState.motion,
    actionRate,
    collapsed,
    open,
    motionReduced,
    triggerDance,
    triggerFlight,
    triggerWave,
    visible,
  ]);

  React.useEffect(() => {
    if (
      motionReduced ||
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
    }, (7_500 + Math.round(Math.random() * 8_500)) * expressionDelay);
    return () => window.clearTimeout(timer);
  }, [
    character,
    characterState.activity,
    characterState.expression,
    characterState.motion,
    curious,
    displayFace,
    expressionDelay,
    open,
    motionReduced,
    visible,
  ]);

  React.useEffect(() => {
    if (motionReduced) return;
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
  }, [character, motionReduced]);

  const showCommands = React.useCallback(() => {
    if (commandCloseTimerRef.current !== null) {
      window.clearTimeout(commandCloseTimerRef.current);
      commandCloseTimerRef.current = null;
    }
    setCurious(true);
  }, []);

  const scheduleCommandClose = React.useCallback(() => {
    if (commandCloseTimerRef.current !== null) {
      window.clearTimeout(commandCloseTimerRef.current);
    }
    commandCloseTimerRef.current = window.setTimeout(() => {
      commandCloseTimerRef.current = null;
      setCurious(false);
    }, 520);
  }, []);

  React.useEffect(
    () => () => {
      if (commandCloseTimerRef.current !== null) {
        window.clearTimeout(commandCloseTimerRef.current);
      }
    },
    [],
  );

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
  const petName = Array.from(characterState.identity.name || DEFAULT_AGENT_NAME)
    .slice(0, 7)
    .join("");
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

  function moveFacePreset(preset: string, direction: -1 | 1) {
    const index = facePresets.indexOf(preset);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= facePresets.length) return;
    const next = [...facePresets];
    [next[index], next[target]] = [next[target], next[index]];
    persistFacePresets(next);
  }

  function followAvatar() {
    setFace(null);
    character.setAvatar(identityFace);
    window.localStorage.removeItem(PET_FACE_MODE_KEY);
    window.localStorage.removeItem(PET_FACE_KEY);
    window.localStorage.removeItem("sag:pet-emoji");
  }

  function updatePetSize(value: number) {
    setPetSize(value);
    character.configure({ size: value });
    window.localStorage.setItem(PET_SIZE_KEY, String(value));
  }

  function updateFloatStrength(value: number) {
    setFloatStrength(value);
    window.localStorage.setItem(PET_FLOAT_KEY, String(value));
  }

  function updateActionRate(value: number) {
    setActionRate(value);
    window.localStorage.setItem(PET_ACTION_RATE_KEY, String(value));
  }

  function updateExpressionDelay(value: number) {
    setExpressionDelay(value);
    window.localStorage.setItem(PET_EXPRESSION_DELAY_KEY, String(value));
  }

  function updateReducedMotion(value: boolean) {
    setPetReduceMotion(value);
    window.localStorage.setItem(PET_REDUCE_MOTION_KEY, String(value));
  }

  function setFacing(direction: PetAgentFacing) {
    character.face(direction);
    window.localStorage.setItem("sag:pet-facing", direction);
  }

  function resetPetPosition() {
    const width = 94 * character.getSnapshot().identity.size;
    const height = 118 * character.getSnapshot().identity.size;
    const next = {
      x: Math.max(PET_VIEWPORT_MARGIN, window.innerWidth - width - 32),
      y: Math.max(PET_VIEWPORT_MARGIN, window.innerHeight - height - 88),
    };
    lastPosRef.current = next;
    character.moveTo(next);
    setAlignRight(true);
    setPanelAbove(true);
    window.localStorage.setItem("sag:pet-pos", JSON.stringify(next));
  }

  function resetPetPreferences() {
    setPetSize(1);
    setFloatStrength(1);
    setActionRate(1);
    setExpressionDelay(1);
    setPetReduceMotion(false);
    setFacePresets([...DEFAULT_FACE_PRESETS]);
    character.configure({ size: 1 });
    followAvatar();
    [
      PET_SIZE_KEY,
      PET_FLOAT_KEY,
      PET_ACTION_RATE_KEY,
      PET_EXPRESSION_DELAY_KEY,
      PET_REDUCE_MOTION_KEY,
      PET_FACE_PRESETS_KEY,
    ].forEach((key) => window.localStorage.removeItem(key));
  }

  function hide() {
    setOpen(false);
    setPetOverlay("none");
    hideWorkspace();
    if (expandActionTimerRef.current !== null) {
      window.clearTimeout(expandActionTimerRef.current);
      expandActionTimerRef.current = null;
    }
    setPetEnabled(false);
  }

  function collapseToHead() {
    if (ambient || characterState.motion !== "idle") return;
    setOpen(false);
    setPetOverlay("none");
    hideWorkspace();
    setCurious(false);
    setRevealing(false);
    if (expandActionTimerRef.current !== null) {
      window.clearTimeout(expandActionTimerRef.current);
      expandActionTimerRef.current = null;
    }
    setCollapsed(true);
    window.localStorage.setItem(PET_COLLAPSED_KEY, "true");
  }

  function expandFromHead() {
    if (!collapsed) return;
    setCollapsed(false);
    setCurious(false);
    setRevealing(true);
    window.localStorage.setItem(PET_COLLAPSED_KEY, "false");

    const snapshot = character.getSnapshot();
    if (snapshot.activity !== "idle" || snapshot.motion !== "idle") return;
    character.emote("^o^", 2_400);
    if (motionReduced) return;

    expandActionTimerRef.current = window.setTimeout(() => {
      expandActionTimerRef.current = null;
      const current = character.getSnapshot();
      if (current.activity !== "idle" || current.motion !== "idle") return;
      const roll = Math.random();
      if (roll < 0.4) triggerWave();
      else if (roll < 0.68) triggerDance();
      else if (roll < 0.88) triggerFlight();
      else triggerRoam();
    }, 260);
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

  const style: React.CSSProperties = characterState.position
    ? { left: characterState.position.x, top: characterState.position.y, right: "auto", bottom: "auto" }
    : {};
  const panelSide = alignRight ? "right-0" : "left-0";
  const panelVertical = panelAbove ? "bottom-full mb-2" : "top-full mt-2";
  const scale = characterState.identity.size;
  const visualStyle = {
    width: (collapsed ? 82 : 94) * scale,
    height: (collapsed ? 82 : 118) * scale,
  } as React.CSSProperties;
  const characterStyle = {
    "--pet-scale": scale,
    "--pet-look-x": `${(characterState.look.x * 2.4).toFixed(2)}px`,
    "--pet-look-y": `${(characterState.look.y * 1.7).toFixed(2)}px`,
    "--pet-look-rotate": `${(characterState.look.x * 1.2).toFixed(2)}deg`,
  } as React.CSSProperties;
  const visualAnimate = motionReduced
    ? undefined
    : collapsed
      ? {
          x: [0, 0.8 * floatStrength, 0],
          y: [0, -2.2 * floatStrength, 0],
          rotate: [0, 0.65 * floatStrength, 0],
        }
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
        : visualMode === "idle" && curious
          ? { x: 0, y: -1.5, rotate: 0 }
        : visualMode === "idle"
          ? {
              x: [0, 4.2, 1.4, -4.6, -1.5, 0].map((value) => value * floatStrength),
              y: [0, -5.8, -2.4, 3.8, 1.2, 0].map((value) => value * floatStrength),
              rotate: [0, 0.62, 0.2, -0.56, -0.14, 0].map(
                (value) => value * floatStrength,
              ),
            }
          : { x: [0, 0.45, 0], y: [0, -1, 0], rotate: [0, 0, 0] };
  const visualTransition = motionReduced
    ? undefined
    : collapsed
      ? { duration: 4.6, repeat: Infinity, ease: "easeInOut" as const }
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
        : visualMode === "idle" && curious
          ? { duration: 0.32, ease: "easeOut" as const }
        : {
            duration: visualMode === "idle" ? 9.2 : 3.5,
            repeat: Infinity,
            ease: "easeInOut" as const,
          };

  if (!visible) return null;

  return (
    <div
      ref={elRef}
      className={cn(
        "sag-pet-shell group/pet fixed z-40 block select-none",
        ambient ? "bottom-16 right-7" : "bottom-24 left-5",
      )}
      data-facing={characterState.facing}
      data-collapsed={collapsed ? "true" : "false"}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={showCommands}
      onPointerLeave={scheduleCommandClose}
    >
      <AnimatePresence>
        {!ambient && !open && statusText && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={
              motionReduced
                ? { opacity: 1, scale: 1 }
                : { ...visualAnimate, opacity: 1, scale: 1 }
            }
            exit={{ opacity: 0, scale: 0.97 }}
            transition={visualTransition}
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


        {!ambient && panelMode === "mini" && (
          <PetMiniWorkspace
            character={character}
            panelClassName={cn(panelVertical, panelSide)}
            alignRight={alignRight}
            panelAbove={panelAbove}
          />
        )}

        {!ambient && petOverlay === "actions" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className={cn(
              "absolute w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover/96 shadow-2xl backdrop-blur-xl",
              panelVertical,
              panelSide,
            )}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-11 items-center border-b px-3">
              <Hand className="size-3.5 text-muted-foreground" />
              <span className="ml-2 flex-1 text-sm font-medium">动作</span>
              <button
                type="button"
                onClick={() => setPetOverlay("none")}
                aria-label="收起动作"
                title="收起"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-2.5">
              {[
                { label: "挥手", icon: Hand, run: triggerWave },
                { label: "升空", icon: Rocket, run: triggerFlight },
                { label: "漫游", icon: Route, run: triggerRoam },
                { label: "跳舞", icon: Music2, run: triggerDance },
              ].map(({ label, icon: Icon, run }) => (
                <button
                  key={label}
                  type="button"
                  disabled={!canAct}
                  onClick={() => {
                    setPetOverlay("none");
                    run();
                  }}
                  className="flex h-9 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 border-t px-2.5 py-2">
              <span className="mr-auto text-[11px] text-muted-foreground">朝向</span>
              <button
                type="button"
                onClick={() => setFacing("left")}
                aria-label="面向左侧"
                title="面向左侧"
                className={cn(
                  "grid size-7 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground",
                  characterState.facing === "left" && "bg-muted text-foreground",
                )}
              >
                <ArrowLeft className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFacing("right")}
                aria-label="面向右侧"
                title="面向右侧"
                className={cn(
                  "grid size-7 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground",
                  characterState.facing === "right" && "bg-muted text-foreground",
                )}
              >
                <ArrowRight className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={resetPetPosition}
                className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                重置位置
              </button>
            </div>
          </motion.div>
        )}

        {!ambient && petOverlay === "appearance" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className={cn(
              "absolute max-h-[min(470px,calc(100dvh-14rem))] w-[330px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-popover/96 shadow-2xl backdrop-blur-xl",
              panelVertical,
              panelSide,
            )}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex h-11 items-center border-b bg-popover/96 px-3 backdrop-blur-xl">
              <Palette className="size-3.5 text-muted-foreground" />
              <span className="ml-2 flex-1 text-sm font-medium">宇航员配置</span>
              <button
                type="button"
                onClick={() => setPetOverlay("none")}
                aria-label="收起配置"
                title="收起"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="space-y-4 p-3">
              <section>
                <div className="mb-2 text-xs font-medium">面罩</div>
                <div className="grid grid-cols-3 rounded-md bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={followAvatar}
                    className={cn(
                      "h-7 rounded text-[11px] text-muted-foreground",
                      face === null && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    跟随头像
                  </button>
                  <button
                    type="button"
                    onClick={() => saveFace(displayFace || "^_^")}
                    className={cn(
                      "h-7 rounded text-[11px] text-muted-foreground",
                      face !== null && Boolean(displayFace) && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    自定义
                  </button>
                  <button
                    type="button"
                    onClick={() => saveFace("")}
                    className={cn(
                      "h-7 rounded text-[11px] text-muted-foreground",
                      face !== null && !displayFace && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    留空
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    value={displayFace}
                    onChange={(event) => saveFace(event.target.value)}
                    aria-label="自定义面罩字符"
                    placeholder="@_@"
                    className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-center font-mono text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={addFacePreset}
                    disabled={!canAddFacePreset}
                    aria-label="添加表情"
                    title="添加到表情库"
                    className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>

                <div className="mt-2 space-y-1">
                  {facePresets.map((preset, index) => (
                    <div
                      key={preset}
                      className={cn(
                        "flex h-8 items-center rounded-md border border-transparent pl-2 transition-colors hover:border-border hover:bg-muted/50",
                        displayFace === preset && face !== null && "border-border bg-muted/70",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => saveFace(preset)}
                        className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                      >
                        {preset}
                      </button>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveFacePreset(preset, -1)}
                        aria-label={`向前移动 ${preset}`}
                        title="向前"
                        className="grid size-7 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-20"
                      >
                        <ChevronLeft className="size-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === facePresets.length - 1}
                        onClick={() => moveFacePreset(preset, 1)}
                        aria-label={`向后移动 ${preset}`}
                        title="向后"
                        className="grid size-7 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-20"
                      >
                        <ChevronRight className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFacePreset(preset)}
                        aria-label={`删除 ${preset}`}
                        title="删除"
                        className="grid size-7 place-items-center text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3 border-t pt-3">
                <PetPreferenceSlider
                  label="角色尺寸"
                  value={`${Math.round(petSize * 100)}%`}
                  sliderValue={petSize}
                  min={0.72}
                  max={1.35}
                  step={0.01}
                  onChange={updatePetSize}
                />
                <PetPreferenceSlider
                  label="悬浮幅度"
                  value={`${Math.round(floatStrength * 100)}%`}
                  sliderValue={floatStrength}
                  min={0.4}
                  max={1.8}
                  step={0.05}
                  onChange={updateFloatStrength}
                />
                <PetPreferenceSlider
                  label="随机动作频率"
                  value={actionRate < 0.05 ? "关闭" : `${Math.round(actionRate * 100)}%`}
                  sliderValue={actionRate}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={updateActionRate}
                />
                <PetPreferenceSlider
                  label="待机表情间隔"
                  value={`${expressionDelay.toFixed(1)}×`}
                  sliderValue={expressionDelay}
                  min={0.5}
                  max={2}
                  step={0.1}
                  onChange={updateExpressionDelay}
                />
              </section>

              <div className="flex items-center gap-3 border-t pt-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">减少动态</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    停止悬浮、表情轮换与随机动作
                  </span>
                </span>
                <Switch checked={petReduceMotion} onCheckedChange={updateReducedMotion} />
              </div>
            </div>

            <div className="flex items-center gap-1.5 border-t p-2">
              <button
                type="button"
                onClick={resetPetPreferences}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
                恢复默认
              </button>
              <button
                type="button"
                onClick={hide}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <EyeOff className="size-3.5" />
                隐藏宇航员
              </button>
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
        data-collapsed={collapsed ? "true" : "false"}
        className="sag-pet-rig relative"
      >
        {collapsed && !open && petOverlay === "none" && (
          <div
            className="sag-pet__actions sag-pet__actions--commands sag-pet__actions--collapsed"
            data-align={alignRight ? "right" : "left"}
            data-visible={curious ? "true" : "false"}
            role="toolbar"
            aria-label="宇航员快捷入口"
            onPointerEnter={showCommands}
            onPointerLeave={scheduleCommandClose}
          >
            <PetActionButton
              slot="search"
              label="搜索知识库"
              onClick={() => {
                setCurious(false);
                openMiniWorkspace("search");
              }}
            >
              <Search />
            </PetActionButton>
            <PetActionButton
              slot="answer"
              label="问答"
              onClick={() => {
                setCurious(false);
                openMiniWorkspace("answer");
              }}
            >
              <MessageCircle />
            </PetActionButton>
            <PetActionButton
              slot="knowledge"
              label="知识库"
              onClick={() => {
                setCurious(false);
                openMiniWorkspace("knowledge");
              }}
            >
              <Library />
            </PetActionButton>
            <PetActionButton
              slot="appearance"
              label="配置宇航员"
              onClick={() => setPetOverlay("appearance")}
            >
              <SlidersHorizontal />
            </PetActionButton>
            <PetActionButton slot="expand" label="切换为全身" onClick={expandFromHead}>
              <Maximize2 />
            </PetActionButton>
          </div>
        )}

        {!collapsed && !open && petOverlay === "none" && (
          <div
            className={cn(
              "sag-pet__actions",
              !ambient && "sag-pet__actions--commands",
            )}
            data-align={alignRight ? "right" : "left"}
            data-visible={curious ? "true" : "false"}
            role="toolbar"
            aria-label="宇航员快捷入口"
            onPointerEnter={showCommands}
            onPointerLeave={scheduleCommandClose}
          >
            {ambient ? (
              <PetActionButton slot="wave" label="挥手" onClick={triggerWave} disabled={!canAct}>
                <Hand />
              </PetActionButton>
            ) : (
              <>
                <PetActionButton
                  slot="search"
                  label="搜索知识库"
                  onClick={() => {
                    setCurious(false);
                    setPetOverlay("none");
                    openMiniWorkspace("search");
                  }}
                >
                  <Search />
                </PetActionButton>
                <PetActionButton
                  slot="answer"
                  label="问答"
                  onClick={() => {
                    setCurious(false);
                    setPetOverlay("none");
                    openMiniWorkspace("answer");
                  }}
                >
                  <MessageCircle />
                </PetActionButton>
                <PetActionButton
                  slot="knowledge"
                  label="知识库"
                  onClick={() => {
                    setCurious(false);
                    setPetOverlay("none");
                    openMiniWorkspace("knowledge");
                  }}
                >
                  <Library />
                </PetActionButton>
                <PetActionButton
                  slot="actions"
                  label="动作"
                  onClick={() => setPetOverlay("actions")}
                >
                  <WandSparkles />
                </PetActionButton>
                <PetActionButton
                  slot="appearance"
                  label="配置宇航员"
                  onClick={() => setPetOverlay("appearance")}
                >
                  <SlidersHorizontal />
                </PetActionButton>
                <PetActionButton
                  slot="collapse"
                  label="切换为头部"
                  onClick={collapseToHead}
                  disabled={characterState.motion !== "idle"}
                >
                  <Minimize2 />
                </PetActionButton>
              </>
            )}
          </div>
        )}

        {collapsed ? (
          <div
            role="button"
            tabIndex={0}
            data-mode={visualMode}
            data-facing={characterState.facing}
            data-curious={curious && visualMode === "idle" ? "true" : "false"}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              expandFromHead();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                expandFromHead();
              }
            }}
            aria-label={`${characterState.identity.name} 头部形态，点击切换为全身${statusText ? `，${statusText}` : ""}`}
            title="切换为全身"
            style={characterStyle}
            className="sag-pet-collapsed relative cursor-grab outline-none active:cursor-grabbing"
          >
            <div className="sag-pet__helmet" aria-hidden>
              <span className="sag-pet__antenna" />
              <div className="sag-pet__visor">
                <span className="sag-pet__glass" />
                <span
                  className="sag-pet__face"
                  style={visualMode === "thinking" ? undefined : petFaceStyle(renderedFace)}
                >
                  {visualMode === "thinking" ? (
                    <span className="sag-pet__signal-meter">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
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
                  )}
                </span>
              </div>
              <span className="sag-pet__shine" />
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            data-mode={visualMode}
            data-wave={characterState.motion === "wave" ? "true" : "false"}
            data-facing={characterState.facing}
            data-curious={curious && !open && visualMode === "idle" ? "true" : "false"}
            data-revealing={revealing ? "true" : "false"}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              setCurious(false);
              if (ambient) {
                triggerWave();
                return;
              }
              if (panelMode === "mini") hideWorkspace();
              else openMiniWorkspace(workspaceSection);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setCurious(false);
                if (ambient) {
                  triggerWave();
                  return;
                }
                if (panelMode === "mini") hideWorkspace();
                else openMiniWorkspace(workspaceSection);
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
                {visualMode === "thinking" && <span className="sag-pet__antenna" />}
                <div className="sag-pet__visor">
                  <span className="sag-pet__glass" />
                  <span
                    className="sag-pet__face"
                    style={visualMode === "thinking" ? undefined : petFaceStyle(renderedFace)}
                  >
                    {visualMode === "thinking" ? (
                      <span className="sag-pet__signal-meter">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
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
                    )}
                  </span>
                </div>
                <span className="sag-pet__shine" />
              </div>
            </div>
          </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function PetPreferenceSlider({
  label,
  value,
  sliderValue,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: string;
  sliderValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center text-[11px] text-muted-foreground">
        <span className="flex-1">{label}</span>
        <span className="font-mono text-foreground">{value}</span>
      </span>
      <Slider
        value={[sliderValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onChange(next[0] ?? sliderValue)}
        aria-label={label}
      />
    </label>
  );
}
