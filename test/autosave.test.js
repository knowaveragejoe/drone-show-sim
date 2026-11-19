import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AUTOSAVE_KEY, PAIRINGS_KEY, createAutosave, decodePairings, encodePairings } from '../src/autosave.js';
import { createPlanner } from '../src/plan.js';
import { defaultState, serializeProject } from '../src/state.js';

/** A storage that keeps text in memory, like `localStorage`. */
function memoryStore() {
  const items = new Map();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
}

/** Collects the messages that autosave shows. */
function messages() {
  const shown = [];
  return { shown, onProblem: (message) => shown.push(message) };
}

test('a saved project loads again', () => {
  const store = memoryStore();
  const { onProblem } = messages();
  const state = defaultState();
  state.fleet.count = 321;
  const autosave = createAutosave(store, onProblem);
  autosave.schedule(state);
  autosave.flush();
  assert.equal(store.items.get(AUTOSAVE_KEY), serializeProject(state));
  assert.deepEqual(createAutosave(store, onProblem).load(), state);
});

test('a newer project replaces one that waits, and the save happens one time', () => {
  const writes = [];
  const store = { getItem: () => null, setItem: (key, value) => key === AUTOSAVE_KEY && writes.push(value) };
  const autosave = createAutosave(store, () => {});
  const first = defaultState();
  const second = { ...defaultState(), landAtEnd: false };
  autosave.schedule(first);
  autosave.schedule(second);
  autosave.flush();
  // Nothing waits, so a second flush writes nothing.
  autosave.flush();
  assert.deepEqual(writes, [serializeProject(second)]);
});

test('the save happens by itself after a short delay', async () => {
  const store = memoryStore();
  const autosave = createAutosave(store, () => {});
  autosave.schedule(defaultState());
  assert.equal(store.items.size, 0);
  await new Promise((done) => setTimeout(done, 600));
  assert.equal(store.items.get(AUTOSAVE_KEY), serializeProject(defaultState()));
});

test('load gives null when nothing is saved, or when there is no storage', () => {
  assert.equal(createAutosave(memoryStore(), () => {}).load(), null);
  assert.equal(createAutosave(null, () => {}).load(), null);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
  assert.equal(createAutosave(broken, () => {}).load(), null);
});

test('saved text that is not a valid project loads as null, with a message', () => {
  const store = memoryStore();
  store.items.set(AUTOSAVE_KEY, '{"app": "drone-show-sim", "version": 99}');
  const { shown, onProblem } = messages();
  assert.equal(createAutosave(store, onProblem).load(), null);
  assert.equal(shown.length, 1);
  assert.match(shown[0], /saved show could not be loaded.*version 99/);
});

test('a failed save shows a message, and a later save clears it', () => {
  let full = true;
  const items = new Map();
  const store = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (full) throw new Error('QuotaExceededError');
      items.set(key, value);
    },
  };
  const { shown, onProblem } = messages();
  const autosave = createAutosave(store, onProblem);
  autosave.schedule(defaultState());
  autosave.flush();
  assert.match(shown.at(-1), /did not save the show.*Export/);
  full = false;
  autosave.schedule(defaultState());
  autosave.flush();
  assert.equal(shown.at(-1), null);
  assert.ok(items.has(AUTOSAVE_KEY));
});

test('the assignments of a plan go through storage unchanged', () => {
  const planner = createPlanner();
  planner(defaultState());
  const entries = planner.warmStarts();
  assert.equal(entries.length, 4);
  const back = decodePairings(encodePairings(entries));
  assert.deepEqual(back, entries);
});

test('autosave keeps the assignments with the project, and a later page load starts from them', () => {
  const store = memoryStore();
  const planner = createPlanner();
  const state = defaultState();
  const first = planner(state);
  const autosave = createAutosave(store, () => {}, () => planner.warmStarts());
  autosave.schedule(state);
  autosave.flush();
  assert.ok(store.items.has(PAIRINGS_KEY));

  // A new page load: a new planner that starts from the stored assignments.
  const later = createAutosave(store, () => {});
  const nextPlanner = createPlanner();
  nextPlanner.addWarmStarts(later.loadPairings());
  const plan = nextPlanner(later.load());
  plan.steps.forEach((step, index) => assert.deepEqual(step.to, first.steps[index].to));
});

test('stored assignments that are not valid are dropped, and the plan stays right', () => {
  const store = memoryStore();
  const autosave = createAutosave(store, () => {});
  for (const text of ['not json', '{"version": 9, "entries": []}', '{"version": 1, "entries": [{"key": 5}]}']) {
    store.items.set(PAIRINGS_KEY, text);
    assert.deepEqual(autosave.loadPairings(), []);
  }
  // Entries that decode, but do not fit: wrong lengths, repeated columns, and prices that
  // are not numbers. The planner either drops them or the solver repairs them.
  const fresh = createPlanner()(defaultState());
  const planner = createPlanner();
  const real = createPlanner();
  real(defaultState());
  const [takeoff, ...rest] = real.warmStarts();
  planner.addWarmStarts([
    { key: takeoff.key, columnOfRow: new Int32Array(100).fill(3), price: takeoff.price },
    { key: rest[0].key, columnOfRow: rest[0].columnOfRow, price: new Float64Array(100).fill(NaN) },
    { key: rest[1].key, columnOfRow: rest[1].columnOfRow.subarray(0, 50), price: rest[1].price },
    { key: 'other', columnOfRow: rest[2].columnOfRow, price: rest[2].price },
  ]);
  const plan = planner(defaultState());
  plan.steps.forEach((step, index) => assert.deepEqual(step.to, fresh.steps[index].to));
});
