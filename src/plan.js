// Turns the project state into a plan: where each drone is at each time.
//
// A show is a list of steps. In each step the fleet flies to a stop and then holds there.
// The stops are the formations in storyboard order, and then the takeoff grid again
// when the show ends with a landing. A formation can turn slowly while it holds, and a
// light chase can run across it.

import { assignTargets } from './assign.js';
import {
  arcBox,
  closestApproach,
  planTiming,
  planTurn,
  progressAt,
  rateAt,
  takeoffGrid,
  turnAboutZ,
} from './motion.js';
import { objCloud } from './obj.js';
import { closestSpacing, farthestPointSampler } from './sample.js';
import { builtinCloud } from './shapes.js';
import { svgCloud } from './svg.js';

/**
 * One step of the show: a transition to a stop, then a hold at that stop.
 * @typedef {object} Step
 * @property {number} formation index of the formation that the fleet flies to, or -1 for the landing
 * @property {number} start time when the transition starts, seconds
 * @property {import('./motion.js').Timing} timing timing of the transition
 * @property {number} hold time at the stop after the transition, seconds
 * @property {Float32Array} from position of each drone when the transition starts, xyz
 * @property {Float32Array} to position of each drone when the transition ends, xyz
 * @property {import('./motion.js').Turn | null} turn the turn of the formation in the hold, if any
 * @property {Chase | null} chase the light chase of the formation in the hold, if any
 * @property {Float32Array} end position of each drone when the hold ends, xyz; `to` when the formation does not turn
 * @property {Float32Array} pathLengths flight distance of each drone in the transition, meters
 * @property {number} closestApproach smallest distance between two drones in the transition, meters
 * @property {number} turnSpeed speed of the fastest drone in the turn, m/s; 0 when the formation does not turn
 * @property {number} peakSpeed speed of the fastest drone in the step, m/s
 */

/**
 * @typedef {object} FormationChecks
 * @property {number} spacing smallest distance between two targets, meters
 * @property {number} lowestTarget height of the lowest target, meters; negative is below the ground
 * @property {number} outsideVolume number of targets that are outside the flight volume at some time in the hold
 */

/**
 * @typedef {object} Plan
 * @property {number} count number of drones
 * @property {Step[]} steps step k flies to formation k; a landing, if any, is the last step
 * @property {FormationChecks[]} formations one entry per formation
 * @property {number} total length of the timeline, seconds
 * @property {number} lowestTarget height of the lowest target of the show, meters
 * @property {number} closestApproach smallest distance between two drones in any transition, meters
 * @property {number} peakSpeed speed of the fastest drone of the show, m/s
 * @property {Bounds} volume corners of the flight volume
 * @property {number} outsideVolume number of drones that leave the flight volume at some time
 * @property {number} takeoffOutsideVolume number of takeoff grid cells outside the flight volume
 */

/**
 * A light chase: bright bands that travel across a formation in its hold.
 * The drones do not move. Only their brightness changes.
 * @typedef {object} Chase
 * @property {Float32Array} u place of each drone along the path of the bands, 0 to 1; one lap is 0 to 1
 * @property {number} bands number of bright bands on the path at one time
 * @property {number} speed laps per second; a negative speed moves the bands the other way
 */

/**
 * A box with sides along the world axes.
 * @typedef {object} Bounds
 * @property {number[]} low corner with the smallest x, y, and z
 * @property {number[]} high corner with the largest x, y, and z
 */

/**
 * A place where the fleet rests. Its points are in a fixed order that does not depend on
 * the drones: grid order for the takeoff grid, pick order for a formation.
 *
 * The best assignment between two stops does not change when a stop grows, shrinks, or
 * moves: the total cost then changes by a positive factor and by a constant. So the
 * planner solves each assignment on canonical copies of the stops (unit size, centered),
 * and the key of a pose names only its shape and its rotation. A change of formation size,
 * formation height, or grid spacing then needs no new assignment.
 * @typedef {object} Stop
 * @property {number} formation index of the formation, or -1 for the takeoff grid
 * @property {string} family the shape of the stop, without its pose
 * @property {number} scale size of the formation, or spacing of the grid, meters
 * @property {string} key shape and rotation of the stop when the fleet arrives
 * @property {Float32Array} points xyz per point when the fleet arrives
 * @property {Float32Array} unit canonical copy of `points`
 * @property {import('./motion.js').Turn | null} turn the turn in the hold, if any
 * @property {number} radius distance from the turn axis to the farthest point, meters
 * @property {string} leaveKey shape and rotation of the stop when the hold ends
 * @property {Float32Array} leavePoints xyz per point when the hold ends
 * @property {Float32Array} leaveUnit canonical copy of `leavePoints`
 * @property {Chase | null} chase the light chase in the hold, with `u` in point order, if any
 */

