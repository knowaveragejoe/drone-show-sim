// Turns the project state into a plan: where each drone is at each time.

import { takeoffGrid } from './motion.js';
import { closestSpacing, farthestPointOrder } from './sample.js';
import { builtinCloud } from './shapes.js';
import { MAX_DRONES } from './state.js';

/**
 * @typedef {object} Plan
 * @property {number} count number of drones
 * @property {Float32Array} starts takeoff grid position of each drone, xyz
 * @property {Float32Array} targets formation position of each drone, xyz
 * @property {number} spacing smallest distance between two targets, meters
 * @property {number} total length of the timeline, seconds
 */

/**
 * Makes a function that builds the plan for a state.
 * The function keeps the sampled shape between calls, because sampling is the slow step.
 * @returns {(state: import('./state.js').State) => Plan}
 */
export function createPlanner() {
  /** @type {import('./state.js').Source | null} */
  let sampledSource = null;
  let sampledSeed = NaN;
  /** @type {Float32Array} */
  let cloud;
  /** @type {Uint32Array} */
  let order;

  return (state) => {
    const { count, gridSpacing } = state.fleet;
    const formation = state.formations[0];

    if (formation.source !== sampledSource || formation.seed !== sampledSeed) {
      cloud = builtinCloud(formation.source.shape, formation.seed);
      order = farthestPointOrder(cloud, MAX_DRONES);
      sampledSource = formation.source;
      sampledSeed = formation.seed;
    }

    const targets = placeTargets(cloud, order, count, formation);
    return {
      count,
      starts: takeoffGrid(count, gridSpacing),
      targets,
      spacing: closestSpacing(targets, count),
      total: 0,
    };
  };
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

/**
 * True when a distance breaks the minimum spacing.
 * Positions are 32-bit numbers, so the check allows half a millimeter of rounding error.
 * @param {number} distance meters
 * @param {number} minSpacing meters
 */
export function isTooClose(distance, minSpacing) {
  return distance < minSpacing - 0.0005;
}

/**
 * Writes the position of every drone at one time.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out xyz per drone; length at least `plan.count × 3`
 */
export function positionsAt(plan, time, out) {
  out.set(plan.targets);
}
