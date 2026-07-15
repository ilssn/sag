export type UniverseDisplayMode = "stable" | "journey";
export type UniverseJourneyDirection = "next" | "previous";

export interface UniverseJourneySession {
  /** Window revision at which this timeline journey began. */
  originWindowRevision: number;
  /** Direction away from the session origin; null until the first accepted step. */
  direction: UniverseJourneyDirection | null;
  /** Number of accepted timeline steps away from the session origin. */
  depth: number;
}

export interface UniverseDisplayModeState {
  mode: UniverseDisplayMode;
  journey: UniverseJourneySession | null;
  /** Invalidates stale asynchronous wheel plans without coupling to scene state. */
  revision: number;
}

export type UniverseDisplayIntentAction =
  | "enter-journey"
  | "advance-journey"
  | "rewind-journey";

export interface UniverseDisplayIntentPlan {
  action: UniverseDisplayIntentAction;
  timelineDirection: UniverseJourneyDirection;
  sourceRevision: number;
  nextState: UniverseDisplayModeState;
}

export type UniverseDisplayIntentOutcome =
  | "shifted"
  | "blocked"
  | "complete"
  | "cancelled";

export interface UniverseStableVisualPolicy {
  nodeScale: number;
  eventStarScale: number;
  cardScale: number;
  opacity: number;
  linkOpacity: number;
}

export interface UniverseJourneyVisualPolicy {
  nearNodeScale: number;
  farNodeScale: number;
  nearEventStarScale: number;
  farEventStarScale: number;
  nearCardScale: number;
  farCardScale: number;
  nearOpacity: number;
  farOpacity: number;
  nearLinkOpacity: number;
  farLinkOpacity: number;
  /** Normalized travel distance away from the camera-facing plane. */
  depthSpan: number;
  /** Normalized package-centre spread at the near and far time boundaries. */
  nearLateralSpread: number;
  farLateralSpread: number;
  verticalAspect: number;
  /** Shapes time distance without changing ordering or endpoints. */
  ageExponent: number;
}

export interface UniverseDisplayVisualPolicy {
  stable: UniverseStableVisualPolicy;
  journey: UniverseJourneyVisualPolicy;
}

export type UniverseDisplayVisualPolicyInput = {
  stable?: Partial<UniverseStableVisualPolicy>;
  journey?: Partial<UniverseJourneyVisualPolicy>;
};

export interface UniverseTemporalBundleInput {
  bundleId: string;
  /** Target time distance: 0 is the active/near package, 1 is farthest. */
  ageProgress: number;
  /** Previous frame's time distance; omitted for an already-settled package. */
  previousAgeProgress?: number;
}

export interface UniverseTemporalBatchOptions {
  mode: UniverseDisplayMode;
  previousMode?: UniverseDisplayMode;
  direction?: UniverseJourneyDirection | null;
  /** Shared 0..1 progress. Every package is interpolated in the same frame. */
  transitionProgress?: number;
}

export interface UniverseTemporalBundleProjection {
  bundleId: string;
  ageProgress: number;
  modeProgress: number;
  /** Add this normalized package offset to the scene's stable base layout. */
  normalizedOffset: { x: number; y: number; z: number };
  nodeScale: number;
  eventStarScale: number;
  cardScale: number;
  opacity: number;
  linkOpacity: number;
}

export const DEFAULT_UNIVERSE_DISPLAY_VISUAL_POLICY: UniverseDisplayVisualPolicy = {
  stable: {
    nodeScale: 1,
    eventStarScale: 1,
    cardScale: 1,
    opacity: 1,
    linkOpacity: 0.62,
  },
  journey: {
    nearNodeScale: 1.08,
    farNodeScale: 0.38,
    nearEventStarScale: 1.18,
    farEventStarScale: 0.3,
    nearCardScale: 1,
    farCardScale: 0.44,
    nearOpacity: 1,
    farOpacity: 0.24,
    nearLinkOpacity: 0.58,
    farLinkOpacity: 0.12,
    depthSpan: 1,
    nearLateralSpread: 0.035,
    farLateralSpread: 0.44,
    verticalAspect: 0.7,
    ageExponent: 1.3,
  },
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function nonNegative(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, value as number) : fallback;
}

