import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  angularSpeedBound,
  closestApproach,
  closestPair,
  holdAngles,
  isMoving,
  placeBody,
  planSwing,
  planTiming,
  planTurn,
  poseRotation,
  progressAt,
  rateAt,
  swingAngle,
  takeoffGrid,
  timeOfProgress,
} from '../src/motion.js';
import { createRng } from '../src/rng.js';

const LIMITS = { maxHorizontalSpeed: 8, maxClimbSpeed: 3, maxDescentSpeed: 2, maxAcceleration: 4 };

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);
}

test('takeoffGrid gives one ground position per drone', () => {
  const grid = takeoffGrid(10, 3);
  assert.equal(grid.length, 30);
  for (let i = 0; i < 10; i++) assert.equal(grid[i * 3 + 2], 0);
});

test('takeoffGrid is centered on the origin and keeps the spacing', () => {
  const grid = takeoffGrid(9, 2);
  // 3 × 3 grid: x and y run from -2 to 2.
  assert.deepEqual(Array.from(grid.subarray(0, 3)), [-2, -2, 0]);
  assert.deepEqual(Array.from(grid.subarray(12, 15)), [0, 0, 0]);
  assert.deepEqual(Array.from(grid.subarray(24, 27)), [2, 2, 0]);
  assert.equal(grid[3] - grid[0], 2);
});

test('takeoffGrid handles a single drone', () => {
  assert.deepEqual(Array.from(takeoffGrid(1, 3)), [0, 0, 0]);
});

test('planTiming: a long climb cruises at the climb limit', () => {
  // 90 m up. Rate limit 3/90, acceleration limit 4/90.
  const timing = planTiming(new Float32Array(3), new Float32Array([0, 0, 90]), 1, LIMITS);
  // 0.75 s to reach 3 m/s, then cruise, then 0.75 s to stop: 90/3 + 3/4.
  near(timing.duration, 30.75);
  near(timing.rampTime, 0.75);
  near(timing.peakRate * 90, 3);
});

test('planTiming: a short hop has no cruise phase', () => {
  // 1 m sideways: the drone cannot reach 8 m/s. Accelerate 0.5 s, brake 0.5 s.
  const timing = planTiming(new Float32Array(3), new Float32Array([1, 0, 0]), 1, LIMITS);
  near(timing.duration, 1);
  near(timing.rampTime, 0.5);
  near(timing.peakRate, 2);
});

test('planTiming: descent uses the descent limit', () => {
  const timing = planTiming(new Float32Array([0, 0, 90]), new Float32Array(3), 1, LIMITS);
  near(timing.duration, 90 / 2 + 2 / 4);
});

test('planTiming: the slowest drone sets the pace', () => {
  const starts = new Float32Array(6);
  const targets = new Float32Array([0, 0, 30, 0, 0, 90]);
  near(planTiming(starts, targets, 2, LIMITS).duration, 30.75);
});

test('planTiming: no motion takes no time', () => {
  const positions = new Float32Array([1, 2, 3]);
  const timing = planTiming(positions, positions, 1, LIMITS);
  assert.equal(timing.duration, 0);
  assert.equal(progressAt(timing, 0), 1);
  assert.equal(rateAt(timing, 0), 0);
});

test('no drone exceeds a limit at any time', () => {
  const random = createRng(4);
  const count = 40;
  const starts = takeoffGrid(count, 3);
  const targets = Float32Array.from({ length: count * 3 }, () => random() * 120 - 20);
  const timing = planTiming(starts, targets, count, LIMITS);
  const slack = 1 + 1e-9;
  for (let step = 0; step <= 1000; step++) {
    const rate = rateAt(timing, (step / 1000) * timing.duration);
    for (let i = 0; i < count; i++) {
      const dx = targets[i * 3] - starts[i * 3];
      const dy = targets[i * 3 + 1] - starts[i * 3 + 1];
      const dz = targets[i * 3 + 2] - starts[i * 3 + 2];
      assert.ok(Math.hypot(dx, dy) * rate <= LIMITS.maxHorizontalSpeed * slack);
      assert.ok(dz * rate <= LIMITS.maxClimbSpeed * slack);
      assert.ok(-dz * rate <= LIMITS.maxDescentSpeed * slack);
      assert.ok(Math.hypot(dx, dy, dz) * timing.acceleration <= LIMITS.maxAcceleration * slack);
    }
  }
});

