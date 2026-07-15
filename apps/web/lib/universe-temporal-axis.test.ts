import { describe, expect, it } from "vitest";

import {
  projectUniverseTemporalAxis,
  resolveUniverseTemporalAxisPolicy,
  universeTemporalRankProgress,
  universeTemporalTimestampProgress,
} from "./universe-temporal-axis";

/** Newest at 1000, oldest at 0 — the shape a source's time_buckets produce. */
const BOUNDS = { nearTimestamp: 1_000, farTimestamp: 0 };

describe("universe temporal axis", () => {
  it("normalizes rank and actual time in either chronological direction", () => {
    expect([0, 1, 2, 3].map((rank) =>
      universeTemporalRankProgress(rank, 4))).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
    ]);
    expect(universeTemporalTimestampProgress(800, 1000, 600)).toBe(0.5);
    expect(universeTemporalTimestampProgress(800, 600, 1000)).toBe(0.5);
    expect(universeTemporalTimestampProgress(800, 800, 800, 0.75)).toBe(0.75);
  });

  it("makes near packages larger and far packages smaller without hiding them", () => {
    const [near, middle, far] = projectUniverseTemporalAxis([
      { bundleId: "near", timestamp: 1_000 },
      { bundleId: "middle", timestamp: 500 },
      { bundleId: "far", timestamp: 0 },
    ], BOUNDS);

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
      [{ bundleId: "x", timestamp: 750 }],
      BOUNDS,
    );
    const crowded = projectUniverseTemporalAxis([
      { bundleId: "a", timestamp: 900 },
      { bundleId: "x", timestamp: 750 },
      { bundleId: "b", timestamp: 100 },
    ], BOUNDS);

    expect(crowded.find((projection) => projection.bundleId === "x"))
      .toEqual(alone[0]);
  });

  it("spaces packages by real time distance rather than by their rank", () => {
    // Ranks are evenly spaced; the times are not. Rank progress would have put
    // "recent" at the midpoint of the axis.
    const [newest, recent, ancient] = projectUniverseTemporalAxis([
      { bundleId: "newest", timestamp: 1_000 },
      { bundleId: "recent", timestamp: 950 },
      { bundleId: "ancient", timestamp: 0 },
    ], BOUNDS);

    const recentGap = Math.abs(recent.normalizedOffset.z - newest.normalizedOffset.z);
    const ancientGap = Math.abs(ancient.normalizedOffset.z - recent.normalizedOffset.z);
    expect(recentGap * 10).toBeLessThan(ancientGap);
  });

  it("separates packages that share a moment instead of stacking them", () => {
    const [a, b] = projectUniverseTemporalAxis([
      { bundleId: "a", timestamp: 1_000 },
      { bundleId: "b", timestamp: 1_000 },
    ], BOUNDS);

    expect(a.normalizedOffset.z).toBe(b.normalizedOffset.z);
    expect(a.normalizedOffset).not.toEqual(b.normalizedOffset);
    // The near end must keep a lateral radius. Collapsing it to a point is only
    // safe when exactly one package can ever sit there, which a real timestamp
    // axis cannot promise.
    expect(Math.hypot(a.normalizedOffset.x, a.normalizedOffset.y)).toBeGreaterThan(0);
    expect(Math.hypot(b.normalizedOffset.x, b.normalizedOffset.y)).toBeGreaterThan(0);
  });

  it("derives the lateral angle from package identity alone", () => {
    const [near] = projectUniverseTemporalAxis(
      [{ bundleId: "x", timestamp: 900 }],
      BOUNDS,
    );
    const [far] = projectUniverseTemporalAxis(
      [{ bundleId: "x", timestamp: 100 }],
      BOUNDS,
    );

    // Age may only push a package further out along its own bearing. If x and y
    // scale by one factor the bearing held; anything else means the lane swung.
    const radialGrowth = far.normalizedOffset.x / near.normalizedOffset.x;
    expect(far.normalizedOffset.y / near.normalizedOffset.y)
      .toBeCloseTo(radialGrowth, 10);
    expect(radialGrowth).toBeGreaterThan(1);
  });

  it("falls back to rank progress when an event has no usable time", () => {
    const [missing, degenerate] = projectUniverseTemporalAxis([
      { bundleId: "missing", rankProgress: 1 },
      { bundleId: "degenerate", timestamp: 500, rankProgress: 0.5 },
    ], { nearTimestamp: 500, farTimestamp: 500 });

    expect(missing.ageProgress).toBe(1);
    expect(degenerate.ageProgress).toBe(0.5);
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
