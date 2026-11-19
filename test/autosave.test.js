import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AUTOSAVE_KEY, createAutosave } from '../src/autosave.js';
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
  const store = { getItem: () => null, setItem: (key, value) => writes.push(value) };
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
  assert.equal(items.size, 1);
});
