// Turns the project state into a plan: where each drone is at each time.

import { takeoffGrid } from './motion.js';

/**
 * @typedef {object} Plan
 * @property {number} count number of drones
 * @property {Float32Array} starts takeoff grid position of each drone, xyz
 * @property {number} total length of the timeline, seconds
 */

/**
 * @param {import('./state.js').State} state
 * @returns {Plan}
 */
export function buildPlan(state) {
  const { count, gridSpacing } = state.fleet;
  return {
    count,
    starts: takeoffGrid(count, gridSpacing),
    total: 0,
  };
}

/**
 * Writes the position of every drone at one time.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out xyz per drone; length at least `plan.count × 3`
 */
export function positionsAt(plan, time, out) {
  out.set(plan.starts);
}
