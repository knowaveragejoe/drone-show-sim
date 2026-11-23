import assert from 'node:assert/strict';
import { test } from 'node:test';

import { closestApproach, placeBody, poseRotation, takeoffGrid } from '../src/motion.js';
import {
  CHASE_DIM,
  FLIGHT_MARGIN,
  MAX_SPREAD,
  brightnessAt,
  countOutside,
  createPlanner,
  fitSize,
  formationProblems,
  hexToRgb,
  holdStart,
  isBelowGround,
  isTooClose,
  lightColorAt,
  lightColorsAt,
  positionsAt,
  retime,
  routeOf,
  speedAt,
  showProblems,
  spreadCandidates,
  spreadFactors,
  spreadLimit,
  spreadOut,
  stepAt,
  volumeBounds,
} from '../src/plan.js';
import { defaultState as projectDefault } from '../src/state.js';

/**
 * The default show with one spacing in all directions and a takeoff straight from the grid.
 * Most tests here are about other things than the vertical spacing and the hover layer, and
 * their numbers come from a spherical spacing and a direct takeoff.
 */
function defaultState() {
  const state = projectDefault();
  state.fleet.minVerticalSpacing = state.fleet.minSpacing;
  state.fleet.hoverHeight = 0;
  return state;
}

/** The default show, but no formation moves in its hold. The fixed tilts stay. */
function stillState() {
  const state = defaultState();
  state.formations = state.formations.map((formation) => ({
    ...formation,
    turnRate: 0,
    swayAngle: 0,
    rockAngle: 0,
    rollAngle: 0,
  }));
  return state;
}

/** Turns points about the vertical axis through the origin, as a check of the planner. */
function turnedAboutZ(points, angle) {
  return placeBody(points, poseRotation(angle, 0, 0), 0);
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

test('the targets of a curve are evenly spaced along it', () => {
  const planner = createPlanner();
  const state = singleState();
  Object.assign(state.formations[0], { source: { type: 'builtin', shape: 'ring' }, size: 50 });
  for (const count of [37, 100, 250]) {
    state.fleet.count = count;
    const plan = planner(state);
    assert.equal(new Set(pointSet(plan.steps[0].to)).size, count);
    // Equal steps around a ring of diameter 50.
    const ideal = 50 * Math.sin(Math.PI / count);
    assert.ok(plan.formations[0].spacing >= ideal * 0.97, `${count}: ${plan.formations[0].spacing / ideal} of ideal`);
  }
});

test('a change of drone count picks evenly spread targets again', () => {
  const planner = createPlanner();
  const state = singleState();
  state.fleet.count = 150;
  const plan = planner(state);
  // 150 drones on a sphere of diameter 40: a flat hexagonal packing would give 6.2 m between
  // neighbors. Farthest point sampling alone gives 4.5 m for the closest pair.
  assert.ok(plan.formations[0].spacing > 5, `spacing ${plan.formations[0].spacing}`);
  assert.deepEqual(pointSet(plan.steps[0].to), pointSet(createPlanner()(state).steps[0].to));
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
  positionsAt(plan, step.duration, positions);
  assert.deepEqual(positions, step.to);
  positionsAt(plan, plan.total, positions);
  assert.deepEqual(positions, step.to);
});

test('the timeline of one formation is the transition plus the hold', () => {
  const state = singleState();
  const plan = createPlanner()(state);
  assert.ok(plan.steps[0].duration > 10);
  assert.equal(plan.total, plan.steps[0].duration + state.formations[0].holdSeconds);
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
    fastest = Math.max(fastest, speedAt(plan, drone, plan.steps[0].duration / 2));
    assert.equal(speedAt(plan, drone, 0), 0);
    assert.equal(speedAt(plan, drone, plan.total), 0);
  }
  near(fastest, plan.peakSpeed, 1e-4);
});

test('slower limits make a longer transition', () => {
  const planner = createPlanner();
  const state = singleState();
  const before = planner(state).steps[0].duration;
  state.fleet.maxClimbSpeed /= 2;
  assert.ok(planner(state).steps[0].duration > before * 1.5);
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
    time += step.duration + step.hold;
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
    // Size and grid spacing changes reuse the assignments. Count changes start warm.
    { ...state, formations: [first, { ...second, size: 140 }, { ...third, size: 30 }] },
    { ...state, fleet: { ...state.fleet, gridSpacing: 5 } },
    { ...state, fleet: { ...state.fleet, count: 97 } },
    { ...state, fleet: { ...state.fleet, count: 103 } },
    { ...state, formations: [first, second, { ...third, yaw: 50 }] },
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
  assert.equal(plan.steps[1].duration, 0);
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

  near(holdStart(plan, 0), takeoff.duration);
  near(holdStart(plan, 1), second.start + second.duration);
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
  positionsAt(plan, step.start + step.duration / 2, positions);
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
  assert.deepEqual(lightColorAt(plan, colors, takeoff.duration / 2), [1, 0, 0]);
  assert.deepEqual(lightColorAt(plan, colors, holdStart(plan, 0) + 1), [1, 0, 0]);
  // Half of the progress of a transition is at half of its time.
  const half = lightColorAt(plan, colors, second.start + second.duration / 2);
  [0.5, 0.5, 0].forEach((channel, i) => near(half[i], channel, 1e-6));
  assert.deepEqual(lightColorAt(plan, colors, holdStart(plan, 1)), [0, 1, 0]);
  assert.deepEqual(lightColorAt(plan, colors, holdStart(plan, 2) + third.hold / 2), [0, 0, 1]);
  // The landing keeps the color of the last formation.
  assert.deepEqual(lightColorAt(plan, colors, landing.start + 5), [0, 0, 1]);
  assert.deepEqual(lightColorAt(plan, colors, plan.total), [0, 0, 1]);
});

