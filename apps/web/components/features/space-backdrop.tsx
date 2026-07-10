"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";

const SpaceParticles = dynamic(
  () => import("@/components/features/space-particles").then((module) => module.SpaceParticles),
  { ssr: false },
);

const SPARKLES = [
  { x: 7, y: 18, size: 7, delay: -1.2, duration: 8.8 },
  { x: 18, y: 72, size: 5, delay: -5.8, duration: 11.4 },
  { x: 29, y: 34, size: 4, delay: -8.1, duration: 13.2 },
  { x: 38, y: 84, size: 6, delay: -3.4, duration: 10.6 },
  { x: 51, y: 12, size: 5, delay: -7.6, duration: 12.8 },
  { x: 62, y: 58, size: 7, delay: -2.7, duration: 9.6 },
  { x: 73, y: 27, size: 4, delay: -10.2, duration: 14.2 },
  { x: 82, y: 78, size: 5, delay: -4.9, duration: 11.8 },
  { x: 93, y: 44, size: 6, delay: -8.8, duration: 13.6 },
] as const;

export function SpaceBackdrop() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="sag-space-sparkles" aria-hidden>
      {!reducedMotion && <SpaceParticles />}
      <span className="sag-space-dust" />
      <span className="sag-space-meteor sag-space-meteor--one" />
      <span className="sag-space-meteor sag-space-meteor--two" />
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
