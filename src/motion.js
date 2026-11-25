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
 *
 * A check that only needs to know if the drones keep a distance can pass it as `stopBelow`.
 * The search then stops at the first pair that comes closer, and returns that pair's distance.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per drone
 * @param {number} count
 * @param {number} [stopBelow] meters; 0 searches all pairs
 * @returns {number} meters; Infinity when there are fewer than two drones. With `stopBelow`,
 *   a value below it means that some pair comes closer than `stopBelow`.
 */
export function closestApproach(starts, targets, count, stopBelow = 0) {
  return closestPair(starts, targets, count, stopBelow).distance;
}

/**
 * The two drones that come closest in a transition, and when. The same search as
 * `closestApproach`, which uses it.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per drone
 * @param {number} count
 * @param {number} [stopBelow] meters; 0 searches all pairs
 * @returns {{distance: number, first: number, second: number, progress: number}} the smallest
 *   distance, meters; the two drones, or -1 when there are fewer than two; the progress value
 *   of the closest moment, 0 to 1
 */
export function closestPair(starts, targets, count, stopBelow = 0) {
  const stop = stopBelow * stopBelow;
  let smallest = Infinity;
  let first = -1;
  let second = -1;
  let closest = 0;
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
      if (distance < smallest) {
        smallest = distance;
        first = i;
        second = j;
        closest = progress;
        if (smallest < stop) return { distance: Math.sqrt(smallest), first, second, progress };
      }
    }
  }
  return { distance: Math.sqrt(smallest), first, second, progress: closest };
}

/**
 * The time at which a flight reaches a progress value: the inverse of `progressAt`.
 * @param {Timing} timing
 * @param {number} progress 0 to 1
 * @returns {number} seconds from the start of the flight
 */