test('retime keeps the same moment when the plan changes', () => {
  const step = (start, duration, hold) => ({ start, duration, hold });
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
  assert.match(problems[0], /too close together/);
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
  const { turn } = first.motion;
  // 6 degrees per second for 10 s, less the two ramps.
  assert.ok(turn.angle > 0.95 && turn.angle < (60 * Math.PI) / 180, `angle ${turn.angle}`);
  const turned = turnedAboutZ(first.to, turn.angle);
  for (let i = 0; i < turned.length; i++) near(first.end[i], turned[i], 1e-4);
  assert.deepEqual(second.from, first.end);
  // The heart does not turn. Its rock ends where it started.
  assert.equal(second.motion.turn, null);
  assert.equal(second.end, second.to);

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

test('each stop still has one drone on each target when formations move', () => {
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
  const { motion } = plan.formations[0];
  near(motion.horizontalSpeed, fastest, 1e-4);
  near(motion.speed, fastest, 1e-4);
  assert.ok(motion.climbSpeed < 1e-6 && motion.descentSpeed < 1e-6);
  // The ramps keep the farthest drone at the acceleration limit, centripetal part included.
  assert.ok(motion.acceleration <= state.fleet.maxAcceleration * 1.001, `acceleration ${motion.acceleration}`);
  assert.ok(motion.acceleration >= state.fleet.maxAcceleration * 0.98, `acceleration ${motion.acceleration}`);
  assert.ok(plan.peakSpeed >= motion.speed);
  assert.deepEqual(formationProblems(plan, 0, state.fleet), []);
});

test('a turn that is too fast is a problem', () => {
  const state = defaultState();
  // The 100 m heart, asked to turn at 45 degrees per second. Its tips are 50 m from the axis,
  // so the 4 m/s² limit lets the turn rate grow by 0.08 rad/s each second. In a 10 s hold the
  // turn speeds up for 5 s and then must slow down: the tips reach 0.4 rad/s × 50 m = 20 m/s.
  // At that rate the centripetal acceleration alone is 0.4² × 50 = 8 m/s².
  state.formations[1] = { ...state.formations[1], turnRate: 45, rockAngle: 0 };
  const plan = createPlanner()(state);
  const { motion } = plan.formations[1];
  near(motion.horizontalSpeed, 20, 0.01);
  assert.ok(motion.acceleration > 8);
  near(plan.peakSpeed, motion.speed, 1e-9);
  assert.deepEqual(formationProblems(plan, 1, state.fleet), [
    'The motion in the hold is faster than the maximum horizontal speed.',
    'The motion in the hold accelerates more than the maximum acceleration.',
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

test('routeOf gives the flight and the path in the hold of one drone for each step', () => {
  const plan = createPlanner()(defaultState());
  const drone = 17;
  const route = routeOf(plan, drone);
  assert.equal(route.length, plan.steps.length);
  plan.steps.forEach((step, index) => {
    const points = route[index];
    assert.deepEqual(points.subarray(0, 3), step.from.subarray(drone * 3, drone * 3 + 3));
    assert.deepEqual(points.subarray(3, 6), step.to.subarray(drone * 3, drone * 3 + 3));
    if (!step.motion) {
      assert.equal(points.length, 6);
      return;
    }
    // The path ends where the hold ends. Each point is a short move from the last: the pose
    // changes by at most 10 degrees.
    assert.ok(points.length > 6 * 3);
    const last = points.subarray(points.length - 3);
    for (let axis = 0; axis < 3; axis++) near(last[axis], step.end[drone * 3 + axis], 1e-4);
    const reach = Math.hypot(points[3], points[4], points[5] - step.centerHeight);
    for (let i = 6; i < points.length; i += 3) {
      near(Math.hypot(points[i], points[i + 1], points[i + 2] - step.centerHeight), reach, 1e-3);
      assert.ok(Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]) <= reach * 0.18);
    }
  });
});

// Light chase.

/** A plan with one step: a hold of 10 s that runs a light chase over the given drones. */
function chasePlan(u, bands, speed) {
  const count = u.length;
  return {
    count,
    steps: [{ start: 0, duration: 0, hold: 10, chase: { u: Float32Array.from(u), bands, speed } }],
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

test('a change of formation size, formation height, or grid spacing keeps every pair', () => {
  // A turn's angle depends on the radius of the formation, so this test uses formations
  // that do not turn.
  const planner = createPlanner();
  const state = stillState();
  const before = planner(state);
  const changes = [
    { ...state, formations: state.formations.map((formation) => ({ ...formation, size: formation.size * 1.6 })) },
    { ...state, formations: state.formations.map((formation) => ({ ...formation, centerHeight: 90 })) },
    { ...state, fleet: { ...state.fleet, gridSpacing: 4.5 } },
  ];
  for (const changed of changes) {
    const plan = planner(changed);
    const fresh = createPlanner()(changed);
    plan.steps.forEach((step, index) => assert.deepEqual(step.to, fresh.steps[index].to));
  }
  // Each drone flies to the same target as before, at its new place: a size change scales
  // each target about the formation center.
  const bigger = planner(changes[0]);
  const center = state.formations[1].centerHeight;
  const earlier = before.steps[1].to;
  const later = bigger.steps[1].to;
  for (let i = 0; i < earlier.length; i += 3) {
    near(later[i], earlier[i] * 1.6, 1e-3);
    near(later[i + 2] - center, (earlier[i + 2] - center) * 1.6, 1e-3);
  }
});

// Spread out to pass.

/**
 * The default show with still formations, each at the smallest size that keeps the plain
 * minimum spacing. Direct flights between these formations bring drones too close.
 * @param {ReturnType<typeof createPlanner>} planner
 */
function tightState(planner) {
  const state = stillState();
  const plan = planner(state);
  const { minSpacing } = state.fleet;
  state.formations = state.formations.map((formation, index) => ({
    ...formation,
    size: fitSize(formation.size, plan.formations[index].spacing, minSpacing, 1),
  }));
  return state;
}

test('spreadFactors grows both ends evenly when both are tight', () => {
  const [leave, arrive] = spreadFactors(2, 2, true, true, 2);
  near(leave, Math.SQRT2 * 1.01);
  near(arrive, Math.SQRT2 * 1.01);
});

test('spreadFactors only grows the formation when the other end is the takeoff grid', () => {
  // Takeoff: the grid has 3 m spacing. The formation needs B with 1/3² + 1/B² = 1/2.02².
  const needs = 1 / Math.sqrt(1 / 2.02 ** 2 - 1 / 9);
  const [grid, formation] = spreadFactors(3, 2, false, true, 2);
  assert.equal(grid, 1);
  near(formation, needs / 2);
  // Landing: the same, the other way.
  const [leave, land] = spreadFactors(2, 3, true, false, 2);
  near(leave, needs / 2);
  assert.equal(land, 1);
});

test('spreadFactors leaves a wide end as it is, and grows the other end only as far as needed', () => {
  const [leave, arrive] = spreadFactors(10, 2, true, true, 2);
  assert.equal(leave, 1);
  const spacing = 2 * arrive;
  // The bound of the cross is just above the minimum spacing.
  near((10 * spacing) / Math.hypot(10, spacing), 2.02, 1e-9);
  // No end needs to grow when both ends are wide already.
  assert.deepEqual(spreadFactors(5, 5, true, true, 2), [1, 1]);
});

test('spreadFactors stops at the largest spread', () => {
  // A takeoff grid at the minimum spacing gives no safe spacing at any size.
  assert.deepEqual(spreadFactors(2, 2, false, true, 2), [1, MAX_SPREAD]);
  // A formation with targets almost on top of each other.
  assert.deepEqual(spreadFactors(0.1, 0.1, true, true, 2), [MAX_SPREAD, MAX_SPREAD]);
  // One drone: no spacing, and nothing to grow.
  assert.deepEqual(spreadFactors(Infinity, Infinity, true, true, 2), [1, 1]);
});

test('spreadCandidates grows two formations by the same factor, just enough', () => {
  // A crossing whose closest approach grows in proportion to the factors.
  const crossApproach = (leave, arrive) => 1.8 * Math.min(leave, arrive);
  const spreads = spreadCandidates(crossApproach, 1.8, 2, 2, true, true, 2);
  const [even] = spreads;
  near(even.leave, 2.02 / 1.8);
  near(even.arrive, 2.02 / 1.8);
  near(even.approach, 2);
  // The spread of the bound is in the list too, and it is larger.
  assert.equal(spreads.length, 2);
  assert.ok(spreads[1].leave > even.leave);
  for (const spread of spreads) assert.ok(!isTooClose(spread.approach, 2));
});

test('spreadCandidates searches the smallest spread of a takeoff and of a landing', () => {
  let calls = 0;
  // Safe from a factor of 1.3 on.
  const growing = (factor) => {
    calls++;
    return factor >= 1.3 ? 2.1 : 1.5;
  };
  const [takeoff] = spreadCandidates((leave, arrive) => growing(arrive), 1.5, 3, 2, false, true, 2);
  assert.equal(takeoff.leave, 1);
  assert.ok(takeoff.arrive >= 1.3 && takeoff.arrive < 1.3 + 0.01, `factor ${takeoff.arrive}`);
  assert.ok(calls < 15, `${calls} checks`);
  const [landing] = spreadCandidates((leave) => growing(leave), 1.5, 2, 3, true, false, 2);
  assert.equal(landing.arrive, 1);
  assert.ok(landing.leave >= 1.3 && landing.leave < 1.31);
});

test('spreadCandidates lists no spread that a check does not pass', () => {
  // The crossing never gets safe.
  assert.deepEqual(spreadCandidates(() => 1, 1, 2, 2, true, true, 2), []);
  assert.deepEqual(spreadCandidates(() => 1, 1, 3, 2, false, true, 2), []);
  // A stop has crowded points: 1 m apart. The crossing starts there, so it is no wider than
  // that unless the stop grows, and the leg that grows it starts crowded too.
  assert.deepEqual(spreadCandidates((leave) => Math.min(5, leave), 1, 1, 2, true, true, 2), []);
});

test('spreadCandidates with room lists only spreads that fit in it', () => {
  // Either stop alone makes the crossing safe when it grows enough.
  const crossApproach = (leave, arrive) => 1.8 * Math.max(leave, arrive);
  const room = [1.05, 3];
  const spreads = spreadCandidates(crossApproach, 1.8, 2, 2, true, true, 2, room);
  assert.ok(spreads.length > 0);
  for (const spread of spreads) {
    assert.ok(spread.leave <= room[0] && spread.arrive <= room[1], `${spread.leave}, ${spread.arrive}`);
    assert.ok(!isTooClose(spread.approach, 2));
  }
  // Without room, the even spread grows the first stop past its room.
  const [even] = spreadCandidates(crossApproach, 1.8, 2, 2, true, true, 2);
  assert.ok(even.leave > room[0]);
});

test('spreadLimit is the largest spread that keeps a fleet inside the flight volume', () => {
  const bounds = { low: [-50, -50, 0], high: [50, 50, 100] };
  // Across, the room is 50 ÷ 20 = 2.5 and 50 ÷ 25 = 2. Up and down, it is 100 ÷ 40 = 2.5.
  const positions = new Float32Array([20, 0, 30, -10, 25, 70]);
  near(spreadLimit(positions, 2, bounds), 2);
  const spread = spreadOut(positions, 2, 2, bounds);
  for (let i = 0; i < spread.length; i++) {
    assert.ok(spread[i] >= bounds.low[i % 3] - 1e-4 && spread[i] <= bounds.high[i % 3] + 1e-4);
  }
  // A fleet that is outside already cannot grow.
  assert.equal(spreadLimit(new Float32Array([60, 0, 10]), 1, bounds), 1);
});

test('spreadOut grows the fleet about the middle of the axis', () => {
  const tall = { low: [-500, -500, 0], high: [500, 500, 500] };
  const positions = new Float32Array([0, 0, 50, 4, -2, 60, -3, 1, 55]);
  const spread = spreadOut(positions, 3, 2, tall);
  assert.deepEqual(Array.from(spread), [0, 0, 45, 8, -4, 65, -6, 2, 55]);
  // Distances grow by the factor.
  const distance = (points, a, b) =>
    Math.hypot(points[a * 3] - points[b * 3], points[a * 3 + 1] - points[b * 3 + 1], points[a * 3 + 2] - points[b * 3 + 2]);
  near(distance(spread, 1, 2), 2 * distance(positions, 1, 2), 1e-5);
  assert.deepEqual(spreadOut(positions, 3, 1, tall), positions);
});

test('spreadOut keeps the fleet between the floor and the top of the flight volume', () => {
  const positions = new Float32Array([0, 0, 20, 0, 0, 40]);
  const heights = (floor, top) => {
    const spread = spreadOut(positions, 2, 2, { low: [0, 0, floor], high: [0, 0, top] });
    return [spread[2], spread[5]];
  };
  // Room for an even spread.
  assert.deepEqual(heights(0, 100), [10, 50]);
  // A high floor moves the spread up, and a low top moves it down.
  assert.deepEqual(heights(15, 100), [15, 55]);
  assert.deepEqual(heights(0, 48), [8, 48]);
  // No room: the floor wins.
  assert.deepEqual(heights(15, 48), [15, 55]);
  // A drone below the floor does not go lower.
  assert.deepEqual(heights(25, 100), [20, 60]);
});

// The vertical spacing.

/**
 * Smallest distance between two points when heights count times a factor: the distance
 * that the spacing checks compare with the minimum spacing.
 */
function heightScaledSpacing(points, factor) {
  let smallest = Infinity;
  for (let i = 0; i < points.length; i += 3) {
    for (let j = i + 3; j < points.length; j += 3) {
      const dz = (points[i + 2] - points[j + 2]) * factor;
      smallest = Math.min(smallest, Math.hypot(points[i] - points[j], points[i + 1] - points[j + 1], dz));
    }
  }
  return smallest;
}

/** A copy of points with each height times a factor. */
function heightScaled(points, factor) {
  return points.map((value, i) => (i % 3 === 2 ? value * factor : value));
}

test('with a vertical spacing, a drone above another needs more room than one beside it', () => {
  const state = singleState();
  // An upright ring has drones above one another at its sides.
  state.formations[0] = { ...state.formations[0], source: { type: 'builtin', shape: 'ring' }, size: 80 };
  const planner = createPlanner();
  const round = planner(state).formations[0].spacing;
  state.fleet.minVerticalSpacing = 3;
  const plan = planner(state);
  const { spacing } = plan.formations[0];
  near(spacing, heightScaledSpacing(plan.steps[0].to, 2 / 3), 1e-4);
  assert.ok(spacing < round * 0.8, `${spacing} against ${round}`);
  // Fit grows the ring more, until the drones above one another have the vertical spacing.
  const fitted = fitSize(80, spacing, 2, 1);
  const roundFit = fitSize(80, round, 2, 1);
  assert.ok(fitted > roundFit * 1.25, `fit ${fitted} against ${roundFit}`);
});

test('a vertical spacing does not change a formation that lies flat', () => {
  const state = singleState();
  state.formations[0] = { ...state.formations[0], source: { type: 'builtin', shape: 'disc' }, size: 60, tiltForward: 90 };
  const planner = createPlanner();
  const round = planner(state).formations[0].spacing;
  state.fleet.minVerticalSpacing = 4;
  near(planner(state).formations[0].spacing, round, 1e-3);
});

test('with a vertical spacing, the spacing of a hold looks at the poses of a rock', () => {
  const state = singleState();
  state.fleet.minVerticalSpacing = 4;
  // A disc that lies flat has no height differences. A rock tips it, and then it has some.
  state.formations[0] = { ...state.formations[0], source: { type: 'builtin', shape: 'disc' }, size: 60, tiltForward: 90 };
  const planner = createPlanner();
  const still = planner(state).formations[0].spacing;
  state.formations[0] = { ...state.formations[0], rockAngle: 30, rockSeconds: 10, holdSeconds: 10 };
  const rocking = planner(state).formations[0].spacing;
  assert.ok(rocking < still * 0.99, `${rocking} against ${still}`);
  // The axis of the flat disc lies on its side, so a turn about it stands the disc up.
  state.formations[0] = { ...state.formations[0], rockAngle: 0, turnRate: 10 };
  assert.ok(planner(state).formations[0].spacing < still * 0.6);
  // A formation that stands upright turns about the vertical axis. That changes no height
  // difference, so it changes nothing.
  const upright = { ...state.formations[0], source: { type: 'builtin', shape: 'ring' }, tiltForward: 0, turnRate: 0 };
  state.formations[0] = upright;
  const ring = planner(state).formations[0].spacing;
  state.formations[0] = { ...upright, turnRate: 10 };
  near(planner(state).formations[0].spacing, ring, 1e-4);
});

test('with a vertical spacing, the closest approach and the spread count heights the same way', () => {
  const planner = createPlanner();
  const state = tightState(planner);
  state.fleet.minVerticalSpacing = 3;
  // Make the formations fit the vertical spacing, so a spread can make each flight safe.
  const loose = planner(state);
  state.formations = state.formations.map((formation, index) => ({
    ...formation,
    size: fitSize(formation.size, loose.formations[index].spacing, 2, 1),
    centerHeight: 70,
  }));
  state.volume = { ...state.volume, size: 200 };
  const plan = planner(state);
  const factor = 2 / 3;
  for (const step of plan.steps) {
    const legApproaches = step.legs.map((leg) =>
      closestApproach(heightScaled(leg.from, factor), heightScaled(leg.to, factor), plan.count),
    );
    near(Math.min(...legApproaches), step.closestApproach, 1e-3);
    assert.ok(!isTooClose(step.closestApproach, 2), `step ${step.formation}: ${step.closestApproach}`);
  }
  assert.deepEqual(showProblems(state, plan), []);
});

// The hover layer and the rows of the takeoff grid.

/** The default show with one spacing in all directions, a 10 m hover layer, and 0.5 s per row. */
function hoverState() {
  const state = projectDefault();
  state.fleet.minVerticalSpacing = state.fleet.minSpacing;
  state.fleet.hoverHeight = 10;
  state.fleet.rowDelay = 0.5;
  return state;
}

test('the rows lift off straight up to the hover layer, one after another', () => {
  const plan = createPlanner()(hoverState());
  const { count } = plan;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const [lift] = plan.steps[0].legs;
  for (let drone = 0; drone < count; drone++) {
    const o = drone * 3;
    assert.equal(lift.to[o], lift.from[o]);
    assert.equal(lift.to[o + 1], lift.from[o + 1]);
    assert.equal(lift.from[o + 2], 0);
    near(lift.to[o + 2], 10, 1e-5);
    near(lift.delays[drone], Math.floor(drone / columns) * 0.5);
  }
  near(lift.duration, lift.timing.duration + (rows - 1) * 0.5);
  // Row 0 is the row nearest the audience, which stands toward negative y.
  assert.ok(lift.from[1] < lift.from[(count - 1) * 3 + 1]);
  // Halfway through the lift-off, the first row is higher than the last one.
  const positions = new Float32Array(count * 3);
  positionsAt(plan, lift.duration / 2, positions);
  assert.ok(positions[2] > positions[(count - 1) * 3 + 2]);
  // A drone of the last row waits on the ground at first.
  assert.equal(speedAt(plan, count - 1, 0.2), 0);
  assert.ok(speedAt(plan, 0, 0.2) > 0);
  // After the lift-off, the fleet flies on from the hover layer.
  assert.equal(plan.steps[0].legs[1].from, lift.to);
});

test('the fleet lands on the takeoff grid in rows, straight down from the hover layer', () => {
  const plan = createPlanner()(hoverState());
  const landing = plan.steps.at(-1);
  const touchdown = landing.legs.at(-1);
  assert.ok(touchdown.delays);
  assert.deepEqual(pointSet(landing.to), pointSet(takeoffGrid(plan.count, 3)));
  for (let drone = 0; drone < plan.count; drone++) {
    const o = drone * 3;
    assert.equal(touchdown.to[o], touchdown.from[o]);
    near(touchdown.from[o + 2], 10, 1e-5);
  }
  // The row nearest the audience lands first.
  const front = Math.min(...Array.from({ length: plan.count }, (unused, drone) => touchdown.to[drone * 3 + 1]));
  for (let drone = 0; drone < plan.count; drone++) {
    if (touchdown.to[drone * 3 + 1] === front) assert.equal(touchdown.delays[drone], 0);
    else assert.ok(touchdown.delays[drone] > 0);
  }
  const positions = new Float32Array(plan.count * 3);
  positionsAt(plan, plan.total, positions);
  assert.deepEqual(positions, landing.to);
});

test('the rows keep the grid spacing in the lift-off and in the touchdown', () => {
  const state = hoverState();
  state.fleet.minVerticalSpacing = 3;
  const plan = createPlanner()(state);
  const positions = new Float32Array(plan.count * 3);
  for (const step of [plan.steps[0], plan.steps.at(-1)]) {
    const leg = step === plan.steps[0] ? step.legs[0] : step.legs.at(-1);
    let smallest = Infinity;
    for (let k = 0; k <= 40; k++) {
      positionsAt(plan, step.start + leg.start + (k / 40) * leg.duration, positions);
      smallest = Math.min(smallest, heightScaledSpacing(positions, 2 / 3));
    }
    near(smallest, state.fleet.gridSpacing, 1e-4);
    assert.ok(step.closestApproach <= state.fleet.gridSpacing);
  }
});

test('the hover layer can spread, so a takeoff to a large formation fits in the flight volume', () => {
  const planner = createPlanner();
  const state = hoverState();
  state.formations = [{ ...state.formations[0], source: { type: 'builtin', shape: 'ring' }, turnRate: 0, size: 66, centerHeight: 45 }];
  state.volume = { ...state.volume, size: 80 };
  state.fleet.hoverHeight = 0;
  const ground = planner(state);
  assert.ok(ground.steps.every((step) => step.spreadOutside > 0));
  state.fleet.hoverHeight = 10;
  const plan = planner(state);
  // Lift-off, spread of the hover layer, crossing, close-up; and the same back for the landing.
  assert.deepEqual(plan.steps.map((step) => step.legs.length), [4, 4]);
  assert.deepEqual(plan.steps.map((step) => step.spreadOutside), [0, 0]);
  assert.deepEqual(showProblems(state, plan), []);
});

test('a hover layer outside the flight volume is a problem', () => {
  const state = hoverState();
  state.volume = { ...state.volume, z: 20 };
  const plan = createPlanner()(state);
  assert.equal(plan.hoverOutsideVolume, plan.count);
  assert.ok(showProblems(state, plan).includes('The hover layer is outside the flight volume.'));
});

test('a direct flight that is safe has one leg', () => {
  const plan = createPlanner()(defaultState());
  for (const step of plan.steps) {
    assert.equal(step.legs.length, 1);
    assert.equal(step.cross, 0);
    assert.equal(step.spreadOutside, 0);
    assert.equal(step.legs[0].from, step.from);
    assert.equal(step.legs[0].to, step.to);
    assert.equal(step.legs[0].start, 0);
    assert.equal(step.duration, step.legs[0].timing.duration);
  }
});

test('the fleet spreads out to pass, and keeps the minimum spacing in every leg', () => {
  const planner = createPlanner();
  const state = tightState(planner);
  const { count, minSpacing } = state.fleet;
  state.spreadToPass = false;
  const direct = planner(state);
  assert.ok(isTooClose(direct.closestApproach, minSpacing), `direct ${direct.closestApproach}`);

  state.spreadToPass = true;
  const plan = planner(state);
  assert.ok(!isTooClose(plan.closestApproach, minSpacing), `spread ${plan.closestApproach}`);
  // Takeoff and landing spread the formation only. Between two formations both ends spread.
  assert.deepEqual(plan.steps.map((step) => step.legs.length), [2, 3, 3, 2]);
  assert.deepEqual(plan.steps.map((step) => step.cross), [0, 1, 1, 1]);
  for (const step of plan.steps) {
    // The planner finds the closest approach of a spread leg without a search. Check it.
    const legApproaches = step.legs.map((leg) => closestApproach(leg.from, leg.to, count));
    near(Math.min(...legApproaches), step.closestApproach, 1e-4);
    assert.ok(!isTooClose(step.closestApproach, minSpacing));
  }
  for (const index of [0, 1, 2]) assert.deepEqual(formationProblems(plan, index, state.fleet), []);
  // The spread costs time.
  assert.ok(plan.total > direct.total);
  // The formations grow just enough: between two formations, the crossing comes within a
  // percent or two of the minimum spacing, far below the bound of the old spread.
  for (const step of plan.steps.slice(1, 3)) {
    const cross = step.legs[step.cross];
    const crossApproach = closestApproach(cross.from, cross.to, count);
    assert.ok(crossApproach < minSpacing * 1.03, `crossing ${crossApproach}`);
  }
});

test('the legs of a transition join end to end, and the drones stay above the ground', () => {
  const planner = createPlanner();
  const plan = planner(tightState(planner));
  const positions = new Float32Array(plan.count * 3);
  for (const step of plan.steps) {
    const { legs } = step;
    assert.equal(legs[0].from, step.from);
    assert.equal(legs.at(-1).to, step.to);
    let start = 0;
    legs.forEach((leg, index) => {
      if (index > 0) assert.equal(leg.from, legs[index - 1].to);
      near(leg.start, start);
      start += leg.timing.duration;
      // At the end of each leg, the drones are at its end.
      positionsAt(plan, step.start + leg.start + leg.timing.duration - 1e-9, positions);
      for (let i = 0; i < positions.length; i++) near(positions[i], leg.to[i], 1e-3);
    });
    near(step.duration, start);

    // The default flight volume stands on the ground.
    const lowest = (points) => Math.min(...points.filter((value, i) => i % 3 === 2));
    for (const leg of legs) assert.ok(lowest(leg.to) >= -1e-4);
  }
});

test('the speed in a spread leg stays inside the limits', () => {
  const planner = createPlanner();
  const state = tightState(planner);
  const plan = planner(state);
  const step = plan.steps[1];
  let fastest = 0;
  for (const leg of step.legs) {
    for (let drone = 0; drone < plan.count; drone += 3) {
      fastest = Math.max(fastest, speedAt(plan, drone, step.start + leg.start + leg.timing.duration / 2));
    }
  }
  assert.ok(fastest > 0);
  assert.ok(fastest <= step.peakSpeed + 1e-9);
  // No drone is faster than the limits allow: horizontal plus vertical, at most.
  const { maxHorizontalSpeed, maxClimbSpeed } = state.fleet;
  assert.ok(step.peakSpeed <= Math.hypot(maxHorizontalSpeed, maxClimbSpeed) + 1e-6);
});

test('the light color changes only in the leg that crosses', () => {
  const planner = createPlanner();
  const plan = planner(tightState(planner));
  const colors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const step = plan.steps[1];
  const [out, cross, closeUp] = step.legs;
  const at = (leg, share) => lightColorAt(plan, colors, step.start + leg.start + share * leg.timing.duration);
  assert.deepEqual(at(out, 0.5), [1, 0, 0]);
  const half = at(cross, 0.5);
  [0.5, 0.5, 0].forEach((channel, i) => near(half[i], channel));
  assert.deepEqual(at(closeUp, 0.5), [0, 1, 0]);
});

test('routeOf passes each corner of a spread flight', () => {
  const planner = createPlanner();
  const plan = planner(tightState(planner));
  const drone = 11;
  routeOf(plan, drone).forEach((points, index) => {
    const { legs } = plan.steps[index];
    assert.equal(points.length, (legs.length + 1) * 3);
    assert.deepEqual(points.subarray(0, 3), legs[0].from.subarray(drone * 3, drone * 3 + 3));
    legs.forEach((leg, corner) => {
      assert.deepEqual(points.subarray((corner + 1) * 3, (corner + 2) * 3), leg.to.subarray(drone * 3, drone * 3 + 3));
    });
  });
});

test('a spread that does not make the flight safe is not used', () => {
  // Crowded targets: the spread would close up to targets that are too close together.
  const state = singleState();
  state.formations[0].size = 5;
  const plan = createPlanner()(state);
  assert.ok(isTooClose(plan.closestApproach, state.fleet.minSpacing));
  assert.equal(plan.steps[0].legs.length, 1);
  // A takeoff grid at the minimum spacing: no spread of the formation is sufficient.
  const grid = singleState();
  grid.fleet.gridSpacing = grid.fleet.minSpacing;
  grid.fleet.count = 400;
  grid.formations[0].size = 15;
  const tight = createPlanner()(grid);
  assert.ok(isTooClose(tight.steps[0].closestApproach, grid.fleet.minSpacing));
  assert.equal(tight.steps[0].legs.length, 1);
});

test('a spread that leaves the flight volume is a problem', () => {
  const planner = createPlanner();
  const state = tightState(planner);
  // The heart fits, but it is too wide when it spreads out, even by the little that it needs.
  state.formations = state.formations.map((formation) => ({ ...formation, centerHeight: 34 }));
  state.volume = { ...state.volume, size: 66 };
  const plan = planner(state);
  assert.deepEqual(plan.formations.map((checks) => checks.outsideVolume), [0, 0, 0]);
  assert.deepEqual(plan.steps.map((step) => step.spreadOutside > 0), [false, true, true, false]);
  // The plan counts each drone that leaves the volume one time, in whichever spread it leaves.
  const [, first, second] = plan.steps.map((step) => step.spreadOutside);
  assert.ok(plan.outsideVolume >= Math.max(first, second) && plan.outsideVolume <= first + second);
  assert.deepEqual(formationProblems(plan, 1, state.fleet), [
    'Drones leave the flight volume when they spread out to pass.',
  ]);
});

test('a spread that fits in the flight volume wins over a faster one that leaves it', () => {
  const planner = createPlanner();
  const state = tightState(planner);
  // The heart nearly fills the volume. Grown evenly with the formation before or after it,
  // it would leave the volume.
  state.formations = state.formations.map((formation) => ({ ...formation, centerHeight: 34 }));
  state.volume = { ...state.volume, size: 70 };
  const plan = planner(state);
  assert.deepEqual(plan.steps.map((step) => step.legs.length), [2, 3, 3, 2]);
  assert.deepEqual(plan.steps.map((step) => step.spreadOutside), [0, 0, 0, 0]);
  assert.equal(plan.outsideVolume, 0);
  assert.deepEqual(showProblems(state, plan), []);
});

test('Fit with a margin of 1 gives the plain minimum spacing', () => {
  assert.equal(fitSize(40, 4, 2, 1), 20);
  assert.equal(fitSize(40, 4, 2), Math.ceil(20 * FLIGHT_MARGIN * 100) / 100);
});

// Colors.

/** The color of one drone, as a list. */
const colorOf = (colors, drone) => Array.from(colors.subarray(drone * 3, drone * 3 + 3));

/** True when two colors are the same, up to 32-bit rounding. */
function sameColor(actual, expected) {
  expected.forEach((channel, i) => near(actual[i], channel, 1e-6));
}

test('a solid formation gives every drone the formation color', () => {
  const state = defaultState();
  const plan = createPlanner()(state);
  const first = hexToRgb(state.formations[0].color);
  for (let drone = 0; drone < plan.count; drone++) sameColor(colorOf(plan.steps[0].colors, drone), first);
});

test('a gradient blends from the formation color to the second color along its path', () => {
  const planner = createPlanner();
  const state = singleState();
  const formation = state.formations[0];
  Object.assign(formation, { color: '#ff0000', secondColor: '#0000ff', yaw: 40 });
  const first = hexToRgb('#ff0000');
  const second = hexToRgb('#0000ff');
  const yaw = (40 * Math.PI) / 180;
  const paths = {
    // Height above the formation center.
    rising: (x, y, z) => z,
    // Side position in the axes of the formation, before its yaw.
    across: (x, y) => x * Math.cos(yaw) + y * Math.sin(yaw),
    // Distance from the formation center.
    outward: (x, y, z) => Math.hypot(x, y, z),
  };
  formation.source = { type: 'builtin', shape: 'torus' };
  for (const [pattern, path] of Object.entries(paths)) {
    formation.colorPattern = pattern;
    const step = planner(state).steps[0];
    const values = [];
    for (let drone = 0; drone < state.fleet.count; drone++) {
      const o = drone * 3;
      values.push(path(step.to[o], step.to[o + 1], step.to[o + 2] - formation.centerHeight));
    }
    const low = Math.min(...values);
    const high = Math.max(...values);
    values.forEach((value, drone) => {
      const share = (value - low) / (high - low);
      sameColor(
        colorOf(step.colors, drone),
        first.map((channel, i) => channel + share * (second[i] - channel)),
      );
    });
  }
});

test('an outward gradient on a sphere has the formation color only', () => {
  // Every target of a sphere is at the same distance from its center.
  const state = singleState();
  Object.assign(state.formations[0], { colorPattern: 'outward', color: '#ff0000', secondColor: '#0000ff' });
  const plan = createPlanner()(state);
  for (let drone = 0; drone < plan.count; drone++) sameColor(colorOf(plan.steps[0].colors, drone), [1, 0, 0]);
});

test('drawing colors come from the outlines of an SVG drawing, at full brightness', () => {
  const text =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<line x1="0" y1="0" x2="100" y2="0" stroke="#800000"/>' +
    '<line x1="0" y1="40" x2="100" y2="40" style="fill: #00ff00"/>' +
    '<line x1="0" y1="80" x2="100" y2="80" stroke="#333333"/>' +
    '<line x1="0" y1="120" x2="100" y2="120"/>' +
    '</svg>';
  const state = singleState();
  Object.assign(state.formations[0], {
    source: { type: 'svg', fileName: 'lines.svg', text },
    colorPattern: 'drawing',
    color: '#0000ff',
    size: 100,
  });
  const planner = createPlanner();
  const step = planner(state).steps[0];
  // The four lines from the top down: dark red, green, dark gray, and no color.
  const expected = [[1, 0, 0], [0, 1, 0], [1, 1, 1], [0, 0, 1]];
  const seen = new Set();
  for (let drone = 0; drone < state.fleet.count; drone++) {
    const z = step.to[drone * 3 + 2] - state.formations[0].centerHeight;
    // The drawing is 120 high, so at size 100 the lines are at heights 50, 16.7, -16.7, and -50.
    const line = Math.round((50 - z) / (100 / 3));
    seen.add(line);
    sameColor(colorOf(step.colors, drone), expected[line]);
  }
  assert.equal(seen.size, 4);

  // The same drawing as a solid formation, and a built-in shape with drawing colors.
  state.formations[0].colorPattern = 'solid';
  const solid = planner(state).steps[0];
  for (let drone = 0; drone < state.fleet.count; drone++) sameColor(colorOf(solid.colors, drone), [0, 0, 1]);
  Object.assign(state.formations[0], { source: { type: 'builtin', shape: 'heart' }, colorPattern: 'drawing' });
  const builtin = planner(state).steps[0];
  for (let drone = 0; drone < state.fleet.count; drone++) sameColor(colorOf(builtin.colors, drone), [0, 0, 1]);
});

test('each drone blends from its old color to its new color in the leg that crosses', () => {
  const planner = createPlanner();
  const state = defaultState();
  state.formations[0] = { ...state.formations[0], colorPattern: 'rising', color: '#ff0000', secondColor: '#00ff00' };
  const plan = planner(state);
  const out = new Float32Array(plan.count * 3);
  const [takeoff, second, , landing] = plan.steps;

  // Takeoff shows the colors of the first formation.
  lightColorsAt(plan, 0, out);
  assert.deepEqual(out, takeoff.colors);
  lightColorsAt(plan, holdStart(plan, 0) + 1, out);
  assert.deepEqual(out, takeoff.colors);

  // In the middle of the next transition, each drone is half way between its two colors.
  lightColorsAt(plan, second.start + second.duration / 2, out);
  for (let i = 0; i < out.length; i++) near(out[i], (takeoff.colors[i] + second.colors[i]) / 2, 1e-6);
  lightColorsAt(plan, holdStart(plan, 1), out);
  assert.deepEqual(out, second.colors);

  // The landing keeps the colors of the last formation.
  assert.equal(landing.colors, plan.steps[2].colors);
  lightColorsAt(plan, plan.total, out);
  assert.deepEqual(out, plan.steps[2].colors);
});

test('the colors stay with the drones through a spread', () => {
  const planner = createPlanner();
  const state = tightState(planner);
  state.formations[1] = { ...state.formations[1], colorPattern: 'across', secondColor: '#00ff00' };
  const plan = planner(state);
  const step = plan.steps[1];
  assert.equal(step.legs.length, 3);
  const before = plan.steps[0].colors;
  const out = new Float32Array(plan.count * 3);
  const [out1, cross, closeUp] = step.legs;
  lightColorsAt(plan, step.start + out1.start + out1.timing.duration / 2, out);
  assert.deepEqual(out, before);
  lightColorsAt(plan, step.start + cross.start + cross.timing.duration / 2, out);
  for (let i = 0; i < out.length; i++) near(out[i], (before[i] + step.colors[i]) / 2, 1e-6);
  lightColorsAt(plan, step.start + closeUp.start + closeUp.timing.duration / 2, out);
  assert.deepEqual(out, step.colors);
});

// Tilt, sway, rock, and roll.

/** True when each point of one list is near some point of the other list. */
function sameSet(actual, expected, tolerance) {
  for (let i = 0; i < actual.length; i += 3) {
    let best = Infinity;
    for (let j = 0; j < expected.length; j += 3) {
      best = Math.min(best, Math.hypot(actual[i] - expected[j], actual[i + 1] - expected[j + 1], actual[i + 2] - expected[j + 2]));
    }
    assert.ok(best <= tolerance, `point ${i / 3} is ${best} from the nearest expected point`);
  }
}

test('a forward tilt leans the formation toward the audience about its center', () => {
  const planner = createPlanner();
  const state = singleState();
  Object.assign(state.formations[0], { source: { type: 'builtin', shape: 'helix' }, size: 40 });
  const upright = planner(state).steps[0].to;
  state.formations[0].tiltForward = 30;
  const tilted = planner(state).steps[0].to;
  // The tilted targets are the upright ones, turned 30° about the X axis through the center.
  const center = state.formations[0].centerHeight;
  const body = upright.map((value, i) => (i % 3 === 2 ? value - center : value));
  sameSet(tilted, placeBody(body, poseRotation(0, (30 * Math.PI) / 180, 0), center), 1e-3);
  // The top of the helix is now nearer the audience, which stands on the negative Y axis.
  const top = topDrone(planner(state).steps[0]);
  assert.ok(tilted[top * 3 + 1] < -5, `top at y ${tilted[top * 3 + 1]}`);
});

/** The drone at the top of its formation, in the axes of the formation. */
function topDrone(step) {
  let top = 0;
  for (let i = 0; i < step.body.length; i += 3) if (step.body[i + 2] > step.body[top * 3 + 2]) top = i / 3;
  return top;
}

test('a sideways tilt leans the formation to the right as the audience sees it', () => {
  const planner = createPlanner();
  const state = singleState();
  Object.assign(state.formations[0], { source: { type: 'builtin', shape: 'helix' }, size: 40, tiltSide: 30 });
  const step = planner(state).steps[0];
  const top = topDrone(step);
  // 20 m above the center, leaned 30°: 10 m to the right of the axis.
  near(step.to[top * 3] - step.body[top * 3] * Math.cos(Math.PI / 6), 10, 0.5);
});

test('a sway turns the formation back and forth, and it ends where it started', () => {
  const state = singleState();
  Object.assign(state.formations[0], {
    source: { type: 'builtin', shape: 'heart' },
    size: 100,
    swayAngle: 8,
    swaySeconds: 10,
    holdSeconds: 20,
  });
  const plan = createPlanner()(state);
  const step = plan.steps[0];
  assert.equal(step.motion.sway.cycles, 2);
  assert.equal(step.end, step.to);
  const positions = new Float32Array(plan.count * 3);
  const start = holdStart(plan, 0);
  // The heart faces the audience at the start. Three quarters of the first sway later, it is
  // turned 8°: its tips, 50 m from the axis, are 7 m out of the plane.
  let depth = 0;
  positionsAt(plan, start + 7.5, positions);
  for (let i = 0; i < positions.length; i += 3) depth = Math.max(depth, Math.abs(positions[i + 1]));
  assert.ok(depth > 5, `depth ${depth}`);
  // At the end of the hold it faces the audience again.
  positionsAt(plan, start + step.hold - 1e-9, positions);
  for (let i = 0; i < positions.length; i++) near(positions[i], step.to[i], 1e-3);
  assert.deepEqual(formationProblems(plan, 0, state.fleet), []);
});

test('a rock can take a formation below the ground and out of the flight volume', () => {
  const planner = createPlanner();
  const state = singleState();
  // The torus stands upright. A forward tilt of 90° lays it flat: a ring 25 m from its axis,
  // with a tube 7.5 m thick. At 10 m, its lowest point is 2.5 m up.
  Object.assign(state.formations[0], {
    source: { type: 'builtin', shape: 'torus' },
    size: 50,
    centerHeight: 10,
    tiltForward: 90,
  });
  const still = planner(state);
  assert.ok(still.formations[0].lowestTarget > 2, `lowest ${still.formations[0].lowestTarget}`);
  // A rock of 30° each way dips the front and the back of the ring by more than 12 m.
  state.formations[0].rockAngle = 30;
  const rocking = planner(state);
  assert.ok(rocking.formations[0].lowestTarget < -2, `lowest ${rocking.formations[0].lowestTarget}`);
  assert.match(formationProblems(rocking, 0, state.fleet).join(), /below the ground/);

  // Higher up, the rock stays above the ground, but it leaves a volume with a high floor.
  Object.assign(state.formations[0], { centerHeight: 60 });
  state.volume = { ...state.volume, z: 50 };
  assert.equal(planner({ ...state, formations: [{ ...state.formations[0], rockAngle: 0 }] }).formations[0].outsideVolume, 0);
  const high = planner(state);
  assert.ok(high.formations[0].outsideVolume > 0);
  assert.ok(high.outsideVolume > 0);
});

test('a swing that is too fast for the limits is a problem', () => {
  const state = singleState();
  // The 100 m heart, swaying 60° each way every 2 s: its tips move about 100 m/s.
  Object.assign(state.formations[0], { source: { type: 'builtin', shape: 'heart' }, size: 100, swayAngle: 60, swaySeconds: 2 });
  const plan = createPlanner()(state);
  const { motion } = plan.formations[0];
  assert.ok(motion.horizontalSpeed > 50, `speed ${motion.horizontalSpeed}`);
  assert.ok(motion.acceleration > 100, `acceleration ${motion.acceleration}`);
  const problems = formationProblems(plan, 0, state.fleet);
  assert.ok(problems.includes('The motion in the hold is faster than the maximum horizontal speed.'));
  assert.ok(problems.includes('The motion in the hold accelerates more than the maximum acceleration.'));
  // A roll of a flat shape moves its drones up and down.
  const rolling = createPlanner()({ ...state, formations: [{ ...state.formations[0], swayAngle: 0, rollAngle: 30, rollSeconds: 3 }] });
  assert.ok(rolling.formations[0].motion.climbSpeed > 3);
  assert.match(formationProblems(rolling, 0, state.fleet).join(), /climbs or descends faster/);
});

test('a light chase and a gradient stay on the drones of a tilted formation, like paint', () => {
  const planner = createPlanner();
  const state = singleState();
  Object.assign(state.formations[0], { chase: 'rising', colorPattern: 'across', secondColor: '#00ff00' });
  const upright = planner(state).steps[0];
  state.formations[0] = { ...state.formations[0], tiltForward: 40, tiltSide: -25, yaw: 70 };
  const tilted = planner(state).steps[0];
  const sorted = (values) => Array.from(values).sort((a, b) => a - b);
  assert.deepEqual(sorted(tilted.chase.u), sorted(upright.chase.u));
  assert.deepEqual(sorted(tilted.colors), sorted(upright.colors));
});

test('turn, sway, rock, and roll run together, and the formation leaves its hold turned', () => {
  const state = singleState();
  Object.assign(state.formations[0], {
    source: { type: 'builtin', shape: 'torus' },
    size: 30,
    tiltForward: 15,
    turnRate: 5,
    swayAngle: 6,
    swaySeconds: 10,
    rockAngle: 4,
    rockSeconds: 10,
    rollAngle: 4,
    rollSeconds: 10,
    holdSeconds: 20,
  });
  const plan = createPlanner()(state);
  const step = plan.steps[0];
  const { turn, sway, rock, roll } = step.motion;
  assert.ok(turn && sway && rock && roll);
  // At the end only the turn remains: the tilted torus has turned about its own tilted axis.
  const center = state.formations[0].centerHeight;
  const body = step.body;
  const expected = placeBody(body, poseRotation(turn.angle, (15 * Math.PI) / 180, 0), center);
  for (let i = 0; i < expected.length; i++) near(step.end[i], expected[i], 1e-4);
  const positions = new Float32Array(plan.count * 3);
  positionsAt(plan, holdStart(plan, 0) + step.hold - 1e-9, positions);
  for (let i = 0; i < positions.length; i++) near(positions[i], step.end[i], 1e-3);
  assert.deepEqual(formationProblems(plan, 0, state.fleet), []);
});