test('progress runs from 0 to 1, and its slope is the rate', () => {
  for (const height of [0.5, 5, 90]) {
    const timing = planTiming(new Float32Array(3), new Float32Array([3, 4, height]), 1, LIMITS);
    assert.equal(progressAt(timing, 0), 0);
    assert.equal(progressAt(timing, -1), 0);
    assert.equal(progressAt(timing, timing.duration), 1);
    assert.equal(progressAt(timing, timing.duration + 5), 1);
    near(progressAt(timing, timing.duration / 2), 0.5);

    const dt = timing.duration / 5000;
    let previous = 0;
    for (let step = 1; step <= 5000; step++) {
      const progress = progressAt(timing, step * dt);
      assert.ok(progress >= previous, 'progress never goes back');
      const middleRate = rateAt(timing, (step - 0.5) * dt);
      near((progress - previous) / dt, middleRate, timing.peakRate * 1e-3);
      previous = progress;
    }
  }
});

test('closestApproach finds a near miss in flight', () => {
  // Two drones swap sides. They are 10 m apart at both ends and pass 1 m apart in the middle.
  const starts = new Float32Array([0, 0, 0, 10, 1, 0]);
  const targets = new Float32Array([10, 0, 0, 0, 1, 0]);
  near(closestApproach(starts, targets, 2), 1, 1e-5);
});

test('closestApproach is the end spacing when the drones only come closer at the end', () => {
  const starts = new Float32Array([0, 0, 0, 10, 0, 0]);
  const targets = new Float32Array([0, 0, 20, 4, 0, 20]);
  near(closestApproach(starts, targets, 2), 4, 1e-5);
});

test('closestApproach equals a dense scan over time', () => {
  const random = createRng(9);
  const count = 25;
  const starts = Float32Array.from({ length: count * 3 }, () => random() * 40);
  const targets = Float32Array.from({ length: count * 3 }, () => random() * 40);
  let scanned = Infinity;
  for (let step = 0; step <= 4000; step++) {
    const progress = step / 4000;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let sum = 0;
        for (let axis = 0; axis < 3; axis++) {
          const a = starts[i * 3 + axis] + progress * (targets[i * 3 + axis] - starts[i * 3 + axis]);
          const b = starts[j * 3 + axis] + progress * (targets[j * 3 + axis] - starts[j * 3 + axis]);
          sum += (a - b) ** 2;
        }
        scanned = Math.min(scanned, Math.sqrt(sum));
      }
    }
  }
  const exact = closestApproach(starts, targets, count);
  assert.ok(exact <= scanned + 1e-6);
  near(exact, scanned, 1e-3);
});

test('closestApproach can stop at the first pair that comes too close', () => {
  const random = createRng(4);
  const count = 40;
  const starts = Float32Array.from({ length: count * 3 }, () => random() * 40);
  const targets = Float32Array.from({ length: count * 3 }, () => random() * 40);
  const exact = closestApproach(starts, targets, count);
  // A limit below the closest approach: the search runs to the end and gives the exact value.
  assert.equal(closestApproach(starts, targets, count, exact * 0.99), exact);
  // A limit above it: the answer is below the limit, and is the distance of a real pair.
  const limit = exact * 3;
  const early = closestApproach(starts, targets, count, limit);
  assert.ok(early < limit && early >= exact);
});

test('closestApproach is infinite for one drone', () => {
  assert.equal(closestApproach(new Float32Array(3), new Float32Array(3), 1), Infinity);
});

test('planTurn: a long hold reaches the turn rate and cruises', () => {
  // Rim at 20 m, limit 4 m/s²: alone, the limit lets the turn speed up by 0.2 rad/s each
  // second. At 0.1 rad/s the rim also has 0.1² × 20 = 0.2 m/s² of centripetal acceleration,
  // so the ramp uses a little less.
  const turn = planTurn(0.1, 10, 20, 4);
  const ramp = Math.sqrt(0.2 ** 2 - 0.1 ** 4);
  near(turn.timing.rampTime, 0.1 / ramp);
  near(turn.peakRate, 0.1);
  near(turn.angle, 0.1 * (10 - 0.1 / ramp));
  assert.equal(turn.timing.duration, 10);
  assert.equal(progressAt(turn.timing, 0), 0);
  near(progressAt(turn.timing, 5), 0.5);
  assert.equal(progressAt(turn.timing, 10), 1);
  // The turn rate is the progress rate times the angle.
  near(rateAt(turn.timing, 5) * turn.angle, 0.1);
  assert.equal(rateAt(turn.timing, 10), 0);
});