export function timeOfProgress(timing, progress) {
  if (progress <= 0) return 0;
  if (progress >= 1) return timing.duration;
  // The progress grows with the time, so halving the interval finds the time.
  let low = 0;
  let high = timing.duration;
  for (let k = 0; k < 50; k++) {
    const middle = (low + high) / 2;
    if (progressAt(timing, middle) < progress) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * A slow turn of a formation in its hold. The formation rotates about its own vertical axis
 * as one rigid body. The turn starts and ends at rest.
 * @typedef {object} Turn
 * @property {number} angle total turn, radians; positive is counterclockwise seen from above
 * @property {Timing} timing progress of the turn, from 0 to 1 over the hold
 * @property {number} peakRate largest turn rate, radians per second
 */

/**
 * Plans the turn of a formation in its hold.
 * The turn speeds up to the turn rate, keeps it, and slows down to a stop at the end of the hold.
 * The ramps use the acceleration limit at the target that is farthest from the axis. That
 * target also has the centripetal acceleration ω² r of the turn, so the ramps leave room for
 * it: at the end of a ramp, the total acceleration is the limit.
 * @param {number} rate turn rate, radians per second; the sign gives the direction
 * @param {number} hold length of the hold, seconds
 * @param {number} radius distance from the axis to the farthest target, meters
 * @param {number} maxAcceleration m/s²
 * @returns {Turn | null} null when the formation does not turn
 */
export function planTurn(rate, hold, radius, maxAcceleration) {
  if (rate === 0 || hold <= 0 || radius <= 0) return null;
  // The angular acceleration that alone uses the whole limit at the farthest target.
  const limit = maxAcceleration / radius;
  // The rate at the end of a ramp. A short hold has no time to reach the turn rate.
  const reached = Math.min(Math.abs(rate), (limit * hold) / 2);
  const spare = limit * limit - reached ** 4;
  // When the centripetal acceleration alone breaks the limit, the ramps use the whole limit,
  // and the checks of the plan report the problem.
  const acceleration = spare > 0 ? Math.sqrt(spare) : limit;
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
 * A swing: a rotation back and forth in the hold, such as a sway. It starts and ends at rest
 * at angle 0, so the formation leaves its hold in the pose that it arrived in.
 * @typedef {object} Swing
 * @property {number} amplitude largest angle each way, radians
 * @property {number} cycles number of full swings, back and forth, in the hold
 * @property {number} hold length of the hold, seconds
 * @property {number} ramp time of the fade in at the start and of the fade out at the end, seconds
 */

/**
 * Plans a swing. The hold holds a whole number of full swings, as near to the asked swing
 * time as it can, and at least one. The swing fades in over half a swing and fades out over
 * the last half swing.
 * @param {number} amplitude largest angle each way, radians
 * @param {number} period asked time of one full swing, back and forth, seconds
 * @param {number} hold length of the hold, seconds
 * @returns {Swing | null} null when there is no swing
 */
export function planSwing(amplitude, period, hold) {
  if (amplitude === 0 || hold <= 0 || !(period > 0)) return null;
  const cycles = Math.max(1, Math.round(hold / period));
  return { amplitude, cycles, hold, ramp: hold / cycles / 2 };
}

/**
 * @param {number} x
 * @returns {number} 0 below 0, 1 above 1, and a smooth S-curve between them
 */
function smoothStep(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/**
 * Angle of a swing at a time.
 * @param {Swing} swing
 * @param {number} time seconds from the start of the hold
 * @returns {number} radians
 */
export function swingAngle(swing, time) {
  const { amplitude, cycles, hold, ramp } = swing;
  if (time <= 0 || time >= hold) return 0;
  const fade = smoothStep(time / ramp) * smoothStep((hold - time) / ramp);
  return amplitude * Math.sin((2 * Math.PI * cycles * time) / hold) * fade;
}

/**
 * The pose of a formation in its hold. The pose is three angles. The turn and the sway add
 * to the yaw, the rock adds to the forward tilt, and the roll adds to the sideways tilt.
 * @typedef {object} HoldMotion
 * @property {number} hold length of the hold, seconds
 * @property {number} yaw radians
 * @property {number} forward tilt toward the audience, radians
 * @property {number} side tilt to the right as the audience sees it, radians
 * @property {Turn | null} turn
 * @property {Swing | null} sway a swing of the yaw
 * @property {Swing | null} rock a swing of the forward tilt
 * @property {Swing | null} roll a swing of the sideways tilt
 */

/**
 * @param {HoldMotion} motion
 * @returns {boolean} true when the formation moves in its hold
 */
export function isMoving(motion) {
  return Boolean(motion.turn || motion.sway || motion.rock || motion.roll);
}

/**
 * The angles of the pose at a time in the hold.
 * @param {HoldMotion} motion
 * @param {number} time seconds from the start of the hold
 * @returns {number[]} yaw, forward tilt, sideways tilt, radians
 */
export function holdAngles(motion, time) {
  const { turn, sway, rock, roll } = motion;
  return [
    motion.yaw + (turn ? turn.angle * progressAt(turn.timing, time) : 0) + (sway ? swingAngle(sway, time) : 0),
    motion.forward + (rock ? swingAngle(rock, time) : 0),
    motion.side + (roll ? swingAngle(roll, time) : 0),
  ];
}

/**
 * An upper bound for how fast the pose changes, radians per second. It sets how often a
 * check looks at the hold.
 * @param {HoldMotion} motion
 */
export function angularSpeedBound(motion) {
  /** @param {Swing | null} swing */
  const swingBound = (swing) =>
    swing ? Math.abs(swing.amplitude) * ((2 * Math.PI * swing.cycles) / swing.hold + 3 / swing.ramp) : 0;
  return (
    (motion.turn ? motion.turn.peakRate : 0) + swingBound(motion.sway) + swingBound(motion.rock) + swingBound(motion.roll)
  );
}

/**
 * The rotation of a pose. First the yaw turns the formation about its own vertical axis.
 * Then the sideways tilt leans its top to the right as the audience sees it, a rotation
 * about the Y axis. Then the forward tilt leans its top toward the audience, a rotation about
 * the X axis. A tilted formation then turns about its own tilted axis.
 * @param {number} yaw radians; positive is counterclockwise seen from above
 * @param {number} forward radians; positive leans the top toward the audience
 * @param {number} side radians; positive leans the top to the right
 * @returns {number[]} 3 × 3 matrix, row by row
 */
export function poseRotation(yaw, forward, side) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cf = Math.cos(forward);
  const sf = Math.sin(forward);
  const cs = Math.cos(side);
  const ss = Math.sin(side);
  // Rx(forward) · Ry(side) · Rz(yaw).
  return [
    cs * cy,
    -cs * sy,
    ss,
    cf * sy + sf * ss * cy,
    cf * cy - sf * ss * sy,
    -sf * cs,
    sf * sy - cf * ss * cy,
    sf * cy + cf * ss * sy,
    cf * cs,
  ];
}

/**
 * Places the points of a formation: its center plus the rotation of each point.
 * @param {Float32Array} body xyz per point, in the axes of the formation, about its center
 * @param {number[]} rotation from `poseRotation`
 * @param {number} centerHeight height of the center, meters; the center is above the origin
 * @param {Float32Array | Float64Array} [out] xyz per point; a new list when not given
 * @returns {Float32Array | Float64Array} `out`
 */
export function placeBody(body, rotation, centerHeight, out = new Float32Array(body.length)) {
  const [a, b, c, d, e, f, g, h, k] = rotation;
  for (let i = 0; i < body.length; i += 3) {
    const x = body[i];
    const y = body[i + 1];
    const z = body[i + 2];
    out[i] = a * x + b * y + c * z;
    out[i + 1] = d * x + e * y + f * z;
    out[i + 2] = g * x + h * y + k * z + centerHeight;
  }
  return out;
}
