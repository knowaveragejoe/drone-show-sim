// Built-in shapes. Each shape makes a candidate cloud: a dense set of random points on the shape.
//
// Points are in unit space: the shape is centered on the origin and its largest extent is 1.
// Axes: X to the right of the audience, Y away from the audience, Z up.
// Flat shapes stand upright in the XZ plane, so they face the audience.
//
// A shape is a surface or a curve. The points of a surface are random and spread evenly
// over its area. The points of a curve are in order along the curve, and spread evenly
// along its length: the curve is cut into `CLOUD_SIZE` slices of equal length, and each
// slice gets one point at a random place in it.

import { createRng } from './rng.js';

/** Number of points in a candidate cloud. */
export const CLOUD_SIZE = 40000;

const TWO_PI = Math.PI * 2;

const TORUS_RING_RADIUS = 0.35;
const TORUS_TUBE_RADIUS = 0.15;

const HELIX_RADIUS = 0.22;
const HELIX_TURNS = 3;

/**
 * The classic heart curve, before scaling.
 * @param {number} t angle, radians
 * @returns {[number, number]} horizontal and vertical coordinate
 */
function heartCurve(t) {
  const horizontal = 16 * Math.sin(t) ** 3;
  const vertical = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return [horizontal, vertical];
}

// The heart curve is 32 units wide, which is its largest extent. Its vertical range is not
// symmetric, so the middle of that range moves to the origin.
const HEART_SCALE = 1 / 32;
const HEART_MIDDLE = (() => {
  let low = Infinity;
  let high = -Infinity;
  for (let step = 0; step < 2000; step++) {
    const vertical = heartCurve((step / 2000) * TWO_PI)[1];
    low = Math.min(low, vertical);
    high = Math.max(high, vertical);
  }
  return (low + high) / 2;
})();

/**
 * Writes one random point of a surface.
 * @callback PointWriter
 * @param {() => number} random
 * @param {Float32Array} out
 * @param {number} offset index of the x value in `out`
 */

/**
 * Writes the point of a curve at one place along it.
 * @callback CurveWriter
 * @param {number} t place on the curve, from 0 at its start to 1 at its end
 * @param {Float32Array} out
 * @param {number} offset index of the x value in `out`
 */

/**
 * A built-in shape: a surface with `point`, or a curve with `curve`.
 * @typedef {{label: string, point: PointWriter, curve?: undefined}
 *   | {label: string, curve: CurveWriter, point?: undefined}} BuiltinShape
 */

/** @type {Record<string, BuiltinShape>} */
export const BUILTIN_SHAPES = {
  sphere: {
    label: 'Sphere',
    point(random, out, offset) {
      const z = 2 * random() - 1;
      const radius = 0.5 * Math.sqrt(1 - z * z);
      const angle = TWO_PI * random();
      out[offset] = radius * Math.cos(angle);
      out[offset + 1] = radius * Math.sin(angle);
      out[offset + 2] = 0.5 * z;
    },
  },

  cube: {
    label: 'Cube',
    point(random, out, offset) {
      const face = Math.floor(random() * 6);
      const axis = face >> 1;
      out[offset + axis] = face & 1 ? 0.5 : -0.5;
      out[offset + ((axis + 1) % 3)] = random() - 0.5;
      out[offset + ((axis + 2) % 3)] = random() - 0.5;
    },
  },

  torus: {
    label: 'Torus',
    point(random, out, offset) {
      // The outer side of the tube has more area than the inner side.
      // Rejection sampling keeps the points uniform over the surface.
      let tubeAngle;
      let distance;
      do {
        tubeAngle = TWO_PI * random();
        distance = TORUS_RING_RADIUS + TORUS_TUBE_RADIUS * Math.cos(tubeAngle);
      } while (random() * (TORUS_RING_RADIUS + TORUS_TUBE_RADIUS) > distance);
      const ringAngle = TWO_PI * random();
      out[offset] = distance * Math.cos(ringAngle);
      out[offset + 1] = TORUS_TUBE_RADIUS * Math.sin(tubeAngle);
      out[offset + 2] = distance * Math.sin(ringAngle);
    },
  },

  disc: {
    label: 'Disc',
    point(random, out, offset) {
      const radius = 0.5 * Math.sqrt(random());
      const angle = TWO_PI * random();
      out[offset] = radius * Math.cos(angle);
      out[offset + 1] = 0;
      out[offset + 2] = radius * Math.sin(angle);
    },
  },

  ring: {
    label: 'Ring',
    curve(t, out, offset) {
      const angle = TWO_PI * t;
      out[offset] = 0.5 * Math.cos(angle);
      out[offset + 1] = 0;
      out[offset + 2] = 0.5 * Math.sin(angle);
    },
  },

  helix: {
    label: 'Helix',
    curve(t, out, offset) {
      const angle = TWO_PI * HELIX_TURNS * t;
      out[offset] = HELIX_RADIUS * Math.cos(angle);
      out[offset + 1] = HELIX_RADIUS * Math.sin(angle);
      out[offset + 2] = t - 0.5;
    },
  },

  heart: {
    label: 'Heart',
    curve(t, out, offset) {
      const [horizontal, vertical] = heartCurve(TWO_PI * t);
      out[offset] = horizontal * HEART_SCALE;
      out[offset + 1] = 0;
      out[offset + 2] = (vertical - HEART_MIDDLE) * HEART_SCALE;
    },
  },
};