const DEGREE = Math.PI / 180;

// The route of a drone shows a turn as short straight lines. Each covers this much of the turn.
const ROUTE_ARC_STEP = 10 * DEGREE;

// Brightness of a drone outside the bands of a light chase. The shape stays visible.
export const CHASE_DIM = 0.12;
// A light chase fades in at the start of the hold and out at its end, over this time, seconds.
const CHASE_FADE = 1;
// How fast the tail of a band fades. A larger number gives a shorter tail.
const CHASE_TAIL = 3;

// The planner keeps this many results of its slow stages. Recent results stay, so undo,
// redo, and a value that goes back and forth need no new work.
const CACHE_LIMIT = 256;

/**
 * Makes a function that builds the plan for a state.
 * The function keeps the recent results of the slow stages (sampling, assignment, and the
 * distance checks) and runs a stage again only for inputs that it has not seen.
 *
 * An assignment that is not in the store starts from the last assignment between the same
 * two shapes, if there is one. That warm start makes a change of rotation, turn, or drone
 * count much faster, and gives the same result as a cold start.
 *
 * The function throws when a shape is not usable, for example an OBJ model with no faces
 * or an SVG drawing with no outlines.
 * It then keeps its stored results, so the next call with the old state is still fast.
 * @returns {((state: import('./state.js').State) => Plan) & {
 *   warmStarts: () => WarmStart[],
 *   addWarmStarts: (entries: WarmStart[]) => void,
 * }}
 */
