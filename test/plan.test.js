import assert from 'node:assert/strict';
import { test } from 'node:test';

import { takeoffGrid, turnAboutZ } from '../src/motion.js';
import {
  CHASE_DIM,
  FLIGHT_MARGIN,
  brightnessAt,
  countOutside,
  createPlanner,
  fitSize,
  formationProblems,
  holdStart,
  isBelowGround,
  isTooClose,
  lightColorAt,
  positionsAt,
  retime,
  routeOf,
  speedAt,
  stepAt,
  volumeBounds,
} from '../src/plan.js';
import { defaultState } from '../src/state.js';

/** The default show, but no formation turns in its hold. */
function stillState() {
  const state = defaultState();
  state.formations = state.formations.map((formation) => ({ ...formation, turnRate: 0 }));
  return state;
}

/** A show with one formation that stands still, and no landing. */
function singleState() {
  const state = stillState();
  state.formations = [state.formations[0]];
  state.landAtEnd = false;
  return state;
}

/** Positions as a sorted list of "x,y,z" strings, to compare two sets without regard to drone order. */
function pointSet(positions) {
  const rows = [];
  for (let i = 0; i < positions.length; i += 3) {
    rows.push(Array.from(positions.subarray(i, i + 3), (value) => (value + 0).toFixed(3)).join());
  }
  return rows.sort();
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);
}

// One formation.

test('the plan has one target per drone at the formation height', () => {
  const state = singleState();
  const plan = createPlanner()(state);
  const { size, centerHeight } = state.formations[0];
  const targets = plan.steps[0].to;
  assert.equal(plan.count, 100);
  assert.equal(plan.steps.length, 1);
  assert.equal(targets.length, 300);
  for (let i = 0; i < plan.count; i++) {
    const z = targets[i * 3 + 2];
    assert.ok(z >= centerHeight - size / 2 - 1e-3 && z <= centerHeight + size / 2 + 1e-3);
  }
});

test('more drones keep the targets of the first drones', () => {
  const planner = createPlanner();
  const state = singleState();
  const small = new Set(pointSet(planner(state).steps[0].to));
  state.fleet.count = 250;
  const large = new Set(pointSet(planner(state).steps[0].to));
  assert.equal(large.size, 250);
  for (const target of small) assert.ok(large.has(target));
});

test('yaw turns the formation about the vertical axis', () => {
  const planner = createPlanner();
  const state = singleState();
  const before = planner(state).steps[0].to;
  state.formations[0].yaw = 90;
  const after = new Set(pointSet(planner(state).steps[0].to));
  for (let i = 0; i < before.length; i += 3) {
    const [x, y, z] = before.subarray(i, i + 3);
    // A quarter turn counterclockwise moves (x, y) to (-y, x).
    const turned = pointSet(new Float32Array([-y, x, z]))[0];
    assert.ok(after.has(turned) || after.has(turned.replaceAll('-0.000', '0.000')), turned);
  }
});

test('spacing grows in proportion to size', () => {
  const planner = createPlanner();
  const state = singleState();
  const before = planner(state).formations[0].spacing;
  state.formations[0].size *= 2;
  near(planner(state).formations[0].spacing, before * 2, 1e-3);
});

test('Fit gives the smallest size that keeps the minimum spacing, also in flight', () => {
  const planner = createPlanner();
  const state = singleState();
  const { minSpacing } = state.fleet;
  state.fleet.count = 400;
  state.formations[0].size = 10;
  const crowded = planner(state);
  assert.ok(isTooClose(crowded.formations[0].spacing, minSpacing));
  assert.ok(isTooClose(crowded.closestApproach, minSpacing));

  // The targets end up with the margin that the flight bound needs.
  const target = minSpacing * FLIGHT_MARGIN;
  state.formations[0].size = fitSize(10, crowded.formations[0].spacing, minSpacing);
  const fitted = planner(state);
  assert.ok(!isTooClose(fitted.formations[0].spacing, target));
  // The takeoff grid has the same margin, so the flight is safe too.
  assert.ok(state.fleet.gridSpacing >= target);
  assert.ok(!isTooClose(fitted.closestApproach, minSpacing), `closest approach ${fitted.closestApproach}`);
  assert.deepEqual(formationProblems(fitted, 0, state.fleet), []);

  // Two centimeters smaller is too small.
  state.formations[0].size -= 0.02;
  assert.ok(isTooClose(planner(state).formations[0].spacing, target));
});

