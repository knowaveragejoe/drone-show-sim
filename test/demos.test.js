// Checks of the demo shows: each file is on the site, loads like an imported project file,
// and passes every check of the simulator.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEMOS } from '../src/demos.js';
import { createPlanner, showProblems } from '../src/plan.js';
import { parseProject } from '../src/state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('each demo has a name, a summary, and a relative URL of a file in the demos folder', () => {
  assert.ok(DEMOS.length > 0);
  assert.equal(new Set(DEMOS.map((demo) => demo.name)).size, DEMOS.length, 'no two demos share a name');
  for (const demo of DEMOS) {
    assert.ok(demo.name.length > 0);
    assert.ok(demo.summary.length > 0);
    assert.match(demo.file, /^demos\/[\w-]+\.droneshow\.json$/);
    assert.ok(existsSync(join(root, demo.file)), `${demo.file} is not a file`);
  }
});

test('the menu lists every file in the demos folder', () => {
  const files = readdirSync(join(root, 'demos')).map((name) => `demos/${name}`);
  assert.deepEqual(new Set(files), new Set(DEMOS.map((demo) => demo.file)));
});

for (const demo of DEMOS) {
  test(`the demo "${demo.name}" loads and passes every check`, () => {
    const state = parseProject(readFileSync(join(root, demo.file), 'utf8'));
    const plan = createPlanner()(state);
    assert.deepEqual(showProblems(state, plan), []);
    assert.equal(plan.count, state.fleet.count);
  });
}
