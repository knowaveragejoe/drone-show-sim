// 4×4 matrix helpers for the camera. Matrices are column-major Float32Array(16), as WebGL expects.

/**
 * @param {Float32Array} out
 * @param {number} fovY vertical field of view, radians
 * @param {number} aspect width ÷ height
 * @param {number} near
 * @param {number} far
 */
export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/**
 * View matrix for a camera at `eye` that looks at `target`, with world Z up.
 * @param {Float32Array} out
 * @param {ArrayLike<number>} eye
 * @param {ArrayLike<number>} target
 */
export function lookAt(out, eye, target) {
  // Camera axes: z points from the target to the eye, x to the right, y up.
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz);
  zx /= len;
  zy /= len;
  zz /= len;

  // x = worldUp × z, with worldUp = (0, 0, 1).
  let xx = -zy;
  let xy = zx;
  len = Math.hypot(xx, xy);
  xx /= len;
  xy /= len;

  // y = z × x. The z part of x is 0.
  const yx = -zz * xy;
  const yy = zz * xx;
  const yz = zx * xy - zy * xx;

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = 0;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

/**
 * out = a × b. `out` can be the same array as `a` or `b`.
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
export function multiply(out, a, b) {
  const result = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      result[col * 4 + row] = sum;
    }
  }
  out.set(result);
  return out;
}

/**
 * Projects a world point to canvas pixels.
 * @param {Float32Array} viewProj
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} width canvas width in pixels
 * @param {number} height canvas height in pixels
 * @returns {[number, number] | null} null when the point is behind the camera
 */
export function projectToScreen(viewProj, x, y, z, width, height) {
  const w = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (w <= 0) return null;
  const clipX = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const clipY = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  return [(clipX / w * 0.5 + 0.5) * width, (0.5 - clipY / w * 0.5) * height];
}