export function createPlanner() {
  /**
   * @typedef {object} Sample
   * @property {string} name names the shape by its contents, so that a name stays the same
   *   from one page load to the next
   * @property {Float32Array} cloud
   * @property {ReturnType<typeof farthestPointSampler>} sampler
   */
  /** Samples of built-in shapes, by name. @type {Map<string, Sample>} */
  const builtinSamples = new Map();
  /**
   * Samples of imported files, by source. A copy of a formation shares its source, and so its sample.
   * @type {WeakMap<import('./state.js').Source, {seed: number, sample: Sample}>}
   */
  const fileSamples = new WeakMap();

  /** @param {string} name @param {Float32Array} cloud @returns {Sample} */
  const newSample = (name, cloud) => ({ name, cloud, sampler: farthestPointSampler(cloud) });

  /** @param {import('./state.js').Formation} formation */
  function sampleOf({ source, seed }) {
    if (source.type === 'builtin') {
      const name = `builtin:${source.shape}:${seed}`;
      let sample = builtinSamples.get(name);
      if (!sample) {
        sample = newSample(name, builtinCloud(source.shape, seed));
        builtinSamples.set(name, sample);
      }
      return sample;
    }
    const entry = fileSamples.get(source);
    if (entry && entry.seed === seed) return entry.sample;
    const contents = `${textHash(source.text)}:${source.text.length}:${seed}`;
    const sample =
      source.type === 'obj'
        ? newSample(`obj:${source.upAxis}:${contents}`, objCloud(source.text, source.upAxis, seed))
        : newSample(`svg:${contents}`, svgCloud(source.text, seed));
    fileSamples.set(source, { seed, sample });
    return sample;
  }

  /** Results of the slow stages, by a key made from their inputs, oldest use first. @type {Map<string, any>} */
  const cache = new Map();
  /** @param {string} key @param {any} value */
  const store = (key, value) => {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
  };
  /**
   * @template T
   * @param {string} key
   * @param {() => T} compute
   * @returns {T}
   */
  const remember = (key, compute) => store(key, cache.has(key) ? cache.get(key) : compute());

  /** The assignments of the last plan, as warm starts for a later page load. @type {WarmStart[]} */
  let lastWarmStarts = [];

  /** @param {import('./state.js').State} state */
  const plan = (state) => {
    const { count, gridSpacing, maxAcceleration } = state.fleet;
    // Sample every shape first. A shape that fails then leaves the stored results as they were.
    const shapes = state.formations.map(sampleOf);
    /** @type {WarmStart[]} */
    const warmStarts = [];
    const orders = shapes.map((sample) => sample.sampler.order(count));

    const gridPoints = takeoffGrid(count, gridSpacing);
    const gridUnit = anchored(takeoffGrid(count, 1));
    /** @type {Stop} */
    const grid = {
      formation: -1,
      family: 'grid',
      scale: gridSpacing,
      key: 'grid',
      points: gridPoints,
      unit: gridUnit,
      turn: null,
      radius: 0,
      leaveKey: 'grid',
      leavePoints: gridPoints,
      leaveUnit: gridUnit,
      chase: null,
    };
    const stops = [grid];
    state.formations.forEach((formation, index) => {
      const { name, cloud } = shapes[index];
      const points = placeTargets(cloud, orders[index], count, formation);
      const unit = placeTargets(cloud, orders[index], count, { ...formation, size: 1, centerHeight: 0 });
      let radius = 0;
      for (let i = 0; i < points.length; i += 3) {
        radius = Math.max(radius, Math.hypot(points[i], points[i + 1]));
      }
      const turn = planTurn(formation.turnRate * DEGREE, formation.holdSeconds, radius, maxAcceleration);
      const family = name;
      const key = `${family}:${formation.yaw}`;
      // A formation that turns leaves its hold in a new pose: the same shape at a new yaw.
      stops.push({
        formation: index,
        family,
        scale: formation.size,
        key,
        points,
        unit,
        turn,
        radius,
        leaveKey: turn ? `${family}:${formation.yaw + turn.angle / DEGREE}` : key,
        leavePoints: turn ? turnAboutZ(points, turn.angle, new Float32Array(points.length)) : points,
        leaveUnit: turn ? turnAboutZ(unit, turn.angle, new Float32Array(unit.length)) : unit,
        chase:
          formation.chase === 'off'
            ? null
            : {
                u: chasePath(points, count, formation),
                bands: formation.chaseBands,
                speed: formation.chaseSpeed,
              },
      });
    });
    if (state.landAtEnd) stops.push(grid);

    const volume = volumeBounds(state.volume);
    const outside = new Uint8Array(count);
    const takeoffOutsideVolume = markOutside(grid.points, count, 0, volume, outside);

    // slots[drone] is the point of the current stop where the drone is.
    let slots = Int32Array.from({ length: count }, (unused, drone) => drone);
    let from = grid.points;
    let start = 0;
    /** @type {Step[]} */
    const steps = [];
    for (let index = 1; index < stops.length; index++) {
      const previous = stops[index - 1];
      const stop = stops[index];

      // The assignment pairs the points of two stops. It does not depend on which drone
      // is at which point, so one result serves every order of the stops before it.
      const linkKey = `${count}|${previous.leaveKey}|${stop.key}`;
      const familyKey = `family|${previous.family}|${stop.family}`;
      const match = remember(`link|${linkKey}`, () =>
        assignTargets(previous.leaveUnit, stop.unit, count, cache.get(familyKey) ?? null),
      );
      store(familyKey, match);
      warmStarts.push({ key: familyKey, ...match });
      // The closest approach depends on the sizes, but not on the heights.
      const approach = remember(`approach|${linkKey}|${previous.scale}|${stop.scale}`, () =>
        closestApproach(previous.leavePoints, gather(stop.points, match.columnOfRow), count),
      );

      slots = slots.map((slot) => match.columnOfRow[slot]);
      const to = gather(stop.points, slots);
      const end = stop.turn ? gather(stop.leavePoints, slots) : to;
      markOutside(to, count, stop.turn?.angle ?? 0, volume, outside);

      const pathLengths = new Float32Array(count);
      let longest = 0;
      for (let drone = 0; drone < count; drone++) {
        const o = drone * 3;
        pathLengths[drone] = Math.hypot(to[o] - from[o], to[o + 1] - from[o + 1], to[o + 2] - from[o + 2]);
        longest = Math.max(longest, pathLengths[drone]);
      }

      const timing = planTiming(from, to, count, state.fleet);
      const hold = stop.formation >= 0 ? state.formations[stop.formation].holdSeconds : 0;
      const turnSpeed = stop.turn ? stop.turn.peakRate * stop.radius : 0;
      steps.push({
        formation: stop.formation,
        start,
        timing,
        hold,
        from,
        to,
        turn: stop.turn,
        chase: stop.chase && { ...stop.chase, u: gatherValues(stop.chase.u, slots) },
        end,
        pathLengths,
        closestApproach: approach,
        turnSpeed,
        peakSpeed: Math.max(longest * timing.peakRate, turnSpeed),
      });
      start += timing.duration + hold;
      from = end;
    }

    const formations = state.formations.map((formation, index) => {
      const { key, scale, points, turn } = stops[index + 1];
      let lowestTarget = Infinity;
      for (let i = 0; i < count; i++) lowestTarget = Math.min(lowestTarget, points[i * 3 + 2]);
      return {
        spacing: remember(`spacing|${count}|${key}|${scale}`, () => closestSpacing(points, count)),
        lowestTarget,
        outsideVolume: markOutside(points, count, turn?.angle ?? 0, volume, new Uint8Array(count)),
      };
    });

    lastWarmStarts = warmStarts;
    return {
      count,
      steps,
      formations,
      total: start,
      lowestTarget: Math.min(...formations.map((checks) => checks.lowestTarget)),
      closestApproach: Math.min(...steps.map((step) => step.closestApproach)),
      peakSpeed: Math.max(...steps.map((step) => step.peakSpeed)),
      volume,
      outsideVolume: outside.reduce((sum, flag) => sum + flag, 0),
      takeoffOutsideVolume,
    };
  };

  return Object.assign(plan, {
    /**
     * The assignments of the last plan. A later page load can start from them.
     * @returns {WarmStart[]}
     */
    warmStarts: () => lastWarmStarts,
    /**
     * Adds assignments to start from, for example from an earlier page load. The solver
     * checks each pair it keeps, so a start that does not fit only costs time.
     * @param {WarmStart[]} entries
     */
    addWarmStarts(entries) {
      for (const { key, columnOfRow, price } of entries) {
        const valid =
          key.startsWith('family|') &&
          columnOfRow.length === price.length &&
          columnOfRow.every((column) => column >= 0 && column < columnOfRow.length) &&
          price.every(Number.isFinite);
        if (valid) store(key, { columnOfRow, price });
      }
    },
  });
}

