"use client";

/**
 * 知识宇宙纹理/材质工厂（自 universe-scene-engine 抽离的纯层）。
 *
 * 全部为输入 → 纹理/材质的纯函数（依赖 DOM canvas 与 THREE，不触碰引擎状态），
 * 品牌金与星云走廊常量随之集中于此 —— 引擎与外围 UI 统一从这里取值。
 */

import * as THREE from "three";

export const UNIVERSE_BRAND_GOLD = "#d6ae63";
export const NEBULA_BRAND_GOLD = new THREE.Color(UNIVERSE_BRAND_GOLD);
export const NEBULA_DETAIL_ALPHA = 1.55;
const NEBULA_DETAIL_DUST_POINT_SIZE_CSS = 20;
const NEBULA_CORRIDOR_DUST_POINT_SIZE_CSS = 5.5;
const NEBULA_CORRIDOR_GLOW_POINT_SIZE_CSS = 9;
const NEBULA_CORRIDOR_DUST_ALPHA = 0.62;
const NEBULA_CORRIDOR_WALL_ALPHA = 0.22;
const NEBULA_CORRIDOR_LOADED_ALPHA = 0.52;
export const NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP = 16;
export const NEBULA_CORRIDOR_BAND_OFF = 1e8;
export const SOURCE_ENTRY_CONDENSATION_FRACTION = 0.9;
export const NEBULA_CORRIDOR_WRAP_SPAN = 2400;

