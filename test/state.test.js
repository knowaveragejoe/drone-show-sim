import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlanner } from '../src/plan.js';
import {
  FLEET_FIELDS,
  FORMATION_FIELDS,
  VOLUME_FIELDS,
  clampToField,
  defaultState,
  parseProject,
  serializeProject,
} from '../src/state.js';

/** A project file made from the default state, with changes applied to the parsed JSON. */
function fileWith(change) {
  const data = JSON.parse(serializeProject(defaultState()));
  change(data);
  return JSON.stringify(data);
}

test('the default state has a value in range for each field', () => {
  const state = defaultState();
  for (const field of FLEET_FIELDS) {
    assert.equal(clampToField(field, state.fleet[field.key]), state.fleet[field.key]);
  }
  for (const field of FORMATION_FIELDS) {
    assert.equal(clampToField(field, state.formations[0][field.key]), state.formations[0][field.key]);
  }
  for (const field of VOLUME_FIELDS) {
    assert.equal(clampToField(field, state.volume[field.key]), state.volume[field.key]);
  }
});

test('clampToField keeps a value in range', () => {
  const count = FLEET_FIELDS.find((field) => field.key === 'count');
  assert.equal(clampToField(count, 5000), 1000);
  assert.equal(clampToField(count, -3), 1);
  assert.equal(clampToField(count, 12.6), 13);
  assert.equal(clampToField(count, NaN), null);
});

test('export then import gives the same state', () => {
  const state = defaultState();
  state.fleet.count = 321;
  state.volume = { size: 250, x: -30, y: 12.5, z: 4 };
  state.formations[0].yaw = -45.5;
  state.formations[0].source = { type: 'builtin', shape: 'heart' };
  assert.deepEqual(parseProject(serializeProject(state)), state);
});

test('export then import keeps an OBJ model', () => {
  const state = defaultState();
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
  state.formations[0].source = { type: 'obj', fileName: 'tri "quoted".obj', upAxis: 'z', text };
  const loaded = parseProject(serializeProject(state));
  assert.deepEqual(loaded, state);
  // The loaded state gives the same plan as the first one.
  assert.deepEqual(createPlanner()(loaded).targets, createPlanner()(state).targets);
});

test('the project file names the app and the version', () => {
  const data = JSON.parse(serializeProject(defaultState()));
  assert.equal(data.app, 'drone-show-sim');
  assert.equal(data.version, 1);
});

test('import drops values that the project format does not have', () => {
  const text = fileWith((data) => {
    data.extra = 1;
    data.fleet.extra = 2;
    data.volume.extra = 5;
    data.formations[0].extra = 3;
    data.formations[0].source.extra = 4;
  });
  assert.deepEqual(parseProject(text), defaultState());
});

test('import rejects a file that is not a project', () => {
  assert.throws(() => parseProject('not json {'), /not valid JSON/);
  assert.throws(() => parseProject('[1, 2]'), /not a drone show project/);
  assert.throws(() => parseProject('null'), /not a drone show project/);
  assert.throws(() => parseProject('{"app": "other"}'), /not a drone show project/);
  assert.throws(() => parseProject(fileWith((data) => (data.version = 2))), /has version 2.*reads version 1/);
});

test('import rejects a missing part', () => {
  assert.throws(() => parseProject(fileWith((data) => delete data.fleet)), /no fleet/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations = []))), /exactly one formation/);
  assert.throws(() => parseProject(fileWith((data) => data.formations.push(data.formations[0]))), /exactly one formation/);
  assert.throws(() => parseProject(fileWith((data) => delete data.formations)), /exactly one formation/);
});

test('import rejects a value that is out of range or of the wrong type', () => {
  const cases = [
    [(data) => (data.fleet.count = 5000), /fleet\.count must be a whole number from 1 to 1000/],
    [(data) => (data.fleet.count = 10.5), /fleet\.count must be a whole number/],
    [(data) => (data.fleet.count = '100'), /fleet\.count/],
    [(data) => delete data.fleet.maxClimbSpeed, /fleet\.maxClimbSpeed must be a number from 0\.5 to 30/],
    [(data) => (data.fleet.minSpacing = 0), /fleet\.minSpacing/],
    [(data) => (data.fleet.gridSpacing = null), /fleet\.gridSpacing/],
    [(data) => (data.volume.size = 5), /volume\.size must be a number from 10 to 1000/],
    [(data) => (data.volume.z = -1), /volume\.z must be a number from 0 to 500/],
    [(data) => delete data.volume.x, /volume\.x/],
    [(data) => (data.volume = 'big'), /flight volume in the project file is not valid/],
    [(data) => (data.volume = null), /flight volume in the project file is not valid/],
    [(data) => (data.formations[0].size = -1), /formation\.size must be a number from 1 to 500/],
    [(data) => (data.formations[0].yaw = 999), /formation\.yaw/],
    [(data) => (data.formations[0].color = 'red'), /formation\.color/],
    [(data) => (data.formations[0].color = 7), /formation\.color/],
    [(data) => (data.formations[0].seed = 1.5), /formation\.seed/],
  ];
  for (const [change, message] of cases) {
    assert.throws(() => parseProject(fileWith(change)), message);
  }
});

test('import rejects a bad shape source', () => {
  const source = (value) => fileWith((data) => (data.formations[0].source = value));
  assert.throws(() => parseProject(source({ type: 'builtin', shape: 'teapot' })), /unknown shape "teapot"/);
  assert.throws(() => parseProject(source({ type: 'builtin', shape: 'toString' })), /unknown shape/);
  assert.throws(() => parseProject(source({ type: 'obj', fileName: 'a.obj', upAxis: 'x', text: '' })), /not complete/);
  assert.throws(() => parseProject(source({ type: 'obj', fileName: 'a.obj', upAxis: 'y' })), /not complete/);
  assert.throws(() => parseProject(source({ type: 'svg' })), /built-in shape or an OBJ model/);
  assert.throws(() => parseProject(source(undefined)), /built-in shape or an OBJ model/);
});

test('a project file with no flight volume gets the default volume', () => {
  const loaded = parseProject(fileWith((data) => delete data.volume));
  assert.deepEqual(loaded.volume, defaultState().volume);
  assert.deepEqual(loaded, defaultState());
});
