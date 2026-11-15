import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRng } from '../src/rng.js';

test('the same seed gives the same sequence', () => {
  const a = createRng(7);
  const b = createRng(7);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('different seeds give different sequences', () => {
  assert.notEqual(createRng(1)(), createRng(2)());
});

test('values are from 0 to 1 and cover the range', () => {
  const random = createRng(3);
  let low = 1;
  let high = 0;
  for (let i = 0; i < 10000; i++) {
    const value = random();
    assert.ok(value >= 0 && value < 1);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  assert.ok(low < 0.01 && high > 0.99);
});