test('Fit has no answer for one drone', () => {
  assert.equal(fitSize(40, Infinity, 2), null);
  assert.equal(fitSize(40, 0, 2), null);
});

test('drones start on the takeoff grid and end on their targets', () => {
  const state = singleState();
  const plan = createPlanner()(state);
  const step = plan.steps[0];
  assert.deepEqual(step.from, takeoffGrid(state.fleet.count, state.fleet.gridSpacing));
  const positions = new Float32Array(plan.count * 3);
  positionsAt(plan, 0, positions);
  assert.deepEqual(positions, step.from);
  positionsAt(plan, step.timing.duration, positions);
  assert.deepEqual(positions, step.to);
  positionsAt(plan, plan.total, positions);
  assert.deepEqual(positions, step.to);
});

test('the timeline of one formation is the transition plus the hold', () => {
  const state = singleState();
  const plan = createPlanner()(state);
  assert.ok(plan.steps[0].timing.duration > 10);
  assert.equal(plan.total, plan.steps[0].timing.duration + state.formations[0].holdSeconds);
});

test('the checks follow the limits', () => {
  const state = singleState();
  const plan = createPlanner()(state);
  // The grid spacing is 3 m and the formation spacing is larger, so D is 3 m.
  assert.ok(plan.closestApproach >= 3 / Math.SQRT2 - 1e-3, `closest approach ${plan.closestApproach}`);
  const { maxHorizontalSpeed, maxClimbSpeed } = state.fleet;
  assert.ok(plan.peakSpeed <= Math.hypot(maxHorizontalSpeed, maxClimbSpeed) + 1e-6);

  let fastest = 0;
  for (let drone = 0; drone < plan.count; drone++) {
    fastest = Math.max(fastest, speedAt(plan, drone, plan.steps[0].timing.duration / 2));
    assert.equal(speedAt(plan, drone, 0), 0);
    assert.equal(speedAt(plan, drone, plan.total), 0);
  }
  near(fastest, plan.peakSpeed, 1e-4);
});

test('slower limits make a longer transition', () => {
  const planner = createPlanner();
  const state = singleState();
  const before = planner(state).steps[0].timing.duration;
  state.fleet.maxClimbSpeed /= 2;
  assert.ok(planner(state).steps[0].timing.duration > before * 1.5);
});

test('a new formation height keeps the assignment', () => {
  const planner = createPlanner();
  const state = singleState();
  const low = planner(state).steps[0].to;
  state.formations[0].centerHeight += 25;
  const high = planner(state).steps[0].to;
  for (let i = 0; i < low.length; i += 3) {
    assert.equal(high[i], low[i]);
    assert.equal(high[i + 1], low[i + 1]);
    near(high[i + 2], low[i + 2] + 25, 1e-3);
  }
});

test('the plan uses an OBJ model as the shape', () => {
  const state = singleState();
  // A flat square in the model XY plane. With Y up, it stands upright and faces the audience.
  const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  state.formations[0].source = { type: 'obj', fileName: 'square.obj', upAxis: 'y', text };
  const targets = createPlanner()(state).steps[0].to;
  const { size, centerHeight } = state.formations[0];
  for (let i = 0; i < targets.length; i += 3) {
    assert.ok(Math.abs(targets[i]) <= size / 2 + 1e-3);
    assert.ok(Math.abs(targets[i + 1]) < 1e-3);
    assert.ok(Math.abs(targets[i + 2] - centerHeight) <= size / 2 + 1e-3);
  }
});

test('a shape that fails does not break the planner', () => {
  const planner = createPlanner();
  const state = defaultState();
  const good = planner(state);
  const bad = structuredClone(state);
  bad.formations[1].source = { type: 'obj', fileName: 'empty.obj', upAxis: 'y', text: '' };
  assert.throws(() => planner(bad), /no faces/);
  assert.deepEqual(planner(state).steps.at(-1).to, good.steps.at(-1).to);
});