/**
 * An assignment between two shapes, for a warm start.
 * @typedef {object} WarmStart
 * @property {string} key names the two shapes
 * @property {Int32Array} columnOfRow
 * @property {Float64Array} price
 */

/**
 * A 53-bit hash of a text (cyrb53). It names an imported file by its contents.
 * @param {string} text
 * @returns {string}
 */
function textHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Moves points so that the first one is at the origin. The canonical copy of the takeoff
 * grid uses this. A change of drone count moves the centered grid by half a cell, but in
 * this copy each drone keeps its place, so a warm start from the old count stays good.
 * A move of a whole stop does not change the best assignment.
 * @param {Float32Array} points xyz per point; the function changes them
 * @returns {Float32Array} `points`
 */
function anchored(points) {
  const [x, y, z] = points.slice(0, 3);
  for (let i = 0; i < points.length; i += 3) {
    points[i] -= x;
    points[i + 1] -= y;
    points[i + 2] -= z;
  }
  return points;
}

/**
 * Picks points from a list.
 * @param {Float32Array} points xyz per point
 * @param {Int32Array} indices index of the point to take, per output position
 * @returns {Float32Array} xyz per output position
 */
function gather(points, indices) {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    out[i * 3] = points[indices[i] * 3];
    out[i * 3 + 1] = points[indices[i] * 3 + 1];
    out[i * 3 + 2] = points[indices[i] * 3 + 2];
  }
  return out;
}

/**
 * Picks one value per output position from a list.
 * @param {Float32Array} values one value per point
 * @param {Int32Array} indices index of the value to take, per output position
 */
function gatherValues(values, indices) {
  return Float32Array.from(indices, (index) => values[index]);
}

