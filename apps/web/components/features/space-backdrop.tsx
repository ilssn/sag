"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";

import {
  UNIVERSE_VIEW_EVENT,
  readUniverseView,
  type UniverseViewState,
} from "@/lib/universe-events";
import { ParticleGalaxy } from "@/components/features/particle-galaxy";

const SpaceParticles = dynamic(
  () => import("@/components/features/space-particles").then((module) => module.SpaceParticles),
  { ssr: false },
);

const SPARKLES = [
  { x: 7, y: 18, size: 7, delay: -1.2, duration: 8.8 },
  { x: 12, y: 49, size: 4, delay: -9.4, duration: 12.4 },
  { x: 18, y: 72, size: 5, delay: -5.8, duration: 11.4 },
  { x: 24, y: 8, size: 6, delay: -3.1, duration: 10.2 },
  { x: 29, y: 34, size: 4, delay: -8.1, duration: 13.2 },
  { x: 33, y: 63, size: 5, delay: -11.2, duration: 14.6 },
  { x: 38, y: 84, size: 6, delay: -3.4, duration: 10.6 },
  { x: 46, y: 43, size: 4, delay: -6.3, duration: 11.9 },
  { x: 51, y: 12, size: 5, delay: -7.6, duration: 12.8 },
  { x: 57, y: 89, size: 5, delay: -1.8, duration: 9.8 },
  { x: 62, y: 58, size: 7, delay: -2.7, duration: 9.6 },
  { x: 68, y: 8, size: 6, delay: -12.6, duration: 15.1 },
  { x: 73, y: 27, size: 4, delay: -10.2, duration: 14.2 },
  { x: 77, y: 56, size: 5, delay: -6.9, duration: 12.1 },
  { x: 82, y: 78, size: 5, delay: -4.9, duration: 11.8 },
  { x: 88, y: 15, size: 4, delay: -2.4, duration: 9.4 },
  { x: 93, y: 44, size: 6, delay: -8.8, duration: 13.6 },
  { x: 96, y: 88, size: 6, delay: -10.7, duration: 14.8 },
] as const;

export function SpaceBackdrop() {
  const reducedMotion = useReducedMotion();
  const initialViewRef = React.useRef(readUniverseView());
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const cursorMeteorRef = React.useRef<HTMLSpanElement>(null);
  const viewProgress = useMotionValue(initialViewRef.current.progress);
  const springProgress = useSpring(viewProgress, {
    stiffness: 92,
    damping: 23,
    mass: 1.05,
    restDelta: 0.001,
  });
  const renderedProgress = reducedMotion ? viewProgress : springProgress;
  const galaxyX = useTransform(renderedProgress, [0, 0.55, 1], ["0%", "12%", "36%"]);
  const galaxyY = useTransform(renderedProgress, [0, 0.55, 1], ["0%", "-8%", "-24%"]);
  const galaxyScale = useTransform(renderedProgress, [0, 0.55, 1], [1, 0.98, 0.9]);
  const galaxyOpacity = useTransform(renderedProgress, [0, 0.55, 1], [1, 0.72, 0.16]);

  React.useEffect(() => {
    const applyView = (view: UniverseViewState) => {
      viewProgress.set(view.progress);
      if (!backdropRef.current) return;
      backdropRef.current.dataset.universeView = view.mode;
      backdropRef.current.dataset.universeViewProgress = view.progress.toFixed(2);
    };
    const handleView = (event: Event) => {
      const view = (event as CustomEvent<UniverseViewState>).detail;
      if (view) applyView(view);
    };
    applyView(readUniverseView());
    window.addEventListener(UNIVERSE_VIEW_EVENT, handleView);
    return () => window.removeEventListener(UNIVERSE_VIEW_EVENT, handleView);
  }, [viewProgress]);

  React.useEffect(() => {
    if (reducedMotion || !cursorMeteorRef.current) return;

    const meteor = cursorMeteorRef.current;
    const field = meteor.closest<HTMLElement>(".bg-space-field");
    if (!field) return;

    let hideTimer: number | undefined;
    let hasPreviousPoint = false;
    let previousX = 0;
    let previousY = 0;
    let angle = -0.35;

    const hideMeteor = () => {
      meteor.dataset.active = "false";
      hasPreviousPoint = false;
      if (hideTimer) window.clearTimeout(hideTimer);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.target !== field) {
        hideMeteor();
        return;
      }

      const bounds = field.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const deltaX = hasPreviousPoint ? x - previousX : 0;
      const deltaY = hasPreviousPoint ? y - previousY : 0;
      const speed = Math.hypot(deltaX, deltaY);

      if (speed > 0.4) angle = Math.atan2(deltaY, deltaX);

      previousX = x;
      previousY = y;
      hasPreviousPoint = true;

      meteor.style.setProperty("--cursor-meteor-x", `${x}px`);
      meteor.style.setProperty("--cursor-meteor-y", `${y}px`);
      meteor.style.setProperty("--cursor-meteor-angle", `${angle}rad`);
      meteor.style.setProperty("--cursor-meteor-tail", `${Math.min(138, 46 + speed * 3.4)}px`);
      meteor.dataset.active = "true";

      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hideMeteor, 300);
    };

    field.addEventListener("pointermove", handlePointerMove);
    field.addEventListener("pointerleave", hideMeteor);

    return () => {
      field.removeEventListener("pointermove", handlePointerMove);
      field.removeEventListener("pointerleave", hideMeteor);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [reducedMotion]);

  return (
    <div
      ref={backdropRef}
      className="sag-space-sparkles"
      data-universe-view={initialViewRef.current.mode}
      data-universe-view-progress={initialViewRef.current.progress.toFixed(2)}
      aria-hidden
    >
      <SpaceParticles reducedMotion={Boolean(reducedMotion)} />
      {!reducedMotion && (
        <span ref={cursorMeteorRef} className="sag-space-cursor-meteor" data-active="false" />
      )}
      <motion.span
        className="sag-space-galaxy-orbit"
        style={{
          x: galaxyX,
          y: galaxyY,
          scale: galaxyScale,
          opacity: galaxyOpacity,
        }}
      >
        <ParticleGalaxy reducedMotion={Boolean(reducedMotion)} />
      </motion.span>
      <span className="sag-space-dust" />
      <span className="sag-space-meteor sag-space-meteor--one" />
      <span className="sag-space-meteor sag-space-meteor--two" />
      <span className="sag-space-meteor sag-space-meteor--three" />
      <span className="sag-space-meteor sag-space-meteor--four" />
      {SPARKLES.map((star) => (
        <span
          key={`${star.x}-${star.y}`}
          className="sag-space-sparkle"
          style={
            {
              "--star-x": `${star.x}%`,
              "--star-y": `${star.y}%`,
              "--star-size": `${star.size}px`,
              "--star-delay": `${star.delay}s`,
              "--star-duration": `${star.duration}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
