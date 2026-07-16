import { describe, expect, it } from "vitest";

import {
  applyUniverseTemporalFlightWheel,
  brakeUniverseTemporalFlight,
  createUniverseTemporalFlightState,
  flyUniverseTemporalFlightTo,
  planUniverseTemporalFlightFollow,
  stepUniverseTemporalFlight,
  UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL,
  universeTemporalFlightPresence,
} from "./universe-temporal-flight";

const WHEEL = { deltaMode: 0, viewportHeight: 800 };

function coast(
  state = createUniverseTemporalFlightState(),
  maxDepth = 10_000,
  frames = 240,
) {
  let current = state;
  for (let frame = 0; frame < frames; frame += 1) {
    const result = stepUniverseTemporalFlight(current, {
      elapsedMs: 16,
      maxDepth,
    });
    current = result.state;
    if (!result.moving) break;
  }
  return current;
}

describe("universe temporal flight", () => {
  it("coasts a wheel notch to roughly the gesture's travel and stops", () => {
    const impelled = applyUniverseTemporalFlightWheel(
      createUniverseTemporalFlightState(),
      { ...WHEEL, deltaY: -120 },
    );
    const settled = coast(impelled);

    const promisedTravel = 120 * UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL;
    expect(settled.velocity).toBe(0);
    expect(settled.depth).toBeGreaterThan(promisedTravel * 0.8);
    expect(settled.depth).toBeLessThan(promisedTravel * 1.2);
  });

  it("flies toward the present on downward scroll and walls at the newest moment", () => {
    // Wheel-up dives deeper (the zoom-in hand motion); wheel-down backs out.
    const fromShallow = applyUniverseTemporalFlightWheel(
      createUniverseTemporalFlightState(20),
      { ...WHEEL, deltaY: 600 },
    );
    const settled = coast(fromShallow);

    expect(settled.depth).toBe(0);
    expect(settled.velocity).toBe(0);
  });

  it("walls at the oldest moment instead of overshooting the axis", () => {
    const impelled = applyUniverseTemporalFlightWheel(
      createUniverseTemporalFlightState(),
      { ...WHEEL, deltaY: -10_000 },
    );
    const settled = coast(impelled, 300);

    expect(settled.depth).toBe(300);
    expect(settled.velocity).toBe(0);
  });

  it("treats a long-blocked frame as one frame, not as elapsed teleport time", () => {
    const impelled = applyUniverseTemporalFlightWheel(
      createUniverseTemporalFlightState(),
      { ...WHEEL, deltaY: -120 },
    );
    const afterTabSwitch = stepUniverseTemporalFlight(impelled, {
      elapsedMs: 5_000,
      maxDepth: 10_000,
    });

    expect(afterTabSwitch.state.depth).toBeLessThan(30);
  });

  it("glides to a button target and settles exactly there", () => {
    const gliding = flyUniverseTemporalFlightTo(
      createUniverseTemporalFlightState(100),
      460,
    );
    const settled = coast(gliding);

    expect(settled.depth).toBe(460);
    expect(settled.targetDepth).toBeNull();
  });

  it("lets a live wheel gesture take over from a glide in progress", () => {
    const gliding = flyUniverseTemporalFlightTo(
      createUniverseTemporalFlightState(100),
      460,
    );
    const grabbed = applyUniverseTemporalFlightWheel(gliding, {
      ...WHEEL,
      deltaY: -120,
    });

    expect(grabbed.targetDepth).toBeNull();
    // Wheel-up is the dive: the takeover pushes deeper, ignoring the glide.
    expect(grabbed.velocity).toBeGreaterThan(0);
  });

  it("brakes on grab and reports rest so the loop can sleep", () => {
    const impelled = applyUniverseTemporalFlightWheel(
      createUniverseTemporalFlightState(50),
      { ...WHEEL, deltaY: 120 },
    );
    const braked = brakeUniverseTemporalFlight(impelled);
    const stepped = stepUniverseTemporalFlight(braked, {
      elapsedMs: 16,
      maxDepth: 1_000,
    });

    expect(braked.velocity).toBe(0);
    expect(stepped.moving).toBe(false);
    expect(stepped.state.depth).toBe(50);
  });

  it("applies travel directly under reduced motion, with no inertia tail", () => {
    const moved = applyUniverseTemporalFlightWheel(
      createUniverseTemporalFlightState(10),
      { ...WHEEL, deltaY: -120, reducedMotion: true },
    );

    expect(moved.velocity).toBe(0);
    expect(moved.depth).toBe(10 + 120 * UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL);

    const gliding = flyUniverseTemporalFlightTo(moved, 500);
    const snapped = stepUniverseTemporalFlight(gliding, {
      elapsedMs: 16,
      maxDepth: 1_000,
      reducedMotion: true,
    });
    expect(snapped.state.depth).toBe(500);
    expect(snapped.moving).toBe(false);
  });

  it("pages ahead approaching the window's old edge, back only after leaving its new edge", () => {
    const window = {
      windowNearDepth: 600,
      windowFarDepth: 960,
      marginUnits: 90,
      busy: false,
      hasNext: true,
      hasPrevious: true,
    };

    expect(planUniverseTemporalFlightFollow({ ...window, depth: 700 })).toBeNull();
    expect(planUniverseTemporalFlightFollow({ ...window, depth: 880 })).toBe("next");
    // Still inside the window near its new edge: paging back here would ping-pong
    // with the page-older threshold of the adjacent window at the same depth.
    expect(planUniverseTemporalFlightFollow({ ...window, depth: 620 })).toBeNull();
    expect(planUniverseTemporalFlightFollow({ ...window, depth: 505 }))
      .toBe("previous");
  });

  it("holds paging while busy or at the axis ends", () => {
    const window = {
      windowNearDepth: 0,
      windowFarDepth: 360,
      marginUnits: 90,
      hasNext: false,
      hasPrevious: false,
      busy: false,
    };

    expect(planUniverseTemporalFlightFollow({ ...window, depth: 350 })).toBeNull();
    expect(planUniverseTemporalFlightFollow({
      ...window,
      depth: 350,
      hasNext: true,
      busy: true,
    })).toBeNull();
    // A camera above the newest window can never page previous at the axis start.
    expect(planUniverseTemporalFlightFollow({
      ...window,
      depth: 0,
      hasPrevious: true,
    })).toBeNull();
  });

  it("keeps both edges from triggering inside a narrow window", () => {
    const narrow = {
      windowNearDepth: 100,
      windowFarDepth: 160,
      marginUnits: 90,
      busy: false,
      hasNext: true,
      hasPrevious: true,
    };

    // Margin clamps to a third of the span, so the middle stays quiet.
    expect(planUniverseTemporalFlightFollow({ ...narrow, depth: 130 })).toBeNull();
    expect(planUniverseTemporalFlightFollow({ ...narrow, depth: 155 })).toBe("next");
  });

  it("leads the page with velocity so fast flight never outruns its data", () => {
    const window = {
      windowNearDepth: 600,
      windowFarDepth: 960,
      marginUnits: 90,
      busy: false,
      hasNext: true,
      hasPrevious: true,
    };

    // Mid-window is quiet at rest, but flying fast toward the old edge pages
    // now: 900 units/s × 0.5 s lead crosses the far threshold from anywhere
    // in this window.
    expect(planUniverseTemporalFlightFollow({ ...window, depth: 780 })).toBeNull();
    expect(planUniverseTemporalFlightFollow({
      ...window,
      depth: 780,
      velocity: 900,
    })).toBe("next");
    // The lead is direction-gated: speed toward the newer edge trips previous,
    // and a camera short of both led thresholds stays quiet even at speed.
    expect(planUniverseTemporalFlightFollow({
      ...window,
      depth: 780,
      velocity: -900,
    })).toBe("previous");
    expect(planUniverseTemporalFlightFollow({
      ...window,
      depth: 540,
      velocity: 500,
    })).toBeNull();
  });

  it("keeps whatever the camera reaches fully present, thinning only with distance", () => {
    // At the camera plane and through most of the loaded window: fully there.
    // Reading events is the point — the stage ahead must stay legible.
    expect(universeTemporalFlightPresence(0, 60)).toEqual({ scale: 1, opacity: 1 });
    expect(universeTemporalFlightPresence(60, 60)).toEqual({ scale: 1, opacity: 1 });
    expect(universeTemporalFlightPresence(60 * 5, 60)).toEqual({ scale: 1, opacity: 1 });
    // Far ahead: atmospheric floor, never invisible — the corridor keeps
    // promising more.
    const far = universeTemporalFlightPresence(60 * 20, 60);
    expect(far.scale).toBeCloseTo(0.5, 5);
    expect(far.opacity).toBeCloseTo(0.25, 5);
    // Between: monotonic thinning.
    const mid = universeTemporalFlightPresence(60 * 10, 60);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.opacity).toBeGreaterThan(far.opacity);
    expect(mid.scale).toBeLessThan(1);
    expect(mid.scale).toBeGreaterThan(far.scale);
    // Behind: passed packages fade fast but settle on a faint ember, so
    // looking back shows the travelled road instead of pure black.
    expect(universeTemporalFlightPresence(-30, 60).opacity).toBe(1);
    expect(universeTemporalFlightPresence(-90, 60).opacity).toBeLessThan(1);
    expect(universeTemporalFlightPresence(-60 * 3, 60).opacity).toBeCloseTo(0.1, 10);
    expect(universeTemporalFlightPresence(-60 * 30, 60).opacity).toBeCloseTo(0.1, 10);
    expect(universeTemporalFlightPresence(-60 * 3, 60).scale).toBe(1);
  });
});
