// Drone motion: where the drones start and how they fly.
//
// In a transition each drone flies a straight line. All drones share one progress value
// that goes from 0 to 1: position = start + progress × (target − start).
// The progress value follows a trapezoid profile: accelerate, cruise, brake.

/**
 * Ground positions where the drones start: a grid that is close to square, centered on the origin.
 * Drone 0 is in the corner nearest the audience. The order is row by row.
 * @param {number} count number of drones
 * @param {number} spacing distance between neighbors, meters
 * @returns {Float32Array} xyz per drone
 */
export function takeoffGrid(count, spacing) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    positions[i * 3] = (column - (columns - 1) / 2) * spacing;
    positions[i * 3 + 1] = (row - (rows - 1) / 2) * spacing;
  }
  return positions;
}

/**
 * @typedef {object} Limits
 * @property {number} maxHorizontalSpeed m/s
 * @property {number} maxClimbSpeed m/s
 * @property {number} maxDescentSpeed m/s
 * @property {number} maxAcceleration m/s²
 */

/**
 * The trapezoid profile of the progress value.
 * @typedef {object} Timing
 * @property {number} duration seconds from progress 0 to progress 1
 * @property {number} acceleration of the progress value, 1/s²
 * @property {number} rampTime seconds to accelerate; braking takes the same time
 * @property {number} peakRate largest rate of the progress value, 1/s
 */

/**
 * Finds the fastest profile that keeps every drone inside every limit.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per drone
 * @param {number} count
 * @param {Limits} limits
 * @returns {Timing}
 */
export function planTiming(starts, targets, count, limits) {
  // Largest progress rate and progress acceleration that no drone exceeds a limit with.
  let rate = Infinity;
  let acceleration = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = targets[i * 3] - starts[i * 3];
    const dy = targets[i * 3 + 1] - starts[i * 3 + 1];
    const dz = targets[i * 3 + 2] - starts[i * 3 + 2];
    const horizontal = Math.hypot(dx, dy);
    const length = Math.hypot(horizontal, dz);
    if (horizontal > 0) rate = Math.min(rate, limits.maxHorizontalSpeed / horizontal);
    if (dz > 0) rate = Math.min(rate, limits.maxClimbSpeed / dz);
    if (dz < 0) rate = Math.min(rate, limits.maxDescentSpeed / -dz);
    if (length > 0) acceleration = Math.min(acceleration, limits.maxAcceleration / length);
  }

  // No drone moves.
  if (!Number.isFinite(acceleration)) {
    return { duration: 0, acceleration: 0, rampTime: 0, peakRate: 0 };
  }
  // The path is too short to reach the rate limit: accelerate to the middle, then brake.
  if (rate * rate >= acceleration) {
    const rampTime = 1 / Math.sqrt(acceleration);
    return { duration: 2 * rampTime, acceleration, rampTime, peakRate: acceleration * rampTime };
  }
  return {
    duration: 1 / rate + rate / acceleration,
    acceleration,
    rampTime: rate / acceleration,
    peakRate: rate,
  };
}

/**
 * Progress value at a time.
 * @param {Timing} timing
 * @param {number} time seconds from the start of the transition
 * @returns {number} 0 to 1
 */
export function progressAt(timing, time) {
  const { duration, acceleration, rampTime, peakRate } = timing;
  if (time >= duration) return 1;
  if (time <= 0) return 0;
  if (time < rampTime) return 0.5 * acceleration * time * time;
  const left = duration - time;
  if (left < rampTime) return 1 - 0.5 * acceleration * left * left;
  return 0.5 * acceleration * rampTime * rampTime + peakRate * (time - rampTime);
}

/**
 * Rate of the progress value at a time. A drone's speed is this rate × its path length.
 * @param {Timing} timing
 * @param {number} time seconds from the start of the transition
 * @returns {number} 1/s
 */
export function rateAt(timing, time) {
  const { duration, acceleration, rampTime, peakRate } = timing;
  if (time <= 0 || time >= duration) return 0;
  if (time < rampTime) return acceleration * time;
  const left = duration - time;
  if (left < rampTime) return acceleration * left;
  return peakRate;
}

/**
 * Smallest distance between any two drones at any time in the transition.
 *
 * The result is exact. All drones share one progress value, so the offset between two drones
 * moves along a straight segment. The smallest distance is the distance from that segment to zero.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per drone
 * @param {number} count
 * @returns {number} meters; Infinity when there are fewer than two drones
 */