// A curve is measured as this many straight pieces, to find places of equal length on it.
const CURVE_PIECES = 4096;

/**
 * Makes the candidate cloud of a built-in shape.
 * @param {string} shape key of `BUILTIN_SHAPES`
 * @param {number} seed
 * @returns {Float32Array} xyz per point, `CLOUD_SIZE` points
 */
export function builtinCloud(shape, seed) {
  if (!Object.hasOwn(BUILTIN_SHAPES, shape)) throw new Error(`Unknown shape "${shape}".`);
  const generator = BUILTIN_SHAPES[shape];
  const random = createRng(seed);
  const cloud = new Float32Array(CLOUD_SIZE * 3);
  if (generator.curve) return curveCloud(generator.curve, random, cloud);
  for (let i = 0; i < CLOUD_SIZE; i++) generator.point(random, cloud, i * 3);
  return cloud;
}

/**
 * Fills a cloud with points in order along a curve, one in each slice of equal length.
 * @param {CurveWriter} curve
 * @param {() => number} random
 * @param {Float32Array} cloud xyz per point, `CLOUD_SIZE` points; the function fills it
 * @returns {Float32Array} `cloud`
 */
function curveCloud(curve, random, cloud) {
  // Length from the start of the curve to the end of each piece.
  const lengthUpTo = new Float64Array(CURVE_PIECES + 1);
  const point = new Float32Array(6);
  curve(0, point, 0);
  for (let piece = 1; piece <= CURVE_PIECES; piece++) {
    curve(piece / CURVE_PIECES, point, 3);
    const length = Math.hypot(point[3] - point[0], point[4] - point[1], point[5] - point[2]);
    lengthUpTo[piece] = lengthUpTo[piece - 1] + length;
    point.copyWithin(0, 3, 6);
  }
  const total = lengthUpTo[CURVE_PIECES];
  let piece = 0;
  for (let i = 0; i < CLOUD_SIZE; i++) {
    const along = ((i + random()) / CLOUD_SIZE) * total;
    // The places grow, so the piece that holds the place only moves forward.
    while (piece < CURVE_PIECES - 1 && lengthUpTo[piece + 1] < along) piece++;
    const share = (along - lengthUpTo[piece]) / (lengthUpTo[piece + 1] - lengthUpTo[piece] || 1);
    curve((piece + Math.min(1, Math.max(0, share))) / CURVE_PIECES, cloud, i * 3);
  }
  return cloud;
}

/**
 * @param {string} shape key of `BUILTIN_SHAPES`
 * @returns {boolean} true when the shape is a curve, so its cloud is in order along it
 */
export function isCurve(shape) {
  return Boolean(BUILTIN_SHAPES[shape]?.curve);
}
