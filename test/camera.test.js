import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUDIENCE_SEAT,
  SHOWTIME_MAX_FOV,
  SHOWTIME_MIN_FOV,
  aimFromSeat,
  audienceShot,
  cameraAxes,
  cameraEye,
  createCamera,
  easeShot,
  frameShow,
  setAudienceView,
} from '../src/camera.js';

test('the camera frames a show from the start direction, at the middle of its formations', () => {
  const camera = createCamera();
  camera.azimuth = 2;
  camera.elevation = -0.3;
  camera.target = [40, -20, 5];
  frameShow(camera, [
    { centerHeight: 60, size: 40 },
    { centerHeight: 70, size: 100 },
  ]);
  const start = createCamera();
  // The lowest bottom is 20 m and the highest top is 120 m.
  assert.deepEqual(camera.target, [0, 0, 70]);
  assert.equal(camera.azimuth, start.azimuth);
  assert.equal(camera.elevation, start.elevation);
  // A show of this height fits at the start distance.
  assert.equal(camera.distance, start.distance);
});

test('the camera moves back for a tall show until the formations fit', () => {
  const camera = createCamera();
  frameShow(camera, [{ centerHeight: 250, size: 400 }]);
  assert.deepEqual(camera.target, [0, 0, 250]);
  const viewHeight = 2 * camera.distance * Math.tan(camera.fovY / 2);
  assert.ok(viewHeight > 400 && viewHeight < 600, `the view is ${viewHeight} m high`);
});

const DEGREE = Math.PI / 180;

/**
 * Where a point shows in the view of a shot, as tangents from the middle of the view.
 * @returns {{x: number, y: number}} y as a share of the half height; x as a share of the half width
 */
function onScreen(shot, aspect, point) {
  const { yaw, pitch, fovY } = shot;
  const [ex, ey, ez] = AUDIENCE_SEAT;
  const d = [point[0] - ex, point[1] - ey, point[2] - ez];
  const forward = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const right = [Math.cos(yaw), -Math.sin(yaw), 0];
  const up = [-Math.sin(yaw) * Math.sin(pitch), -Math.cos(yaw) * Math.sin(pitch), Math.cos(pitch)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(d, forward);
  const half = Math.tan(fovY / 2);
  return { x: dot(d, right) / depth / (half * aspect), y: dot(d, up) / depth / half };
}

/** The corners of a box around a formation center. */
function box(centerHeight, size, depth = size) {
  const points = [];
  for (const x of [-size / 2, size / 2]) {
    for (const y of [-depth / 2, depth / 2]) {
      for (const z of [centerHeight - size / 2, centerHeight + size / 2]) points.push(x, y, z);
    }
  }
  return points;
}

test('a shot from the audience seat shows every point, with the horizon near the bottom', () => {
  const aspect = 16 / 9;
  const points = box(80, 60);
  const shot = audienceShot([points], aspect, SHOWTIME_MIN_FOV, SHOWTIME_MAX_FOV);
  for (let i = 0; i < points.length; i += 3) {
    const { x, y } = onScreen(shot, aspect, points.slice(i, i + 3));
    assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `corner ${i / 3} is at ${x}, ${y}`);
  }
  assert.ok(Math.abs(shot.yaw) < 1e-9, 'a show in the middle needs no yaw');
  // The horizon is in the lower quarter of the view.
  const horizon = Math.tan(-shot.pitch) / Math.tan(shot.fovY / 2);
  assert.ok(horizon > -1 && horizon < -0.5, `the horizon is at ${horizon}`);
  assert.ok(shot.fovY >= SHOWTIME_MIN_FOV && shot.fovY <= SHOWTIME_MAX_FOV);
});

test('a shot zooms in on a small show, and not past the narrowest view', () => {
  const near = audienceShot([box(30, 10)], 16 / 9, SHOWTIME_MIN_FOV, SHOWTIME_MAX_FOV);
  assert.equal(near.fovY, SHOWTIME_MIN_FOV);
  const large = audienceShot([box(120, 200)], 16 / 9, SHOWTIME_MIN_FOV, SHOWTIME_MAX_FOV);
  assert.ok(large.fovY > near.fovY);
});

