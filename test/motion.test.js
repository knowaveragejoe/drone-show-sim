import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arcBox,
  closestApproach,
  planTiming,
  planTurn,
  progressAt,
  rateAt,
  takeoffGrid,
  turnAboutZ,
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

test('closestApproach is infinite for one drone', () => {
  assert.equal(closestApproach(new Float32Array(3), new Float32Array(3), 1), Infinity);
});

test('planTurn: a long hold reaches the turn rate and cruises', () => {
  // Rim at 20 m, limit 4 m/s²: the turn can speed up by 0.2 rad/s each second.
  const turn = planTurn(0.1, 10, 20, 4);
  near(turn.timing.rampTime, 0.5);
  near(turn.peakRate, 0.1);
  // 0.5 s up, 9 s at 0.1 rad/s, 0.5 s down.
  near(turn.angle, 0.1 * 9.5);
  assert.equal(turn.timing.duration, 10);
  assert.equal(progressAt(turn.timing, 0), 0);
  near(progressAt(turn.timing, 5), 0.5);
  assert.equal(progressAt(turn.timing, 10), 1);
  // The turn rate is the progress rate times the angle.
  near(rateAt(turn.timing, 5) * turn.angle, 0.1);
  assert.equal(rateAt(turn.timing, 10), 0);
});

test('planTurn: a short hold speeds up to its middle and then slows down', () => {
  // The turn rate needs 5 s to reach, but the hold is 4 s.
  const turn = planTurn(1, 4, 20, 4);
  near(turn.timing.rampTime, 2);
  near(turn.peakRate, 0.4);
  near(turn.angle, 0.4 * 2);
  near(progressAt(turn.timing, 2), 0.5);
  assert.equal(progressAt(turn.timing, 4), 1);
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

test('planTurn: no target exceeds the acceleration limit along its path', () => {
  const turn = planTurn(0.3, 12, 35, 4);
  // Along the path, the acceleration is the progress acceleration × angle × radius.
  near(turn.timing.acceleration * turn.angle * 35, 4);
});

test('turnAboutZ turns points about the vertical axis', () => {
  const points = new Float32Array([1, 0, 5, 0, 2, -3]);
  const turned = turnAboutZ(points, Math.PI / 2, new Float32Array(6));
  [0, 1, 5, -2, 0, -3].forEach((value, i) => near(turned[i], value, 1e-6));
  // The output can be the input.
  turnAboutZ(points, Math.PI, points);
  [-1, 0, 5, 0, -2, -3].forEach((value, i) => near(points[i], value, 1e-6));
});

test('arcBox equals a dense scan of the arc', () => {
  const random = createRng(21);
  for (let round = 0; round < 200; round++) {
    const x = random() * 40 - 20;
    const y = random() * 40 - 20;
    const angle = (random() * 2 - 1) * (round % 4 === 0 ? 9 : 2.5);
    const radius = Math.hypot(x, y);
    const start = Math.atan2(y, x);
    const scan = [Infinity, -Infinity, Infinity, -Infinity];
    for (let step = 0; step <= 4000; step++) {
      const at = start + (angle * step) / 4000;
      scan[0] = Math.min(scan[0], radius * Math.cos(at));
      scan[1] = Math.max(scan[1], radius * Math.cos(at));
      scan[2] = Math.min(scan[2], radius * Math.sin(at));
      scan[3] = Math.max(scan[3], radius * Math.sin(at));
    }
    arcBox(x, y, angle).forEach((value, i) => near(value, scan[i], 1e-3));
  }
});

test('arcBox of a full turn is the whole circle, and of no turn is the point', () => {
  arcBox(3, 4, 7).forEach((value, i) => near(value, [-5, 5, -5, 5][i], 1e-9));
  arcBox(3, 4, 0).forEach((value, i) => near(value, [3, 3, 4, 4][i], 1e-9));
});