function positive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(Number.EPSILON, value as number) : fallback;
}

function opacity(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? clamp01(value as number) : fallback;
}

function integer(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function smoothstep(value: number) {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

function oppositeDirection(
  left: UniverseJourneyDirection,
  right: UniverseJourneyDirection,
) {
  return left !== right;
}

function stableState(revision: number): UniverseDisplayModeState {
  return { mode: "stable", journey: null, revision };
}

function journeyState(
  revision: number,
  journey: UniverseJourneySession,
): UniverseDisplayModeState {
  return { mode: "journey", journey, revision };
}

export function createUniverseDisplayModeState(
  mode: UniverseDisplayMode = "stable",
  windowRevision = 0,
): UniverseDisplayModeState {
  if (mode === "stable") return stableState(0);
  return journeyState(0, {
    originWindowRevision: integer(windowRevision),
    direction: null,
    depth: 0,
  });
}

/**
 * Explicit Stable/Journey switch. Switching to journey establishes a new
 * origin without moving data; switching to stable only changes presentation.
 */
export function setUniverseDisplayMode(
  state: UniverseDisplayModeState,
  mode: UniverseDisplayMode,
  windowRevision: number,
): UniverseDisplayModeState {
  if (state.mode === mode) return state;
  if (mode === "stable") return stableState(state.revision + 1);
  return journeyState(state.revision + 1, {
    originWindowRevision: integer(windowRevision),
    direction: null,
    depth: 0,
  });
}

/**
 * Plans one explicit button-driven timeline step. Callers commit the candidate only after
 * the virtual window actually shifts, so a cache/network boundary cannot put
 * the UI into a journey state that its data did not reach.
 *
 * Rewinding the last step returns to the journey origin while staying in
 * Journey. Camera dragging is the only implicit way back to Stable, so wheel
 * direction changes never produce a presentation-mode surprise.
 */
export function planUniverseDisplayTimelineIntent(
  state: UniverseDisplayModeState,
  direction: UniverseJourneyDirection,
  windowRevision: number,
): UniverseDisplayIntentPlan {
  const sourceRevision = state.revision;
  const nextRevision = sourceRevision + 1;

  if (state.mode === "stable" || !state.journey) {
    return {
      action: "enter-journey",
      timelineDirection: direction,
      sourceRevision,
      nextState: journeyState(nextRevision, {
        originWindowRevision: integer(windowRevision),
        direction,
        depth: 1,
      }),
    };
  }

  const session = state.journey;
  if (session.direction === null || session.depth === 0) {
    return {
      action: "enter-journey",
      timelineDirection: direction,
      sourceRevision,
      nextState: journeyState(nextRevision, {
        ...session,
        direction,
        depth: 1,
      }),
    };
  }

  if (!oppositeDirection(session.direction, direction)) {
    return {
      action: "advance-journey",
      timelineDirection: direction,
      sourceRevision,
      nextState: journeyState(nextRevision, {
        ...session,
        depth: session.depth + 1,
      }),
    };
  }

  if (session.depth > 1) {
    return {
      action: "rewind-journey",
      timelineDirection: direction,
      sourceRevision,
      nextState: journeyState(nextRevision, {
        ...session,
        depth: session.depth - 1,
      }),
    };
  }

  return {
    action: "rewind-journey",
    timelineDirection: direction,
    sourceRevision,
    nextState: journeyState(nextRevision, {
      ...session,
      direction: null,
      depth: 0,
    }),
  };
}

/** Commits only a successful and non-stale asynchronous timeline movement. */
export function commitUniverseDisplayIntent(
  state: UniverseDisplayModeState,
  plan: UniverseDisplayIntentPlan,
  outcome: UniverseDisplayIntentOutcome,
) {
  if (outcome !== "shifted" || plan.sourceRevision !== state.revision) {
    return state;
  }
  return plan.nextState;
}

/** Rank 0 is active/near; the last rank is the far time boundary. */
export function universeTemporalRankProgress(rank: number, total: number) {
  const count = integer(total);
  if (count <= 1) return 0;
  return clamp01(rank / (count - 1));
}

/**
 * Time-based progress works for either chronological direction. The fallback
 * should normally be rank progress and handles identical or invalid dates.
 */
export function universeTemporalTimestampProgress(
  timestamp: number,
  nearTimestamp: number,
  farTimestamp: number,
  fallback = 0,
) {
  if (
    !Number.isFinite(timestamp)
    || !Number.isFinite(nearTimestamp)
    || !Number.isFinite(farTimestamp)
    || nearTimestamp === farTimestamp
  ) return clamp01(fallback);
  return clamp01(
    (timestamp - nearTimestamp) / (farTimestamp - nearTimestamp),
  );
}

export function resolveUniverseDisplayVisualPolicy(
  input: UniverseDisplayVisualPolicyInput = {},
): UniverseDisplayVisualPolicy {
  const stableDefaults = DEFAULT_UNIVERSE_DISPLAY_VISUAL_POLICY.stable;
  const journeyDefaults = DEFAULT_UNIVERSE_DISPLAY_VISUAL_POLICY.journey;
  const stableInput = input.stable ?? {};
  const journeyInput = input.journey ?? {};

  const stable: UniverseStableVisualPolicy = {
    nodeScale: positive(stableInput.nodeScale, stableDefaults.nodeScale),
    eventStarScale: positive(
      stableInput.eventStarScale,
      stableDefaults.eventStarScale,
    ),
    cardScale: positive(stableInput.cardScale, stableDefaults.cardScale),
    opacity: opacity(stableInput.opacity, stableDefaults.opacity),
    linkOpacity: opacity(stableInput.linkOpacity, stableDefaults.linkOpacity),
  };

  const nearNodeScale = positive(
    journeyInput.nearNodeScale,
    journeyDefaults.nearNodeScale,
  );
  const nearEventStarScale = positive(
    journeyInput.nearEventStarScale,
    journeyDefaults.nearEventStarScale,
  );
  const nearCardScale = positive(
    journeyInput.nearCardScale,
    journeyDefaults.nearCardScale,
  );
  const nearOpacity = opacity(
    journeyInput.nearOpacity,
    journeyDefaults.nearOpacity,
  );
  const nearLinkOpacity = opacity(
    journeyInput.nearLinkOpacity,
    journeyDefaults.nearLinkOpacity,
  );
  const nearLateralSpread = nonNegative(
    journeyInput.nearLateralSpread,
    journeyDefaults.nearLateralSpread,
  );

  return {
    stable,
    journey: {
      nearNodeScale,
      farNodeScale: Math.min(
        nearNodeScale,
        positive(journeyInput.farNodeScale, journeyDefaults.farNodeScale),
      ),
      nearEventStarScale,
      farEventStarScale: Math.min(
        nearEventStarScale,
        positive(
          journeyInput.farEventStarScale,
          journeyDefaults.farEventStarScale,
        ),
      ),
      nearCardScale,
      farCardScale: Math.min(
        nearCardScale,
        positive(journeyInput.farCardScale, journeyDefaults.farCardScale),
      ),
      nearOpacity,
      farOpacity: Math.min(
        nearOpacity,
        opacity(journeyInput.farOpacity, journeyDefaults.farOpacity),
      ),
      nearLinkOpacity,
      farLinkOpacity: Math.min(
        nearLinkOpacity,
        opacity(journeyInput.farLinkOpacity, journeyDefaults.farLinkOpacity),
      ),
      depthSpan: nonNegative(journeyInput.depthSpan, journeyDefaults.depthSpan),
      nearLateralSpread,
      farLateralSpread: Math.max(
        nearLateralSpread,
        nonNegative(
          journeyInput.farLateralSpread,
          journeyDefaults.farLateralSpread,
        ),
      ),
      verticalAspect: nonNegative(
        journeyInput.verticalAspect,
        journeyDefaults.verticalAspect,
      ),
      ageExponent: positive(
        journeyInput.ageExponent,
        journeyDefaults.ageExponent,
      ),
    },
  };
}

function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Projects an entire event-package batch with one shared transition clock.
 * No item delay/stagger is introduced: temporal order comes from continuous
 * depth, scale and opacity, while the event and its entities share one offset.
 */
export function projectUniverseTemporalBatch(
  bundles: readonly UniverseTemporalBundleInput[],
  options: UniverseTemporalBatchOptions,
  policyInput: UniverseDisplayVisualPolicyInput = {},
): UniverseTemporalBundleProjection[] {
  const policy = resolveUniverseDisplayVisualPolicy(policyInput);
  const progress = smoothstep(options.transitionProgress ?? 1);
  const fromMode = options.previousMode ?? options.mode;
  const fromModeProgress = fromMode === "journey" ? 1 : 0;
  const toModeProgress = options.mode === "journey" ? 1 : 0;
  const modeProgress = lerp(fromModeProgress, toModeProgress, progress);
  const mirror = options.direction === "previous" ? -1 : 1;

  return bundles.map((bundle) => {
    const targetAge = clamp01(bundle.ageProgress);
    const previousAge = clamp01(bundle.previousAgeProgress ?? targetAge);
    const ageProgress = lerp(previousAge, targetAge, progress);
    const curvedAge = Math.pow(ageProgress, policy.journey.ageExponent);
    // Rank zero is the camera-centre arrival slot. A non-zero minimum spread
    // leaves a permanent visual hole precisely where the next time page should
    // emerge; all older ranks fan outward continuously from this origin.
    const spread = curvedAge <= Number.EPSILON
      ? 0
      : lerp(
          policy.journey.nearLateralSpread,
          policy.journey.farLateralSpread,
          curvedAge,
        );
    const angle = stableUnit(bundle.bundleId) * Math.PI * 2 * mirror;
    const journeyOffset = {
      x: Math.cos(angle) * spread,
      y: Math.sin(angle) * spread * policy.journey.verticalAspect,
      z: -policy.journey.depthSpan * curvedAge,
    };
    const journeyNodeScale = lerp(
      policy.journey.nearNodeScale,
      policy.journey.farNodeScale,
      curvedAge,
    );
    const journeyEventStarScale = lerp(
      policy.journey.nearEventStarScale,
      policy.journey.farEventStarScale,
      curvedAge,
    );
    const journeyCardScale = lerp(
      policy.journey.nearCardScale,
      policy.journey.farCardScale,
      curvedAge,
    );
    const journeyOpacity = lerp(
      policy.journey.nearOpacity,
      policy.journey.farOpacity,
      curvedAge,
    );
    const journeyLinkOpacity = lerp(
      policy.journey.nearLinkOpacity,
      policy.journey.farLinkOpacity,
      curvedAge,
    );

    return {
      bundleId: bundle.bundleId,
      ageProgress,
      modeProgress,
      normalizedOffset: {
        x: canonicalNumber(journeyOffset.x * modeProgress),
        y: canonicalNumber(journeyOffset.y * modeProgress),
        z: canonicalNumber(journeyOffset.z * modeProgress),
      },
      nodeScale: lerp(policy.stable.nodeScale, journeyNodeScale, modeProgress),
      eventStarScale: lerp(
        policy.stable.eventStarScale,
        journeyEventStarScale,
        modeProgress,
      ),
      cardScale: lerp(policy.stable.cardScale, journeyCardScale, modeProgress),
      opacity: lerp(policy.stable.opacity, journeyOpacity, modeProgress),
      linkOpacity: lerp(
        policy.stable.linkOpacity,
        journeyLinkOpacity,
        modeProgress,
      ),
    };
  });
}
