import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlanner } from '../src/plan.js';
import { BUILTIN_SHAPES } from '../src/shapes.js';
import {
  FLEET_FIELDS,
  FLIGHT_EFFECTS,
  FLIGHT_LIGHT_CHOICES,
  FLIGHT_LIGHT_FIELDS,
  FORMATION_FIELDS,
  MAX_FORMATIONS,
  MOTION_FIELDS,
  VOLUME_FIELDS,
  clampToField,
  defaultFlightLights,
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
    for (const field of [...FORMATION_FIELDS, ...MOTION_FIELDS]) {
      assert.equal(clampToField(field, formation[field.key]), formation[field.key], field.key);
    }
  }
  for (const lights of [...state.formations.map((formation) => formation.flightLights), state.landingLights]) {
    assert.ok(Object.hasOwn(FLIGHT_EFFECTS, lights.effect));
    for (const field of FLIGHT_LIGHT_FIELDS) assert.equal(clampToField(field, lights[field.key]), lights[field.key], field.key);
    for (const { key, options } of FLIGHT_LIGHT_CHOICES) {
      assert.ok(options ? Object.hasOwn(options, lights[key]) : /^#[0-9a-f]{6}$/i.test(lights[key]), key);
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
    [(data) => (data.spreadToPass = 1), /spreadToPass must be true or false/],
    [(data) => (data.volume = 'big'), /flight volume in the project file is not valid/],
    [(data) => (data.volume = null), /flight volume in the project file is not valid/],
    [(data) => (data.formations[0].size = -1), /formation 1: size must be a number from 1 to 500/],
    [(data) => (data.formations[2].yaw = 999), /formation 3: yaw/],
    [(data) => (data.formations[1].color = 'red'), /formation 2: color/],
    [(data) => (data.formations[0].color = 7), /formation 1: color/],
    [(data) => (data.formations[0].secondColor = 'white'), /formation 1: secondColor must be a color/],
    [(data) => (data.formations[1].colorPattern = 'plaid'), /formation 2: colorPattern must be one of solid, rising/],
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
  assert.throws(() => parseProject(source({ type: 'svg', fileName: 'logo.svg' })), /formation 1: the SVG drawing is not complete/);
  assert.throws(() => parseProject(source({ type: 'gltf' })), /built-in shape, an OBJ model, or an SVG drawing/);
  assert.throws(() => parseProject(source(undefined)), /built-in shape, an OBJ model, or an SVG drawing/);
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

test('a project file from before the spread gets it, and a file can turn it off', () => {
  assert.equal(parseProject(fileWith((data) => delete data.spreadToPass)).spreadToPass, true);
  assert.equal(parseProject(fileWith((data) => (data.spreadToPass = false))).spreadToPass, false);
});

test('a project file from before the vertical spacing has one spacing in all directions', () => {
  const old = parseProject(fileWith((data) => {
    delete data.fleet.minVerticalSpacing;
    data.fleet.minSpacing = 2.5;
  }));
  assert.equal(old.fleet.minVerticalSpacing, 2.5);
  assert.equal(parseProject(fileWith((data) => (data.fleet.minVerticalSpacing = 4))).fleet.minVerticalSpacing, 4);
  assert.throws(() => parseProject(fileWith((data) => (data.fleet.minVerticalSpacing = 0))), /minVerticalSpacing/);
});

test('a project file from before the hover layer takes off straight from the grid', () => {
  const old = parseProject(fileWith((data) => {
    delete data.fleet.hoverHeight;
    delete data.fleet.rowDelay;
  }));
  assert.equal(old.fleet.hoverHeight, 0);
  assert.equal(old.fleet.rowDelay, 0.5);
  const hovering = parseProject(fileWith((data) => (data.fleet.hoverHeight = 15)));
  assert.equal(hovering.fleet.hoverHeight, 15);
});

test('a formation from before color patterns gets one solid color', () => {
  const loaded = parseProject(
    fileWith((data) => {
      delete data.formations[2].colorPattern;
      delete data.formations[2].secondColor;
    }),
  );
  assert.equal(loaded.formations[2].colorPattern, 'solid');
  assert.equal(loaded.formations[2].secondColor, '#ffffff');
});

test('drawing colors need an SVG drawing', () => {
  const builtin = parseProject(fileWith((data) => (data.formations[0].colorPattern = 'drawing')));
  assert.equal(builtin.formations[0].colorPattern, 'solid');
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" stroke="red"/></svg>';
  const drawing = parseProject(
    fileWith((data) => {
      data.formations[0].source = { type: 'svg', fileName: 'dot.svg', text };
      data.formations[0].colorPattern = 'drawing';
    }),
  );
  assert.equal(drawing.formations[0].colorPattern, 'drawing');
});

test('a formation from before tilt and swings stands upright and does not swing', () => {
  const keys = ['tiltForward', 'tiltSide', 'swayAngle', 'swaySeconds', 'rockAngle', 'rockSeconds', 'rollAngle', 'rollSeconds'];
  const loaded = parseProject(fileWith((data) => data.formations.forEach((formation) => keys.forEach((key) => delete formation[key]))));
  for (const formation of loaded.formations) {
    assert.deepEqual(
      keys.map((key) => formation[key]),
      [0, 0, 0, 8, 0, 8, 0, 8],
    );
  }
  assert.throws(() => parseProject(fileWith((data) => (data.formations[0].tiltForward = 100))), /formation 1: tiltForward must be a number from -90 to 90/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[1].swayAngle = -5))), /formation 2: swayAngle must be a number from 0 to 60/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[2].rollSeconds = 0))), /formation 3: rollSeconds must be a number from 1 to 60/);
});

