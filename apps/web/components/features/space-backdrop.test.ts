import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./space-backdrop.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("space backdrop interaction isolation", () => {
  it("does not translate the screen-space galaxy from graph camera progress", () => {
    expect(source).not.toContain("UNIVERSE_VIEW_EVENT");
    expect(source).not.toContain("readUniverseView");
    expect(source).not.toContain("useTransform");
    expect(source).not.toContain("galaxyX");
    expect(source).toContain('<span className="sag-space-galaxy-orbit">');
    expect(source).toContain("pauseAmbientMotion = false");
    expect(source).toContain('data-ambient-motion={ambientMotionPaused ? "paused" : "active"}');
  });

  it("suppresses the decorative cursor meteor while the graph is being dragged", () => {
    expect(source).toContain("event.buttons !== 0");
    expect(source.indexOf("event.buttons !== 0"))
      .toBeLessThan(source.indexOf("pendingFrame = { x, y, speed, angle }"));
  });

  it("coalesces cursor meteor work to one frame without pointer-time layout reads", () => {
    const pointerMove = sourceBetween(
      "const handlePointerMove = (event: PointerEvent) =>",
      "const resizeObserver = new ResizeObserver(measureField)",
    );
    expect(source).toContain("let fieldBounds = field.getBoundingClientRect()");
    expect(pointerMove).toContain("fieldBounds.left");
    expect(pointerMove).toContain("window.requestAnimationFrame(renderMeteor)");
    expect(pointerMove).not.toContain("getBoundingClientRect()");
    expect(source).toContain("window.cancelAnimationFrame(animationFrame)");
  });
});