test('the lowest target check finds a formation that goes below the ground', () => {
  const planner = createPlanner();
  const state = singleState();
  // A 40 m sphere centered at 60 m: the lowest target is near 40 m.
  const high = planner(state);
  assert.ok(high.lowestTarget > 39.9 && high.lowestTarget < 42, `lowest ${high.lowestTarget}`);
  assert.ok(!isBelowGround(high.lowestTarget));

  state.formations[0].centerHeight = 10;
  const low = planner(state);
  near(low.lowestTarget, high.lowestTarget - 50, 1e-3);
  assert.equal(low.formations[0].lowestTarget, low.lowestTarget);
  assert.ok(isBelowGround(low.lowestTarget));
  // A target on the ground is not below it.
  assert.ok(!isBelowGround(0));
  assert.ok(!isBelowGround(-0.0001));
});

// Flight volume.

test('the flight volume is a cube that stands on its floor', () => {
  assert.deepEqual(volumeBounds({ size: 100, x: 10, y: -20, z: 5 }), {
    low: [-40, -70, 5],
    high: [60, 30, 105],
  });
});

test('countOutside counts each drone that is outside the box at a stop', () => {
  const bounds = { low: [-10, -10, 0], high: [10, 10, 20] };
  const first = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 11, 0, 0]);
  const second = new Float32Array([0, 0, 10, 0, 0, 21, 10, -10, 20, 0, 0, 10, 0, 0, 10]);
  // Drone 0 is inside. Drone 1 ends too high. Drone 2 ends on a corner, which is inside.
  // Drone 3 starts below the floor. Drone 4 starts beside the box.
  assert.equal(countOutside([first, second], 5, bounds), 3);
  assert.equal(countOutside([first], 5, bounds), 2);
  assert.equal(countOutside([first, second], 1, bounds), 0);
  // A drone that is outside at two stops counts one time.
  assert.equal(countOutside([second, second, first], 5, bounds), 3);
});

test('the plan counts the drones outside the flight volume', () => {
  const planner = createPlanner();
  const state = singleState();
  // The show fits in the default volume. The takeoff grid is on the floor, which is inside.
  assert.equal(planner(state).outsideVolume, 0);
  assert.equal(planner(state).takeoffOutsideVolume, 0);

  // A ceiling at 60 m cuts the sphere, which is centered at 60 m, in half.
  state.volume = { ...state.volume, size: 60 };
  const cut = planner(state);
  assert.ok(cut.outsideVolume > 30 && cut.outsideVolume < 70, `outside ${cut.outsideVolume}`);
  assert.equal(cut.formations[0].outsideVolume, cut.outsideVolume);

  // A volume that floats above the ground does not hold the takeoff grid.
  state.volume = { size: 120, x: 0, y: 0, z: 10 };
  assert.equal(planner(state).outsideVolume, state.fleet.count);
  assert.equal(planner(state).takeoffOutsideVolume, state.fleet.count);
  assert.equal(planner(state).formations[0].outsideVolume, 0);

  // A volume far to the side holds no drone.
  state.volume = { size: 120, x: 400, y: 0, z: 0 };
  assert.equal(planner(state).outsideVolume, state.fleet.count);
});

// Storyboard: more than one formation.

test('a show has one step per formation, and one more for the landing', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  assert.deepEqual(plan.steps.map((step) => step.formation), [0, 1, 2, -1]);
  assert.equal(plan.formations.length, 3);

  let time = 0;
  plan.steps.forEach((step, index) => {
    near(step.start, time);
    assert.equal(step.hold, index < 3 ? state.formations[index].holdSeconds : 0);
    time += step.timing.duration + step.hold;
  });
  near(plan.total, time);

  state.landAtEnd = false;
  assert.deepEqual(createPlanner()(state).steps.map((step) => step.formation), [0, 1, 2]);
});

test('each step starts where the step before it ends', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  assert.deepEqual(plan.steps[0].from, takeoffGrid(state.fleet.count, state.fleet.gridSpacing));
  for (let index = 1; index < plan.steps.length; index++) {
    assert.deepEqual(plan.steps[index].from, plan.steps[index - 1].end);
  }

  // No drone jumps at the border between two steps.
  const before = new Float32Array(plan.count * 3);
  const after = new Float32Array(plan.count * 3);
  for (const step of plan.steps.slice(1)) {
    positionsAt(plan, step.start - 1e-6, before);
    positionsAt(plan, step.start + 1e-6, after);
    for (let i = 0; i < before.length; i++) near(after[i], before[i], 1e-3);
  }
});

