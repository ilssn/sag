/**
 * The source-local temporal axis.
 *
 * Depth comes from an event's own timestamp normalized across its source's whole
 * time span, so one event holds one depth no matter which pages happen to be
 * cached or how the camera arrived. Callers must therefore pass bounds derived
 * from the source itself (its time_buckets), never from the visible window — the
 * invariant dies the moment the bounds move with the viewport.
 */

export interface UniverseTemporalAxisBounds {
  /** Time at depth zero; normally the source's newest event. */
  nearTimestamp: number;
  /** Time at full depth; normally the source's oldest event. */
  farTimestamp: number;
}

export interface UniverseTemporalAxisPolicy {
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
  /** Normalized travel distance along the axis. */
  depthSpan: number;
  /** Normalized lateral radius at the near and far ends of the axis. */
  nearLateralSpread: number;
  farLateralSpread: number;
  /** Share of the lateral radius that varies per package. */
  lateralJitter: number;
  verticalAspect: number;
  /** Shapes time distance without changing ordering or endpoints. */
  ageExponent: number;
}

export type UniverseTemporalAxisPolicyInput = Partial<UniverseTemporalAxisPolicy>;

export interface UniverseTemporalBundleInput {
  bundleId: string;
  /** Event time in epoch milliseconds. */
  timestamp?: number;
  /** Position within the visible window; used only when timestamp is unusable. */
  rankProgress?: number;
}

export interface UniverseTemporalBundleProjection {
  bundleId: string;
  ageProgress: number;
  /** Add this normalized package offset to the scene's source-centred layout. */
  normalizedOffset: { x: number; y: number; z: number };
  nodeScale: number;
  eventStarScale: number;
  cardScale: number;
  opacity: number;
  linkOpacity: number;
}

export const DEFAULT_UNIVERSE_TEMPORAL_AXIS_POLICY: UniverseTemporalAxisPolicy = {
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
  nearLateralSpread: 0.18,
  farLateralSpread: 0.44,
  lateralJitter: 0.45,
  verticalAspect: 0.7,
  ageExponent: 1.3,
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

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
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

export function resolveUniverseTemporalAxisPolicy(
  input: UniverseTemporalAxisPolicyInput = {},
): UniverseTemporalAxisPolicy {
  const defaults = DEFAULT_UNIVERSE_TEMPORAL_AXIS_POLICY;

  const nearNodeScale = positive(input.nearNodeScale, defaults.nearNodeScale);
  const nearEventStarScale = positive(
    input.nearEventStarScale,
    defaults.nearEventStarScale,
  );
  const nearCardScale = positive(input.nearCardScale, defaults.nearCardScale);
  const nearOpacity = opacity(input.nearOpacity, defaults.nearOpacity);
  const nearLinkOpacity = opacity(input.nearLinkOpacity, defaults.nearLinkOpacity);
  const nearLateralSpread = nonNegative(
    input.nearLateralSpread,
    defaults.nearLateralSpread,
  );

  // Age may only shrink and dim a package, and may only fan it wider. Clamping
  // here keeps every caller's overrides monotonic along the axis.
  return {
    nearNodeScale,
    farNodeScale: Math.min(
      nearNodeScale,
      positive(input.farNodeScale, defaults.farNodeScale),
    ),
    nearEventStarScale,
    farEventStarScale: Math.min(
      nearEventStarScale,
      positive(input.farEventStarScale, defaults.farEventStarScale),
    ),
    nearCardScale,
    farCardScale: Math.min(
      nearCardScale,
      positive(input.farCardScale, defaults.farCardScale),
    ),
    nearOpacity,
    farOpacity: Math.min(
      nearOpacity,
      opacity(input.farOpacity, defaults.farOpacity),
    ),
    nearLinkOpacity,
    farLinkOpacity: Math.min(
      nearLinkOpacity,
      opacity(input.farLinkOpacity, defaults.farLinkOpacity),
    ),
    depthSpan: nonNegative(input.depthSpan, defaults.depthSpan),
    nearLateralSpread,
    farLateralSpread: Math.max(
      nearLateralSpread,
      nonNegative(input.farLateralSpread, defaults.farLateralSpread),
    ),
    lateralJitter: clamp01(
      Number.isFinite(input.lateralJitter)
        ? (input.lateralJitter as number)
        : defaults.lateralJitter,
    ),
    verticalAspect: nonNegative(input.verticalAspect, defaults.verticalAspect),
    ageExponent: positive(input.ageExponent, defaults.ageExponent),
  };
}

/**
 * Projects event packages onto the source's time axis. An event and its entities
 * share one package offset, so temporal order reads as continuous depth, scale
 * and opacity rather than as per-item staggering.
 */
export function projectUniverseTemporalAxis(
  bundles: readonly UniverseTemporalBundleInput[],
  bounds: UniverseTemporalAxisBounds,
  policyInput: UniverseTemporalAxisPolicyInput = {},
): UniverseTemporalBundleProjection[] {
  const policy = resolveUniverseTemporalAxisPolicy(policyInput);

  return bundles.map((bundle) => {
    const ageProgress = universeTemporalTimestampProgress(
      bundle.timestamp ?? Number.NaN,
      bounds.nearTimestamp,
      bounds.farTimestamp,
      bundle.rankProgress ?? 0,
    );
    const curvedAge = Math.pow(ageProgress, policy.ageExponent);
    // Every package keeps a lateral radius, jittered per package. Packages that
    // share a moment sit at the same depth and would otherwise stack on one point.
    const radius = lerp(
      policy.nearLateralSpread,
      policy.farLateralSpread,
      curvedAge,
    ) * lerp(1 - policy.lateralJitter, 1, stableUnit(`${bundle.bundleId}:lateral`));
    // The angle is a pure function of package identity: a package may not swing
    // sideways because of the direction the camera last travelled.
    const angle = stableUnit(bundle.bundleId) * Math.PI * 2;

    return {
      bundleId: bundle.bundleId,
      ageProgress,
      normalizedOffset: {
        x: canonicalNumber(Math.cos(angle) * radius),
        y: canonicalNumber(Math.sin(angle) * radius * policy.verticalAspect),
        z: canonicalNumber(-policy.depthSpan * curvedAge),
      },
      nodeScale: lerp(policy.nearNodeScale, policy.farNodeScale, curvedAge),
      eventStarScale: lerp(
        policy.nearEventStarScale,
        policy.farEventStarScale,
        curvedAge,
      ),
      cardScale: lerp(policy.nearCardScale, policy.farCardScale, curvedAge),
      opacity: lerp(policy.nearOpacity, policy.farOpacity, curvedAge),
      linkOpacity: lerp(
        policy.nearLinkOpacity,
        policy.farLinkOpacity,
        curvedAge,
      ),
    };
  });
}