test('planTurn: a short hold speeds up to its middle and then slows down', () => {
  // The turn rate needs more than the 4 s hold to reach. The rate at the middle stays low
  // enough that the total acceleration at the rim is inside the limit.
  const turn = planTurn(1, 4, 20, 4);
  near(turn.timing.rampTime, 2);
  near(progressAt(turn.timing, 2), 0.5);
  assert.equal(progressAt(turn.timing, 4), 1);
  const ramp = turn.peakRate / 2;
  assert.ok(20 * Math.hypot(ramp, turn.peakRate ** 2) <= 4 + 1e-9);
});

test('planTurn: the sign of the turn rate gives the direction', () => {
  const left = planTurn(0.1, 10, 20, 4);
  const right = planTurn(-0.1, 10, 20, 4);
  near(right.angle, -left.angle);
  assert.deepEqual(right.timing, left.timing);
});

test('planTurn: no turn rate, no hold, or no radius gives no turn', () => {
  assert.equal(planTurn(0, 10, 20, 4), null);
  assert.equal(planTurn(0.1, 0, 20, 4), null);
  assert.equal(planTurn(0.1, 10, 0, 4), null);
});

test('planTurn: the farthest target keeps the acceleration limit, centripetal part included', () => {
  const turn = planTurn(0.3, 12, 35, 4);
  // At the end of a ramp: the ramp acceleration along the path, and ω² r toward the axis.
  const along = turn.timing.acceleration * turn.angle * 35;
  const inward = turn.peakRate ** 2 * 35;
  near(Math.hypot(along, inward), 4);
});

// Swings and poses.

test('planSwing fits a whole number of swings in the hold', () => {
  const swing = planSwing(0.2, 4.4, 10);
  // 10 s ÷ 4.4 s rounds to 2 full swings, 5 s each.
  assert.equal(swing.cycles, 2);
  near(swing.ramp, 2.5);
  // At least one swing, also when the swing time is longer than the hold.
  assert.equal(planSwing(0.2, 60, 10).cycles, 1);
  assert.equal(planSwing(0, 4, 10), null);
  assert.equal(planSwing(0.2, 4, 0), null);
});

test('a swing starts and ends at rest at angle 0, and reaches its amplitude', () => {
  for (const [period, hold] of [[4, 10], [8, 10], [3, 30], [20, 6]]) {
    const swing = planSwing(0.3, period, hold);
    const dt = 1e-4;
    assert.equal(swingAngle(swing, 0), 0);
    assert.equal(swingAngle(swing, hold), 0);
    near(swingAngle(swing, dt) / dt, 0, 1e-3);
    near(swingAngle(swing, hold - dt) / dt, 0, 1e-3);
    let largest = 0;
    let fastest = 0;
    for (let step = 1; step < 4000; step++) {
      const time = (step / 4000) * hold;
      largest = Math.max(largest, Math.abs(swingAngle(swing, time)));
      const rate = (swingAngle(swing, time + dt) - swingAngle(swing, time - dt)) / (2 * dt);
      fastest = Math.max(fastest, Math.abs(rate));
    }
    assert.ok(largest <= 0.3 + 1e-9);
    // With more than one swing, the middle swings reach the amplitude.
    if (swing.cycles > 1) near(largest, 0.3, 0.01);
    // The bound for the checks is above the true speed.
    const bound = angularSpeedBound({ hold, yaw: 0, forward: 0, side: 0, turn: null, sway: swing, rock: null, roll: null });
    assert.ok(fastest <= bound, `${fastest} > ${bound}`);
  }
});

test('holdAngles adds the turn and the sway to the yaw, the rock and the roll to the tilts', () => {
  const turn = planTurn(0.1, 10, 20, 4);
  const sway = planSwing(0.2, 5, 10);
  const rock = planSwing(0.1, 10, 10);
  const roll = planSwing(-0.05, 2, 10);
  const motion = { hold: 10, yaw: 1, forward: 0.3, side: -0.2, turn, sway, rock, roll };
  assert.ok(isMoving(motion));
  assert.deepEqual(holdAngles(motion, 0), [1, 0.3, -0.2]);
  const [yaw, forward, side] = holdAngles(motion, 10);
  near(yaw, 1 + turn.angle);
  near(forward, 0.3);
  near(side, -0.2);
  const [y, f, s] = holdAngles(motion, 3.7);
  near(y, 1 + turn.angle * progressAt(turn.timing, 3.7) + swingAngle(sway, 3.7));
  near(f, 0.3 + swingAngle(rock, 3.7));
  near(s, -0.2 + swingAngle(roll, 3.7));
  assert.equal(isMoving({ ...motion, turn: null, sway: null, rock: null, roll: null }), false);
});