test('each swing time field depends on its angle field', () => {
  const byKey = Object.fromEntries(MOTION_FIELDS.map((field) => [field.key, field]));
  for (const swing of ['sway', 'rock', 'roll']) {
    assert.equal(byKey[`${swing}Seconds`].dependsOn, `${swing}Angle`);
  }
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

test('a project file from before the turn rate existed loads with no turn', () => {
  const text = fileWith((data) => data.formations.forEach((formation) => delete formation.turnRate));
  const loaded = parseProject(text);
  for (const formation of loaded.formations) assert.equal(formation.turnRate, 0);
  // A field that never had a fallback is still required.
  assert.throws(() => parseProject(fileWith((data) => delete data.formations[0].size)), /formation 1: size/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[0].turnRate = 90))), /formation 1: turnRate must be a number from -45 to 45/);
});

test('a project file from before the light chase existed loads with no chase', () => {
  const text = fileWith((data) =>
    data.formations.forEach((formation) => {
      delete formation.chase;
      delete formation.chaseBands;
      delete formation.chaseSpeed;
    }),
  );
  for (const formation of parseProject(text).formations) {
    assert.equal(formation.chase, 'off');
    assert.equal(formation.chaseBands, 4);
    assert.equal(formation.chaseSpeed, 0.5);
  }
});

test('import rejects a bad light chase', () => {
  assert.throws(() => parseProject(fileWith((data) => (data.formations[1].chase = 'spiral'))), /formation 2: chase must be one of off, around, rising, across/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[0].chaseBands = 0))), /formation 1: chaseBands must be a whole number from 1 to 12/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[0].chaseBands = 2.5))), /chaseBands/);
  assert.throws(() => parseProject(fileWith((data) => (data.formations[0].chaseSpeed = 9))), /formation 1: chaseSpeed must be a number from -2 to 2/);
});

test('a project file from before the flight lights keeps the lights on in every flight', () => {
  const text = fileWith((data) => {
    delete data.landingLights;
    data.formations.forEach((formation) => delete formation.flightLights);
  });
  const state = parseProject(text);
  assert.deepEqual(state.landingLights, defaultFlightLights());
  for (const formation of state.formations) assert.deepEqual(formation.flightLights, defaultFlightLights());
  assert.equal(defaultFlightLights().effect, 'blend');
});

