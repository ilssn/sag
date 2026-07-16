/**
 * Temporal flight along a source's counting axis.
 *
 * Pure state: the scene feeds wheel samples and frame ticks, and reads back one
 * number — how deep into the past the camera sits, in world units, 0 being the
 * source's newest moment. Wheel gestures add velocity and inertia carries it;
 * button flights glide to a target; both respect the same clamps, so there is
 * exactly one notion of "where the camera is in time".
 *
 * The camera rig applies depth *deltas* (translating camera and orbit target
 * together along the axis), so flight composes with OrbitControls rotate/pan/
 * pinch instead of competing with them — no gesture classifier needed.
 */

export interface UniverseTemporalFlightState {
  /** World units along the axis. 0 = newest. */
  depth: number;
  /** World units per second toward the past. */
  velocity: number;
  /** Glide destination for impulse flights; null while free-flying. */
  targetDepth: number | null;
}

export interface UniverseTemporalFlightWheelInput {
  deltaY: number;
  deltaMode: number;
  viewportHeight: number;
  reducedMotion?: boolean;
}

export interface UniverseTemporalFlightStepInput {
  /** Milliseconds since the previous step. */
  elapsedMs: number;
  /** Axis length; depth clamps to [0, maxDepth]. */
  maxDepth: number;
  reducedMotion?: boolean;
}

export interface UniverseTemporalFlightStepResult {
  state: UniverseTemporalFlightState;
  /** True while the flight still needs animation frames. */
  moving: boolean;
}

export interface UniverseTemporalFlightFollowInput {
  depth: number;
  /** Depth of the newest and oldest packages in the visible window. */
  windowNearDepth: number;
  windowFarDepth: number;
  /** How close to a window edge the camera may fly before paging. */
  marginUnits: number;
  busy: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** One 120px wheel notch flies roughly this share of two packages. */
export const UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL = 0.9;
/** Coasting velocity halves this often. */
export const UNIVERSE_FLIGHT_VELOCITY_HALF_LIFE_MS = 160;
/** Glides cover half their remaining distance this often. */
export const UNIVERSE_FLIGHT_GLIDE_HALF_LIFE_MS = 140;
/** Distances below this settle instantly instead of easing forever. */
export const UNIVERSE_FLIGHT_SETTLE_EPSILON = 0.5;
/** Velocities below this stop instead of easing forever. */
const VELOCITY_REST_EPSILON = 2;
/** Frames longer than this (tab switches) step as if one frame passed. */
const MAX_STEP_MS = 64;
const WHEEL_LINE_PX = 16;

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function createUniverseTemporalFlightState(
  depth = 0,
): UniverseTemporalFlightState {
  return { depth: Math.max(0, finite(depth)), velocity: 0, targetDepth: null };
}

function normalizedWheelPixels(input: UniverseTemporalFlightWheelInput) {
  const delta = finite(input.deltaY);
  if (input.deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (input.deltaMode === 2) {
    return delta * Math.max(1, finite(input.viewportHeight, 800));
  }
  return delta;
}

/**
 * A wheel sample becomes a velocity impulse sized so its coasted distance is
 * the gesture's travel; reduced motion applies the travel directly instead.
 * Scrolling down (positive deltaY) flies into the past.
 */
export function applyUniverseTemporalFlightWheel(
  state: UniverseTemporalFlightState,
  input: UniverseTemporalFlightWheelInput,
): UniverseTemporalFlightState {
  const travel = normalizedWheelPixels(input) * UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL;
  if (travel === 0) return state;
  if (input.reducedMotion) {
    return {
      depth: Math.max(0, state.depth + travel),
      velocity: 0,
      targetDepth: null,
    };
  }
  // Coasted distance of v0 under exponential decay is v0 × halfLife / ln2.
  const impulse = travel * (Math.LN2 * 1000) / UNIVERSE_FLIGHT_VELOCITY_HALF_LIFE_MS;
  return {
    depth: state.depth,
    velocity: state.velocity + impulse,
    // A live gesture overrides any glide in progress.
    targetDepth: null,
  };
}

/** Button flights glide; the step clamps the destination to the axis. */
export function flyUniverseTemporalFlightTo(
  state: UniverseTemporalFlightState,
  targetDepth: number,
): UniverseTemporalFlightState {
  return {
    depth: state.depth,
    velocity: 0,
    targetDepth: Math.max(0, finite(targetDepth)),
  };
}

/** Grabbing the scene brakes: a deliberate drag owns the camera immediately. */
export function brakeUniverseTemporalFlight(
  state: UniverseTemporalFlightState,
): UniverseTemporalFlightState {
  if (state.velocity === 0 && state.targetDepth === null) return state;
  return { depth: state.depth, velocity: 0, targetDepth: null };
}

export function stepUniverseTemporalFlight(
  state: UniverseTemporalFlightState,
  input: UniverseTemporalFlightStepInput,
): UniverseTemporalFlightStepResult {
  const elapsed = Math.min(MAX_STEP_MS, Math.max(0, finite(input.elapsedMs)));
  const maxDepth = Math.max(0, finite(input.maxDepth));
  let { depth, velocity, targetDepth } = state;

  if (targetDepth !== null) {
    const target = Math.min(maxDepth, targetDepth);
    const remaining = target - depth;
    if (input.reducedMotion || Math.abs(remaining) <= UNIVERSE_FLIGHT_SETTLE_EPSILON) {
      depth = target;
      targetDepth = null;
    } else {
      depth += remaining
        * (1 - Math.exp(-(Math.LN2 * elapsed) / UNIVERSE_FLIGHT_GLIDE_HALF_LIFE_MS));
    }
  } else if (velocity !== 0) {
    depth += velocity * (elapsed / 1000);
    velocity *= Math.exp(-(Math.LN2 * elapsed) / UNIVERSE_FLIGHT_VELOCITY_HALF_LIFE_MS);
    if (Math.abs(velocity) < VELOCITY_REST_EPSILON) velocity = 0;
  }

  // The axis ends are walls, not springs: hitting one stops the flight.
  if (depth <= 0) {
    depth = 0;
    if (velocity < 0) velocity = 0;
    if (targetDepth !== null && targetDepth <= 0) targetDepth = null;
  } else if (depth >= maxDepth) {
    depth = maxDepth;
    if (velocity > 0) velocity = 0;
    if (targetDepth !== null && targetDepth >= maxDepth) targetDepth = null;
  }

  const next = depth === state.depth
    && velocity === state.velocity
    && targetDepth === state.targetDepth
    ? state
    : { depth, velocity, targetDepth };
  return { state: next, moving: velocity !== 0 || targetDepth !== null };
}

/**
 * Decides whether the visible window must page to keep the camera inside it.
 * "next" pages older (deeper), "previous" pages newer, matching the buttons.
 */
export function planUniverseTemporalFlightFollow(
  input: UniverseTemporalFlightFollowInput,
): "next" | "previous" | null {
  if (input.busy) return null;
  const span = Math.max(0, input.windowFarDepth - input.windowNearDepth);
  // A margin wider than a third of the window would let both edges trigger.
  const margin = Math.max(0, Math.min(finite(input.marginUnits), span / 3));
  if (input.hasNext && input.depth > input.windowFarDepth - margin) return "next";
  if (input.hasPrevious && input.depth < input.windowNearDepth - margin) {
    return "previous";
  }
  return null;
}