test('each stop has one drone on each target of its formation', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  state.formations.forEach((formation, index) => {
    // The same formation as the only one of a show gives the same targets.
    const alone = createPlanner()({ ...state, formations: [formation], landAtEnd: false });
    assert.deepEqual(pointSet(plan.steps[index].to), pointSet(alone.steps[0].to));
  });
});

test('the landing puts one drone on each cell of the takeoff grid', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  const grid = takeoffGrid(state.fleet.count, state.fleet.gridSpacing);
  assert.deepEqual(pointSet(plan.steps.at(-1).to), pointSet(grid));
});

test('each transition keeps the closest approach bound', () => {
  const state = defaultState();
  state.fleet.count = 150;
  const plan = createPlanner()(state);
  const spacings = [state.fleet.gridSpacing, ...plan.formations.map((checks) => checks.spacing)];
  spacings.push(state.fleet.gridSpacing);
  plan.steps.forEach((step, index) => {
    // If the closest spacing at both ends is D, the closest approach is at least D ÷ √2.
    const bound = Math.min(spacings[index], spacings[index + 1]) / Math.SQRT2;
    assert.ok(step.closestApproach >= bound - 1e-3, `step ${index}: ${step.closestApproach} < ${bound}`);
  });
  near(plan.closestApproach, Math.min(...plan.steps.map((step) => step.closestApproach)));
  near(plan.peakSpeed, Math.max(...plan.steps.map((step) => step.peakSpeed)));
});

test('stored results give the same plan as a new planner', () => {
  const planner = createPlanner();
  const state = defaultState();
  planner(state);
  const [first, second, third] = state.formations;
  const changes = [
    // A height change uses the stored assignment.
    { ...state, formations: [first, { ...second, centerHeight: 80 }, third] },
    { ...state, formations: [third, first, second] },
    { ...state, formations: [first, { ...second, size: 120, yaw: 45 }, third], landAtEnd: false },
    { ...state, fleet: { ...state.fleet, count: 60, gridSpacing: 4 } },
    { ...state, formations: [first, first, third, second] },
    // A new turn changes the pose that the next flight starts from.
    { ...state, formations: [{ ...first, turnRate: -12 }, second, { ...third, turnRate: 0 }] },
    { ...state, fleet: { ...state.fleet, maxAcceleration: 1 } },
    { ...state, formations: [{ ...first, holdSeconds: 4 }, second, third] },
    state,
  ];
  for (const changed of changes) {
    const stored = planner(changed);
    const fresh = createPlanner()(changed);
    assert.equal(stored.steps.length, fresh.steps.length);
    stored.steps.forEach((step, index) => {
      assert.deepEqual(step.to, fresh.steps[index].to);
      assert.equal(step.closestApproach, fresh.steps[index].closestApproach);
    });
    assert.deepEqual(stored.formations, fresh.formations);
    assert.equal(stored.total, fresh.total);
  }
});

test('two equal formations in a row need no flight', () => {
  const state = stillState();
  state.formations = [state.formations[0], state.formations[0]];
  const plan = createPlanner()(state);
  assert.equal(plan.steps[1].timing.duration, 0);
  assert.deepEqual(plan.steps[1].to, plan.steps[0].to);
  assert.equal(plan.steps[1].peakSpeed, 0);
});

test('stepAt and holdStart find the parts of the timeline', () => {
  const plan = createPlanner()(defaultState());
  const [takeoff, second, third, landing] = plan.steps;
  assert.equal(stepAt(plan, 0), 0);
  assert.equal(stepAt(plan, -5), 0);
  assert.equal(stepAt(plan, second.start - 0.01), 0);
  assert.equal(stepAt(plan, second.start), 1);
  assert.equal(stepAt(plan, third.start + 1), 2);
  assert.equal(stepAt(plan, plan.total + 100), 3);

  near(holdStart(plan, 0), takeoff.timing.duration);
  near(holdStart(plan, 1), second.start + second.timing.duration);
  near(holdStart(plan, 2) + third.hold, landing.start);
});

