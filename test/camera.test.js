import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCamera, frameShow } from '../src/camera.js';

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
