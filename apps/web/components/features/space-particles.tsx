"use client";

import * as React from "react";
import type { ISourceOptions } from "@tsparticles/engine";
import Particles, { ParticlesProvider } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

const PARTICLE_OPTIONS: ISourceOptions = {
  autoPlay: true,
  background: { color: { value: "transparent" } },
  detectRetina: true,
  fpsLimit: 45,
  fullScreen: { enable: false },
  pauseOnBlur: true,
  pauseOnOutsideViewport: true,
  particles: {
    color: { value: ["#ffffff", "#d7e1e8", "#f2dfa2"] },
    move: {
      direction: "none",
      enable: true,
      outModes: { default: "out" },
      random: true,
      speed: { min: 0.025, max: 0.11 },
      straight: false,
    },
    number: {
      density: { enable: true, height: 800, width: 1200 },
      value: 86,
    },
    opacity: {
      animation: {
        destroy: "none",
        enable: true,
        speed: 0.22,
        startValue: "random",
        sync: false,
      },
      value: { min: 0.12, max: 0.68 },
    },
    shape: { type: "circle" },
    size: {
      animation: {
        destroy: "none",
        enable: true,
        speed: 0.16,
        startValue: "random",
        sync: false,
      },
      value: { min: 0.35, max: 1.45 },
    },
  },
};

export function SpaceParticles() {
  const id = React.useId().replace(/:/g, "");

  return (
    <ParticlesProvider init={loadSlim}>
      <Particles
        id={`sag-space-${id}`}
        className="sag-space-particles"
        options={PARTICLE_OPTIONS}
      />
    </ParticlesProvider>
  );
}
