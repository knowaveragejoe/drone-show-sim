// Orbit camera. The camera circles a target point. World Z is up.

import { lookAt, multiply, perspective } from './mat4.js';

/**
 * @typedef {object} Camera
 * @property {number[]} target point that the camera looks at, meters
 * @property {number} distance from the target to the eye, meters
 * @property {number} azimuth radians; 0 puts the eye on the audience side (negative Y)
 * @property {number} elevation radians; positive puts the eye above the target
 * @property {number} fovY vertical field of view, radians
 */

const MIN_DISTANCE = 2;
const MAX_DISTANCE = 3000;
const MAX_ELEVATION = (89 * Math.PI) / 180;
// The eye stays above the ground.
const MIN_EYE_HEIGHT = 0.3;

// The front row of the audience stands this far in front of the takeoff grid, meters.
export const AUDIENCE_DISTANCE = 150;
// The audience seat: the place in the crowd where the Audience view and Showtime put the
// camera. It is at eye height, this far behind the front row, so heads show in front of it.
const SEAT_BEHIND_FRONT = 10;
const AUDIENCE_EYE_HEIGHT = 1.7;
export const AUDIENCE_SEAT = [0, -(AUDIENCE_DISTANCE + SEAT_BEHIND_FRONT), AUDIENCE_EYE_HEIGHT];

const DEGREE = Math.PI / 180;
// A shot from the audience seat shows this much ground below the horizon, when the show
// leaves room for it: the heads of the crowd and the field.
const GROUND_BELOW_HORIZON = 3 * DEGREE;
// A shot keeps this share of the view free at each edge.
const SHOT_MARGIN = 0.08;
// Showtime zooms between these fields of view, radians.
export const SHOWTIME_MIN_FOV = 30 * DEGREE;
export const SHOWTIME_MAX_FOV = 75 * DEGREE;
// The Showtime camera eases to a new shot: it closes 63 percent (1 - 1/e) of the gap in
// this many seconds.
const SHOT_EASE_SECONDS = 1.2;

/** @returns {Camera} */
export function createCamera() {
  return {
    target: [0, 0, 45],
    distance: 240,
    azimuth: (30 * Math.PI) / 180,
    elevation: (10 * Math.PI) / 180,
    fovY: (50 * Math.PI) / 180,
  };
}

/**
 * @param {Camera} camera
 * @returns {number[]} eye position
 */
export function cameraEye(camera) {
  const horizontal = Math.cos(camera.elevation) * camera.distance;
  return [
    camera.target[0] + horizontal * Math.sin(camera.azimuth),
    camera.target[1] - horizontal * Math.cos(camera.azimuth),
    camera.target[2] + Math.sin(camera.elevation) * camera.distance,
  ];
}

/**
 * @param {Camera} camera
 * @param {number} aspect canvas width ÷ height
 * @param {Float32Array} out
 */
export function viewProjection(camera, aspect, out) {
  const view = lookAt(new Float32Array(16), cameraEye(camera), camera.target);
  perspective(out, camera.fovY, aspect, 0.5, 10000);
  return multiply(out, out, view);
}

/**
 * Screen pixels that 1 meter covers at a distance of 1 meter.
 * @param {Camera} camera
 * @param {number} heightPixels
 */
export function pixelsPerMeter(camera, heightPixels) {
  return heightPixels / (2 * Math.tan(camera.fovY / 2));
}

/**
 * Where the camera looks from the audience seat.
 * @typedef {object} Shot
 * @property {number} yaw radians; 0 looks toward positive Y, a positive yaw turns toward positive X
 * @property {number} pitch radians; a positive pitch looks up
 * @property {number} fovY vertical field of view, radians
 */

/**
 * Finds the shot from the audience seat that shows all the given points.
 *
 * The shot looks at the middle of the points from left to right. When the points leave room,
 * the bottom of the view shows a little ground below the horizon, and the spare room goes
 * above the points, as a person in the crowd sees a show. The field of view grows from
 * `minFov` until the points fit, up to `maxFov`. When the points do not fit with the ground,
 * the ground goes out of the view. When they do not fit at all, the shot aims at their middle.
 * @param {ArrayLike<number>[]} pointSets lists of points, xyz per point
 * @param {number} aspect view width ÷ height
 * @param {number} minFov radians
 * @param {number} maxFov radians
 * @returns {Shot}
 */