export function closestApproach(starts, targets, count) {
  let smallest = Infinity;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      // Offset between the two drones at the start, and how the offset changes.
      const ox = starts[i * 3] - starts[j * 3];
      const oy = starts[i * 3 + 1] - starts[j * 3 + 1];
      const oz = starts[i * 3 + 2] - starts[j * 3 + 2];
      const cx = targets[i * 3] - targets[j * 3] - ox;
      const cy = targets[i * 3 + 1] - targets[j * 3 + 1] - oy;
      const cz = targets[i * 3 + 2] - targets[j * 3 + 2] - oz;
      const changeSquared = cx * cx + cy * cy + cz * cz;
      let progress = 0;
      if (changeSquared > 0) {
        progress = Math.min(1, Math.max(0, -(ox * cx + oy * cy + oz * cz) / changeSquared));
      }
      const x = ox + progress * cx;
      const y = oy + progress * cy;
      const z = oz + progress * cz;
      const distance = x * x + y * y + z * z;
      if (distance < smallest) smallest = distance;
    }
  }
  return Math.sqrt(smallest);
}

const TWO_PI = Math.PI * 2;

/**
 * A slow turn of a formation in its hold. The formation rotates about the vertical axis
 * through the world origin as one rigid body. The turn starts and ends at rest.
 * @typedef {object} Turn
 * @property {number} angle total turn, radians; positive is counterclockwise seen from above
 * @property {Timing} timing progress of the turn, from 0 to 1 over the hold
 * @property {number} peakRate largest turn rate, radians per second
 */

/**
 * Plans the turn of a formation in its hold.
 * The turn speeds up to the turn rate, keeps it, and slows down to a stop at the end of the hold.
 * The ramps use the acceleration limit at the target that is farthest from the axis.
 * @param {number} rate turn rate, radians per second; the sign gives the direction
 * @param {number} hold length of the hold, seconds
 * @param {number} radius distance from the axis to the farthest target, meters
 * @param {number} maxAcceleration m/s²
 * @returns {Turn | null} null when the formation does not turn
 */
export function planTurn(rate, hold, radius, maxAcceleration) {
  if (rate === 0 || hold <= 0 || radius <= 0) return null;
  const acceleration = maxAcceleration / radius;
  // A short hold has no time to reach the turn rate: speed up for half of the hold, then slow down.
  const rampTime = Math.min(Math.abs(rate) / acceleration, hold / 2);
  const peakRate = acceleration * rampTime;
  const angle = peakRate * (hold - rampTime);
  return {
    angle: Math.sign(rate) * angle,
    timing: { duration: hold, acceleration: acceleration / angle, rampTime, peakRate: peakRate / angle },
    peakRate,
  };
}

/**
 * Turns points about the vertical axis through the world origin.
 * @param {Float32Array} points xyz per point
 * @param {number} angle radians; positive is counterclockwise seen from above
 * @param {Float32Array} out xyz per point; can be `points`
 * @returns {Float32Array} `out`
 */
export function turnAboutZ(points, angle, out) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    out[i] = x * cos - y * sin;
    out[i + 1] = x * sin + y * cos;
    out[i + 2] = points[i + 2];
  }
  return out;
}

/**
 * The box around the arc that a point draws when it turns about the vertical axis.
 * @param {number} x start of the arc
 * @param {number} y start of the arc
 * @param {number} angle turn, radians
 * @returns {number[]} smallest x, largest x, smallest y, largest y
 */
export function arcBox(x, y, angle) {
  const radius = Math.hypot(x, y);
  const start = Math.atan2(y, x);
  const end = start + angle;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  // True when the arc passes the direction, or the direction plus full turns.
  const passes = (/** @type {number} */ direction) =>
    Math.ceil((low - direction) / TWO_PI) <= Math.floor((high - direction) / TWO_PI);
  // The arc is farthest out where it crosses an axis. If it does not cross, at one of its ends.
  const endX = radius * Math.cos(end);
  const endY = radius * Math.sin(end);
  return [
    passes(Math.PI) ? -radius : Math.min(x, endX),
    passes(0) ? radius : Math.max(x, endX),
    passes(-Math.PI / 2) ? -radius : Math.min(y, endY),
    passes(Math.PI / 2) ? radius : Math.max(y, endY),
  ];
}
