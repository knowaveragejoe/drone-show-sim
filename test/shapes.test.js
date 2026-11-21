import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILTIN_SHAPES, CLOUD_SIZE, builtinCloud, isCurve } from '../src/shapes.js';

/** @param {Float32Array} cloud */
function extents(cloud) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cloud.length; i++) {
    low[i % 3] = Math.min(low[i % 3], cloud[i]);
    high[i % 3] = Math.max(high[i % 3], cloud[i]);
  }
  return { low, high };
}

for (const shape of Object.keys(BUILTIN_SHAPES)) {
  test(`${shape}: the cloud is in unit space`, () => {
    const cloud = builtinCloud(shape, 1);
    assert.equal(cloud.length, CLOUD_SIZE * 3);
    assert.ok(cloud.every(Number.isFinite));

    const { low, high } = extents(cloud);
    const sizes = low.map((value, axis) => high[axis] - value);
    // The largest extent is 1. Random points come close to the edge but do not always reach it.
    assert.ok(Math.max(...sizes) <= 1 + 1e-6, `largest extent ${Math.max(...sizes)}`);
    assert.ok(Math.max(...sizes) > 0.98, `largest extent ${Math.max(...sizes)}`);
    // The shape is centered on the origin.
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(low[axis] + high[axis]) < 0.02, `axis ${axis} is off center`);
    }
  });

  test(`${shape}: the same seed gives the same cloud`, () => {
    assert.deepEqual(builtinCloud(shape, 5), builtinCloud(shape, 5));
  });
}

test('sphere points are on the sphere surface', () => {
  const cloud = builtinCloud('sphere', 1);
  for (let i = 0; i < CLOUD_SIZE; i++) {
    const radius = Math.hypot(cloud[i * 3], cloud[i * 3 + 1], cloud[i * 3 + 2]);
    assert.ok(Math.abs(radius - 0.5) < 1e-5);
  }
});

test('flat shapes face the audience', () => {
  for (const shape of ['disc', 'ring', 'heart']) {
    const cloud = builtinCloud(shape, 1);
    for (let i = 0; i < CLOUD_SIZE; i++) assert.equal(cloud[i * 3 + 1], 0);
  }
});

test('the ring, the helix, and the heart are curves; the others are surfaces', () => {
  const curves = Object.keys(BUILTIN_SHAPES).filter(isCurve);
  assert.deepEqual(curves, ['ring', 'helix', 'heart']);
  assert.equal(isCurve('teapot'), false);
});

test('the points of a curve are in order along it, one in each slice of equal length', () => {
  for (const shape of ['ring', 'helix', 'heart']) {
    const cloud = builtinCloud(shape, 1);
    const steps = [];
    for (let i = 1; i < CLOUD_SIZE; i++) {
      const o = i * 3;
      steps.push(Math.hypot(cloud[o] - cloud[o - 3], cloud[o + 1] - cloud[o - 2], cloud[o + 2] - cloud[o - 1]));
    }
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    // Two neighbors are at most two slices apart. Random points would leave gaps of about
    // ten times the mean.
    assert.ok(Math.max(...steps) <= 2 * mean * 1.05, `${shape}: largest step ${Math.max(...steps) / mean} × mean`);
  }
  // The ring is 3.14 long; its points are 3.14 / 20,000 apart on average.
  const ring = builtinCloud('ring', 1);
  let length = 0;
  for (let i = 1; i < CLOUD_SIZE; i++) {
    const o = i * 3;
    length += Math.hypot(ring[o] - ring[o - 3], ring[o + 2] - ring[o - 1]);
  }
  assert.ok(Math.abs(length - Math.PI) < 0.001, `ring length ${length}`);
});

test('an unknown shape is an error', () => {
  assert.throws(() => builtinCloud('teapot', 1), /Unknown shape/);
  assert.throws(() => builtinCloud('toString', 1), /Unknown shape/);
});