export function audienceShot(pointSets, aspect, minFov, maxFov) {
  const [ex, ey, ez] = AUDIENCE_SEAT;
  let left = Infinity;
  let right = -Infinity;
  let low = Infinity;
  let high = -Infinity;
  for (const points of pointSets) {
    for (let i = 0; i + 2 < points.length; i += 3) {
      const dx = points[i] - ex;
      const dy = points[i + 1] - ey;
      const yaw = Math.atan2(dx, dy);
      const elevation = Math.atan2(points[i + 2] - ez, Math.hypot(dx, dy));
      left = Math.min(left, yaw);
      right = Math.max(right, yaw);
      low = Math.min(low, elevation);
      high = Math.max(high, elevation);
    }
  }
  if (!Number.isFinite(low)) return { yaw: 0, pitch: minFov / 2 - GROUND_BELOW_HORIZON, fovY: minFov };

  const yaw = (left + right) / 2;
  const free = 1 - 2 * SHOT_MARGIN;
  // The vertical field of view that the width of the points needs.
  const halfWidth = Math.min((right - left) / 2 / free, 80 * DEGREE);
  const widthFov = 2 * Math.atan(Math.tan(halfWidth) / aspect);
  const fovFor = (/** @type {number} */ bottom) => Math.max(minFov, widthFov, (high - bottom) / free);

  let bottom = Math.min(low, -GROUND_BELOW_HORIZON);
  if (fovFor(bottom) > maxFov) bottom = low;
  let fovY = Math.min(maxFov, fovFor(bottom));
  // The bottom edge of the view sits one margin below `bottom`.
  let pitch = bottom - SHOT_MARGIN * fovY + fovY / 2;
  if ((high - low) / free > fovY) pitch = (low + high) / 2;

  // The angles above are exact only in the middle of the view. Near its edges a perspective
  // view shows a point a little higher or lower. Grow the view until every point fits.
  const needed = shotExtent(pointSets, yaw, pitch, aspect) / free;
  fovY = Math.min(maxFov, Math.max(fovY, 2 * Math.atan(needed)));
  return { yaw, pitch, fovY };
}

/**
 * How far from the middle of a view the points reach, as the tangent of the vertical
 * half angle that holds them.
 * @param {ArrayLike<number>[]} pointSets lists of points, xyz per point
 * @param {number} yaw radians
 * @param {number} pitch radians
 * @param {number} aspect view width ÷ height
 * @returns {number}
 */
function shotExtent(pointSets, yaw, pitch, aspect) {
  const [ex, ey, ez] = AUDIENCE_SEAT;
  const forward = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const right = [Math.cos(yaw), -Math.sin(yaw), 0];
  const up = [-Math.sin(yaw) * Math.sin(pitch), -Math.cos(yaw) * Math.sin(pitch), Math.cos(pitch)];
  let extent = 0;
  for (const points of pointSets) {
    for (let i = 0; i + 2 < points.length; i += 3) {
      const dx = points[i] - ex;
      const dy = points[i + 1] - ey;
      const dz = points[i + 2] - ez;
      const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
      if (depth <= 0) continue;
      const across = Math.abs(dx * right[0] + dy * right[1]) / depth / aspect;
      const above = Math.abs(dx * up[0] + dy * up[1] + dz * up[2]) / depth;
      extent = Math.max(extent, across, above);
    }
  }
  return extent;
}

/**
 * Moves a shot part of the way to a new shot. The step depends on the time only, not on the
 * number of frames in that time.
 * @param {Shot} current
 * @param {Shot} target
 * @param {number} seconds time since the last frame
 * @returns {Shot}
 */
export function easeShot(current, target, seconds) {
  const share = 1 - Math.exp(-seconds / SHOT_EASE_SECONDS);
  return {
    yaw: current.yaw + (target.yaw - current.yaw) * share,
    pitch: current.pitch + (target.pitch - current.pitch) * share,
    fovY: current.fovY + (target.fovY - current.fovY) * share,
  };
}

/**
 * Puts the camera at the audience seat with a shot. The orbit target goes on the line of
 * sight, at a given distance, so that an orbit after the shot turns about that point.
 * @param {Camera} camera
 * @param {Shot} shot
 * @param {number} distance meters from the seat to the orbit target
 */
export function aimFromSeat(camera, { yaw, pitch, fovY }, distance) {
  const [x, y, z] = AUDIENCE_SEAT;
  camera.target = [
    x + distance * Math.sin(yaw) * Math.cos(pitch),
    y + distance * Math.cos(yaw) * Math.cos(pitch),
    z + distance * Math.sin(pitch),
  ];
  camera.distance = distance;
  // The eye is on the other side of the target: an eye below the target looks up.
  camera.azimuth = -yaw;
  camera.elevation = -pitch;
  camera.fovY = fovY;
}