test('drones hold their targets between transitions', () => {
  const plan = createPlanner()(stillState());
  const positions = new Float32Array(plan.count * 3);
  plan.formations.forEach((checks, index) => {
    const step = plan.steps[index];
    positionsAt(plan, holdStart(plan, index) + step.hold / 2, positions);
    assert.deepEqual(positions, step.to);
    for (let drone = 0; drone < plan.count; drone += 7) {
      assert.equal(speedAt(plan, drone, holdStart(plan, index) + 1), 0);
    }
  });
  // In the middle of a transition each drone is between its two stops.
  const step = plan.steps[1];
  positionsAt(plan, step.start + step.timing.duration / 2, positions);
  for (let i = 0; i < positions.length; i++) near(positions[i], (step.from[i] + step.to[i]) / 2, 1e-3);
});

test('the light color blends from one formation to the next', () => {
  const plan = createPlanner()(defaultState());
  const colors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const [takeoff, second, third, landing] = plan.steps;
  // Takeoff uses the color of the first formation.
  assert.deepEqual(lightColorAt(plan, colors, 0), [1, 0, 0]);
  assert.deepEqual(lightColorAt(plan, colors, takeoff.timing.duration / 2), [1, 0, 0]);
  assert.deepEqual(lightColorAt(plan, colors, holdStart(plan, 0) + 1), [1, 0, 0]);
  // Half of the progress of a transition is at half of its time.
  const half = lightColorAt(plan, colors, second.start + second.timing.duration / 2);
  [0.5, 0.5, 0].forEach((channel, i) => near(half[i], channel, 1e-6));
  assert.deepEqual(lightColorAt(plan, colors, holdStart(plan, 1)), [0, 1, 0]);
  assert.deepEqual(lightColorAt(plan, colors, holdStart(plan, 2) + third.hold / 2), [0, 0, 1]);
  // The landing keeps the color of the last formation.
  assert.deepEqual(lightColorAt(plan, colors, landing.start + 5), [0, 0, 1]);
  assert.deepEqual(lightColorAt(plan, colors, plan.total), [0, 0, 1]);
});

test('retime keeps the same moment when the plan changes', () => {
  const step = (start, duration, hold) => ({ start, timing: { duration }, hold });
  const oldPlan = { steps: [step(0, 20, 10), step(30, 10, 10)], total: 50 };
  const newPlan = { steps: [step(0, 40, 5), step(45, 20, 30)], total: 95 };
  // The end stays the end.
  assert.equal(retime(oldPlan, newPlan, 50), 95);
  // 3 s into the first hold stays 3 s into the first hold.
  assert.equal(retime(oldPlan, newPlan, 23), 43);
  // The first hold got shorter: stop at its end.
  assert.equal(retime(oldPlan, newPlan, 28), 45);
  // A quarter of the first transition stays a quarter.
  assert.equal(retime(oldPlan, newPlan, 5), 10);
  assert.equal(retime(oldPlan, newPlan, 0), 0);
  // Half of the second transition stays half of the second transition.
  assert.equal(retime(oldPlan, newPlan, 35), 55);
  // 4 s into the second hold.
  assert.equal(retime(oldPlan, newPlan, 44), 69);

  // The new plan has no second step: go to its end.
  const shortPlan = { steps: [step(0, 40, 5)], total: 45 };
  assert.equal(retime(oldPlan, shortPlan, 35), 45);
  assert.equal(retime(oldPlan, shortPlan, 5), 10);
});

test('formationProblems lists what is wrong with a formation', () => {
  const planner = createPlanner();
  const state = defaultState();
  const plan = planner(state);
  state.formations.forEach((formation, index) => {
    assert.deepEqual(formationProblems(plan, index, state.fleet), []);
  });

  // A small, low second formation: crowded targets, below the ground, and a tight transition.
  state.formations[1] = { ...state.formations[1], size: 20, centerHeight: 5 };
  state.volume = { ...state.volume, x: 80 };
  const broken = planner(state);
  const problems = formationProblems(broken, 1, state.fleet);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /closer than the minimum spacing/);
  assert.match(problems[1], /below the ground/);
  assert.match(problems[2], /outside the flight volume/);
  assert.match(problems[3], /too close in the transition/);
  // The first formation is far from the moved volume, but its own spacing is fine.
  assert.deepEqual(formationProblems(broken, 0, state.fleet), ['Targets are outside the flight volume.']);
});

// Slow turn.

