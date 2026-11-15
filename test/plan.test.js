import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlanner, fitSize, isTooClose, positionsAt, retime, speedAt } from '../src/plan.js';
import { defaultState } from '../src/state.js';

/** The targets as a sorted list of "x,y,z" strings, so two plans compare without regard to drone order. */
function targetSet(plan) {
  const rows = [];
  for (let i = 0; i < plan.count; i++) {
    rows.push(Array.from(plan.targets.subarray(i * 3, i * 3 + 3), (value) => value.toFixed(3)).join());
  }
  return rows.sort();
}

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
  const small = new Set(targetSet(planner(state)));
  state.fleet.count = 250;
  const large = new Set(targetSet(planner(state)));
  assert.equal(large.size, 250);
  for (const target of small) assert.ok(large.has(target));
});

test('yaw turns the formation about the vertical axis', () => {
  const planner = createPlanner();
  const state = defaultState();
  const before = planner(state);
  state.formations[0].yaw = 90;
  const after = new Set(targetSet(planner(state)));
  for (let i = 0; i < before.count; i++) {
    const [x, y, z] = before.targets.subarray(i * 3, i * 3 + 3);
    // A quarter turn counterclockwise moves (x, y) to (-y, x).
    const turned = [-y, x, z].map((value) => (value + 0).toFixed(3)).join();
    assert.ok(after.has(turned) || after.has(turned.replaceAll('-0.000', '0.000')), turned);
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

test('drones start on the takeoff grid and end on their targets', () => {
  const plan = createPlanner()(defaultState());
  const positions = new Float32Array(plan.count * 3);
  positionsAt(plan, 0, positions);
  assert.deepEqual(positions, plan.starts);
  positionsAt(plan, plan.timing.duration, positions);
  assert.deepEqual(positions, plan.targets);
  positionsAt(plan, plan.total, positions);
  assert.deepEqual(positions, plan.targets);
});

test('the timeline is the transition plus the hold', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  assert.ok(plan.timing.duration > 10);
  assert.equal(plan.total, plan.timing.duration + state.formations[0].holdSeconds);
});

test('the checks follow the limits', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  // The grid spacing is 3 m and the formation spacing is larger, so D is 3 m.
  assert.ok(plan.closestApproach >= 3 / Math.SQRT2 - 1e-3, `closest approach ${plan.closestApproach}`);
  const { maxHorizontalSpeed, maxClimbSpeed } = state.fleet;
  assert.ok(plan.peakSpeed <= Math.hypot(maxHorizontalSpeed, maxClimbSpeed) + 1e-6);

  let fastest = 0;
  for (let drone = 0; drone < plan.count; drone++) {
    fastest = Math.max(fastest, speedAt(plan, drone, plan.timing.duration / 2));
    assert.equal(speedAt(plan, drone, 0), 0);
    assert.equal(speedAt(plan, drone, plan.total), 0);
  }
  assert.ok(Math.abs(fastest - plan.peakSpeed) < 1e-4);
});

test('slower limits make a longer transition', () => {
  const planner = createPlanner();
  const state = defaultState();
  const before = planner(state).timing.duration;
  state.fleet.maxClimbSpeed /= 2;
  assert.ok(planner(state).timing.duration > before * 1.5);
});

test('a new formation height keeps the assignment', () => {
  const planner = createPlanner();
  const state = defaultState();
  const low = planner(state);
  state.formations[0].centerHeight += 25;
  const high = planner(state);
  for (let i = 0; i < low.count; i++) {
    assert.equal(high.targets[i * 3], low.targets[i * 3]);
    assert.equal(high.targets[i * 3 + 1], low.targets[i * 3 + 1]);
    assert.ok(Math.abs(high.targets[i * 3 + 2] - low.targets[i * 3 + 2] - 25) < 1e-3);
  }
});

test('retime keeps the same moment when the plan changes', () => {
  const oldPlan = { timing: { duration: 20 }, total: 30 };
  const newPlan = { timing: { duration: 40 }, total: 45 };
  // The end stays the end.
  assert.equal(retime(oldPlan, newPlan, 30), 45);
  // 3 s into the hold stays 3 s into the hold.
  assert.equal(retime(oldPlan, newPlan, 23), 43);
  // The hold got shorter: stop at the end.
  assert.equal(retime(oldPlan, newPlan, 28), 45);
  // A quarter of the transition stays a quarter.
  assert.equal(retime(oldPlan, newPlan, 5), 10);
  assert.equal(retime(oldPlan, newPlan, 0), 0);
});

test('the plan uses an OBJ model as the shape', () => {
  const state = defaultState();
  // A flat square in the model XY plane. With Y up, it stands upright and faces the audience.
  const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  state.formations[0].source = { type: 'obj', fileName: 'square.obj', upAxis: 'y', text };
  const plan = createPlanner()(state);
  const { size, centerHeight } = state.formations[0];
  for (let i = 0; i < plan.count; i++) {
    assert.ok(Math.abs(plan.targets[i * 3]) <= size / 2 + 1e-3);
    assert.ok(Math.abs(plan.targets[i * 3 + 1]) < 1e-3);
    assert.ok(Math.abs(plan.targets[i * 3 + 2] - centerHeight) <= size / 2 + 1e-3);
  }
});

test('a shape that fails does not break the planner', () => {
  const planner = createPlanner();
  const state = defaultState();
  const good = planner(state);
  const bad = structuredClone(state);
  bad.formations[0].source = { type: 'obj', fileName: 'empty.obj', upAxis: 'y', text: '' };
  assert.throws(() => planner(bad), /no faces/);
  assert.deepEqual(planner(state).targets, good.targets);
});
