import { describe, expect, it } from "vitest";

import {
  resolveUniverseDetailSource,
  universeDeepLoadMilestone,
} from "./universe-presentation";

describe("universe presentation state", () => {
  it("enters detail only at the near threshold", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: null,
      currentRadiusPx: null,
      candidateSourceId: "source-a",
      candidateRadiusPx: 179,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBeNull();
    expect(resolveUniverseDetailSource({
      currentSourceId: null,
      currentRadiusPx: null,
      candidateSourceId: "source-a",
      candidateRadiusPx: 180,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-a");
  });

  it("keeps the activated source through orbit, pan, and ordinary zoom", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 116,
      candidateSourceId: "source-b",
      candidateRadiusPx: 220,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-a");
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 116,
      candidateSourceId: null,
      candidateRadiusPx: null,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-a");
  });

  it("returns the whole source to overview only at the exit threshold", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 72,
      candidateSourceId: "source-a",
      candidateRadiusPx: 72,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBeNull();
  });

  it("lets an explicit node focus establish its source immediately", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: null,
      currentRadiusPx: null,
      candidateSourceId: null,
      candidateRadiusPx: null,
      explicitSourceId: "source-b",
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-b");
  });

  it("uses coarse deep-zoom milestones instead of individual wheel gestures", () => {
    expect(universeDeepLoadMilestone(359, 360, 24)).toBe(0);
    expect(universeDeepLoadMilestone(360, 360, 24)).toBe(1);
    expect(universeDeepLoadMilestone(470, 360, 24)).toBe(1);
    expect(universeDeepLoadMilestone(500, 360, 24)).toBe(2);
  });
});