test('a formation that turns ends its hold in a turned pose', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  const [first, second] = plan.steps;
  // 6 degrees per second for 10 s, less the two ramps.
  assert.ok(first.turn.angle > 0.95 && first.turn.angle < (60 * Math.PI) / 180, `angle ${first.turn.angle}`);
  assert.deepEqual(first.end, turnAboutZ(first.to, first.turn.angle, new Float32Array(first.to.length)));
  assert.deepEqual(second.from, first.end);
  // The heart does not turn.
  assert.equal(second.turn, null);
  assert.equal(second.end, second.to);
  assert.equal(second.turnSpeed, 0);

  const positions = new Float32Array(plan.count * 3);
  positionsAt(plan, holdStart(plan, 0), positions);
  assert.deepEqual(positions, first.to);
  positionsAt(plan, second.start - 1e-9, positions);
  for (let i = 0; i < positions.length; i++) near(positions[i], first.end[i], 1e-4);

  // In the hold each drone stays at its height and at its distance from the axis.
  positionsAt(plan, holdStart(plan, 0) + 3, positions);
  let moved = 0;
  for (let i = 0; i < positions.length; i += 3) {
    near(Math.hypot(positions[i], positions[i + 1]), Math.hypot(first.to[i], first.to[i + 1]), 1e-3);
    assert.equal(positions[i + 2], first.to[i + 2]);
    moved = Math.max(moved, Math.hypot(positions[i] - first.to[i], positions[i + 1] - first.to[i + 1]));
  }
  assert.ok(moved > 1, 'the formation turns');
});

test('each stop still has one drone on each target when formations turn', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  const still = createPlanner()(stillState());
  plan.steps.forEach((step, index) => {
    assert.deepEqual(pointSet(step.to), pointSet(still.steps[index].to));
  });
});

test('the speed in a turn is the turn rate times the distance from the axis', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  const step = plan.steps[0];
  const middle = holdStart(plan, 0) + step.hold / 2;
  const rate = (6 * Math.PI) / 180;
  let fastest = 0;
  for (let drone = 0; drone < plan.count; drone++) {
    const radius = Math.hypot(step.to[drone * 3], step.to[drone * 3 + 1]);
    near(speedAt(plan, drone, middle), rate * radius, 1e-6);
    fastest = Math.max(fastest, rate * radius);
    // The turn starts and ends at rest.
    assert.equal(speedAt(plan, drone, holdStart(plan, 0)), 0);
  }
  near(step.turnSpeed, fastest, 1e-6);
  assert.ok(plan.peakSpeed >= step.turnSpeed);
  assert.deepEqual(formationProblems(plan, 0, state.fleet), []);
});

test('a turn that is too fast is a problem', () => {
  const state = defaultState();
  // The 100 m heart, asked to turn at 45 degrees per second. Its tips are 50 m from the axis,
  // so the 4 m/s² limit lets the turn rate grow by 0.08 rad/s each second. In a 10 s hold the
  // turn speeds up for 5 s and then must slow down: the tips reach 0.4 rad/s × 50 m = 20 m/s.
  state.formations[1] = { ...state.formations[1], turnRate: 45 };
  const plan = createPlanner()(state);
  near(plan.steps[1].turnSpeed, 20, 0.01);
  assert.equal(plan.peakSpeed, plan.steps[1].turnSpeed);
  assert.deepEqual(formationProblems(plan, 1, state.fleet), [
    'The turn is faster than the maximum horizontal speed.',
  ]);
});

test('a turn can take a formation out of the flight volume', () => {
  const planner = createPlanner();
  const state = stillState();
  // The heart is flat and 100 m wide. This volume holds it only while it faces the audience.
  state.volume = { size: 120, x: 0, y: 40, z: 0 };
  const facing = planner(state);
  assert.equal(facing.formations[1].outsideVolume, 0);

  state.formations[1] = { ...state.formations[1], turnRate: 9 };
  const turning = planner(state);
  assert.ok(turning.formations[1].outsideVolume > 10, `outside ${turning.formations[1].outsideVolume}`);
  assert.ok(turning.outsideVolume >= turning.formations[1].outsideVolume);
  assert.match(formationProblems(turning, 1, state.fleet).join(), /outside the flight volume/);
});

