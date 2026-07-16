import { describe, expect, it } from "vitest";

import {
  createUniverseTemporalAxis,
  projectUniverseTemporalAxis,
  resolveUniverseTemporalAxisPolicy,
  universeTemporalAxisAgeProgress,
  universeTemporalAxisDepth,
  universeTemporalRankProgress,
} from "./universe-temporal-axis";

/**
 * Ten events over 400ms of clock. Nine of them land in the newest quarter; the
 * middle half is empty. The shape a real source has, exaggerated.
 */
const CLUSTERED = createUniverseTemporalAxis([
  { start: 0, end: 100, count: 1 },
  { start: 100, end: 200, count: 0 },
  { start: 200, end: 300, count: 0 },
  { start: 300, end: 400, count: 9 },
]);

/** Ten events spread evenly, for projection tests that don't care about shape. */
const EVEN = createUniverseTemporalAxis([{ start: 0, end: 1_000, count: 10 }]);

describe("universe temporal axis", () => {
  it("normalizes rank in either chronological direction", () => {
    expect([0, 1, 2, 3].map((rank) =>
      universeTemporalRankProgress(rank, 4))).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
    ]);
  });

  it("spends depth on events, not on empty stretches of clock time", () => {
    // Half the clock carries no events at all and collapses to a single point.
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 100)).toBe(0.9);
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 200)).toBe(0.9);
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 300)).toBe(0.9);
    // The busy quarter of the clock owns 90% of the axis. On a clock-time axis it
    // would have owned 25% and crushed nine events into it.
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 350)).toBeCloseTo(0.45, 10);
    // Endpoints pin to the source's newest and oldest moments.
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 400)).toBe(0);
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 0)).toBe(1);
  });

  it("clamps timestamps outside the source's own span", () => {
    expect(universeTemporalAxisAgeProgress(CLUSTERED, -5_000)).toBe(1);
    expect(universeTemporalAxisAgeProgress(CLUSTERED, 5_000)).toBe(0);
  });

  it("gives every event the same slice of the axis", () => {
    // The visible window is at most 18 packages, so a per-event length is what
    // decides whether depth is legible — not the source's size or time span.
    expect(universeTemporalAxisDepth(EVEN, 60)).toBe(600);
    expect(universeTemporalAxisDepth(CLUSTERED, 60)).toBe(600);
    expect(universeTemporalAxisDepth(null, 60)).toBe(0);
  });

  it("refuses to build an axis a source cannot carry", () => {
    expect(createUniverseTemporalAxis([])).toBeNull();
    // No events.
    expect(createUniverseTemporalAxis([{ start: 0, end: 100, count: 0 }])).toBeNull();
    // Every event at one instant: the backend's degenerate single-bucket case.
    expect(createUniverseTemporalAxis([{ start: 5, end: 5, count: 3 }])).toBeNull();
    // Unparsed dates arrive as NaN.
    expect(createUniverseTemporalAxis([
      { start: Number.NaN, end: 100, count: 3 },
    ])).toBeNull();
    // A null axis leaves every caller on its fallback.
    expect(universeTemporalAxisAgeProgress(null, 50, 0.25)).toBe(0.25);
  });

  it("makes near packages larger and far packages smaller without hiding them", () => {
    const [near, middle, far] = projectUniverseTemporalAxis([
      { bundleId: "near", timestamp: 1_000 },
      { bundleId: "middle", timestamp: 500 },
      { bundleId: "far", timestamp: 0 },
    ], EVEN);

    expect(near.nodeScale).toBeGreaterThan(middle.nodeScale);
    expect(middle.nodeScale).toBeGreaterThan(far.nodeScale);
    expect(near.eventStarScale).toBeGreaterThan(middle.eventStarScale);
    expect(middle.eventStarScale).toBeGreaterThan(far.eventStarScale);
    expect(near.cardScale).toBeGreaterThan(far.cardScale);
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(far.opacity).toBeGreaterThan(0);
    expect(near.normalizedOffset.z).toBe(0);
    expect(far.normalizedOffset.z).toBe(-1);
  });

  it("keeps a package's projection identical no matter what else is in the batch", () => {
    const alone = projectUniverseTemporalAxis(
      [{ bundleId: "x", timestamp: 250 }],
      EVEN,
    );
    const crowded = projectUniverseTemporalAxis([
      { bundleId: "a", timestamp: 900 },
      { bundleId: "x", timestamp: 250 },
      { bundleId: "b", timestamp: 100 },
    ], EVEN);

    expect(crowded.find((projection) => projection.bundleId === "x"))
      .toEqual(alone[0]);
  });

  it("separates packages that share a moment instead of stacking them", () => {
    const [a, b] = projectUniverseTemporalAxis([
      { bundleId: "a", timestamp: 500 },
      { bundleId: "b", timestamp: 500 },
    ], EVEN);

    expect(a.normalizedOffset.z).toBe(b.normalizedOffset.z);
    expect(a.normalizedOffset).not.toEqual(b.normalizedOffset);
    // The near end must keep a lateral radius. Collapsing it to a point is only
    // safe when exactly one package can ever sit there, which a real axis cannot
    // promise.
    expect(Math.hypot(a.normalizedOffset.x, a.normalizedOffset.y)).toBeGreaterThan(0);
    expect(Math.hypot(b.normalizedOffset.x, b.normalizedOffset.y)).toBeGreaterThan(0);
  });

  it("derives the lateral angle from package identity alone", () => {
    const [near] = projectUniverseTemporalAxis(
      [{ bundleId: "x", timestamp: 900 }],
      EVEN,
    );
    const [far] = projectUniverseTemporalAxis(
      [{ bundleId: "x", timestamp: 100 }],
      EVEN,
    );

    // Age may only push a package further out along its own bearing. If x and y
    // scale by one factor the bearing held; anything else means the lane swung.
    const radialGrowth = far.normalizedOffset.x / near.normalizedOffset.x;
    expect(far.normalizedOffset.y / near.normalizedOffset.y)
      .toBeCloseTo(radialGrowth, 10);
    expect(radialGrowth).toBeGreaterThan(1);
  });

  it("falls back to rank progress when an event has no usable time", () => {
    const [missing, timed] = projectUniverseTemporalAxis([
      { bundleId: "missing", rankProgress: 1 },
      { bundleId: "timed", timestamp: 1_000, rankProgress: 0.5 },
    ], EVEN);

    expect(missing.ageProgress).toBe(1);
    expect(timed.ageProgress).toBe(0);
  });

  it("keeps travel even by default and leaves the curve as a knob", () => {
    // An exponent bends depth away from the count it is supposed to track, so
    // even spacing is the default the axis ships with.
    expect(resolveUniverseTemporalAxisPolicy().ageExponent).toBe(1);
    const [half] = projectUniverseTemporalAxis(
      [{ bundleId: "x", timestamp: 500 }],
      EVEN,
    );
    expect(half.normalizedOffset.z).toBeCloseTo(-0.5, 10);
  });

  it("keeps overrides monotonic along the axis", () => {
    const policy = resolveUniverseTemporalAxisPolicy({
      farNodeScale: 9,
      farOpacity: 1,
      farLateralSpread: 0,
      ageExponent: 0,
    });

    expect(policy.farNodeScale).toBe(policy.nearNodeScale);
    expect(policy.farOpacity).toBe(policy.nearOpacity);
    expect(policy.farLateralSpread).toBe(policy.nearLateralSpread);
    expect(policy.ageExponent).toBeGreaterThan(0);
  });
});