/** Multiplies two 3 × 3 matrices, row by row. */
function multiply(m, n) {
  const out = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out.push(m[row * 3] * n[column] + m[row * 3 + 1] * n[3 + column] + m[row * 3 + 2] * n[6 + column]);
    }
  }
  return out;
}

test('poseRotation turns the yaw first, then tilts sideways, then tilts forward', () => {
  const random = createRng(4);
  for (let round = 0; round < 20; round++) {
    const [yaw, forward, side] = [random() * 6 - 3, random() * 3 - 1.5, random() * 3 - 1.5];
    const [cy, sy, cf, sf, cs, ss] = [Math.cos(yaw), Math.sin(yaw), Math.cos(forward), Math.sin(forward), Math.cos(side), Math.sin(side)];
    const rz = [cy, -sy, 0, sy, cy, 0, 0, 0, 1];
    const ry = [cs, 0, ss, 0, 1, 0, -ss, 0, cs];
    const rx = [1, 0, 0, 0, cf, -sf, 0, sf, cf];
    const expected = multiply(rx, multiply(ry, rz));
    poseRotation(yaw, forward, side).forEach((value, i) => near(value, expected[i], 1e-12));
  }
});

test('a forward tilt leans the top toward the audience, a sideways tilt to the right', () => {
  const top = new Float32Array([0, 0, 10]);
  // The audience stands on the negative Y axis.
  const forward = placeBody(top, poseRotation(0, Math.PI / 6, 0), 50);
  [0, -5, 50 + 10 * Math.cos(Math.PI / 6)].forEach((value, i) => near(forward[i], value, 1e-5));
  const side = placeBody(top, poseRotation(0, 0, Math.PI / 6), 50);
  [5, 0, 50 + 10 * Math.cos(Math.PI / 6)].forEach((value, i) => near(side[i], value, 1e-5));
  // A yaw turns counterclockwise seen from above: x goes to y.
  const turned = placeBody(new Float32Array([2, 0, 0]), poseRotation(Math.PI / 2, 0, 0), 0);
  [0, 2, 0].forEach((value, i) => near(turned[i], value, 1e-6));
});

test('the closest pair is the pair of the closest approach, at the progress of that moment', () => {
  const random = createRng(31);
  const count = 40;
  const starts = Float32Array.from({ length: count * 3 }, () => random() * 60);
  const targets = Float32Array.from({ length: count * 3 }, () => random() * 60);
  const pair = closestPair(starts, targets, count);
  assert.equal(pair.distance, closestApproach(starts, targets, count));
  assert.ok(pair.first >= 0 && pair.second > pair.first);
  // At that progress, the two drones are exactly that far apart.
  const at = (drone) => [0, 1, 2].map((axis) => starts[drone * 3 + axis] + pair.progress * (targets[drone * 3 + axis] - starts[drone * 3 + axis]));
  const [a, b] = [at(pair.first), at(pair.second)];
  assert.ok(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - pair.distance) < 1e-4);
  // One drone has no pair.
  assert.deepEqual(closestPair(starts, targets, 1), { distance: Infinity, first: -1, second: -1, progress: 0 });
});

test('the time of a progress value is the inverse of the progress at a time', () => {
  const timing = planTiming(Float32Array.from([0, 0, 0]), Float32Array.from([0, 90, 30]), 1, {
    maxHorizontalSpeed: 8,
    maxClimbSpeed: 3,
    maxDescentSpeed: 3,
    maxAcceleration: 4,
  });
  for (const progress of [0, 0.01, 0.2, 0.5, 0.93, 1]) {
    const time = timeOfProgress(timing, progress);
    assert.ok(time >= 0 && time <= timing.duration);
    assert.ok(Math.abs(progressAt(timing, time) - progress) < 1e-9, `progress ${progress}`);
  }
});