test('routeOf gives the flight and the arc of one drone for each step', () => {
  const plan = createPlanner()(defaultState());
  const drone = 17;
  const route = routeOf(plan, drone);
  assert.equal(route.length, plan.steps.length);
  plan.steps.forEach((step, index) => {
    const points = route[index];
    assert.deepEqual(points.subarray(0, 3), step.from.subarray(drone * 3, drone * 3 + 3));
    assert.deepEqual(points.subarray(3, 6), step.to.subarray(drone * 3, drone * 3 + 3));
    if (!step.turn) {
      assert.equal(points.length, 6);
      return;
    }
    // The arc ends where the hold ends, and each of its points is a short turn from the last.
    assert.ok(points.length > 6 * 3);
    const last = points.subarray(points.length - 3);
    for (let axis = 0; axis < 3; axis++) near(last[axis], step.end[drone * 3 + axis], 1e-4);
    const radius = Math.hypot(points[3], points[4]);
    for (let i = 6; i < points.length; i += 3) {
      near(Math.hypot(points[i], points[i + 1]), radius, 1e-3);
      assert.equal(points[i + 2], points[5]);
      assert.ok(Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]) <= radius * 0.18);
    }
  });
});

// Light chase.

/** A plan with one step: a hold of 10 s that runs a light chase over the given drones. */
function chasePlan(u, bands, speed) {
  const count = u.length;
  return {
    count,
    steps: [{ start: 0, timing: { duration: 0 }, hold: 10, chase: { u: Float32Array.from(u), bands, speed } }],
  };
}

test('a chase band has a bright head and a dim side ahead of it', () => {
  // One band, 0.1 laps per second. At 5 s the head is at u = 0.5.
  const plan = chasePlan([0.49, 0.51, 0.3], 1, 0.1);
  const light = new Float32Array(3);
  brightnessAt(plan, 5, light);
  assert.ok(light[0] > 0.95, `head ${light[0]}`);
  near(light[1], CHASE_DIM, 0.01);
  // Behind the head, the tail fades.
  assert.ok(light[2] > CHASE_DIM && light[2] < light[0], `tail ${light[2]}`);
  // 0.2 s later the head has moved past u = 0.51.
  brightnessAt(plan, 5.2, light);
  assert.ok(light[1] > 0.95, `head moved ${light[1]}`);
});

test('a negative chase speed moves the bands the other way', () => {
  // At 5 s the head is at u = 0.5, and it moves toward smaller u.
  const plan = chasePlan([0.49, 0.51], 1, -0.1);
  const light = new Float32Array(2);
  brightnessAt(plan, 5, light);
  near(light[0], CHASE_DIM, 0.01);
  assert.ok(light[1] > 0.95, `head ${light[1]}`);
});

test('the chase pattern repeats after the time that one band needs to reach the next', () => {
  const u = Array.from({ length: 50 }, (unused, i) => i / 50);
  const plan = chasePlan(u, 4, 0.5);
  const first = new Float32Array(50);
  const later = new Float32Array(50);
  brightnessAt(plan, 3, first);
  // The bands are 1/4 lap apart and move 0.5 laps per second: the same pattern after 0.5 s.
  brightnessAt(plan, 3.5, later);
  for (let i = 0; i < 50; i++) near(later[i], first[i], 1e-5);
  for (const value of first) assert.ok(value >= CHASE_DIM - 1e-6 && value <= 1 + 1e-6);
});

test('the chase fades in and out at the ends of the hold', () => {
  // A chase that stands still, so that only the fade changes the brightness.
  const plan = chasePlan([0.2, 0.7], 2, 0);
  const light = new Float32Array(2);
  brightnessAt(plan, 0, light);
  assert.deepEqual(Array.from(light), [1, 1]);
  brightnessAt(plan, 10, light);
  assert.deepEqual(Array.from(light), [1, 1]);
  // Half way through the fade, a drone is half way between full and its chase level.
  const full = new Float32Array(2);
  brightnessAt(plan, 0.5, light);
  brightnessAt(plan, 1, full);
  near(light[0], (1 + full[0]) / 2, 0.02);
});

test('lights are at full brightness outside a hold with a chase', () => {
  const plan = createPlanner()(defaultState());
  const light = new Float32Array(plan.count);
  // The sphere has no chase. Its hold and the flights stay at full brightness.
  for (const time of [5, holdStart(plan, 0) + 3, plan.steps[1].start + 2]) {
    brightnessAt(plan, time, light);
    assert.ok(light.every((value) => value === 1), `time ${time}`);
  }
  // The heart runs a chase around its outline.
  brightnessAt(plan, holdStart(plan, 1) + 5, light);
  const dim = light.filter((value) => value < 0.3).length;
  const bright = light.filter((value) => value > 0.8).length;
  assert.ok(dim > 30 && bright > 5, `dim ${dim}, bright ${bright}`);
});

