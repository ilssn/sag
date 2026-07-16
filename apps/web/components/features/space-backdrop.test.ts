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
  it("reuses the shell atmosphere without duplicating its galaxy inside the universe", () => {
    expect(source).toContain('variant?: "shell" | "universe"');
    expect(source).toContain('data-space-variant={variant}');
    expect(source).toContain('variant === "shell" && (');
    expect(source).toContain('<span className="sag-space-galaxy-orbit">');
    expect(source).toContain('<span className="sag-space-dust" />');
    expect(source).toContain(
      'reducedMotion={ambientMotionPaused || variant === "universe"}',
    );
    expect(source).toContain("pauseAmbientMotion = false");
  });

  it("uses universe view only as an overview/detail visibility gate", () => {
    const viewEffect = sourceBetween(
      "React.useEffect(() => {\n    const backdrop = backdropRef.current;",
      "React.useEffect(() => {\n    if (reducedMotion || !cursorMeteorRef.current) return;",
    );

    expect(viewEffect).toContain("readUniverseView()");
    expect(viewEffect).toContain("UNIVERSE_VIEW_EVENT");
    expect(viewEffect).toContain(
      'view.mode === "detail" || view.progress >= 0.12',
    );
    expect(viewEffect).toContain('backdrop.dataset.universeView = nextView');
    expect(viewEffect).toContain(
      'backdrop.dataset.ambientMotion = ambientMotionPaused || detail ? "paused" : "active"',
    );
    expect(viewEffect).toContain('cursorMeteorRef.current.dataset.active = "false"');
    expect(viewEffect).not.toMatch(/style\.|transform|translate|rotate|scale/);
    expect(source).not.toContain("useTransform");
  });

  it("gates the cursor meteor for drags and source-detail exploration", () => {
    expect(source).toContain("event.buttons !== 0");
    expect(source).toContain(
      'variant === "universe" && universeDetailRef.current',
    );
    expect(source.indexOf("event.buttons !== 0"))
      .toBeLessThan(source.indexOf("pendingFrame = { x, y, speed, angle }"));
  });

  it("seeds its first point, ignores low-speed jitter and normalizes pointer polling rate", () => {
    const pointerMove = sourceBetween(
      "const handlePointerMove = (event: PointerEvent) =>",
      "const resizeObserver = new ResizeObserver(measureField)",
    );

    expect(pointerMove).toContain("if (!hasPreviousPoint)");
    expect(pointerMove).toContain("previousTime = event.timeStamp");
    expect(pointerMove).toContain("hasPreviousPoint = true;\n        return;");
    expect(pointerMove).toContain(
      "Math.max(8, Math.min(50, event.timeStamp - previousTime || 16.67))",
    );
    expect(pointerMove).toContain("* (16.67 / elapsed)");
    expect(pointerMove).toContain("if (speed <= 0.7) return");
    expect(pointerMove.indexOf("if (speed <= 0.7) return"))
      .toBeLessThan(pointerMove.indexOf("pendingFrame = { x, y, speed, angle }"));
  });

  it("coalesces cursor meteor work to one frame and cleans it up without pointer-time layout reads", () => {
    const pointerMove = sourceBetween(
      "const handlePointerMove = (event: PointerEvent) =>",
      "const resizeObserver = new ResizeObserver(measureField)",
    );
    const cleanup = sourceBetween(
      "return () => {\n      resizeObserver.disconnect();",
      "}, [reducedMotion, variant]);",
    );

    expect(source).toContain("let fieldBounds = field.getBoundingClientRect()");
    expect(pointerMove).toContain("fieldBounds.left");
    expect(pointerMove).toContain("window.requestAnimationFrame(renderMeteor)");
    expect(pointerMove).not.toContain("getBoundingClientRect()");
    expect(cleanup).toContain("window.cancelAnimationFrame(animationFrame)");
    expect(cleanup).toContain("window.clearTimeout(hideTimer)");
  });
});
