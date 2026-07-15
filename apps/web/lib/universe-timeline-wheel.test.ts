import { describe, expect, it } from "vitest";

import {
  createUniverseTimelineWheelState,
  drainUniverseTimelineWheel,
  normalizeUniverseTimelineWheelDelta,
  planUniverseTimelineWheel,
  resetUniverseTimelineWheelState,
  type UniverseTimelineWheelState,
} from "./universe-timeline-wheel";

function plan(
  state: UniverseTimelineWheelState,
  overrides: Partial<Parameters<typeof planUniverseTimelineWheel>[1]> = {},
) {
  return planUniverseTimelineWheel(state, {
    deltaY: 0,
    busy: false,
    mode: "stable",
    ...overrides,
  });
}

describe("universe timeline wheel coordinator", () => {
  it("normalizes pixel, line and page delta modes", () => {
    expect(normalizeUniverseTimelineWheelDelta(2, 0, 600)).toBe(2);
    expect(normalizeUniverseTimelineWheelDelta(2, 1, 600)).toBe(32);
    expect(normalizeUniverseTimelineWheelDelta(2, 2, 600)).toBe(1_200);
    expect(normalizeUniverseTimelineWheelDelta(-1, 2, 720)).toBe(-720);
    expect(normalizeUniverseTimelineWheelDelta(3, 99, 600)).toBe(3);
    expect(normalizeUniverseTimelineWheelDelta(Number.NaN, 0, 600)).toBe(0);
  });

  it("emits next after the stable-view threshold and enters the journey", () => {
    const first = plan(createUniverseTimelineWheelState(), {
      deltaY: 70,
      threshold: 120,
    });
    expect(first).toMatchObject({
      intent: null,
      outcome: "accumulating",
      state: { accumulatedDistance: 70, direction: "next" },
    });

    const second = plan(first.state, { deltaY: 50, threshold: 120 });
    expect(second).toMatchObject({
      intent: { direction: "next", action: "enter-journey" },
      outcome: "intent",
      state: {
        accumulatedDistance: 0,
        direction: null,
        queuedDirection: null,
      },
    });
  });

  it("emits previous while continuing an existing journey", () => {
    const result = plan(createUniverseTimelineWheelState(), {
      deltaY: -3,
      deltaMode: 1,
      threshold: 40,
      mode: "journey",
    });
    expect(result.intent).toEqual({
      direction: "previous",
      action: "continue-journey",
    });
  });

  it("clears accumulated distance when the direction reverses", () => {
    const forward = plan(createUniverseTimelineWheelState(), {
      deltaY: 90,
      threshold: 120,
    });
    const reverse = plan(forward.state, {
      deltaY: -40,
      threshold: 120,
      mode: "journey",
    });
    expect(reverse).toMatchObject({
      intent: null,
      state: { accumulatedDistance: 40, direction: "previous" },
    });

    const accepted = plan(reverse.state, {
      deltaY: -80,
      threshold: 120,
      mode: "journey",
    });
    expect(accepted.intent?.direction).toBe("previous");
  });

  it("keeps ctrl/meta wheel camera-only and clears partial gesture residue", () => {
    const partial = plan(createUniverseTimelineWheelState(), {
      deltaY: 80,
      threshold: 120,
    });
    const ctrlZoom = plan(partial.state, {
      deltaY: 500,
      ctrlKey: true,
      threshold: 120,
    });
    expect(ctrlZoom).toMatchObject({
      intent: null,
      outcome: "zoom-only",
      state: { accumulatedDistance: 0, direction: null },
    });

    const metaZoom = plan(createUniverseTimelineWheelState(), {
      deltaY: -500,
      metaKey: true,
      threshold: 120,
      mode: "journey",
    });
    expect(metaZoom.intent).toBeNull();
    expect(metaZoom.outcome).toBe("zoom-only");
  });

  it("cancels a queued direction when pinch zoom occurs before settling", () => {
    const queued = plan(createUniverseTimelineWheelState(), {
      deltaY: 180,
      busy: true,
      mode: "journey",
    });
    expect(queued.state.queuedDirection).toBe("next");

    const pinch = plan(queued.state, {
      deltaY: -240,
      ctrlKey: true,
      busy: true,
      mode: "journey",
    });
    expect(pinch).toMatchObject({
      intent: null,
      outcome: "zoom-only",
      state: {
        accumulatedDistance: 0,
        direction: null,
        queuedDirection: null,
      },
    });

    const settled = drainUniverseTimelineWheel(pinch.state, {
      busy: false,
      mode: "journey",
    });
    expect(settled.intent).toBeNull();
    expect(settled.outcome).toBe("idle");
  });

  it("keeps only the latest accepted direction while busy", () => {
    const queuedNext = plan(createUniverseTimelineWheelState(), {
      deltaY: 120,
      threshold: 120,
      busy: true,
      mode: "journey",
    });
    expect(queuedNext).toMatchObject({
      intent: null,
      outcome: "queued",
      state: { queuedDirection: "next" },
    });

    const queuedPrevious = plan(queuedNext.state, {
      deltaY: -120,
      threshold: 120,
      busy: true,
      mode: "journey",
    });
    expect(queuedPrevious.state.queuedDirection).toBe("previous");
    expect(Object.keys(queuedPrevious.state)).toEqual([
      "accumulatedDistance",
      "direction",
      "queuedDirection",
    ]);
  });

  it("drains one queued direction only after the coordinator is idle", () => {
    const queued = plan(createUniverseTimelineWheelState(), {
      deltaY: 200,
      busy: true,
      mode: "journey",
    }).state;

    const stillBusy = drainUniverseTimelineWheel(queued, {
      busy: true,
      mode: "journey",
    });
    expect(stillBusy.state).toBe(queued);
    expect(stillBusy.intent).toBeNull();

    const drained = drainUniverseTimelineWheel(queued, {
      busy: false,
      mode: "journey",
    });
    expect(drained.intent).toEqual({
      direction: "next",
      action: "continue-journey",
    });
    expect(drained.state).toEqual(createUniverseTimelineWheelState());

    expect(drainUniverseTimelineWheel(drained.state, {
      busy: false,
      mode: "journey",
    }).intent).toBeNull();
  });

  it("resets accumulation and queued intent together", () => {
    expect(resetUniverseTimelineWheelState()).toEqual({
      accumulatedDistance: 0,
      direction: null,
      queuedDirection: null,
    });
  });

  it("emits at most one intent for a very large delta", () => {
    const result = plan(createUniverseTimelineWheelState(), {
      deltaY: 5,
      deltaMode: 2,
      viewportHeight: 900,
      threshold: 120,
    });
    expect(result.intent?.direction).toBe("next");
    expect(result.state.accumulatedDistance).toBe(0);
    expect(result.state.queuedDirection).toBeNull();
  });
});