test('the chase path of each pattern runs from 0 to 1 over the formation', () => {
  const state = stillState();
  state.landAtEnd = false;
  for (const chase of ['around', 'rising', 'across']) {
    state.formations[1] = { ...state.formations[1], chase };
    const step = createPlanner()(state).steps[1];
    const { u } = step.chase;
    assert.equal(u.length, 100);
    assert.ok(Math.min(...u) >= 0 && Math.max(...u) < 1 + 1e-6, chase);
    assert.ok(Math.min(...u) < 0.05 && Math.max(...u) > 0.95, chase);
    for (let drone = 0; drone < 100; drone++) {
      const [x, , z] = step.to.subarray(drone * 3, drone * 3 + 3);
      const center = state.formations[1].centerHeight;
      if (chase === 'rising') {
        // The highest drone has the largest value.
        assert.equal(z === Math.max(...Array.from({ length: 100 }, (n, d) => step.to[d * 3 + 2])), u[drone] === Math.max(...u));
      }
      if (chase === 'around' && Math.abs(x) < 1 && z > center) {
        // A drone at the top of the heart is near the start of a lap, or near its end.
        assert.ok(u[drone] < 0.05 || u[drone] > 0.95, `top drone ${u[drone]}`);
      }
    }
  }
  state.formations[1] = { ...state.formations[1], chase: 'off' };
  assert.equal(createPlanner()(state).steps[1].chase, null);
});

test('the chase path follows the drones through the assignment', () => {
  // The same formation gives each target the same path value, whatever drone flies to it.
  const state = stillState();
  const plan = createPlanner()(state);
  const alone = createPlanner()({ ...state, formations: [state.formations[1]], landAtEnd: false });
  const byTarget = (step) => {
    const values = new Map();
    for (let drone = 0; drone < 100; drone++) {
      values.set(pointSet(step.to.subarray(drone * 3, drone * 3 + 3))[0], step.chase.u[drone]);
    }
    return values;
  };
  const inShow = byTarget(plan.steps[1]);
  for (const [target, value] of byTarget(alone.steps[0])) near(inShow.get(target), value, 1e-6);
});

test('a yaw does not change the chase path', () => {
  const state = stillState();
  state.landAtEnd = false;
  const planner = createPlanner();
  const facing = planner(state).steps[1].chase.u;
  state.formations[1] = { ...state.formations[1], yaw: 40 };
  const turned = planner(state).steps[1].chase.u;
  const sorted = (values) => Array.from(values).sort((a, b) => a - b);
  sorted(turned).forEach((value, i) => near(value, sorted(facing)[i], 1e-5));
});

// SVG drawings.

test('the plan uses an SVG drawing as the shape, upright and facing the audience', () => {
  const state = singleState();
  // A wide rectangle with a circle above it.
  const text =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="40" width="100" height="20"/>' +
    '<circle cx="50" cy="15" r="15"/></svg>';
  state.formations[0].source = { type: 'svg', fileName: 'logo.svg', text };
  const plan = createPlanner()(state);
  const targets = plan.steps[0].to;
  const { size, centerHeight } = state.formations[0];
  let highest = -Infinity;
  for (let i = 0; i < targets.length; i += 3) {
    assert.ok(Math.abs(targets[i]) <= size / 2 + 1e-3);
    assert.ok(Math.abs(targets[i + 1]) < 1e-3);
    highest = Math.max(highest, targets[i + 2]);
  }
  // The circle is at the top of the drawing, so the highest targets are at the top of the formation.
  near(highest, centerHeight + size * 0.3, 0.5);
});

test('an SVG drawing with no outlines does not break the planner', () => {
  const planner = createPlanner();
  const state = defaultState();
  const good = planner(state);
  const bad = structuredClone(state);
  bad.formations[0].source = { type: 'svg', fileName: 'empty.svg', text: '<svg></svg>' };
  assert.throws(() => planner(bad), /no outlines/);
  assert.deepEqual(planner(state).steps.at(-1).to, good.steps.at(-1).to);
});
