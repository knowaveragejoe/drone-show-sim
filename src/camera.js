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

// The audience stands this far in front of the takeoff grid, meters.
export const AUDIENCE_DISTANCE = 150;
const AUDIENCE_EYE_HEIGHT = 1.7;

/** @returns {Camera} */
export function createCamera() {
  return {
    target: [0, 0, 30],
    distance: 190,
    azimuth: (35 * Math.PI) / 180,
    elevation: (12 * Math.PI) / 180,
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
 * Puts the camera where the audience stands and aims it at the formation center.
 * @param {Camera} camera
 * @param {number} centerHeight formation center height, meters
 */
export function setAudienceView(camera, centerHeight) {
  const rise = AUDIENCE_EYE_HEIGHT - centerHeight;
  camera.target = [0, 0, centerHeight];
  camera.distance = Math.hypot(AUDIENCE_DISTANCE, rise);
  camera.azimuth = 0;
  camera.elevation = Math.atan2(rise, AUDIENCE_DISTANCE);
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
 * Connects mouse input to the camera.
 * Drag orbits. Right-drag or Shift-drag pans. The wheel zooms.
 * @param {HTMLCanvasElement} canvas
 * @param {Camera} camera
 * @param {() => void} onChange called after each camera change
 * @param {(x: number, y: number) => void} onClick called for a press and release with no drag; CSS pixels in the canvas
 */
export function attachCameraControls(canvas, camera, onChange, onClick) {
  const CLICK_SLOP = 4;
  /** @type {{x: number, y: number, startX: number, startY: number, pan: boolean, moved: boolean} | null} */
  let drag = null;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    drag = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pan: event.button === 2 || event.shiftKey,
      moved: false,
    };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > CLICK_SLOP) {
      drag.moved = true;
    }
    if (!drag.moved) return;

    if (drag.pan) {
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
      const metersPerPixel = camera.distance / pixelsPerMeter(camera, canvas.clientHeight);
      camera.target[0] += (-dx * rx + dy * ux) * metersPerPixel;
      camera.target[1] += (-dx * ry + dy * uy) * metersPerPixel;
      camera.target[2] = Math.max(0, camera.target[2] + dy * uz * metersPerPixel);
    } else {
      camera.azimuth -= dx * 0.005;
      camera.elevation += dy * 0.005;
    }
    clampCamera(camera);
    onChange();
  });

  const endDrag = (/** @type {PointerEvent} */ event) => {
    if (!drag) return;
    const wasClick = !drag.moved && event.type === 'pointerup' && event.button === 0;
    drag = null;
    if (wasClick) {
      const rect = canvas.getBoundingClientRect();
      onClick(event.clientX - rect.left, event.clientY - rect.top);
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
