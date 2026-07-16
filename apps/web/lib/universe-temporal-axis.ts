/**
 * The source-local counting axis.
 *
 * Depth is the event's position in the source's canonical exploration order —
 * the backend's snapshot-stable `ordinal` (0 = newest end) — not clock time.
 * Clock time failed the only data shape that matters here: an imported book
 * stamps every event with one instant, which collapses a timestamp axis to a
 * point (and its histogram to a single degenerate bucket). Counting spends
 * depth where the events are for every source: travel costs the same per event
 * everywhere, and a book's axis is simply its narrative order.
 *
 * The ordinal is snapshot-scoped (the timeline session pins as_of + revision),
 * so an event's depth cannot move because the cache paged. Callers must never
 * rebuild the axis from the visible window.
 *
 * Visual depth-cueing (scale/opacity by distance) deliberately does NOT live
 * here: with the camera flying along the axis, presence is a function of the
 * camera's position, so the scene computes it per frame. This module only
 * places packages.
 */

export interface UniverseTemporalAxis {
  /** Snapshot-stable number of events in the source's exploration order. */
  readonly total: number;
}

/**
 * World length of one event's slice of its source's counting axis. Shared by
 * package placement, flight margins and the nebula corridor, so one wheel
 * notch always flies the same share of events everywhere.
 */
export const UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT = 60;

/**
 * Lateral corridor spread is intentionally wider than the source core. The
 * axis still owns chronology on Z, while these values give neighbouring
 * packages enough breathing room for their event cards and entities.
 */
export const UNIVERSE_TEMPORAL_AXIS_NEAR_LATERAL_SPREAD = 0.24;
export const UNIVERSE_TEMPORAL_AXIS_FAR_LATERAL_SPREAD = 0.58;
export const UNIVERSE_TEMPORAL_AXIS_VERTICAL_ASPECT = 0.7;

/**
 * The vestibule: a stretch of axis between the entry pose (flight depth 0)
 * and the first event. Arriving in a source shows only the intact nebula —
 * the hero pose; scrolling forward crosses the vestibule while the dust
 * stretches into the corridor and the first events condense in. Scrolling
 * all the way back lands exactly on this initial state again.
 */
export const UNIVERSE_TEMPORAL_AXIS_VESTIBULE_UNITS = 300;

export interface UniverseTemporalAxisPolicy {
  /** Normalized travel distance along the axis. */
  depthSpan: number;
  /** Normalized lateral radius at the near and far ends of the axis. */
  nearLateralSpread: number;
  farLateralSpread: number;
  /** Share of the lateral radius that varies per package. */
  lateralJitter: number;
  verticalAspect: number;
  /** Shapes depth without changing ordering or endpoints. 1 keeps travel even. */
  ageExponent: number;
}

export type UniverseTemporalAxisPolicyInput = Partial<UniverseTemporalAxisPolicy>;

export interface UniverseTemporalBundleInput {
  bundleId: string;
  /** Snapshot-stable exploration ordinal; 0 = the newest end of the source. */
  ordinal: number;
}

export interface UniverseTemporalBundleProjection {
  bundleId: string;
  ageProgress: number;
  /** Add this normalized package offset to the scene's source-centred layout. */
  normalizedOffset: { x: number; y: number; z: number };
}

export const DEFAULT_UNIVERSE_TEMPORAL_AXIS_POLICY: UniverseTemporalAxisPolicy = {
  depthSpan: 1,
  nearLateralSpread: UNIVERSE_TEMPORAL_AXIS_NEAR_LATERAL_SPREAD,
  farLateralSpread: UNIVERSE_TEMPORAL_AXIS_FAR_LATERAL_SPREAD,
  lateralJitter: 0.45,
  verticalAspect: UNIVERSE_TEMPORAL_AXIS_VERTICAL_ASPECT,
  ageExponent: 1,
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

/**
 * Builds the counting axis for a source. Returns null when there is nothing to
 * explore at all (no events), which leaves callers on their spiral fallback.
 */
export function createUniverseTemporalAxis(
  totalEvents: number,
): UniverseTemporalAxis | null {
  if (!Number.isFinite(totalEvents)) return null;
  const total = Math.floor(totalEvents);
  if (total < 1) return null;
  return { total };
}

/**
 * World length of the axis. Even spacing is the whole point of counting: the
 * newest event sits at depth 0, the oldest at (total - 1) × unitsPerEvent.
 */
export function universeTemporalAxisDepth(
  axis: UniverseTemporalAxis | null,
  unitsPerEvent: number,
) {
  if (!axis) return 0;
  return Math.max(0, axis.total - 1) * Math.max(0, unitsPerEvent);
}

/** 0 is the source's newest end, 1 its oldest; linear in exploration order. */
export function universeTemporalAxisAgeProgress(
  axis: UniverseTemporalAxis | null,
  ordinal: number,
) {
  if (!axis || axis.total <= 1) return 0;
  if (!Number.isFinite(ordinal)) return 0;
  return clamp01(ordinal / (axis.total - 1));
}

export function resolveUniverseTemporalAxisPolicy(
  input: UniverseTemporalAxisPolicyInput = {},
): UniverseTemporalAxisPolicy {
  const defaults = DEFAULT_UNIVERSE_TEMPORAL_AXIS_POLICY;
  const nearLateralSpread = nonNegative(
    input.nearLateralSpread,
    defaults.nearLateralSpread,
  );
  // The corridor may only fan wider with age, so depth still reads as travel
  // even when a caller overrides the spread.
  return {
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
 * Projects event packages onto the counting axis. An event and its entities
 * share one package offset, so exploration order reads as continuous depth
 * rather than as per-item staggering.
 */
export function projectUniverseTemporalAxis(
  bundles: readonly UniverseTemporalBundleInput[],
  axis: UniverseTemporalAxis | null,
  policyInput: UniverseTemporalAxisPolicyInput = {},
): UniverseTemporalBundleProjection[] {
  const policy = resolveUniverseTemporalAxisPolicy(policyInput);

  return bundles.map((bundle) => {
    const ageProgress = universeTemporalAxisAgeProgress(axis, bundle.ordinal);
    const curvedAge = Math.pow(ageProgress, policy.ageExponent);
    // Every package keeps a lateral radius, jittered per package, so packages
    // never stack onto the axis line itself.
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
    };
  });
}
