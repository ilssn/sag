export type UniverseTimelineWheelDirection = "next" | "previous";
export type UniverseTimelineWheelMode = "stable" | "journey";

export interface UniverseTimelineWheelState {
  /** Distance accumulated in one direction, expressed in CSS pixels. */
  accumulatedDistance: number;
  direction: UniverseTimelineWheelDirection | null;
}

export interface UniverseTimelineWheelInput {
  deltaY: number;
  /** Mirrors WheelEvent.deltaMode without depending on DOM globals. */
  deltaMode?: number;
  viewportHeight?: number;
  threshold?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  busy: boolean;
  mode: UniverseTimelineWheelMode;
}

export interface UniverseTimelineWheelIntent {
  direction: UniverseTimelineWheelDirection;
  action: "enter-journey" | "continue-journey";
}

export type UniverseTimelineWheelOutcome =
  | "idle"
  | "zoom-only"
  | "busy"
  | "accumulating"
  | "intent";

export interface UniverseTimelineWheelPlan {
  state: UniverseTimelineWheelState;
  intent: UniverseTimelineWheelIntent | null;
  normalizedDelta: number;
  outcome: UniverseTimelineWheelOutcome;
}

export const DEFAULT_UNIVERSE_TIMELINE_WHEEL_THRESHOLD = 120;
export const UNIVERSE_TIMELINE_WHEEL_LINE_HEIGHT = 16;
export const DEFAULT_UNIVERSE_TIMELINE_WHEEL_PAGE_HEIGHT = 800;

function positive(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function intent(
  direction: UniverseTimelineWheelDirection,
  mode: UniverseTimelineWheelMode,
): UniverseTimelineWheelIntent {
  return {
    direction,
    action: mode === "stable" ? "enter-journey" : "continue-journey",
  };
}

/**
 * Converts DOM wheel units to CSS pixels without importing browser globals.
 * Unknown delta modes intentionally fall back to pixel semantics.
 */
export function normalizeUniverseTimelineWheelDelta(
  deltaY: number,
  deltaMode = 0,
  viewportHeight = DEFAULT_UNIVERSE_TIMELINE_WHEEL_PAGE_HEIGHT,
) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  if (deltaMode === 1) return deltaY * UNIVERSE_TIMELINE_WHEEL_LINE_HEIGHT;
  if (deltaMode === 2) {
    return deltaY * positive(
      viewportHeight,
      DEFAULT_UNIVERSE_TIMELINE_WHEEL_PAGE_HEIGHT,
    );
  }
  return deltaY;
}

export function createUniverseTimelineWheelState(): UniverseTimelineWheelState {
  return {
    accumulatedDistance: 0,
    direction: null,
  };
}

/** Clears gesture residue. */
export function resetUniverseTimelineWheelState(): UniverseTimelineWheelState {
  return createUniverseTimelineWheelState();
}

/**
 * Plans one wheel sample using the same spatial contract as OrbitControls:
 * dolly-in (negative delta) explores deeper/older data, while dolly-out
 * (positive delta) rewinds toward newer data.
 * The planner emits at most one page intent for one sample, even for page-mode
 * or unusually large deltas.
 */
export function planUniverseTimelineWheel(
  state: UniverseTimelineWheelState,
  input: UniverseTimelineWheelInput,
): UniverseTimelineWheelPlan {
  const normalizedDelta = normalizeUniverseTimelineWheelDelta(
    input.deltaY,
    input.deltaMode,
    input.viewportHeight,
  );

  // Browser/trackpad pinch gestures commonly surface as ctrl+wheel. They stay
  // camera-only and must not leave partial time-navigation residue behind.
  if (input.ctrlKey || input.metaKey) {
    const next = state.accumulatedDistance === 0 &&
        state.direction === null
      ? state
      : resetUniverseTimelineWheelState();
    return {
      state: next,
      intent: null,
      normalizedDelta,
      outcome: "zoom-only",
    };
  }

  if (normalizedDelta === 0) {
    return {
      state,
      intent: null,
      normalizedDelta,
      outcome: "idle",
    };
  }

  // Camera zoom remains live while a page is loading or animating, but an old
  // wheel sample must never be replayed after the scene settles. Delayed replay
  // lets camera and data move at different times and reads as a direction flip.
  if (input.busy) {
    return {
      state: resetUniverseTimelineWheelState(),
      intent: null,
      normalizedDelta,
      outcome: "busy",
    };
  }

  const direction: UniverseTimelineWheelDirection = normalizedDelta < 0
    ? "next"
    : "previous";
  // Reversal starts a fresh gesture. Opposite residual distance can therefore
  // never cancel or accidentally complete the user's new direction.
  const accumulatedDistance = (state.direction === direction
    ? state.accumulatedDistance
    : 0) + Math.abs(normalizedDelta);
  const threshold = positive(
    input.threshold,
    DEFAULT_UNIVERSE_TIMELINE_WHEEL_THRESHOLD,
  );

  if (accumulatedDistance < threshold) {
    return {
      state: {
        ...state,
        accumulatedDistance,
        direction,
      },
      intent: null,
      normalizedDelta,
      outcome: "accumulating",
    };
  }

  return {
    state: resetUniverseTimelineWheelState(),
    intent: intent(direction, input.mode),
    normalizedDelta,
    outcome: "intent",
  };
}
