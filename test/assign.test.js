import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignTargets, solveAssignment } from '../src/assign.js';
import { takeoffGrid } from '../src/motion.js';
import { createRng } from '../src/rng.js';
import { farthestPointOrder } from '../src/sample.js';
import { builtinCloud } from '../src/shapes.js';

/** Smallest total cost over all assignments, by trying each one. */
function bruteForce(cost, n) {
  let best = Infinity;
  const used = new Array(n).fill(false);
  const search = (row, total) => {
    if (total >= best) return;
    if (row === n) {
      best = total;
      return;
    }
    for (let column = 0; column < n; column++) {
      if (used[column]) continue;
      used[column] = true;
      search(row + 1, total + cost[row * n + column]);
      used[column] = false;
    }
  };
  search(0, 0);
  return best;
}

/**
 * The plain Hungarian algorithm: slow, short, and well known.
 * The tests use it to check the fast solver on cases that are too large for brute force.
 */
function hungarian(cost, n) {
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[(i0 - 1) * n + j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const columnOfRow = new Int32Array(n);
  for (let j = 1; j <= n; j++) columnOfRow[p[j] - 1] = j - 1;
  return columnOfRow;
}

function totalCost(cost, n, assignment) {
  let total = 0;
  for (let row = 0; row < n; row++) total += cost[row * n + assignment[row]];
  return total;
}

function assertValid(assignment, n) {
  assert.equal(assignment.length, n);
  assert.equal(new Set(assignment).size, n, 'each column is used one time');
  for (const column of assignment) assert.ok(column >= 0 && column < n);
}

test('solveAssignment solves a known case', () => {
  // The cheapest choice per row is column 0 each time. The best assignment is 1, 0, 2.
  const cost = new Float64Array([1, 2, 9, 1, 9, 9, 9, 9, 3]);
  assert.deepEqual(Array.from(solveAssignment(cost, 3)), [1, 0, 2]);
});

test('solveAssignment equals a brute-force search on small cases', () => {
  const random = createRng(11);
  for (let round = 0; round < 300; round++) {
    const n = 1 + Math.floor(random() * 7);
    // Few different cost values, so ties are common.
    const range = round % 3 === 0 ? 3 : 50;
    const cost = Float64Array.from({ length: n * n }, () => Math.floor(random() * range));
    const assignment = solveAssignment(cost, n);
    assertValid(assignment, n);
    assert.equal(totalCost(cost, n, assignment), bruteForce(cost, n));
  }
});

test('solveAssignment equals the plain Hungarian algorithm on larger cases', () => {
  const random = createRng(12);
  for (const n of [20, 63, 150]) {
    for (const range of [5, 1000]) {
      const cost = Float64Array.from({ length: n * n }, () => Math.floor(random() * range));
      const assignment = solveAssignment(cost, n);
      assertValid(assignment, n);
      assert.equal(totalCost(cost, n, assignment), totalCost(cost, n, hungarian(cost, n)));
    }
    const real = Float64Array.from({ length: n * n }, () => random() * 100);
    const fast = totalCost(real, n, solveAssignment(real, n));
    const slow = totalCost(real, n, hungarian(real, n));
    assert.ok(Math.abs(fast - slow) < 1e-7 * slow, `${fast} is not ${slow}`);
  }
});

test('solveAssignment handles all costs equal, one row, and no rows', () => {
  assertValid(solveAssignment(new Float64Array(25).fill(7), 5), 5);
  assert.deepEqual(Array.from(solveAssignment(new Float64Array([4]), 1)), [0]);
  assert.equal(solveAssignment(new Float64Array(0), 0).length, 0);
});

test('assignTargets is optimal from the takeoff grid to each kind of shape', () => {
  // The grid makes many equal costs, which is the hard case for the solver.
  for (const shape of ['sphere', 'ring', 'cube']) {
    const count = 120;
    const cloud = builtinCloud(shape, 1);
    const order = farthestPointOrder(cloud, count);
    const starts = takeoffGrid(count, 3);
    const targets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      targets[i * 3] = cloud[order[i] * 3] * 40;
      targets[i * 3 + 1] = cloud[order[i] * 3 + 1] * 40;
      targets[i * 3 + 2] = cloud[order[i] * 3 + 2] * 40 + 60;
    }
    const cost = new Float64Array(count * count);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        cost[i * count + j] =
          (targets[j * 3] - starts[i * 3]) ** 2 +
          (targets[j * 3 + 1] - starts[i * 3 + 1]) ** 2 +
          (targets[j * 3 + 2] - starts[i * 3 + 2]) ** 2;
      }
    }
    const assignment = assignTargets(starts, targets, count);
    assertValid(assignment, count);
    const fast = totalCost(cost, count, assignment);
    const slow = totalCost(cost, count, hungarian(cost, count));
    assert.ok(Math.abs(fast - slow) < 1e-9 * slow, `${shape}: ${fast} is not ${slow}`);
  }
});

test('assignTargets removes a crossing', () => {
  // Two drones on the ground, two targets above them in swapped order.
  const starts = new Float32Array([0, 0, 0, 10, 0, 0]);
  const targets = new Float32Array([10, 0, 5, 0, 0, 5]);
  assert.deepEqual(Array.from(assignTargets(starts, targets, 2)), [1, 0]);
});

test('assignTargets uses squared distance', () => {
  // Plain distance has two best answers here (totals 10 and 10).
  // Squared distance prefers two medium flights (25 + 25) to one long and one short (81 + 1).
  const starts = new Float32Array([0, 0, 0, 4, 0, 0]);
  const targets = new Float32Array([5, 0, 0, 9, 0, 0]);
  assert.deepEqual(Array.from(assignTargets(starts, targets, 2)), [0, 1]);
});
