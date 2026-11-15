import assert from 'node:assert/strict';
import { test } from 'node:test';

import { objCloud, parseObj } from '../src/obj.js';
import { CLOUD_SIZE } from '../src/shapes.js';

const TRIANGLE = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

test('parseObj reads a triangle', () => {
  assert.deepEqual(Array.from(parseObj(TRIANGLE)), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('parseObj splits a face with four corners into two triangles', () => {
  const triangles = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
  assert.deepEqual(Array.from(triangles), [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
});

test('parseObj splits a face with five corners into three triangles', () => {
  const text = 'v 0 0 0\nv 2 0 0\nv 3 1 0\nv 1 2 0\nv -1 1 0\nf 1 2 3 4 5\n';
  assert.equal(parseObj(text).length, 3 * 9);
});

test('parseObj reads corners with texture and normal numbers', () => {
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\nf 1/1/1 2/1/1 3/1/1\nf 1//1 2//1 3//1\nf 1/1 2/1 3/1\n';
  const triangles = parseObj(text);
  assert.equal(triangles.length, 3 * 9);
  assert.deepEqual(Array.from(triangles.subarray(0, 9)), Array.from(triangles.subarray(18, 27)));
});

test('parseObj reads negative vertex numbers', () => {
  // The second face counts back from the newest vertex at that line.
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 5 5 5\nf -1 -3 -2\n';
  const triangles = parseObj(text);
  assert.deepEqual(Array.from(triangles.subarray(0, 9)), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(triangles.subarray(9, 18)), [5, 5, 5, 1, 0, 0, 0, 1, 0]);
});

test('parseObj ignores other lines, Windows line ends, and extra spaces', () => {
  const text = '# comment\r\nmtllib a.mtl\r\no thing\r\nv  0 0 0\r\nv\t1 0 0\r\nv 0 1 0\r\nvn 0 0 1\r\ng group\r\nusemtl red\r\ns off\r\n  f 1 2 3  \r\n\r\n';
  assert.deepEqual(Array.from(parseObj(text)), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('parseObj accepts a face that comes before its vertices', () => {
  assert.equal(parseObj('f 1 2 3\nv 0 0 0\nv 1 0 0\nv 0 1 0\n').length, 9);
});

test('parseObj reports bad input with the line number', () => {
  assert.throws(() => parseObj('v 0 0\n'), /line 1: the vertex/);
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nf 1 2\n'), /line 3: the face has fewer than three/);
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 x\n'), /line 4: "x" is not a vertex number/);
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n'), /uses vertex 9, but it has only 3/);
});

test('objCloud rejects a file with no faces or no area', () => {
  assert.throws(() => objCloud('v 0 0 0\nv 1 0 0\n', 'y', 1), /no faces/);
  assert.throws(() => objCloud('hello', 'y', 1), /no faces/);
  assert.throws(() => objCloud('v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\n', 'y', 1), /no surface area/);
  assert.throws(() => objCloud('v 1 1 1\nv 1 1 1\nv 1 1 1\nf 1 2 3\n', 'y', 1), /no surface area/);
});

test('objCloud puts the model in unit space', () => {
  // A triangle far from the origin, 20 wide and 10 high.
  const cloud = objCloud('v 100 50 7\nv 120 50 7\nv 100 60 7\nf 1 2 3\n', 'z', 1);
  assert.equal(cloud.length, CLOUD_SIZE * 3);
  let lowX = Infinity;
  let highX = -Infinity;
  let highY = -Infinity;
  for (let i = 0; i < CLOUD_SIZE; i++) {
    lowX = Math.min(lowX, cloud[i * 3]);
    highX = Math.max(highX, cloud[i * 3]);
    highY = Math.max(highY, cloud[i * 3 + 1]);
    assert.equal(cloud[i * 3 + 2], 0);
  }
  assert.ok(lowX >= -0.5 && lowX < -0.48, `low x ${lowX}`);
  assert.ok(highX <= 0.5 && highX > 0.48, `high x ${highX}`);
  assert.ok(highY <= 0.25 && highY > 0.23, `high y ${highY}`);
});

test('objCloud turns a Y-up model so that its top points up and its front faces the audience', () => {
  // A tall wall in the model XY plane. Its top is at y = 4. One corner sticks out to the front (+z).
  const text = 'v 0 0 0\nv 1 0 0\nv 0 4 0\nv 0 0 1\nf 1 2 3\nf 1 2 4\n';
  const cloud = objCloud(text, 'y', 1);
  let highZ = -Infinity;
  let lowY = Infinity;
  let highY = -Infinity;
  for (let i = 0; i < CLOUD_SIZE; i++) {
    highZ = Math.max(highZ, cloud[i * 3 + 2]);
    lowY = Math.min(lowY, cloud[i * 3 + 1]);
    highY = Math.max(highY, cloud[i * 3 + 1]);
  }
  // Height 4 is the largest extent, so the top is near 0.5 in world Z.
  assert.ok(highZ > 0.48, `high z ${highZ}`);
  // The front corner is 1 of 4 units deep. It points to the audience, which is negative Y.
  assert.ok(lowY < -0.11 && lowY >= -0.125, `low y ${lowY}`);
  assert.ok(highY <= 0.125 + 1e-6);
});

test('objCloud gives a larger triangle more points in proportion to its area', () => {
  // Two triangles side by side on the x axis: areas 0.5 and 1.5.
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 2 0 0\nv 5 0 0\nv 2 1 0\nf 1 2 3\nf 4 5 6\n';
  const cloud = objCloud(text, 'z', 1);
  // In unit space the gap between the triangles is at x from -0.3 to -0.1.
  let small = 0;
  for (let i = 0; i < CLOUD_SIZE; i++) if (cloud[i * 3] < -0.2) small++;
  const share = small / CLOUD_SIZE;
  assert.ok(Math.abs(share - 0.25) < 0.02, `share ${share}`);
});

test('objCloud gives the same cloud for the same seed', () => {
  assert.deepEqual(objCloud(TRIANGLE, 'y', 3), objCloud(TRIANGLE, 'y', 3));
  assert.notDeepEqual(objCloud(TRIANGLE, 'y', 3), objCloud(TRIANGLE, 'y', 4));
});
