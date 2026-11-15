import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlanner, fitSize, isTooClose } from '../src/plan.js';
import { defaultState } from '../src/state.js';

test('the plan has one target per drone at the formation height', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  const { size, centerHeight } = state.formations[0];
  assert.equal(plan.count, 100);
  assert.equal(plan.targets.length, 300);
  for (let i = 0; i < plan.count; i++) {
    const z = plan.targets[i * 3 + 2];
    assert.ok(z >= centerHeight - size / 2 - 1e-3 && z <= centerHeight + size / 2 + 1e-3);
  }
});

test('more drones keep the targets of the first drones', () => {
  const planner = createPlanner();
  const state = defaultState();
  const small = planner(state);
  state.fleet.count = 250;
  const large = planner(state);
  assert.deepEqual(Array.from(large.targets.subarray(0, 300)), Array.from(small.targets));
});

test('yaw turns the formation about the vertical axis', () => {
  const planner = createPlanner();
  const state = defaultState();
  const before = planner(state);
  state.formations[0].yaw = 90;
  const after = planner(state);
  for (let i = 0; i < before.count; i++) {
    const [x, y, z] = before.targets.subarray(i * 3, i * 3 + 3);
    // A quarter turn counterclockwise moves (x, y) to (-y, x).
    assert.ok(Math.abs(after.targets[i * 3] + y) < 1e-3);
    assert.ok(Math.abs(after.targets[i * 3 + 1] - x) < 1e-3);
    assert.equal(after.targets[i * 3 + 2], z);
  }
});

test('spacing grows in proportion to size', () => {
  const planner = createPlanner();
  const state = defaultState();
  const before = planner(state).spacing;
  state.formations[0].size *= 2;
  assert.ok(Math.abs(planner(state).spacing - before * 2) < 1e-3);
});

test('Fit gives the smallest size that keeps the minimum spacing', () => {
  const planner = createPlanner();
  const state = defaultState();
  state.fleet.count = 400;
  state.formations[0].size = 10;
  const crowded = planner(state);
  assert.ok(isTooClose(crowded.spacing, state.fleet.minSpacing));

  state.formations[0].size = fitSize(10, crowded.spacing, state.fleet.minSpacing);
  const fitted = planner(state);
  assert.ok(!isTooClose(fitted.spacing, state.fleet.minSpacing));
  // One centimeter smaller is too small.
  state.formations[0].size -= 0.02;
  assert.ok(isTooClose(planner(state).spacing, state.fleet.minSpacing));
});

test('Fit has no answer for one drone', () => {
  assert.equal(fitSize(40, Infinity, 2), null);
  assert.equal(fitSize(40, 0, 2), null);
});