/**
 * Places each target of a formation on the path of its light chase. The path uses the
 * axes of the formation itself, before its yaw, so a turned formation keeps its pattern.
 *
 * - Around: the angle around the formation center, in the plane that faces the audience.
 *   0 is at the top, and the angle grows clockwise as the audience sees it.
 * - Rising: the height, from the lowest target (0) to the highest (1).
 * - Across: the side position, from the left end as the audience sees it (0) to the right (1).
 * @param {Float32Array} points xyz per target
 * @param {number} count
 * @param {import('./state.js').Formation} formation
 * @returns {Float32Array} one value per target, 0 to 1
 */
function chasePath(points, count, formation) {
  const yaw = formation.yaw * DEGREE;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const side = new Float32Array(count);
  const up = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Undo the yaw: the side axis of the formation, and the height above its center.
    side[i] = points[i * 3] * cos + points[i * 3 + 1] * sin;
    up[i] = points[i * 3 + 2] - formation.centerHeight;
  }
  if (formation.chase === 'around') {
    return side.map((x, i) => {
      const turn = Math.atan2(x, up[i]) / (2 * Math.PI);
      return turn < 0 ? turn + 1 : turn;
    });
  }
  const values = formation.chase === 'rising' ? up : side;
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const range = high - low;
  return values.map((value) => (range > 0 ? (value - low) / range : 0));
}

/**
 * @param {import('./state.js').Volume} volume
 * @returns {Bounds}
 */
export function volumeBounds(volume) {
  const half = volume.size / 2;
  return {
    low: [volume.x - half, volume.y - half, volume.z],
    high: [volume.x + half, volume.y + half, volume.z + volume.size],
  };
}

/**
 * Sets the flag of each drone that is outside a box at a stop. A position on a face of
 * the box is inside. When the stop turns, the whole arc of the drone must be inside.
 * @param {Float32Array} positions xyz per drone when the fleet arrives at the stop
 * @param {number} count
 * @param {number} turn angle that the stop turns in its hold, radians; 0 for no turn
 * @param {Bounds} bounds
 * @param {Uint8Array} flags one flag per drone; the function only sets flags
 * @returns {number} number of drones outside the box
 */
function markOutside(positions, count, turn, bounds, flags) {
  const { low, high } = bounds;
  let outside = 0;
  for (let drone = 0; drone < count; drone++) {
    const x = positions[drone * 3];
    const y = positions[drone * 3 + 1];
    const z = positions[drone * 3 + 2];
    const [minX, maxX, minY, maxY] = turn === 0 ? [x, x, y, y] : arcBox(x, y, turn);
    const inside =
      minX >= low[0] - ROUNDING_SLACK &&
      maxX <= high[0] + ROUNDING_SLACK &&
      minY >= low[1] - ROUNDING_SLACK &&
      maxY <= high[1] + ROUNDING_SLACK &&
      z >= low[2] - ROUNDING_SLACK &&
      z <= high[2] + ROUNDING_SLACK;
    if (!inside) {
      flags[drone] = 1;
      outside++;
    }
  }
  return outside;
}

/**
 * Counts the drones that leave a box at some time.
 * A drone flies straight lines from stop to stop, so it stays in the box exactly when
 * each of its stops is in the box.
 * @param {Float32Array[]} stops the positions of all drones at each stop, xyz per drone
 * @param {number} count
 * @param {Bounds} bounds
 */
export function countOutside(stops, count, bounds) {
  const flags = new Uint8Array(count);
  for (const positions of stops) markOutside(positions, count, 0, bounds, flags);
  return flags.reduce((sum, flag) => sum + flag, 0);
}

/**
 * Moves the first `count` picks from unit space to their place in the sky.
 * @param {Float32Array} cloud candidate cloud in unit space
 * @param {Uint32Array} order pick order from the sampler
 * @param {number} count
 * @param {import('./state.js').Formation} formation
 * @returns {Float32Array} xyz per target
 */
function placeTargets(cloud, order, count, formation) {
  const yaw = formation.yaw * DEGREE;
  const cos = Math.cos(yaw) * formation.size;
  const sin = Math.sin(yaw) * formation.size;
  const targets = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = cloud[order[i] * 3];
    const y = cloud[order[i] * 3 + 1];
    const z = cloud[order[i] * 3 + 2];
    targets[i * 3] = x * cos - y * sin;
    targets[i * 3 + 1] = x * sin + y * cos;
    targets[i * 3 + 2] = z * formation.size + formation.centerHeight;
  }
  return targets;
}