/**
 * Puts the camera at the audience seat and aims it at a formation. The field of view does
 * not change. The orbit target is the middle of the formation.
 * @param {Camera} camera
 * @param {ArrayLike<number>} points the targets of the formation, xyz per target
 * @param {number} aspect view width ÷ height
 */
export function setAudienceView(camera, points, aspect) {
  const shot = audienceShot([points], aspect, camera.fovY, camera.fovY);
  let x = 0;
  let y = 0;
  let z = 0;
  const count = points.length / 3;
  for (let i = 0; i < points.length; i += 3) {
    x += points[i] / count;
    y += points[i + 1] / count;
    z += points[i + 2] / count;
  }
  const [sx, sy, sz] = AUDIENCE_SEAT;
  aimFromSeat(camera, shot, Math.max(MIN_DISTANCE, Math.hypot(x - sx, y - sy, z - sz)));
}

/**
 * The axes of the camera in world space, for a shader that draws the sky and the ground.
 * @param {Camera} camera
 * @returns {{eye: number[], forward: number[], right: number[], up: number[], tanHalfFovY: number}}
 */
export function cameraAxes(camera) {
  const eye = cameraEye(camera);
  const forward = camera.target.map((value, axis) => (value - eye[axis]) / camera.distance);
  // The camera never rolls, so its right axis is horizontal.
  const length = Math.hypot(forward[0], forward[1]) || 1;
  const right = [forward[1] / length, -forward[0] / length, 0];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { eye, forward, right, up, tanHalfFovY: Math.tan(camera.fovY / 2) };
}

// When the camera frames a show, the formations fill this share of the view height or less.
const FRAME_FILL = 0.75;

/**
 * Aims the camera at the formations of a show, from the start direction. The camera aims at
 * the middle between the lowest bottom and the highest top of the formations. It stays at the
 * start distance, or moves back until that span fills `FRAME_FILL` of the view height.
 * @param {Camera} camera
 * @param {{centerHeight: number, size: number}[]} formations
 */
export function frameShow(camera, formations) {
  let bottom = Infinity;
  let top = -Infinity;
  for (const { centerHeight, size } of formations) {
    bottom = Math.min(bottom, centerHeight - size / 2);
    top = Math.max(top, centerHeight + size / 2);
  }
  const start = createCamera();
  camera.target = [0, 0, (bottom + top) / 2];
  camera.azimuth = start.azimuth;
  camera.elevation = start.elevation;
  const fitDistance = (top - bottom) / FRAME_FILL / (2 * Math.tan(camera.fovY / 2));
  camera.distance = Math.max(start.distance, fitDistance);
  clampCamera(camera);
}

/** @param {Camera} camera */
function clampCamera(camera) {
  camera.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, camera.distance));
  const sinFloor = (MIN_EYE_HEIGHT - camera.target[2]) / camera.distance;
  const floor = sinFloor >= 1 ? MAX_ELEVATION : Math.asin(Math.max(-1, sinFloor));
  const low = Math.max(-MAX_ELEVATION, floor);
  camera.elevation = Math.min(MAX_ELEVATION, Math.max(low, camera.elevation));
}

/**
 * Moves the camera target across the view, as a drag of the view moves it: the scene follows
 * the pointer. The target stays above the ground.
 * @param {Camera} camera
 * @param {number} dx move to the right, CSS pixels
 * @param {number} dy move down, CSS pixels
 * @param {number} viewHeight height of the view, CSS pixels
 */
export function panCamera(camera, dx, dy, viewHeight) {
  const eye = cameraEye(camera);
  // Camera axes in world space: right is horizontal, up completes the frame.
  const fx = (camera.target[0] - eye[0]) / camera.distance;
  const fy = (camera.target[1] - eye[1]) / camera.distance;
  const fz = (camera.target[2] - eye[2]) / camera.distance;
  const rightLength = Math.hypot(fx, fy);
  const rx = fy / rightLength;
  const ry = -fx / rightLength;
  const ux = ry * fz;
  const uy = -rx * fz;
  const uz = rx * fy - ry * fx;
  const metersPerPixel = camera.distance / pixelsPerMeter(camera, viewHeight);
  camera.target[0] += (-dx * rx + dy * ux) * metersPerPixel;
  camera.target[1] += (-dx * ry + dy * uy) * metersPerPixel;
  camera.target[2] = Math.max(0, camera.target[2] + dy * uz * metersPerPixel);
}

