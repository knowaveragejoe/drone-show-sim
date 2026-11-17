import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlanner } from '../src/plan.js';
import { BUILTIN_SHAPES } from '../src/shapes.js';
import {
  FLEET_FIELDS,
  FORMATION_FIELDS,
  MAX_FORMATIONS,
  VOLUME_FIELDS,
  clampToField,
  defaultState,
  nextFormation,
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
  for (const formation of state.formations) {
    for (const field of FORMATION_FIELDS) {
      assert.equal(clampToField(field, formation[field.key]), formation[field.key]);
    }
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
  state.formations.push({ ...state.formations[0], size: 77, color: '#abcdef' });
  state.landAtEnd = false;
  assert.deepEqual(parseProject(serializeProject(state)), state);
  state.landAtEnd = true;
  assert.deepEqual(parseProject(serializeProject(state)), state);
});

test('export then import keeps an OBJ model', () => {
  const state = defaultState();
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
  state.formations[0].source = { type: 'obj', fileName: 'tri "quoted".obj', upAxis: 'z', text };
  const loaded = parseProject(serializeProject(state));
  assert.deepEqual(loaded, state);
  // The loaded state gives the same plan as the first one.
  assert.deepEqual(createPlanner()(loaded).steps[0].to, createPlanner()(state).steps[0].to);
});

test('the project file names the app and the version', () => {
  const data = JSON.parse(serializeProject(defaultState()));
  assert.equal(data.app, 'drone-show-sim');
  assert.equal(data.version, 2);
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
  assert.throws(() => parseProject(fileWith((data) => (data.version = 3))), /has version 3.*reads versions 1 and 2/);
  assert.throws(() => parseProject(fileWith((data) => delete data.version)), /reads versions 1 and 2/);
});

test('import rejects a missing part', () => {
  assert.throws(() => parseProject(fileWith((data) => delete data.fleet)), /no fleet/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations = []))), /1 to 20 formations/);
  assert.throws(() => parseProject(fileWith((data) => delete data.formations)), /1 to 20 formations/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations = 'many'))), /1 to 20 formations/);
  const tooMany = (data) => (data.formations = Array(MAX_FORMATIONS + 1).fill(data.formations[0]));
  assert.throws(() => parseProject(fileWith(tooMany)), /1 to 20 formations/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[1] = null))), /formation 2 is not valid/);
});

test('import rejects a value that is out of range or of the wrong type', () => {
  const cases = [
    [(data) => (data.fleet.count = 5000), /fleet: count must be a whole number from 1 to 1000/],
    [(data) => (data.fleet.count = 10.5), /fleet: count must be a whole number/],
    [(data) => (data.fleet.count = '100'), /fleet: count/],
    [(data) => delete data.fleet.maxClimbSpeed, /fleet: maxClimbSpeed must be a number from 0\.5 to 30/],
    [(data) => (data.fleet.minSpacing = 0), /fleet: minSpacing/],
    [(data) => (data.fleet.gridSpacing = null), /fleet: gridSpacing/],
    [(data) => (data.volume.size = 5), /volume: size must be a number from 10 to 1000/],
    [(data) => (data.volume.z = -1), /volume: z must be a number from 0 to 500/],
    [(data) => delete data.volume.x, /volume: x/],
    [(data) => (data.landAtEnd = 'yes'), /landAtEnd must be true or false/],
    [(data) => (data.volume = 'big'), /flight volume in the project file is not valid/],
    [(data) => (data.volume = null), /flight volume in the project file is not valid/],
    [(data) => (data.formations[0].size = -1), /formation 1: size must be a number from 1 to 500/],
    [(data) => (data.formations[2].yaw = 999), /formation 3: yaw/],
    [(data) => (data.formations[1].color = 'red'), /formation 2: color/],
    [(data) => (data.formations[0].color = 7), /formation 1: color/],
    [(data) => (data.formations[0].seed = 1.5), /formation 1: seed/],
  ];
  for (const [change, message] of cases) {
    assert.throws(() => parseProject(fileWith(change)), message);
  }
});

test('import rejects a bad shape source', () => {
  const source = (value) => fileWith((data) => (data.formations[0].source = value));
  assert.throws(() => parseProject(source({ type: 'builtin', shape: 'teapot' })), /formation 1: the shape "teapot" is unknown/);
  assert.throws(() => parseProject(source({ type: 'builtin', shape: 'toString' })), /is unknown/);
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

test('a version 1 project file loads as a show with one formation and no landing', () => {
  const text = fileWith((data) => {
    data.version = 1;
    data.formations = [data.formations[0]];
    delete data.landAtEnd;
    delete data.volume;
  });
  const loaded = parseProject(text);
  assert.equal(loaded.formations.length, 1);
  assert.equal(loaded.landAtEnd, false);
  assert.deepEqual(loaded.formations[0], defaultState().formations[0]);
});

test('nextFormation gives the next shape and the next color, and keeps the rest', () => {
  const { formations } = defaultState();
  const shapes = Object.keys(BUILTIN_SHAPES);
  const added = nextFormation(formations, 0);
  assert.equal(added.source.shape, shapes[shapes.indexOf(formations[0].source.shape) + 1]);
  assert.notEqual(added.color, formations[0].color);
  const { source, color, ...rest } = added;
  const { source: oldSource, color: oldColor, ...oldRest } = formations[0];
  assert.deepEqual(rest, oldRest);

  // After the last shape comes the first one. An OBJ model is followed by the first shape.
  const last = { ...formations[0], source: { type: 'builtin', shape: shapes.at(-1) } };
  assert.equal(nextFormation([last], 0).source.shape, shapes[0]);
  const model = { ...formations[0], source: { type: 'obj', fileName: 'a.obj', upAxis: 'y', text: '' } };
  assert.equal(nextFormation([model], 0).source.shape, shapes[0]);
  // A color that is not in the list is followed by the first color of the list.
  assert.match(nextFormation([{ ...formations[0], color: '#123456' }], 0).color, /^#[0-9a-f]{6}$/);
});
