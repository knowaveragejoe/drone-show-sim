// Turns the project state into a plan: where each drone is at each time.

import { assignTargets } from './assign.js';
import { closestApproach, planTiming, progressAt, rateAt, takeoffGrid } from './motion.js';
import { objCloud } from './obj.js';
import { closestSpacing, farthestPointOrder } from './sample.js';
import { builtinCloud } from './shapes.js';
import { MAX_DRONES } from './state.js';

/**
 * The timeline has two parts: the transition from the takeoff grid to the formation, then the hold.
 * @typedef {object} Plan
 * @property {number} count number of drones
 * @property {Float32Array} starts takeoff grid position of each drone, xyz
 * @property {Float32Array} targets formation position of each drone, xyz
 * @property {Float32Array} pathLengths flight distance of each drone, meters
 * @property {import('./motion.js').Timing} timing timing of the transition
 * @property {number} total length of the timeline, seconds
 * @property {number} spacing smallest distance between two targets, meters
 * @property {number} lowestTarget height of the lowest target, meters; negative is below the ground
 * @property {number} closestApproach smallest distance between two drones in flight, meters
 * @property {number} peakSpeed speed of the fastest drone, m/s
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
 * Makes a function that builds the plan for a state.
 * The function keeps the results of the two slow steps, sampling and assignment,
 * and runs them again only when their inputs change.
 *
 * The function throws when the shape is not usable, for example an OBJ file with no faces.
 * It then keeps its stored results, so the next call with the old state is still fast.
 * @returns {(state: import('./state.js').State) => Plan}
 */
export function createPlanner() {
  /** @type {import('./state.js').Source | null} */
  let sampledSource = null;
  let sampledSeed = NaN;
  let sampleVersion = 0;
  /** @type {Float32Array} */
  let cloud;
  /** @type {Uint32Array} */
  let order;

  let assignmentKey = '';
  /** @type {Int32Array} */
  let assignment;

  return (state) => {
    const { count, gridSpacing } = state.fleet;
    const formation = state.formations[0];

    if (formation.source !== sampledSource || formation.seed !== sampledSeed) {
      const { source, seed } = formation;
      cloud =
        source.type === 'obj'
          ? objCloud(source.text, source.upAxis, seed)
          : builtinCloud(source.shape, seed);
      order = farthestPointOrder(cloud, MAX_DRONES);
      sampledSource = formation.source;
      sampledSeed = formation.seed;
      sampleVersion++;
    }

    const starts = takeoffGrid(count, gridSpacing);
    const placed = placeTargets(cloud, order, count, formation);

    // The formation height is not part of the key. A shift of all targets by the same
    // offset changes every total cost by the same amount, so the best assignment stays the same.
    const key = [sampleVersion, count, gridSpacing, formation.size, formation.yaw].join();
    if (key !== assignmentKey) {
      assignment = assignTargets(starts, placed, count);
      assignmentKey = key;
    }

    const targets = new Float32Array(count * 3);
    const pathLengths = new Float32Array(count);
    let longest = 0;
    let lowestTarget = Infinity;
    for (let drone = 0; drone < count; drone++) {
      const from = assignment[drone] * 3;
      const to = drone * 3;
      targets[to] = placed[from];
      targets[to + 1] = placed[from + 1];
      targets[to + 2] = placed[from + 2];
      pathLengths[drone] = Math.hypot(
        targets[to] - starts[to],
        targets[to + 1] - starts[to + 1],
        targets[to + 2] - starts[to + 2],
      );
      longest = Math.max(longest, pathLengths[drone]);
      lowestTarget = Math.min(lowestTarget, targets[to + 2]);
    }

    const timing = planTiming(starts, targets, count, state.fleet);
    const volume = volumeBounds(state.volume);
    return {
      count,
      starts,
      targets,
      pathLengths,
      timing,
      total: timing.duration + formation.holdSeconds,
      spacing: closestSpacing(targets, count),
      lowestTarget,
      closestApproach: closestApproach(starts, targets, count),
      peakSpeed: longest * timing.peakRate,
      volume,
      outsideVolume: countOutside(starts, targets, count, volume),
    };
  };
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
 * Counts the drones that leave a box at some time.
 * A drone flies a straight line, so it stays in the box exactly when its start and its
 * target are in the box. A position on a face of the box is inside.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per drone
 * @param {number} count
 * @param {Bounds} bounds
 */
export function countOutside(starts, targets, count, bounds) {
  let outside = 0;
  for (let drone = 0; drone < count; drone++) {
    for (let axis = 0; axis < 3; axis++) {
      const low = bounds.low[axis] - ROUNDING_SLACK;
      const high = bounds.high[axis] + ROUNDING_SLACK;
      const start = starts[drone * 3 + axis];
      const target = targets[drone * 3 + axis];
      if (start < low || start > high || target < low || target > high) {
        outside++;
        break;
      }
    }
  }
  return outside;
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
  const yaw = (formation.yaw * Math.PI) / 180;
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

/**
 * Smallest formation size that keeps the minimum spacing.
 * Spacing grows in proportion to size.
 * @param {number} size current size, meters
 * @param {number} spacing current smallest distance between two targets, meters
 * @param {number} minSpacing meters
 * @returns {number | null} null when the spacing gives no answer, for example with one drone
 */
export function fitSize(size, spacing, minSpacing) {
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  // Round up to the next centimeter, so the result is on the safe side.
  return Math.ceil((size * minSpacing * 100) / spacing) / 100;
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
 * Writes the position of every drone at one time.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out xyz per drone; length at least `plan.count × 3`
 */
export function positionsAt(plan, time, out) {
  const progress = progressAt(plan.timing, time);
  const { starts, targets } = plan;
  for (let i = 0; i < plan.count * 3; i++) {
    out[i] = starts[i] + progress * (targets[i] - starts[i]);
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
  return rateAt(plan.timing, time) * plan.pathLengths[drone];
}

/**
 * Finds the time in a new plan that shows the same moment as a time in the old plan.
 * The end stays the end, a time in the hold stays in the hold, and a time in the
 * transition keeps its share of the transition.
 * @param {Plan} oldPlan
 * @param {Plan} newPlan
 * @param {number} time seconds in the old plan
 * @returns {number} seconds in the new plan
 */
export function retime(oldPlan, newPlan, time) {
  if (time >= oldPlan.total) return newPlan.total;
  const oldDuration = oldPlan.timing.duration;
  const newDuration = newPlan.timing.duration;
  if (time >= oldDuration) return Math.min(newPlan.total, newDuration + time - oldDuration);
  return (time / oldDuration) * newDuration;
}
