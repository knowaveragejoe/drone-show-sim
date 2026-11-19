import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TIE_BREAK, assignTargets, solveAssignment } from '../src/assign.js';
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

/** The largest value of a long array. Spread arguments would overflow the call stack. */
function largest(values) {
  return values.reduce((most, value) => Math.max(most, value), -Infinity);
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
  assert.deepEqual(Array.from(solveAssignment(cost, 3).columnOfRow), [1, 0, 2]);
});

test('solveAssignment equals a brute-force search on small cases', () => {
  const random = createRng(11);
  for (let round = 0; round < 300; round++) {
    const n = 1 + Math.floor(random() * 7);
    // Few different cost values, so ties are common.
    const range = round % 3 === 0 ? 3 : 50;
    const cost = Float64Array.from({ length: n * n }, () => Math.floor(random() * range));
    const assignment = solveAssignment(cost, n).columnOfRow;
    assertValid(assignment, n);
    assert.equal(totalCost(cost, n, assignment), bruteForce(cost, n));
  }
});

test('solveAssignment equals the plain Hungarian algorithm on larger cases', () => {
  const random = createRng(12);
  for (const n of [20, 63, 150]) {
    for (const range of [5, 1000]) {
      const cost = Float64Array.from({ length: n * n }, () => Math.floor(random() * range));
      const assignment = solveAssignment(cost, n).columnOfRow;
      assertValid(assignment, n);
      assert.equal(totalCost(cost, n, assignment), totalCost(cost, n, hungarian(cost, n)));
    }
    const real = Float64Array.from({ length: n * n }, () => random() * 100);
    const fast = totalCost(real, n, solveAssignment(real, n).columnOfRow);
    const slow = totalCost(real, n, hungarian(real, n));
    assert.ok(Math.abs(fast - slow) < 1e-7 * slow, `${fast} is not ${slow}`);
  }
});

test('solveAssignment handles all costs equal, one row, and no rows', () => {
  assertValid(solveAssignment(new Float64Array(25).fill(7), 5).columnOfRow, 5);
  assert.deepEqual(Array.from(solveAssignment(new Float64Array([4]), 1).columnOfRow), [0]);
  assert.equal(solveAssignment(new Float64Array(0), 0).columnOfRow.length, 0);
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
    const assignment = assignTargets(starts, targets, count).columnOfRow;
    assertValid(assignment, count);
    // The tie-break term can cost at most its share of the largest cost per drone.
    const fast = totalCost(cost, count, assignment);
    const slow = totalCost(cost, count, hungarian(cost, count));
    assert.ok(Math.abs(fast - slow) <= TIE_BREAK * largest(cost) * count, `${shape}: ${fast} is not ${slow}`);
  }
});

test('assignTargets removes a crossing', () => {
  // Two drones on the ground, two targets above them in swapped order.
  const starts = new Float32Array([0, 0, 0, 10, 0, 0]);
  const targets = new Float32Array([10, 0, 5, 0, 0, 5]);
  assert.deepEqual(Array.from(assignTargets(starts, targets, 2).columnOfRow), [1, 0]);
});

test('assignTargets uses squared distance', () => {
  // Plain distance has two best answers here (totals 10 and 10).
  // Squared distance prefers two medium flights (25 + 25) to one long and one short (81 + 1).
  const starts = new Float32Array([0, 0, 0, 4, 0, 0]);
  const targets = new Float32Array([5, 0, 0, 9, 0, 0]);
  assert.deepEqual(Array.from(assignTargets(starts, targets, 2).columnOfRow), [0, 1]);
});

// Warm starts.

/** A random cost matrix with values from 0 to range. */
function randomCost(random, n, range) {
  return Float64Array.from({ length: n * n }, () => Math.floor(random() * range));
}

test('a warm start from the same problem gives an optimal assignment at once', () => {
  const random = createRng(31);
  const n = 60;
  const cost = randomCost(random, n, 1000);
  const cold = solveAssignment(cost, n);
  const warm = solveAssignment(cost, n, cold);
  assert.deepEqual(warm.columnOfRow, cold.columnOfRow);
});

test('a warm start from a changed problem still gives an optimal assignment', () => {
  const random = createRng(32);
  for (let round = 0; round < 40; round++) {
    const n = 5 + Math.floor(random() * 60);
    const range = round % 2 === 0 ? 4 : 1000;
    const before = randomCost(random, n, range);
    // Change some of the costs: few, or most of them.
    const share = round % 3 === 0 ? 0.9 : 0.05;
    const after = before.map((value) => (random() < share ? Math.floor(random() * range) : value));
    const assignment = solveAssignment(after, n, solveAssignment(before, n)).columnOfRow;
    assertValid(assignment, n);
    assert.equal(totalCost(after, n, assignment), totalCost(after, n, hungarian(after, n)));
  }
});

