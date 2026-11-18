// Turns the project state into a plan: where each drone is at each time.
//
// A show is a list of steps. In each step the fleet flies to a stop and then holds there.
// The stops are the formations in storyboard order, and then the takeoff grid again
// when the show ends with a landing. A formation can turn slowly while it holds.

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
import { closestSpacing, farthestPointOrder } from './sample.js';
import { builtinCloud } from './shapes.js';
import { MAX_DRONES } from './state.js';

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
 * A key names the shape of a pose but not its place. A shift of a whole stop changes neither
 * the best assignment nor a distance between two drones, so results stored under a key stay
 * valid when only a formation height changes.
 * @typedef {object} Stop
 * @property {number} formation index of the formation, or -1 for the takeoff grid
 * @property {string} key shape of the stop when the fleet arrives
 * @property {Float32Array} points xyz per point when the fleet arrives
 * @property {import('./motion.js').Turn | null} turn the turn in the hold, if any
 * @property {number} radius distance from the turn axis to the farthest point, meters
 * @property {string} leaveKey shape of the stop when the hold ends
 * @property {Float32Array} leavePoints xyz per point when the hold ends
 */

const DEGREE = Math.PI / 180;

// The route of a drone shows a turn as short straight lines. Each covers this much of the turn.
const ROUTE_ARC_STEP = 10 * DEGREE;

/**
 * Makes a function that builds the plan for a state.
 * The function keeps the results of the slow stages (sampling, assignment, and the distance
 * checks) and runs them again only when their inputs change.
 *
 * The function throws when a shape is not usable, for example an OBJ file with no faces.
 * It then keeps its stored results, so the next call with the old state is still fast.
 * @returns {(state: import('./state.js').State) => Plan}
 */
export function createPlanner() {
  /**
   * The sampled shape of each source. A copy of a formation shares its source, and so its sample.
   * @type {WeakMap<import('./state.js').Source, {seed: number, id: number, cloud: Float32Array, order: Uint32Array}>}
   */
  const samples = new WeakMap();
  let nextSampleId = 1;

  /** Results of the slow stages, by a key made from their inputs. @type {Map<string, any>} */
  let stored = new Map();

  /** @param {import('./state.js').Formation} formation */
  function sampleOf({ source, seed }) {
    let sample = samples.get(source);
    if (!sample || sample.seed !== seed) {
      const cloud =
        source.type === 'obj'
          ? objCloud(source.text, source.upAxis, seed)
          : builtinCloud(source.shape, seed);
      sample = { seed, id: nextSampleId++, cloud, order: farthestPointOrder(cloud, MAX_DRONES) };
      samples.set(source, sample);
    }
    return sample;
  }

  return (state) => {
    const { count, gridSpacing, maxAcceleration } = state.fleet;
    // Sample every shape first. A shape that fails then leaves the stored results as they were.
    const shapes = state.formations.map(sampleOf);

    /** @type {Map<string, any>} */
    const used = new Map();
    /**
     * @template T
     * @param {string} key
     * @param {() => T} compute
     * @returns {T}
     */
    const remember = (key, compute) => {
      const value = used.get(key) ?? stored.get(key) ?? compute();
      used.set(key, value);
      return value;
    };

    const gridPoints = takeoffGrid(count, gridSpacing);
    const gridKey = `grid:${gridSpacing}`;
    /** @type {Stop} */
    const grid = {
      formation: -1,
      key: gridKey,
      points: gridPoints,
      turn: null,
      radius: 0,
      leaveKey: gridKey,
      leavePoints: gridPoints,
    };
    const stops = [grid];
    state.formations.forEach((formation, index) => {
      const { id, cloud, order } = shapes[index];
      const points = placeTargets(cloud, order, count, formation);
      const key = `${id}:${formation.size}:${formation.yaw}`;
      let radius = 0;
      for (let i = 0; i < points.length; i += 3) {
        radius = Math.max(radius, Math.hypot(points[i], points[i + 1]));
      }
      const turn = planTurn(formation.turnRate * DEGREE, formation.holdSeconds, radius, maxAcceleration);
      // A formation that turns leaves its hold in a new pose: the same shape at a new yaw.
      stops.push({
        formation: index,
        key,
        points,
        turn,
        radius,
        leaveKey: turn ? `${id}:${formation.size}:${formation.yaw + turn.angle / DEGREE}` : key,
        leavePoints: turn ? turnAboutZ(points, turn.angle, new Float32Array(points.length)) : points,
      });
    });
    if (state.landAtEnd) stops.push(grid);

    const volume = volumeBounds(state.volume);
    const outside = new Uint8Array(count);
    markOutside(grid.points, count, 0, volume, outside);

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
      const link = remember(`link|${count}|${previous.leaveKey}|${stop.key}`, () => {
        const match = assignTargets(previous.leavePoints, stop.points, count);
        return {
          match,
          closestApproach: closestApproach(previous.leavePoints, gather(stop.points, match), count),
        };
      });

      slots = slots.map((slot) => link.match[slot]);
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
        end,
        pathLengths,
        closestApproach: link.closestApproach,
        turnSpeed,
        peakSpeed: Math.max(longest * timing.peakRate, turnSpeed),
      });
      start += timing.duration + hold;
      from = end;
    }

    const formations = state.formations.map((formation, index) => {
      const { key, points, turn } = stops[index + 1];
      let lowestTarget = Infinity;
      for (let i = 0; i < count; i++) lowestTarget = Math.min(lowestTarget, points[i * 3 + 2]);
      return {
        spacing: remember(`spacing|${count}|${key}`, () => closestSpacing(points, count)),
        lowestTarget,
        outsideVolume: markOutside(points, count, turn?.angle ?? 0, volume, new Uint8Array(count)),
      };
    });

    stored = used;
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
    };
  };
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
