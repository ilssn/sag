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
 * World radius of the onion sphere's core. The oldest event's shell sits here
 * instead of at a singular point, so the deepest layers stay legible.
 */
export const UNIVERSE_TEMPORAL_SPHERE_CORE_RADIUS = 150;

export interface UniverseTemporalAxisPolicy {
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
  /**
   * Unit direction from the source's core to this package: a deterministic,
   * uniform point on the sphere derived from package identity alone. The
   * caller multiplies it by the package's shell radius.
   */
  radialDirection: { x: number; y: number; z: number };
}

export const DEFAULT_UNIVERSE_TEMPORAL_AXIS_POLICY: UniverseTemporalAxisPolicy = {
  ageExponent: 1,
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function positive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(Number.EPSILON, value as number) : fallback;
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
  return {
    ageExponent: positive(input.ageExponent, defaults.ageExponent),
  };
}

/**
 * Projects event packages onto the onion sphere. The exploration space has no
 * privileged direction: each package owns a deterministic, uniformly
 * distributed bearing on the sphere (identity alone — a package may never
 * swing because of how the camera travelled), and its age decides how deep
 * its shell sits. An event and its entities share one package offset, so
 * exploration order reads as continuous radial depth.
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
    // Uniform point on the unit sphere from two independent identity hashes.
    const zenith = 2 * stableUnit(`${bundle.bundleId}:zenith`) - 1;
    const azimuth = stableUnit(bundle.bundleId) * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - zenith * zenith));

    return {
      bundleId: bundle.bundleId,
      // curvedAge is what the caller turns into a shell radius; exposing the
      // curved value keeps depth shaping in one place.
      ageProgress: curvedAge,
      radialDirection: {
        x: canonicalNumber(Math.cos(azimuth) * ring),
        y: canonicalNumber(Math.sin(azimuth) * ring),
        z: canonicalNumber(zenith),
      },
    };
  });
}
