import assert from 'node:assert/strict';
import { test } from 'node:test';

import { takeoffGrid } from '../src/motion.js';

test('takeoffGrid gives one ground position per drone', () => {
  const grid = takeoffGrid(10, 3);
  assert.equal(grid.length, 30);
  for (let i = 0; i < 10; i++) assert.equal(grid[i * 3 + 2], 0);
});

test('takeoffGrid is centered on the origin and keeps the spacing', () => {
  const grid = takeoffGrid(9, 2);
  // 3 × 3 grid: x and y run from -2 to 2.
  assert.deepEqual(Array.from(grid.subarray(0, 3)), [-2, -2, 0]);
  assert.deepEqual(Array.from(grid.subarray(12, 15)), [0, 0, 0]);
  assert.deepEqual(Array.from(grid.subarray(24, 27)), [2, 2, 0]);
  assert.equal(grid[3] - grid[0], 2);
});

test('takeoffGrid handles a single drone', () => {
  assert.deepEqual(Array.from(takeoffGrid(1, 3)), [0, 0, 0]);
});