export function makeSpriteTexture(kind: "event" | "entity" | "source") {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const center = 96;

  context.clearRect(0, 0, 192, 192);
  if (kind === "event") {
    const glow = context.createRadialGradient(center, center, 0, center, center, 78);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.08, "rgba(255,255,255,.98)");
    glow.addColorStop(0.24, "rgba(255,255,255,.42)");
    glow.addColorStop(0.58, "rgba(255,255,255,.08)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(10, 10, 172, 172);

    context.fillStyle = "rgba(255,255,255,.9)";
    context.beginPath();
    context.moveTo(center, 18);
    context.quadraticCurveTo(center + 3, center - 14, center + 9, center);
    context.quadraticCurveTo(center + 3, center + 14, center, 174);
    context.quadraticCurveTo(center - 3, center + 14, center - 9, center);
    context.quadraticCurveTo(center - 3, center - 14, center, 18);
    context.fill();

    context.beginPath();
    context.moveTo(22, center);
    context.quadraticCurveTo(center - 14, center - 3, center, center - 8);
    context.quadraticCurveTo(center + 14, center - 3, 170, center);
    context.quadraticCurveTo(center + 14, center + 3, center, center + 8);
    context.quadraticCurveTo(center - 14, center + 3, 22, center);
    context.fill();

    context.globalAlpha = 0.44;
    context.save();
    context.translate(center, center);
    context.rotate(Math.PI / 4);
    context.scale(0.48, 0.48);
    context.translate(-center, -center);
    context.beginPath();
    context.moveTo(center, 28);
    context.quadraticCurveTo(center + 3, center - 12, center + 8, center);
    context.quadraticCurveTo(center + 3, center + 12, center, 164);
    context.quadraticCurveTo(center - 3, center + 12, center - 8, center);
    context.quadraticCurveTo(center - 3, center - 12, center, 28);
    context.fill();
    context.restore();
  } else if (kind === "entity") {
    const glow = context.createRadialGradient(center, center, 0, center, center, 74);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.12, "rgba(255,255,255,.92)");
    glow.addColorStop(0.32, "rgba(255,255,255,.3)");
    glow.addColorStop(0.68, "rgba(255,255,255,.07)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(12, 12, 168, 168);

    context.fillStyle = "rgba(255,255,255,.86)";
    context.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 - Math.PI / 2;
      const inner = index % 2 === 0 ? 9 : 7;
      const outer = index % 2 === 0 ? 48 : 38;
      context.moveTo(
        center + Math.cos(angle - 0.065) * inner,
        center + Math.sin(angle - 0.065) * inner,
      );
      context.lineTo(
        center + Math.cos(angle) * outer,
        center + Math.sin(angle) * outer,
      );
      context.lineTo(
        center + Math.cos(angle + 0.065) * inner,
        center + Math.sin(angle + 0.065) * inner,
      );
    }
    context.fill();

    context.globalAlpha = 0.64;
    context.beginPath();
    context.arc(142, 66, 3.2, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.3;
    context.beginPath();
    context.arc(55, 128, 2.1, 0, Math.PI * 2);
    context.fill();
  } else {
    const glow = context.createRadialGradient(center, center, 0, center, center, 88);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.1, "rgba(255,255,255,.98)");
    glow.addColorStop(0.28, "rgba(255,255,255,.55)");
    glow.addColorStop(0.62, "rgba(255,255,255,.13)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(4, 4, 184, 184);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function makeEventCoreTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const center = 64;

  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "rgba(255,255,255,1)";
  context.beginPath();
  for (let index = 0; index < 16; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / 8;
    const ray = Math.floor(index / 2);
    const radius = index % 2 === 1
      ? 8
      : ray % 2 === 0 ? 58 : 32;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  context.beginPath();
  context.arc(center, center, 7.5, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function makeEntityCoreTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const center = 48;

  context.clearRect(0, 0, 96, 96);
  const glow = context.createRadialGradient(center, center, 0, center, center, 32);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.34, "rgba(255,255,255,.98)");
  glow.addColorStop(0.58, "rgba(255,255,255,.58)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(12, 12, 72, 72);
  context.strokeStyle = "rgba(255,255,255,.88)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(center, center, 24, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "rgba(255,255,255,1)";
  context.beginPath();
  context.arc(center, center, 8.5, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function makeNebulaMaterial(darkTheme: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) },
      uThemeAlpha: { value: darkTheme ? 1 : 0.96 },
      uDetail: { value: 0 },
      uDetailAlpha: { value: NEBULA_DETAIL_ALPHA },
      uDetailSource: { value: -1 },
      uBrandColor: { value: NEBULA_BRAND_GOLD.clone() },
      uPointSizeCap: { value: NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP },
      uTime: { value: performance.now() / 1000 },
      uMotion: { value: 1 },
      // Loaded-window band on the browsed source's axis, in world z. Particles
      // inside it yield to the real packages that condensed there.
      uCorridorNearZ: { value: NEBULA_CORRIDOR_BAND_OFF },
      uCorridorFarZ: { value: NEBULA_CORRIDOR_BAND_OFF },
      // Camera-anchored dust wrap: current flight depth, the wrap span, the
      // full axis depth and the entry plane's world z of the browsed source.
      uFlightDepth: { value: 0 },
      uCorridorSpan: { value: NEBULA_CORRIDOR_WRAP_SPAN },
      uCorridorAxisDepth: { value: 0 },
      uCorridorCenterZ: { value: 0 },
      uCorridorVestibule: { value: 0 },
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uDetail;
      uniform float uDetailAlpha;
      uniform float uDetailSource;
      uniform vec3 uBrandColor;
      uniform float uPointSizeCap;
      uniform float uTime;
      uniform float uMotion;
      uniform float uCorridorNearZ;
      uniform float uCorridorFarZ;
      uniform float uFlightDepth;
      uniform float uCorridorSpan;
      uniform float uCorridorAxisDepth;
      uniform float uCorridorCenterZ;
      uniform float uCorridorVestibule;
      attribute vec3 aColor;
      attribute vec3 aCorridor;
      attribute vec4 aVisual;
      attribute vec4 aMotion;
      attribute float aAlpha;
      attribute float aSourceIndex;
      attribute vec3 aSourceCenter;
      attribute vec3 aSpinAxis;
      #define aSize aVisual.x
      #define aGlow aVisual.y
      #define aShape aVisual.z
      #define aTwinkle aVisual.w
      #define aPhase aMotion.x
      #define aSpinRate aMotion.y
      #define aEmitter aMotion.z
      #define aCorridorWall aMotion.w
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDetail;
      varying float vGlow;
      varying float vShape;
      varying float vPulse;

      vec3 rotateAroundAxis(vec3 value, vec3 axis, float angle) {
        float cosine = cos(angle);
        float sine = sin(angle);
        return value * cosine
          + cross(axis, value) * sine
          + axis * dot(axis, value) * (1.0 - cosine);
      }

      void main() {
        float sourceMatch = 1.0 - step(0.5, abs(aSourceIndex - uDetailSource));
        float particleDetail = uDetail * sourceMatch;
        float focusMix = smoothstep(0.12, 0.82, particleDetail);
        float diveMix = uCorridorVestibule > 0.0
          ? smoothstep(
              0.0,
              uCorridorVestibule * ${SOURCE_ENTRY_CONDENSATION_FRACTION.toFixed(2)},
              uFlightDepth
            )
          : 0.0;
        // Every cloud carries the graph's two semantic lights from the first
        // frame: event gold and the source/entity accent. Detail strengthens
        // the accent but never repaints the whole nebula one flat colour.
        float sourceTint = 0.5 + 0.5 * smoothstep(0.22, 0.82, particleDetail);
        vColor = mix(uBrandColor, aColor, sourceTint);
        vAlpha = aAlpha;
        // Depth of field for the whole sky: while inside one source, every
        // other nebula recedes into the dark instead of competing for light —
        // deep enough that their white-hot cores cannot smudge the corridor.
        vAlpha *= mix(1.0, 0.03, uDetail * (1.0 - sourceMatch));
        // Focusing gathers the SAME cloud into a luminous core. Every selected
        // grain receives a restrained lift, while the sparse emitter grains
        // carry a little more light. This reads as energy concentrating rather
        // than a new, brighter particle system popping into existence.
        vAlpha *= mix(1.0, 1.08, focusMix);
        vAlpha *= mix(1.0, 1.12, focusMix * aEmitter);
        vDetail = 0.0;
        vShape = aShape;
        float wave = 0.5 + 0.5 * sin(uTime * (0.72 + aTwinkle * 1.38) + aPhase);
        float glint = pow(wave, mix(2.2, 7.0, aTwinkle));
        float pulse = mix(1.0, 0.94 + glint * 0.16, uMotion * aTwinkle);
        // Each source is a genuinely tilted spiral system. Rotate its local
        // disk around that tilted normal on the GPU; all sources still share
        // one points draw call, so the slow motion remains inexpensive.
        vec3 rotatedHeroOffset = rotateAroundAxis(
          position - aSourceCenter,
          normalize(aSpinAxis),
          uTime * aSpinRate
        );
        // The overview keeps the full side-on galaxy. On source focus it
        // gathers — it never enlarges — into a compact, bright emitter.
        float focusedRadius = mix(0.18, 0.08, aEmitter);
        vec3 heroPosition = aSourceCenter
          + rotatedHeroOffset * mix(1.0, focusedRadius, focusMix);
        // Camera-anchored wrap: corridor dust repeats modulo the span around
        // the flight depth, so the density near the camera never depends on
        // the source's size — the fixed-window discipline for particles.
        vec3 corridorTarget = position + aCorridor;
        float span = max(1.0, uCorridorSpan);
        float depthAlongAxis = uCorridorCenterZ - corridorTarget.z;
        float rel = mod(depthAlongAxis - uFlightDepth, span);
        if (rel > span * 0.75) rel -= span;
        float wrappedDepth = uFlightDepth + rel;
        corridorTarget.z = uCorridorCenterZ - wrappedDepth;
        // The original spiral follows the camera only for beacon grains. At
        // partial dive it first grows a little, then settles at the same deep
        // centre while stream grains continue travelling toward the viewer.
        vec3 emitterTarget = heroPosition;
        emitterTarget.z -= uFlightDepth;
        vec3 journeyTarget = mix(corridorTarget, emitterTarget, aEmitter);
        // Particles leave the core in overlapping waves. Depth stretches first;
        // lateral spread follows later, so the source reads as an emitting
        // current instead of one synchronous radial explosion.
        float particleOrder = fract(aPhase * 0.15915494 + aTwinkle * 0.173);
        float detailFocus = smoothstep(0.12, 0.88, particleDetail);
        float axialStart = particleOrder * 0.18;
        float axialMix = detailFocus * smoothstep(
          axialStart,
          min(0.98, axialStart + 0.58),
          diveMix
        );
        float lateralStart = 0.2 + particleOrder * 0.22;
        float lateralMix = detailFocus * smoothstep(
          lateralStart,
          min(0.99, lateralStart + 0.5),
          diveMix
        ) * (1.0 - aEmitter);
        float corridorMix = max(axialMix, lateralMix);
        float streamMix = corridorMix * (1.0 - aEmitter);
        // Brightness and point-size detail travel with each particle's own
        // emergence wave. Applying them from the global dive value made the
        // whole disk flash before its grains had actually left the core.
        float localJourneyDetail = particleDetail * corridorMix;
        float detailAlpha = mix(
          1.0,
          uDetailAlpha,
          smoothstep(0.18, 0.78, localJourneyDetail)
        );
        vAlpha *= mix(1.0, detailAlpha, sourceMatch);
        vDetail = smoothstep(0.08, 0.92, localJourneyDetail);
        // The beacon retains its glow at every depth. Stream glow pockets
        // collapse into fine grains before they approach the camera.
        vGlow = aGlow * (
          1.0 - smoothstep(0.08, 0.55, corridorMix) * (1.0 - aEmitter)
        );
        vec3 animatedPosition = heroPosition;
        animatedPosition.z = mix(heroPosition.z, journeyTarget.z, axialMix);
        animatedPosition.xy = mix(heroPosition.xy, journeyTarget.xy, lateralMix);
        // The axis has real ends: dust never spills in front of the entry
        // plane, and the last stretch dissolves into an unresolved horizon
        // instead of a visible wall — then ends for good.
        float entryFade = smoothstep(-220.0, -40.0, wrappedDepth);
        float endProgress = uCorridorAxisDepth > 0.0
          ? wrappedDepth / uCorridorAxisDepth
          : 0.0;
        float horizonFade = 1.0 - smoothstep(0.82, 1.0, endProgress) * 0.8;
        float overEnd = smoothstep(0.0, 200.0, wrappedDepth - uCorridorAxisDepth);
        // Atmospheric haze with distance ahead keeps the vastness readable
        // without ever going fully dark.
        float aheadUnits = wrappedDepth - uFlightDepth;
        float depthHaze = 1.0 - smoothstep(900.0, 1800.0, aheadUnits) * 0.42;
        float axisFade = entryFade * horizonFade * (1.0 - overEnd) * depthHaze;
        // Where the loaded window already condensed into real packages, the
        // corridor dust steps aside instead of double-exposing them.
        float loadedBand = smoothstep(
          uCorridorFarZ - 30.0,
          uCorridorFarZ + 30.0,
          animatedPosition.z
        ) * (1.0 - smoothstep(
          uCorridorNearZ - 30.0,
          uCorridorNearZ + 30.0,
          animatedPosition.z
        ));
        vAlpha *= mix(
          1.0,
          ${NEBULA_CORRIDOR_LOADED_ALPHA.toFixed(2)},
          streamMix * loadedBand
        );
        // The corridor's own light: glow pockets brighten into soft beacons
        // along the axis, and the far end dissolves instead of hard-stopping —
        // vast, with no visible wall.
        float glowParticle = step(0.001, vGlow);
        float originalGlowParticle = step(0.001, aGlow);
        vAlpha *= mix(1.0, 0.14, streamMix * originalGlowParticle);
        vAlpha *= mix(1.0, axisFade, streamMix);
        // The explored graph is the foreground. Corridor dust remains only as
        // a restrained depth cue; distant wall grains recede almost entirely.
        vAlpha *= mix(1.0, ${NEBULA_CORRIDOR_DUST_ALPHA.toFixed(2)}, streamMix);
        vAlpha *= mix(
          1.0,
          ${(NEBULA_CORRIDOR_WALL_ALPHA / NEBULA_CORRIDOR_DUST_ALPHA).toFixed(4)},
          streamMix * aCorridorWall
        );
        // Ambient drift is a whisper, not a float: it breathes only while the
        // camera is idle and holds still under any gesture.
        animatedPosition.x += sin(uTime * 0.28 + aPhase) * 0.16 * uMotion * aTwinkle;
        animatedPosition.y += cos(uTime * 0.24 + aPhase) * 0.12 * uMotion * aTwinkle;
        vec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
        float perspective = clamp(360.0 / max(1.0, -mvPosition.z), 0.42, 2.2);
        float detailScale = mix(1.0, 1.28, vDetail);
        float glowScale = mix(1.0, mix(3.6, 4.8, vDetail), vGlow);
        // Detail walls are intentionally smaller than hero grains. This both
        // removes visual noise and sharply lowers point-sprite overdraw.
        float corridorBoost = mix(1.0, mix(1.0, 0.62, aCorridorWall), streamMix);
        float rawPointSize = aSize * uPixelRatio * perspective * pulse
          * detailScale * glowScale * corridorBoost;
        float detailDustCap = mix(13.0, ${NEBULA_DETAIL_DUST_POINT_SIZE_CSS.toFixed(1)}, vDetail)
          * uPixelRatio;
        float corridorDustCap = mix(
          ${NEBULA_CORRIDOR_DUST_POINT_SIZE_CSS.toFixed(1)},
          4.5,
          aCorridorWall
        ) * uPixelRatio;
        detailDustCap = mix(detailDustCap, corridorDustCap, streamMix);
        float glowPointSizeCap = mix(
          uPointSizeCap * (1.0 + 0.25 * streamMix),
          ${NEBULA_CORRIDOR_GLOW_POINT_SIZE_CSS.toFixed(1)} * uPixelRatio,
          streamMix
        );
        float capSelect = glowParticle;
        float pointSizeCap = mix(
          detailDustCap,
          glowPointSizeCap,
          capSelect
        );
        gl_PointSize = min(max(1.15, rawPointSize), pointSizeCap);
        vPulse = mix(0.92, 1.2, glint);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uThemeAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDetail;
      varying float vGlow;
      varying float vShape;
      varying float vPulse;

      void main() {
        if (vAlpha < 0.008) discard;
        vec2 centered = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(centered);
        float shapeAlpha;
        if (vGlow > 0.001) {
          // The large cloud sprites take a cheap coherent branch: no rays and
          // no fractional pow across their much larger fragment footprint.
          float radial = clamp(1.0 - distanceFromCenter * 2.0, 0.0, 1.0);
          // A faint warm pocket of light — an accent between the grains,
          // never a fog bank smeared over them.
          float haze = radial * mix(0.55, 0.95, radial);
          shapeAlpha = haze * mix(0.15, 0.24, vDetail) * vGlow;
        } else {
          float softDot = smoothstep(0.5, 0.04, distanceFromCenter);
          float rayX = smoothstep(0.09, 0.0, abs(centered.x))
            * smoothstep(0.5, 0.04, abs(centered.y));
          float rayY = smoothstep(0.09, 0.0, abs(centered.y))
            * smoothstep(0.5, 0.04, abs(centered.x));
          float sparkle = max(softDot, max(rayX, rayY));
          shapeAlpha = mix(softDot, sparkle, vShape);
        }
        if (shapeAlpha < 0.008) discard;
        float whiteMix = vDetail * (0.08 + vShape * 0.18);
        vec3 luminousColor = mix(vColor, vec3(1.0), whiteMix);
        float detailBloom = mix(1.04, 1.28, vDetail);
        gl_FragColor = vec4(
          luminousColor,
          min(1.0, shapeAlpha * vAlpha * vPulse * uThemeAlpha * detailBloom)
        );
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    // Brand look: density carries the light — the white-hot heart comes from
    // sheer particle count, not additive bloom.
    blending: THREE.NormalBlending,
  });
}