// If the closest spacing at both ends of a transition is D, the closest approach in flight
// is at least D ÷ √2. A stop needs this much more than the minimum spacing, so that the
// drones also keep the minimum spacing in flight.
export const FLIGHT_MARGIN = Math.SQRT2;

/**
 * Smallest formation size that keeps the minimum spacing, also in the flights to and
 * from the formation. The targets end up `FLIGHT_MARGIN` × the minimum spacing apart.
 * The flights are safe when the stops before and after the formation have the same margin.
 *
 * Spacing grows in proportion to size.
 * @param {number} size current size, meters
 * @param {number} spacing current smallest distance between two targets, meters
 * @param {number} minSpacing meters
 * @returns {number | null} null when the spacing gives no answer, for example with one drone
 */
export function fitSize(size, spacing, minSpacing) {
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  // Round up to the next centimeter, so the result is on the safe side.
  return Math.ceil((size * minSpacing * FLIGHT_MARGIN * 100) / spacing) / 100;
}

// Positions are 32-bit numbers, so the checks allow half a millimeter of rounding error.
const ROUNDING_SLACK = 0.0005;

/**
 * True when a distance breaks the minimum spacing.
 * @param {number} distance meters
 * @param {number} minSpacing meters
 */
export function isTooClose(distance, minSpacing) {
  return distance < minSpacing - ROUNDING_SLACK;
}

/**
 * True when a height is below the ground.
 * @param {number} height meters
 */
export function isBelowGround(height) {
  return height < -ROUNDING_SLACK;
}

/**
 * Lists what is wrong with one formation, in words for the user.
 * @param {Plan} plan
 * @param {number} formation index of the formation
 * @param {{minSpacing: number, maxHorizontalSpeed: number}} limits the fleet limits
 * @returns {string[]} empty when the formation passes every check
 */
export function formationProblems(plan, formation, limits) {
  const checks = plan.formations[formation];
  const step = plan.steps[formation];
  const problems = [];
  if (isTooClose(checks.spacing, limits.minSpacing)) {
    problems.push('Targets are closer than the minimum spacing.');
  }
  if (isBelowGround(checks.lowestTarget)) problems.push('Targets are below the ground.');
  if (checks.outsideVolume > 0) problems.push('Targets are outside the flight volume.');
  if (isTooClose(step.closestApproach, limits.minSpacing)) {
    problems.push('Drones come too close in the transition to this formation.');
  }
  if (step.turnSpeed > limits.maxHorizontalSpeed + ROUNDING_SLACK) {
    problems.push('The turn is faster than the maximum horizontal speed.');
  }
  return problems;
}

/**
 * Finds the step that a time is in.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @returns {number} index in `plan.steps`
 */
export function stepAt(plan, time) {
  let index = 0;
  while (index + 1 < plan.steps.length && time >= plan.steps[index + 1].start) index++;
  return index;
}

/**
 * Time when the fleet arrives at a formation and the hold starts.
 * @param {Plan} plan
 * @param {number} formation index of the formation
 * @returns {number} seconds from the start of the timeline
 */
export function holdStart(plan, formation) {
  const step = plan.steps[formation];
  return step.start + step.timing.duration;
}

/**
 * Writes the position of every drone at one time.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out xyz per drone; length at least `plan.count × 3`
 */
export function positionsAt(plan, time, out) {
  const step = plan.steps[stepAt(plan, time)];
  const { timing, from, to } = step;
  const held = time - step.start - timing.duration;
  if (held >= 0) {
    // In the hold a drone is exactly on its target, or on the arc of the turn.
    if (step.turn && held < step.hold) {
      turnAboutZ(to, step.turn.angle * progressAt(step.turn.timing, held), out);
    } else {
      out.set(step.end);
    }
    return;
  }
  const progress = progressAt(timing, time - step.start);
  for (let i = 0; i < plan.count * 3; i++) {
    out[i] = from[i] + progress * (to[i] - from[i]);
  }
}

/**
 * Speed of one drone at one time.
 * @param {Plan} plan
 * @param {number} drone index
 * @param {number} time seconds from the start of the timeline
 * @returns {number} m/s
 */
