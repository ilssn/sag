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
  /**
   * Signed flight velocity in units/s; positive flies older. Fast flight pages
   * ahead of arrival so data lands before the camera does.
   */
  velocity?: number;
  busy: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface UniverseTemporalFlightPresence {
  scale: number;
  opacity: number;
}

/** One 120px wheel notch flies roughly this share of two packages. */
export const UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL = 0.9;
/** How far ahead (in seconds of current depth rate) the window follow leads. */
export const UNIVERSE_FLIGHT_FOLLOW_LEAD_S = 0.5;
/** Atmosphere ahead of the camera: full presence within, gone beyond. */
const PRESENCE_AHEAD_FULL_EVENTS = 1.5;
const PRESENCE_AHEAD_FAR_EVENTS = 8;
/** Atmosphere behind the camera: passed packages fade out fast. */
const PRESENCE_BEHIND_FULL_EVENTS = 0.75;
const PRESENCE_BEHIND_GONE_EVENTS = 2.5;
const PRESENCE_FAR_SCALE = 0.42;
const PRESENCE_FAR_OPACITY = 0.16;
/**
 * Passed packages keep a faint ember instead of going black: looking back
 * shows the travelled road, and the warm event stars read as cooling embers.
 */
const PRESENCE_BEHIND_EMBER = 0.1;
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
 * Scrolling up (negative deltaY) flies deeper — the same hand motion that
 * zooms in everywhere else pulls the corridor's depths toward you.
 */
export function applyUniverseTemporalFlightWheel(
  state: UniverseTemporalFlightState,
  input: UniverseTemporalFlightWheelInput,
): UniverseTemporalFlightState {
  const travel = -normalizedWheelPixels(input) * UNIVERSE_FLIGHT_UNITS_PER_WHEEL_PIXEL;
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
  // An explicitly unbounded axis is legal (free flight enforces its own walls
  // on the axis projection); only NaN and negatives collapse to zero.
  const maxDepth = input.maxDepth === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Math.max(0, finite(input.maxDepth));
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
  // The lead is velocity-gated, so only the edge being flown toward moves its
  // threshold: at rest both leads vanish and the static hysteresis holds.
  const lead = finite(input.velocity ?? 0) * UNIVERSE_FLIGHT_FOLLOW_LEAD_S;
  const forwardLead = Math.max(0, lead);
  const backwardLead = Math.max(0, -lead);
  if (
    input.hasNext
    && input.depth > input.windowFarDepth - margin - forwardLead
  ) return "next";
  if (
    input.hasPrevious
    && input.depth < input.windowNearDepth - margin + backwardLead
  ) {
    return "previous";
  }
  return null;
}

function easedRange(value: number, from: number, to: number) {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Camera-relative presence of a package on the axis: how large and how opaque
 * it renders given its depth distance from the camera, in world units
 * (positive = ahead of the camera, deeper into the past).
 *
 * Whatever the camera reaches is fully present — this replaces any static
 * age-based dimming, which under a moving camera would leave a reached package
 * forever small and dark. Ahead, atmospheric perspective thins packages toward
 * a floor (still visible: the corridor keeps promising more). Behind, passed
 * packages fade out quickly so the view is always about what is being reached.
 */
export function universeTemporalFlightPresence(
  deltaUnits: number,
  unitsPerEvent: number,
): UniverseTemporalFlightPresence {
  const unit = Math.max(1, finite(unitsPerEvent, 1));
  const events = finite(deltaUnits) / unit;
  if (events < 0) {
    const kept = 1 - easedRange(
      -events,
      PRESENCE_BEHIND_FULL_EVENTS,
      PRESENCE_BEHIND_GONE_EVENTS,
    );
    return {
      scale: 1,
      opacity: PRESENCE_BEHIND_EMBER + (1 - PRESENCE_BEHIND_EMBER) * kept,
    };
  }
  const fade = easedRange(
    events,
    PRESENCE_AHEAD_FULL_EVENTS,
    PRESENCE_AHEAD_FAR_EVENTS,
  );
  return {
    scale: 1 - (1 - PRESENCE_FAR_SCALE) * fade,
    opacity: 1 - (1 - PRESENCE_FAR_OPACITY) * fade,
  };
}
