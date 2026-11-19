import assert from 'node:assert/strict';
import { test } from 'node:test';

import { closestSpacing, farthestPointOrder, farthestPointSampler } from '../src/sample.js';
import { builtinCloud } from '../src/shapes.js';

/** Points 0, 1, ... n-1 on the x axis. */
function line(n) {
  const points = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) points[i * 3] = i;
  return points;
}

test('farthestPointOrder starts at the first point and then takes the farthest', () => {
  // From 0 the farthest is 10. Then 5 is farthest from both.
  assert.deepEqual(Array.from(farthestPointOrder(line(11), 3)), [0, 10, 5]);
});

test('farthestPointOrder gives each point one time at most', () => {
  const order = farthestPointOrder(builtinCloud('cube', 1), 500);
  assert.equal(order.length, 500);
  assert.equal(new Set(order).size, 500);
});

test('farthestPointOrder stops when the points run out', () => {
  assert.equal(farthestPointOrder(line(4), 10).length, 4);
});

test('the first picks do not depend on the pick count', () => {
  const cloud = builtinCloud('sphere', 1);
  const few = farthestPointOrder(cloud, 50);
  const many = farthestPointOrder(cloud, 200);
  assert.deepEqual(Array.from(many.subarray(0, 50)), Array.from(few));
});

test('picks on a sphere are evenly spread', () => {
  const cloud = builtinCloud('sphere', 1);
  const order = farthestPointOrder(cloud, 100);
  const picked = new Float32Array(300);
  for (let i = 0; i < 100; i++) picked.set(cloud.subarray(order[i] * 3, order[i] * 3 + 3), i * 3);
  // 100 points on a sphere of diameter 1: a perfect packing gives about 0.19 between neighbors.
  // Random picks give about 0.02 for the closest pair.
  assert.ok(closestSpacing(picked, 100) > 0.12, `spacing ${closestSpacing(picked, 100)}`);
});

test('closestSpacing finds the smallest distance', () => {
  const points = new Float32Array([0, 0, 0, 10, 0, 0, 10, 3, 4, 50, 50, 50]);
  assert.equal(closestSpacing(points, 4), 5);
  // Only the first two points.
  assert.equal(closestSpacing(points, 2), 10);
});

test('closestSpacing is infinite for fewer than two points', () => {
  assert.equal(closestSpacing(new Float32Array(3), 1), Infinity);
  assert.equal(closestSpacing(new Float32Array(0), 0), Infinity);
});

test('the sampler picks more points when asked, and they equal a single run', () => {
  const cloud = builtinCloud('torus', 2);
  const sampler = farthestPointSampler(cloud);
  const first = Array.from(sampler.order(30));
  const more = Array.from(sampler.order(200));
  const fewer = Array.from(sampler.order(10));
  assert.deepEqual(more, Array.from(farthestPointOrder(cloud, 200)));
  assert.deepEqual(more.slice(0, 30), first);
  assert.deepEqual(fewer, first.slice(0, 10));
});
