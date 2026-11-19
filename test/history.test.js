import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MERGE_WINDOW, createHistory } from '../src/history.js';

test('undo goes back one change, and redo goes forward again', () => {
  const history = createHistory();
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo('a'), null);

  // The state goes a → b → c.
  history.record('a', 'size', 0);
  history.record('b', 'height', 10);
  assert.equal(history.canUndo(), true);
  assert.equal(history.undo('c'), 'b');
  assert.equal(history.undo('b'), 'a');
  assert.equal(history.undo('a'), null);
  assert.equal(history.canRedo(), true);
  assert.equal(history.redo('a'), 'b');
  assert.equal(history.redo('b'), 'c');
  assert.equal(history.redo('c'), null);
});

test('a new change after an undo clears the redo steps', () => {
  const history = createHistory();
  history.record('a', 'size', 0);
  history.record('b', 'height', 10);
  assert.equal(history.undo('c'), 'b');
  history.record('b', 'yaw', 20);
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo('d'), 'b');
  assert.equal(history.undo('b'), 'a');
});

test('quick changes of the same field merge into one step', () => {
  const history = createHistory();
  // A slider drag: a → b → c → d, each change soon after the one before.
  history.record('a', 'size', 0);
  history.record('b', 'size', 300);
  history.record('c', 'size', 600);
  // The window counts from the last change, so a long drag stays one step.
  history.record('d', 'size', 600 + MERGE_WINDOW);
  assert.equal(history.undo('e'), 'a');
  assert.equal(history.canUndo(), false);
});

test('changes of a field merge only inside the time window', () => {
  const history = createHistory();
  history.record('a', 'size', 0);
  history.record('b', 'size', MERGE_WINDOW + 1);
  assert.equal(history.undo('c'), 'b');
  assert.equal(history.undo('b'), 'a');
});

test('changes of different fields, or with no key, do not merge', () => {
  const history = createHistory();
  history.record('a', 'size', 0);
  history.record('b', 'height', 1);
  history.record('c', null, 2);
  history.record('d', null, 3);
  assert.equal(history.undo('e'), 'd');
  assert.equal(history.undo('d'), 'c');
  assert.equal(history.undo('c'), 'b');
  assert.equal(history.undo('b'), 'a');
});

test('an undo ends a merge run', () => {
  const history = createHistory();
  // A drag: a → b → c is one step.
  history.record('a', 'size', 0);
  history.record('b', 'size', 10);
  assert.equal(history.undo('c'), 'a');
  // The same field again, at once. It is a new step: without one, undo would have nothing.
  history.record('a', 'size', 20);
  assert.equal(history.undo('x'), 'a');
  assert.equal(history.canUndo(), false);
});

test('the history keeps a limited number of steps', () => {
  const history = createHistory(3);
  for (const [index, snapshot] of ['a', 'b', 'c', 'd', 'e'].entries()) history.record(snapshot, null, index);
  assert.equal(history.undo('f'), 'e');
  assert.equal(history.undo('e'), 'd');
  assert.equal(history.undo('d'), 'c');
  assert.equal(history.undo('c'), null);
});
