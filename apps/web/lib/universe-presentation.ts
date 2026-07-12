export interface UniverseDetailLatchInput {
  currentSourceId: string | null;
  currentRadiusPx: number | null;
  candidateSourceId: string | null;
  candidateRadiusPx: number | null;
  explicitSourceId?: string | null;
  enterRadiusPx: number;
  exitRadiusPx: number;
}

/**
 * Keeps one source in detail mode until the camera crosses the overview
 * boundary. Candidate changes caused by panning or orbiting are deliberately
 * ignored while the current source remains above that boundary.
 */
export function resolveUniverseDetailSource({
  currentSourceId,
  currentRadiusPx,
  candidateSourceId,
  candidateRadiusPx,
  explicitSourceId,
  enterRadiusPx,
  exitRadiusPx,
}: UniverseDetailLatchInput) {
  if (explicitSourceId) return explicitSourceId;

  if (
    currentSourceId
    && currentRadiusPx !== null
    && Number.isFinite(currentRadiusPx)
    && currentRadiusPx > exitRadiusPx
  ) {
    return currentSourceId;
  }

  if (
    candidateSourceId
    && candidateRadiusPx !== null
    && Number.isFinite(candidateRadiusPx)
    && candidateRadiusPx >= enterRadiusPx
  ) {
    return candidateSourceId;
  }

  return null;
}

/**
 * Converts deep zoom into coarse, monotonic loading milestones. Re-entering a
 * milestone that was already visited must not request another page.
 */
export function universeDeepLoadMilestone(
  radiusPx: number,
  deepRadiusPx: number,
  hysteresisPx: number,
) {
  if (!Number.isFinite(radiusPx) || radiusPx < deepRadiusPx) return 0;
  const step = Math.max(96, hysteresisPx * 4, deepRadiusPx * 0.34);
  return 1 + Math.floor((radiusPx - deepRadiusPx) / step);
}
