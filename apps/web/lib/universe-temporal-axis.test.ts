import { describe, expect, it } from "vitest";

import {
  createUniverseTemporalAxis,
  projectUniverseTemporalAxis,
  resolveUniverseTemporalAxisPolicy,
  universeTemporalAxisAgeProgress,
  universeTemporalAxisDepth,
} from "./universe-temporal-axis";

/** Ten events in exploration order; the shape every source now shares. */
const TEN = createUniverseTemporalAxis(10);

describe("universe temporal axis", () => {
  it("spends the same depth on every event, whatever its clock time was", () => {
    // ordinal → age is linear: the axis is the exploration order itself. An
    // imported book (every event at one instant) gets exactly the same axis as
    // a two-year diary with the same event count.
    expect(universeTemporalAxisAgeProgress(TEN, 0)).toBe(0);
    expect(universeTemporalAxisAgeProgress(TEN, 9)).toBe(1);
    expect(universeTemporalAxisAgeProgress(TEN, 3)).toBeCloseTo(3 / 9, 10);
  });

  it("clamps ordinals outside the snapshot's own range", () => {
    expect(universeTemporalAxisAgeProgress(TEN, -5)).toBe(0);
    expect(universeTemporalAxisAgeProgress(TEN, 50)).toBe(1);
    expect(universeTemporalAxisAgeProgress(TEN, Number.NaN)).toBe(0);
  });

  it("gives every event the same slice of the axis", () => {
    // The visible window is at most 18 packages, so a per-event length is what
    // decides whether depth is legible — not the source's size or time span.
    expect(universeTemporalAxisDepth(TEN, 60)).toBe(540);
    expect(universeTemporalAxisDepth(createUniverseTemporalAxis(2), 60)).toBe(60);
    expect(universeTemporalAxisDepth(null, 60)).toBe(0);
  });

  it("places an event on its shell: unit bearing × caller-scaled radius", () => {
    // depth = age × axisDepth must land on the counting grid, or the flight's
    // per-event margins and the window follow thresholds drift apart. The
    // bearing is a unit vector so the caller owns the radius exactly.
    const axisDepth = universeTemporalAxisDepth(TEN, 60);
    const [projection] = projectUniverseTemporalAxis(
      [{ bundleId: "x", ordinal: 4 }],
      TEN,
    );
    expect(projection.ageProgress * axisDepth).toBeCloseTo(240, 10);
    const { x, y, z } = projection.radialDirection;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 10);
  });

  it("refuses to build an axis only when there is nothing to explore", () => {
    expect(createUniverseTemporalAxis(0)).toBeNull();
    expect(createUniverseTemporalAxis(-3)).toBeNull();
    expect(createUniverseTemporalAxis(Number.NaN)).toBeNull();
    // A single event still carries an axis: depth 0, nowhere to fly, but the
    // wheel keeps its in-source meaning instead of falling back to zoom.
    expect(createUniverseTemporalAxis(1)).toEqual({ total: 1 });
    expect(universeTemporalAxisAgeProgress(createUniverseTemporalAxis(1), 0)).toBe(0);
    expect(universeTemporalAxisAgeProgress(null, 5)).toBe(0);
  });

  it("keeps a package's projection identical no matter what else is in the batch", () => {
    const alone = projectUniverseTemporalAxis(
      [{ bundleId: "x", ordinal: 7 }],
      TEN,
    );
    const crowded = projectUniverseTemporalAxis([
      { bundleId: "a", ordinal: 1 },
      { bundleId: "x", ordinal: 7 },
      { bundleId: "b", ordinal: 9 },
    ], TEN);

    expect(crowded.find((projection) => projection.bundleId === "x"))
      .toEqual(alone[0]);
  });

  it("separates same-shell packages by bearing, never by radius", () => {
    const [a, b] = projectUniverseTemporalAxis([
      { bundleId: "a", ordinal: 5 },
      { bundleId: "b", ordinal: 5 },
    ], TEN);

    // Same ordinal = same shell; identity spreads them around the sphere.
    expect(a.ageProgress).toBe(b.ageProgress);
    expect(a.radialDirection).not.toEqual(b.radialDirection);
  });

  it("derives the bearing from package identity alone", () => {
    // The sphere has no privileged direction and a package may never swing
    // because of its age or the camera's travel: only its shell may change.
    const [near] = projectUniverseTemporalAxis(
      [{ bundleId: "x", ordinal: 1 }],
      TEN,
    );
    const [far] = projectUniverseTemporalAxis(
      [{ bundleId: "x", ordinal: 9 }],
      TEN,
    );

    expect(far.radialDirection).toEqual(near.radialDirection);
    expect(far.ageProgress).toBeGreaterThan(near.ageProgress);
  });

  it("keeps travel even by default and leaves the curve as a knob", () => {
    // An exponent bends depth away from the count it is supposed to track, so
    // even spacing is the default the axis ships with.
    expect(resolveUniverseTemporalAxisPolicy().ageExponent).toBe(1);
    const [half] = projectUniverseTemporalAxis(
      [{ bundleId: "x", ordinal: 4.5 }],
      TEN,
    );
    expect(half.ageProgress).toBeCloseTo(0.5, 10);
    expect(resolveUniverseTemporalAxisPolicy({ ageExponent: 0 }).ageExponent)
      .toBeGreaterThan(0);
  });
});