test('a project file with only the name of the effect and a dark level beside it keeps both', () => {
  // Milestones 26 to 29 wrote the effect as a name and the dark level beside it.
  const text = fileWith((data) => {
    data.formations[1].flightLights = 'glimmer';
    data.formations[1].darkLevel = 15;
    data.formations[2].flightLights = 'dark';
    data.landingLights = 'starburst';
    data.landingDarkLevel = 30;
  });
  const state = parseProject(text);
  assert.deepEqual(state.formations[1].flightLights, { ...defaultFlightLights(), effect: 'glimmer', darkLevel: 15 });
  assert.deepEqual(state.formations[2].flightLights, { ...defaultFlightLights(), effect: 'dark' });
  assert.deepEqual(state.landingLights, { ...defaultFlightLights(), effect: 'starburst', darkLevel: 30 });
  // The old properties beside the effect do not stay in the state.
  assert.equal(state.formations[1].darkLevel, undefined);
  assert.equal(state.landingDarkLevel, undefined);
});

test('flight lights with some settings get the fallback of each other setting', () => {
  const state = parseProject(fileWith((data) => (data.formations[0].flightLights = { effect: 'wave', bandDirection: 'spin' })));
  assert.deepEqual(state.formations[0].flightLights, { ...defaultFlightLights(), effect: 'wave', bandDirection: 'spin' });
});

test('export then import keeps the flight lights', () => {
  const state = defaultState();
  state.formations[1] = {
    ...state.formations[1],
    flightLights: { ...defaultFlightLights(), effect: 'starburst', burstDirection: 'in', sparkColor: '#ffd27a', flashTime: 1.2, emberTime: 2.5, darkLevel: 15 },
  };
  state.landingLights = { ...defaultFlightLights(), effect: 'wave', bandDirection: 'out', bandCount: 3, bandSpeed: 1.25, fadeTime: 2 };
  assert.deepEqual(parseProject(serializeProject(state)), state);
});

test('import rejects bad flight lights', () => {
  const formation = (lights) => fileWith((data) => (data.formations[1].flightLights = lights));
  assert.throws(() => parseProject(formation('disco')), /formation 2, flightLights: effect must be one of blend, dark, glimmer, starburst, wave/);
  assert.throws(() => parseProject(formation(7)), /formation 2: flightLights is not valid/);
  assert.throws(() => parseProject(formation({ effect: 'wave', bandDirection: 'sideways' })), /formation 2, flightLights: bandDirection must be one of right, left, up, down, out, in, spin, together/);
  assert.throws(() => parseProject(formation({ effect: 'starburst', burstDirection: 'up' })), /burstDirection must be one of out, in/);
  assert.throws(() => parseProject(formation({ effect: 'glimmer', sparkColor: 'white' })), /formation 2, flightLights: sparkColor must be a color/);
  assert.throws(() => parseProject(formation({ effect: 'dark', darkLevel: 60 })), /formation 2, flightLights: darkLevel must be a number from 0 to 50/);
  assert.throws(() => parseProject(formation({ effect: 'glimmer', twinkleRate: 0 })), /twinkleRate must be a number from 0.1 to 6/);
  assert.throws(() => parseProject(fileWith((data) => (data.landingLights = { effect: 'dark', fadeTime: 9 }))), /the show, landingLights: fadeTime must be a number from 0.1 to 5/);
  assert.throws(() => parseProject(fileWith((data) => (data.landingLights = 3))), /the show: landingLights is not valid/);
});

test('export then import keeps an SVG drawing', () => {
  const state = defaultState();
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>';
  state.formations[1].source = { type: 'svg', fileName: 'ring.svg', text };
  const loaded = parseProject(serializeProject(state));
  assert.deepEqual(loaded, state);
  assert.deepEqual(createPlanner()(loaded).steps[1].to, createPlanner()(state).steps[1].to);
});