export function speedAt(plan, drone, time) {
  const step = plan.steps[stepAt(plan, time)];
  const held = time - step.start - step.timing.duration;
  if (held < 0) return rateAt(step.timing, time - step.start) * step.pathLengths[drone];
  if (!step.turn) return 0;
  const radius = Math.hypot(step.to[drone * 3], step.to[drone * 3 + 1]);
  return rateAt(step.turn.timing, held) * Math.abs(step.turn.angle) * radius;
}

/**
 * Writes the brightness of every drone light at one time: 1 for full, down to `CHASE_DIM`.
 * Outside a hold with a light chase, every light is at full brightness.
 *
 * Each band has a bright head and a tail that fades behind it. The head leads in the
 * direction that the band moves.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out one value per drone; length at least `plan.count`
 */
export function brightnessAt(plan, time, out) {
  const step = plan.steps[stepAt(plan, time)];
  const held = time - step.start - step.timing.duration;
  const { chase } = step;
  if (!chase || held < 0 || held >= step.hold) {
    out.fill(1, 0, plan.count);
    return;
  }
  const fade = Math.min(1, held / CHASE_FADE, (step.hold - held) / CHASE_FADE);
  const shift = chase.speed * held;
  for (let drone = 0; drone < plan.count; drone++) {
    // 0 just ahead of a head, rising to 1 at the head.
    let phase = (chase.u[drone] - shift) * chase.bands;
    phase -= Math.floor(phase);
    const glow = (chase.speed >= 0 ? phase : 1 - phase) ** CHASE_TAIL;
    const level = CHASE_DIM + (1 - CHASE_DIM) * glow;
    out[drone] = 1 - fade * (1 - level);
  }
}

/**
 * The route of one drone through the show: for each step, the points that it passes.
 * The first two points are the ends of the flight. More points follow when the formation
 * turns in the hold; they trace the arc of the drone.
 * @param {Plan} plan
 * @param {number} drone index
 * @returns {Float32Array[]} xyz per point, one list per step
 */
export function routeOf(plan, drone) {
  return plan.steps.map(({ from, to, turn }) => {
    const arcPoints = turn ? Math.ceil(Math.abs(turn.angle) / ROUTE_ARC_STEP) : 0;
    const route = new Float32Array((2 + arcPoints) * 3);
    route.set(from.subarray(drone * 3, drone * 3 + 3), 0);
    const target = to.subarray(drone * 3, drone * 3 + 3);
    route.set(target, 3);
    for (let point = 1; point <= arcPoints; point++) {
      const turned = route.subarray((1 + point) * 3, (2 + point) * 3);
      turnAboutZ(target, (turn.angle * point) / arcPoints, turned);
    }
    return route;
  });
}

/**
 * Light color of the fleet at one time. In a transition between two formations the color
 * blends from one to the other. Takeoff uses the color of the first formation, and the
 * landing keeps the color of the last one.
 * @param {Plan} plan
 * @param {number[][]} colors red, green, blue of each formation, each 0 to 1
 * @param {number} time seconds from the start of the timeline
 * @returns {number[]} red, green, blue, each 0 to 1
 */
export function lightColorAt(plan, colors, time) {
  const index = stepAt(plan, time);
  const step = plan.steps[index];
  const before = colors[index === 0 ? step.formation : plan.steps[index - 1].formation];
  const after = step.formation >= 0 ? colors[step.formation] : before;
  const progress = progressAt(step.timing, time - step.start);
  return before.map((channel, i) => channel + progress * (after[i] - channel));
}

/**
 * Finds the time in a new plan that shows the same moment as a time in the old plan.
 * The end stays the end, a time in a hold stays in that hold, and a time in a transition
 * keeps its share of that transition.
 * @param {Plan} oldPlan
 * @param {Plan} newPlan
 * @param {number} time seconds in the old plan
 * @returns {number} seconds in the new plan
 */
export function retime(oldPlan, newPlan, time) {
  if (time >= oldPlan.total) return newPlan.total;
  const index = stepAt(oldPlan, time);
  if (index >= newPlan.steps.length) return newPlan.total;
  const before = oldPlan.steps[index];
  const after = newPlan.steps[index];
  const offset = time - before.start;
  if (offset >= before.timing.duration) {
    const held = Math.min(after.hold, offset - before.timing.duration);
    return after.start + after.timing.duration + held;
  }
  return after.start + (offset / before.timing.duration) * after.timing.duration;
}