test('a tall show drops the horizon, and a show that does not fit aims at its middle', () => {
  const aspect = 16 / 9;
  // From the seat, this tower reaches from about 23 to 59 degrees up.
  const tower = [0, 0, 70, 0, 0, 260];
  const fixed = audienceShot([tower], aspect, 50 * DEGREE, 50 * DEGREE);
  assert.equal(fixed.fovY, 50 * DEGREE);
  for (let i = 0; i < tower.length; i += 3) {
    const { y } = onScreen(fixed, aspect, tower.slice(i, i + 3));
    assert.ok(Math.abs(y) <= 1, `the tower point at ${tower[i + 2]} m is at ${y}`);
  }
  assert.ok(fixed.pitch - fixed.fovY / 2 > 0, 'the horizon is below the view');

  const huge = [0, 0, 1, 0, 0, 600];
  const centered = audienceShot([huge], aspect, 50 * DEGREE, 50 * DEGREE);
  const low = Math.atan2(1 - AUDIENCE_SEAT[2], -AUDIENCE_SEAT[1]);
  const high = Math.atan2(600 - AUDIENCE_SEAT[2], -AUDIENCE_SEAT[1]);
  assert.ok(Math.abs(centered.pitch - (low + high) / 2) < 1e-9);
});

test('a show to one side turns the shot toward it', () => {
  const points = box(60, 40).map((value, i) => (i % 3 === 0 ? value + 80 : value));
  const shot = audienceShot([points], 16 / 9, SHOWTIME_MIN_FOV, SHOWTIME_MAX_FOV);
  assert.ok(shot.yaw > 0.3, `yaw ${shot.yaw}`);
});

test('easing moves a shot toward its target by time, not by the number of frames', () => {
  const from = { yaw: 0, pitch: 0, fovY: 1 };
  const to = { yaw: 1, pitch: -1, fovY: 2 };
  const once = easeShot(from, to, 0.5);
  const twice = easeShot(easeShot(from, to, 0.25), to, 0.25);
  for (const key of ['yaw', 'pitch', 'fovY']) assert.ok(Math.abs(once[key] - twice[key]) < 1e-12);
  assert.ok(once.yaw > 0 && once.yaw < 1);
  const late = easeShot(from, to, 60);
  assert.ok(Math.abs(late.yaw - 1) < 1e-9);
  assert.deepEqual(easeShot(from, to, 0), from);
});

test('a camera aimed from the seat has its eye at the seat and looks along the shot', () => {
  const camera = createCamera();
  const shot = { yaw: 0.2, pitch: 0.4, fovY: 0.9 };
  aimFromSeat(camera, shot, 120);
  const eye = cameraEye(camera);
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(eye[axis] - AUDIENCE_SEAT[axis]) < 1e-9);
  const { forward, right, up, tanHalfFovY } = cameraAxes(camera);
  assert.ok(Math.abs(forward[2] - Math.sin(0.4)) < 1e-9);
  assert.ok(Math.abs(Math.atan2(forward[0], forward[1]) - 0.2) < 1e-9);
  assert.ok(Math.abs(right[2]) < 1e-12, 'the camera does not roll');
  assert.ok(up[2] > 0);
  assert.ok(Math.abs(tanHalfFovY - Math.tan(0.45)) < 1e-12);
});

test('the Audience view keeps the field of view and orbits about the formation', () => {
  const camera = createCamera();
  const fovY = camera.fovY;
  const points = box(60, 40);
  setAudienceView(camera, points, 16 / 9);
  assert.equal(camera.fovY, fovY);
  const eye = cameraEye(camera);
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(eye[axis] - AUDIENCE_SEAT[axis]) < 1e-9);
  // The orbit target is on the line of sight, as far away as the middle of the formation.
  const middle = Math.hypot(0 - AUDIENCE_SEAT[0], 0 - AUDIENCE_SEAT[1], 60 - AUDIENCE_SEAT[2]);
  assert.ok(Math.abs(camera.distance - middle) < 1e-9);
});