/**
 * One step of a two-finger gesture. Fingers that move apart zoom in, and the point between
 * the fingers pans the view.
 * @param {{x: number, y: number}[]} before the two fingers before the step, CSS pixels
 * @param {{x: number, y: number}[]} after the same two fingers after the step
 * @returns {{scale: number, dx: number, dy: number}} the factor for the camera distance, and the
 *   move of the point between the fingers, CSS pixels
 */
export function pinchStep(before, after) {
  const span = (/** @type {{x: number, y: number}[]} */ [a, b]) => Math.hypot(b.x - a.x, b.y - a.y);
  const spanBefore = span(before);
  const spanAfter = span(after);
  return {
    scale: spanBefore > 0 && spanAfter > 0 ? spanBefore / spanAfter : 1,
    dx: (after[0].x + after[1].x - before[0].x - before[1].x) / 2,
    dy: (after[0].y + after[1].y - before[0].y - before[1].y) / 2,
  };
}

/**
 * Connects mouse and touch input to the camera.
 * Mouse: drag orbits, right-drag or Shift-drag pans, and the wheel zooms.
 * Touch: one finger orbits, and two fingers pinch to zoom and move together to pan.
 * A press and release with no drag is a click, or a tap.
 * @param {HTMLCanvasElement} canvas
 * @param {Camera} camera
 * @param {() => void} onChange called after each camera change
 * @param {(x: number, y: number, touch: boolean) => void} onClick called for a press and release
 *   with no drag; CSS pixels in the canvas; true for a tap of a finger
 */
export function attachCameraControls(canvas, camera, onChange, onClick) {
  // A pointer that moves less than this, CSS pixels, still clicks. A finger moves more than a mouse.
  const CLICK_SLOP = 4;
  const TAP_SLOP = 10;
  /** The pointers that are down, by id. @type {Map<number, {x: number, y: number}>} */
  const pointers = new Map();
  /**
   * The drag of one pointer. `moved` stays true for a drag that started as a pinch, so its
   * end is not a tap.
   * @type {{startX: number, startY: number, pan: boolean, moved: boolean, slop: number} | null}
   */
  let drag = null;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    drag =
      pointers.size === 1
        ? {
            startX: event.clientX,
            startY: event.clientY,
            pan: event.button === 2 || event.shiftKey,
            moved: false,
            slop: event.pointerType === 'touch' ? TAP_SLOP : CLICK_SLOP,
          }
        : null;
  });

  canvas.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const point = { x: event.clientX, y: event.clientY };

    if (pointers.size >= 2) {
      // The first two fingers make the gesture. A third finger does nothing.
      const ids = [...pointers.keys()].slice(0, 2);
      const before = ids.map((id) => /** @type {{x: number, y: number}} */ (pointers.get(id)));
      pointers.set(event.pointerId, point);
      if (!ids.includes(event.pointerId)) return;
      const after = ids.map((id) => /** @type {{x: number, y: number}} */ (pointers.get(id)));
      const { scale, dx, dy } = pinchStep(before, after);
      camera.distance *= scale;
      panCamera(camera, dx, dy, canvas.clientHeight);
      clampCamera(camera);
      onChange();
      return;
    }

    pointers.set(event.pointerId, point);
    if (!drag) return;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > drag.slop) drag.moved = true;
    if (!drag.moved) return;
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (drag.pan) {
      panCamera(camera, dx, dy, canvas.clientHeight);
    } else {
      camera.azimuth -= dx * 0.005;
      camera.elevation += dy * 0.005;
    }
    clampCamera(camera);
    onChange();
  });

  const endDrag = (/** @type {PointerEvent} */ event) => {
    if (!pointers.has(event.pointerId)) return;
    const wasClick = drag !== null && !drag.moved && event.type === 'pointerup' && event.button === 0;
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      // One finger stays after a pinch: it orbits from where it is, and it is not a tap.
      const [rest] = pointers.values();
      drag = { startX: rest.x, startY: rest.y, pan: false, moved: true, slop: TAP_SLOP };
    } else if (pointers.size === 0) {
      drag = null;
    }
    if (wasClick) {
      const rect = canvas.getBoundingClientRect();
      onClick(event.clientX - rect.left, event.clientY - rect.top, event.pointerType === 'touch');
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      camera.distance *= Math.exp(event.deltaY * 0.001);
      clampCamera(camera);
      onChange();
    },
    { passive: false },
  );

  // Right-drag pans, so the context menu must stay closed.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
}
