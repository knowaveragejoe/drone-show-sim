// Built-in shapes. Each shape makes a candidate cloud: a dense set of random points on the shape.
//
// Points are in unit space: the shape is centered on the origin and its largest extent is 1.
// Axes: X to the right of the audience, Y away from the audience, Z up.
// Flat shapes stand upright in the XZ plane, so they face the audience.

import { createRng } from './rng.js';

/** Number of points in a candidate cloud. */
export const CLOUD_SIZE = 20000;

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
 * Writes one random point of a shape.
 * @callback PointWriter
 * @param {() => number} random
 * @param {Float32Array} out
 * @param {number} offset index of the x value in `out`
 */

/** @type {Record<string, {label: string, point: PointWriter}>} */
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
    point(random, out, offset) {
      const angle = TWO_PI * random();
      out[offset] = 0.5 * Math.cos(angle);
      out[offset + 1] = 0;
      out[offset + 2] = 0.5 * Math.sin(angle);
    },
  },

  helix: {
    label: 'Helix',
    point(random, out, offset) {
      const along = random();
      const angle = TWO_PI * HELIX_TURNS * along;
      out[offset] = HELIX_RADIUS * Math.cos(angle);
      out[offset + 1] = HELIX_RADIUS * Math.sin(angle);
      out[offset + 2] = along - 0.5;
    },
  },

  heart: {
    label: 'Heart',
    point(random, out, offset) {
      const [horizontal, vertical] = heartCurve(TWO_PI * random());
      out[offset] = horizontal * HEART_SCALE;
      out[offset + 1] = 0;
      out[offset + 2] = (vertical - HEART_MIDDLE) * HEART_SCALE;
    },
  },
};

/**
 * Makes the candidate cloud of a built-in shape.
 * @param {string} shape key of `BUILTIN_SHAPES`
 * @param {number} seed
 * @returns {Float32Array} xyz per point, `CLOUD_SIZE` points
 */
export function builtinCloud(shape, seed) {
  const generator = BUILTIN_SHAPES[shape];
  if (!generator) throw new Error(`Unknown shape "${shape}".`);
  const random = createRng(seed);
  const cloud = new Float32Array(CLOUD_SIZE * 3);
  for (let i = 0; i < CLOUD_SIZE; i++) generator.point(random, cloud, i * 3);
  return cloud;
}
