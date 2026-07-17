import { describe, expect, it } from "vitest";

import type { UniverseActivation } from "@/lib/types";
import {
  LOCAL_ENTITY_SPREAD_MIN,
  LOCAL_ENTITY_SPREAD_RANGE,
  TIMELINE_EVENT_LATERAL_SPREAD,
  dominantSource,
  emptySourceBrowseSession,
  stableOffset,
  stableRootEventOffset,
  stableSatelliteOffset,
} from "./model";

describe("knowledge universe model", () => {
  it("keeps timeline packages and local entities on an immersive stage", () => {
    expect(TIMELINE_EVENT_LATERAL_SPREAD).toBeGreaterThanOrEqual(4);
    expect(LOCAL_ENTITY_SPREAD_MIN).toBeGreaterThanOrEqual(48);
    expect(LOCAL_ENTITY_SPREAD_MIN + LOCAL_ENTITY_SPREAD_RANGE)
      .toBeGreaterThanOrEqual(96);
    expect(LOCAL_ENTITY_SPREAD_MIN + LOCAL_ENTITY_SPREAD_RANGE)
      .toBeLessThanOrEqual(110);
  });

  it("builds isolated browse state with the requested window limits", () => {
    const session = emptySourceBrowseSession(7, "source-a", 12, 36);

    expect(session.sourceId).toBe("source-a");
    expect(session.working.epoch).toBe(7);
    expect(session.timeline.window.visibleLimit).toBe(12);
    expect(session.timeline.window.cacheLimit).toBe(36);
    expect(session.timeline.preferredDirection).toBe("older");
  });

  it("keeps deterministic projection offsets stable", () => {
    expect(stableOffset("entity-a", 120)).toEqual(stableOffset("entity-a", 120));
    expect(stableRootEventOffset("source-a", "event-a", 120, 3, 12)).toEqual(
      stableRootEventOffset("source-a", "event-a", 120, 3, 12),
    );
    expect(stableOffset("entity-a", 120)).not.toEqual(stableOffset("entity-b", 120));
  });

  it("keeps entity satellites local to their event's temporal plane", () => {
    const offsets = Array.from({ length: 40 }, (_, index) =>
      stableSatelliteOffset(`entity-${index}`, 104));

    expect(Math.max(...offsets.map((offset) => Math.abs(offset.z))))
      .toBeLessThanOrEqual(10);
    expect(Math.min(...offsets.map((offset) => Math.hypot(offset.x, offset.y))))
      .toBeGreaterThan(55);
    expect(Math.max(...offsets.map((offset) => Math.hypot(
      offset.x,
      offset.y,
      offset.z,
    )))).toBeLessThanOrEqual(105);
  });

  it("fans entity satellites outward without refilling the source core", () => {
    const parent = { x: 84, y: -36, z: -300 };
    const offsets = Array.from({ length: 80 }, (_, index) =>
      stableSatelliteOffset(`entity-${index}`, 104, parent));

    offsets.forEach((offset) => {
      expect(offset.x * parent.x + offset.y * parent.y).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(parent.x + offset.x, parent.y + offset.y))
        .toBeGreaterThanOrEqual(Math.hypot(parent.x, parent.y));
    });
  });

  it("reserves the inner field for the latest non-temporal root", () => {
    const first = stableRootEventOffset("source-a", "event-0", 100, 0, 12);
    const latest = stableRootEventOffset("source-a", "event-11", 100, 11, 12);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(
      Math.hypot(latest.x, latest.y),
    );
  });

  it("prefers explicit search evidence and otherwise finds the dominant event source", () => {
    const activation = {
      source_hits: [{ source_id: "explicit" }],
      nodes: [
        { kind: "event", source_id: "secondary" },
        { kind: "event", source_id: "secondary" },
      ],
    } as unknown as UniverseActivation;
    expect(dominantSource(activation)).toBe("explicit");

    expect(dominantSource({
      source_hits: [],
      nodes: [
        { kind: "event", source_id: "a" },
        { kind: "entity", source_id: "a" },
        { kind: "event", source_id: "b" },
        { kind: "event", source_id: "b" },
      ],
    } as unknown as UniverseActivation)).toBe("b");
  });
});
