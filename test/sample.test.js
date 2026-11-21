import assert from 'node:assert/strict';
import { test } from 'node:test';

import { objCloud } from '../src/obj.js';
import { createRng } from '../src/rng.js';
import { closestSpacing, curvePicks, farthestPointOrder, farthestPointSampler, relaxPicks } from '../src/sample.js';
import { BUILTIN_SHAPES, builtinCloud } from '../src/shapes.js';
import { svgCloud } from '../src/svg.js';

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

/** The plain farthest point search, one full pass per pick. The grid sampler must match it. */
function plainOrder(points, count) {
  const total = points.length / 3;
  const picks = new Uint32Array(Math.min(count, total));
  const nearest = new Float32Array(total).fill(Infinity);
  let current = 0;
  for (let pick = 0; pick < picks.length; pick++) {
    picks[pick] = current;
    const cx = points[current * 3];
    const cy = points[current * 3 + 1];
    const cz = points[current * 3 + 2];
    let farthest = -1;
    let next = 0;
    for (let i = 0; i < total; i++) {
      const dx = points[i * 3] - cx;
      const dy = points[i * 3 + 1] - cy;
      const dz = points[i * 3 + 2] - cz;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearest[i]) nearest[i] = distance;
      if (nearest[i] > farthest) {
        farthest = nearest[i];
        next = i;
      }
    }
    current = next;
  }
  return picks;
}

test('the grid sampler picks the same points as a plain search, for every kind of cloud', () => {
  const random = createRng(41);
  const clouds = {
    ...Object.fromEntries(Object.keys(BUILTIN_SHAPES).map((shape) => [shape, builtinCloud(shape, 3)])),
    svg: svgCloud('<svg><rect x="0" y="0" width="40" height="10" rx="3"/><circle cx="20" cy="5" r="4"/></svg>', 1).points,
    obj: objCloud('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nf 1 2 3 4\nf 1 2 5\nf 2 3 5\n', 'y', 1),
    // All points on one line: two flat axes.
    line: Float32Array.from({ length: 3000 }, (unused, i) => (i % 3 === 0 ? random() : 0)),
    // Many exact duplicates: the lowest index must win each tie.
    duplicates: Float32Array.from({ length: 6000 }, (unused, i) => Math.floor(random() * 4) / 4 + (i % 3) * 0.25),
  };
  for (const [name, cloud] of Object.entries(clouds)) {
    const count = Math.min(1000, cloud.length / 3);
    assert.deepEqual(farthestPointOrder(cloud, count), plainOrder(cloud, count), name);
  }
});

// Even spacing.

/** The points of a cloud at some indices. */
function pointsAt(cloud, indices) {
  const out = new Float32Array(indices.length * 3);
  indices.forEach((index, i) => out.set(cloud.subarray(index * 3, index * 3 + 3), i * 3));
  return out;
}

test('curvePicks spaces the picks evenly along a ring', () => {
  const cloud = builtinCloud('ring', 1);
  for (const count of [7, 100, 300]) {
    const picks = curvePicks(cloud, count);
    assert.equal(picks.length, count);
    // In order along the ring, so each index is larger than the one before it.
    assert.ok(picks.every((pick, i) => i === 0 || pick > picks[i - 1]));
    // Equal steps around a ring of diameter 1 are sin(π / count) apart.
    const ideal = Math.sin(Math.PI / count);
    const spacing = closestSpacing(pointsAt(cloud, picks), count);
    assert.ok(spacing >= ideal * 0.97, `${count}: spacing ${spacing / ideal} of ideal`);
  }
});

test('curvePicks keeps the spacing where a curve comes back near itself', () => {
  // A sharp V: down one arm and up the other, with 10° between the arms. A walk that only
  // counts the length along the curve would put picks on both arms close to the corner.
  const total = 20000;
  const cloud = new Float32Array(total * 3);
  const half = Math.sin((5 * Math.PI) / 180);
  for (let i = 0; i < total; i++) {
    const along = (i / (total - 1)) * 2 - 1;
    cloud[i * 3] = Math.abs(along) * Math.cos((5 * Math.PI) / 180);
    cloud[i * 3 + 2] = along * half;
  }
  const count = 100;
  const picks = curvePicks(cloud, count);
  // The arms are 2 long. Near the corner the picks keep away from the other arm, which
  // costs a few picks' worth of length.
  const spacing = closestSpacing(pointsAt(cloud, picks), count);
  assert.ok(spacing >= (2 / count) * 0.9, `spacing ${spacing}`);
  // Farthest point sampling does worse at the corner.
  const sampled = closestSpacing(pointsAt(cloud, farthestPointOrder(cloud, count)), count);
  assert.ok(spacing > sampled * 1.2, `walk ${spacing}, sampling ${sampled}`);
});

test('curvePicks handles small and large counts', () => {
  const cloud = builtinCloud('helix', 1);
  assert.equal(curvePicks(cloud, 0).length, 0);
  assert.equal(curvePicks(cloud, 1).length, 1);
  const tiny = cloud.subarray(0, 30);
  assert.deepEqual(Array.from(curvePicks(tiny, 50)), Array.from({ length: 10 }, (unused, i) => i));
  assert.deepEqual(curvePicks(cloud, 250), curvePicks(cloud, 250));
});

test('relaxPicks moves picks apart on a surface, and never closer', () => {
  for (const shape of ['sphere', 'cube', 'torus', 'disc']) {
    const cloud = builtinCloud(shape, 1);
    for (const count of [50, 200]) {
      const sampled = farthestPointOrder(cloud, count);
      const relaxed = relaxPicks(cloud, sampled);
      assert.equal(relaxed.length, count);
      assert.equal(new Set(relaxed).size, count, 'no two picks share a point');
      const before = closestSpacing(pointsAt(cloud, sampled), count);
      const after = closestSpacing(pointsAt(cloud, relaxed), count);
      assert.ok(after >= before, `${shape} ${count}: ${after} < ${before}`);
      assert.ok(after >= before * 1.05, `${shape} ${count}: gain ${after / before}`);
    }
  }
});

test('relaxPicks gives the same result for the same input, and handles one pick', () => {
  const cloud = builtinCloud('torus', 3);
  const sampled = farthestPointOrder(cloud, 120);
  assert.deepEqual(relaxPicks(cloud, sampled), relaxPicks(cloud, sampled));
  assert.deepEqual(Array.from(relaxPicks(cloud, [7])), [7]);
  assert.deepEqual(Array.from(relaxPicks(cloud, [])), []);
});