test('a warm start from a problem of another size still gives an optimal assignment', () => {
  const random = createRng(33);
  for (const [earlier, now] of [[40, 50], [50, 40], [30, 31], [1, 20], [20, 1]]) {
    const warm = solveAssignment(randomCost(random, earlier, 500), earlier);
    const cost = randomCost(random, now, 500);
    const assignment = solveAssignment(cost, now, warm).columnOfRow;
    assertValid(assignment, now);
    assert.equal(totalCost(cost, now, assignment), totalCost(cost, now, hungarian(cost, now)));
  }
});

test('the prices of a solution prove it optimal', () => {
  const random = createRng(34);
  const n = 80;
  const cost = randomCost(random, n, 1000);
  const { columnOfRow, price } = solveAssignment(cost, n);
  for (let row = 0; row < n; row++) {
    const own = cost[row * n + columnOfRow[row]] - price[columnOfRow[row]];
    for (let column = 0; column < n; column++) {
      assert.ok(cost[row * n + column] - price[column] >= own - 1e-9, `row ${row}, column ${column}`);
    }
  }
});

test('scaling or moving either point set keeps the best assignment', () => {
  // Any assignment that is best for one problem is best for the other: compare totals,
  // because problems with ties can have more than one best assignment.
  const count = 120;
  const cloud = builtinCloud('torus', 1);
  const order = farthestPointOrder(cloud, count);
  const starts = takeoffGrid(count, 3);
  const targets = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) targets.set(cloud.subarray(order[i] * 3, order[i] * 3 + 3).map((v) => v * 50), i * 3);
  const changedStarts = starts.map((value, i) => value * 1.7 + (i % 3 === 2 ? 0 : 4));
  const changedTargets = targets.map((value, i) => value * 0.6 + (i % 3 === 2 ? 80 : -3));
  const cost = (a, b) => {
    const out = new Float64Array(count * count);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        out[i * count + j] = (a[i * 3] - b[j * 3]) ** 2 + (a[i * 3 + 1] - b[j * 3 + 1]) ** 2 + (a[i * 3 + 2] - b[j * 3 + 2]) ** 2;
      }
    }
    return out;
  };
  const best = assignTargets(starts, targets, count).columnOfRow;
  const changed = cost(changedStarts, changedTargets);
  const reference = totalCost(changed, count, assignTargets(changedStarts, changedTargets, count).columnOfRow);
  assert.ok(Math.abs(totalCost(changed, count, best) - reference) <= TIE_BREAK * largest(changed) * count);
});

test('a large fleet gets the same assignment from a cold start, a warm start, and the plain Hungarian algorithm', () => {
  // From the flat takeoff grid to the flat heart: the geometry alone has many best
  // assignments. The tie-break term leaves one, whatever the start.
  const count = 420;
  const cloud = builtinCloud('heart', 1);
  const order = farthestPointOrder(cloud, count);
  const starts = takeoffGrid(count, 3);
  const targets = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = cloud.subarray(order[i] * 3, order[i] * 3 + 3);
    targets.set([x * 80, y * 80, z * 80 + 60], i * 3);
  }
  // This size takes the coarse to fine path.
  const cold = assignTargets(starts, targets, count);
  // A warm start from a slightly different problem: the heart turned by 3 degrees.
  const turned = targets.map((value, i) => {
    const base = i - (i % 3);
    const [x, y] = [targets[base], targets[base + 1]];
    const angle = (3 * Math.PI) / 180;
    return i % 3 === 0 ? x * Math.cos(angle) - y * Math.sin(angle) : i % 3 === 1 ? x * Math.sin(angle) + y * Math.cos(angle) : value;
  });
  const warm = assignTargets(starts, targets, count, assignTargets(starts, turned, count));
  assert.deepEqual(warm.columnOfRow, cold.columnOfRow);

  const cost = new Float64Array(count * count);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      cost[i * count + j] =
        (starts[i * 3] - targets[j * 3]) ** 2 +
        (starts[i * 3 + 1] - targets[j * 3 + 1]) ** 2 +
        (starts[i * 3 + 2] - targets[j * 3 + 2]) ** 2;
    }
  }
  const best = totalCost(cost, count, hungarian(cost, count));
  assert.ok(Math.abs(totalCost(cost, count, cold.columnOfRow) - best) <= TIE_BREAK * largest(cost) * count);
});
