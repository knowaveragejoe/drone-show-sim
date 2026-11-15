// OBJ model import. Reads the triangles of a model and makes a candidate cloud on its surface.
// The parser reads vertices and faces only. It ignores materials, textures, and normals.

import { createRng } from './rng.js';
import { CLOUD_SIZE } from './shapes.js';

/**
 * Reads the triangles of an OBJ model. A face with more than three corners becomes
 * a fan of triangles around its first corner.
 * @param {string} text contents of the OBJ file
 * @returns {Float32Array} 9 numbers per triangle: xyz of each corner, in model axes
 */
export function parseObj(text) {
  /** @type {number[]} */
  const vertices = [];
  /** Vertex index of each triangle corner. @type {number[]} */
  const corners = [];

  const lines = text.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const parts = lines[lineIndex].trim().split(/\s+/);
    if (parts[0] === 'v') {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`OBJ line ${lineIndex + 1}: the vertex does not have three numbers.`);
      }
      vertices.push(x, y, z);
    } else if (parts[0] === 'f') {
      const vertexCount = vertices.length / 3;
      const face = [];
      for (let i = 1; i < parts.length; i++) {
        // A corner is "vertex", "vertex/texture", or "vertex/texture/normal".
        const index = parseInt(parts[i], 10);
        if (!Number.isInteger(index) || index === 0) {
          throw new Error(`OBJ line ${lineIndex + 1}: "${parts[i]}" is not a vertex number.`);
        }
        // Positive numbers count from 1. Negative numbers count back from the newest vertex.
        face.push(index > 0 ? index - 1 : vertexCount + index);
      }
      if (face.length < 3) {
        throw new Error(`OBJ line ${lineIndex + 1}: the face has fewer than three corners.`);
      }
      for (let i = 1; i + 1 < face.length; i++) corners.push(face[0], face[i], face[i + 1]);
    }
  }

  const vertexCount = vertices.length / 3;
  const triangles = new Float32Array(corners.length * 3);
  for (let i = 0; i < corners.length; i++) {
    const vertex = corners[i];
    if (vertex < 0 || vertex >= vertexCount) {
      throw new Error(`The OBJ file uses vertex ${vertex + 1}, but it has only ${vertexCount} vertices.`);
    }
    triangles[i * 3] = vertices[vertex * 3];
    triangles[i * 3 + 1] = vertices[vertex * 3 + 1];
    triangles[i * 3 + 2] = vertices[vertex * 3 + 2];
  }
  return triangles;
}

/**
 * Makes the candidate cloud of an OBJ model: random points on its surface, in unit space.
 * A larger triangle gets more points in proportion to its area.
 * @param {string} text contents of the OBJ file
 * @param {'y' | 'z'} upAxis the axis that points up in the model
 * @param {number} seed
 * @returns {Float32Array} xyz per point, `CLOUD_SIZE` points
 */
export function objCloud(text, upAxis, seed) {
  const triangles = parseObj(text);
  if (triangles.length === 0) throw new Error('The OBJ file has no faces.');

  if (upAxis === 'y') {
    // Turn the model a quarter turn about X: model Y becomes world Z (up),
    // and the model front (+Z) points to the audience (world -Y).
    for (let i = 0; i < triangles.length; i += 3) {
      const y = triangles[i + 1];
      triangles[i + 1] = -triangles[i + 2];
      triangles[i + 2] = y;
    }
  }

  // Move to unit space: centered on the origin, largest extent 1.
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i++) {
    low[i % 3] = Math.min(low[i % 3], triangles[i]);
    high[i % 3] = Math.max(high[i % 3], triangles[i]);
  }
  const extent = Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
  for (let i = 0; i < triangles.length; i++) {
    triangles[i] = (triangles[i] - (low[i % 3] + high[i % 3]) / 2) / extent;
  }

  // Running total of the triangle areas, to pick a triangle with a chance in proportion to its area.
  const triangleCount = triangles.length / 9;
  const areaUpTo = new Float64Array(triangleCount);
  let totalArea = 0;
  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const ux = triangles[o + 3] - triangles[o];
    const uy = triangles[o + 4] - triangles[o + 1];
    const uz = triangles[o + 5] - triangles[o + 2];
    const vx = triangles[o + 6] - triangles[o];
    const vy = triangles[o + 7] - triangles[o + 1];
    const vz = triangles[o + 8] - triangles[o + 2];
    totalArea += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    areaUpTo[t] = totalArea;
  }
  // A model with no extent gives NaN here, which also fails this check.
  if (!(totalArea > 0)) throw new Error('The OBJ model has no surface area.');

  const random = createRng(seed);
  const cloud = new Float32Array(CLOUD_SIZE * 3);
  for (let i = 0; i < CLOUD_SIZE; i++) {
    // Binary search for the first triangle whose running total passes the random area.
    const pick = random() * totalArea;
    let first = 0;
    let last = triangleCount - 1;
    while (first < last) {
      const middle = (first + last) >> 1;
      if (areaUpTo[middle] > pick) last = middle;
      else first = middle + 1;
    }
    // Uniform random point in the triangle. The square root keeps the points even.
    const root = Math.sqrt(random());
    const side = random();
    const a = 1 - root;
    const b = root * (1 - side);
    const c = root * side;
    const o = first * 9;
    for (let axis = 0; axis < 3; axis++) {
      cloud[i * 3 + axis] = a * triangles[o + axis] + b * triangles[o + 3 + axis] + c * triangles[o + 6 + axis];
    }
  }
  return cloud;
}
