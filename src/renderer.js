// WebGL2 renderer for the ground grid, the flight volume, the flight paths, and the drone lights.
// Every draw call uses additive blending and nothing is opaque, so no depth buffer is necessary.

import { AUDIENCE_DISTANCE } from './camera.js';

const POINT_VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProj;
uniform float uPixelsPerMeter;
uniform float uSize;
uniform float uMinPixels;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  gl_PointSize = max(uSize * uPixelsPerMeter / gl_Position.w, uMinPixels);
}`;

const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  // 0 at the center of the point, 1 at its edge.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float halo = pow(max(1.0 - d, 0.0), 2.5);
  float core = smoothstep(0.4, 0.1, d);
  outColor = vec4(uColor * halo + vec3(0.55) * core, 1.0);
}`;

const LINE_VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProj;
out vec2 vGround;
void main() {
  vGround = aPosition.xy;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uColor;
// Lines fade out between these two distances from the world origin, in meters.
uniform vec2 uFade;
in vec2 vGround;
out vec4 outColor;
void main() {
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, length(vGround));
  outColor = vec4(uColor * fade, 1.0);
}`;

const GROUND_EXTENT = 400;
const GROUND_STEP = 10;
const GROUND_FADE = [120, 400];
const GROUND_COLOR = [0.1, 0.13, 0.2];
const NO_FADE = [1e9, 2e9];

// Half the length of the ground line that marks where the audience stands, meters.
const AUDIENCE_HALF_WIDTH = 40;
const AUDIENCE_COLOR = [0.45, 0.35, 0.15];

const VOLUME_COLOR = [0.2, 0.3, 0.42];
// Color of the flight volume when a drone leaves it.
const VOLUME_BROKEN_COLOR = [0.9, 0.2, 0.2];

// Diameter of the glow around one drone, meters.
const LIGHT_SIZE = 1.6;
const SELECTED_LIGHT_SIZE = 5;
// Far drones stay visible: a light never gets smaller than this many CSS pixels.
const MIN_LIGHT_PIXELS = 4;
const MIN_SELECTED_PIXELS = 14;

// Number of short segments in one line. See `addLine` for the reason.
const PATH_PARTS = 8;
const VOLUME_EDGE_PARTS = 16;
// Brightness of a path that is not selected, as a share of the light color.
const PATH_BRIGHTNESS = 0.1;

/**
 * @typedef {object} Frame
 * @property {Float32Array} viewProj
 * @property {number} pixelsPerMeter screen pixels that 1 m covers at a distance of 1 m
 * @property {Float32Array} positions xyz per drone
 * @property {number} count number of drones
 * @property {number[]} color light color, each channel 0 to 1
 * @property {number} selected index of the selected drone, or -1
 * @property {boolean} showPaths
 * @property {boolean} showVolume
 * @property {boolean} volumeBroken true when a drone leaves the flight volume
 */

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('This browser does not support WebGL2.');

  const pointProgram = createProgram(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);
  const lineProgram = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
  const pointUniforms = uniformLocations(gl, pointProgram, [
    'uViewProj',
    'uPixelsPerMeter',
    'uSize',
    'uMinPixels',
    'uColor',
  ]);
  const lineUniforms = uniformLocations(gl, lineProgram, ['uViewProj', 'uColor', 'uFade']);

  const ground = createLines(gl, lineProgram);
  ground.set(groundGrid());
  const audience = createLines(gl, lineProgram);
  audience.set([
    -AUDIENCE_HALF_WIDTH, -AUDIENCE_DISTANCE, 0,
    AUDIENCE_HALF_WIDTH, -AUDIENCE_DISTANCE, 0,
  ]);
  const volume = createLines(gl, lineProgram);
  const paths = createLines(gl, lineProgram);
  const drones = createVertexArray(gl, pointProgram);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0.016, 0.02, 0.043, 1);

  /**
   * Stores the flight path of each drone: a straight line from start to target.
   * @param {Float32Array} starts xyz per drone
   * @param {Float32Array} targets xyz per drone
   * @param {number} count
   */
  function setPaths(starts, targets, count) {
    /** @type {number[]} */
    const vertices = [];
    for (let drone = 0; drone < count; drone++) {
      const from = starts.subarray(drone * 3, drone * 3 + 3);
      const to = targets.subarray(drone * 3, drone * 3 + 3);
      addLine(vertices, from, to, PATH_PARTS);
    }
    paths.set(vertices);
  }

  /**
   * Stores the flight volume: the 12 edges of a box.
   * @param {import('./plan.js').Bounds} bounds
   */
  function setVolume({ low, high }) {
    /** @type {number[]} */
    const vertices = [];
    for (let axis = 0; axis < 3; axis++) {
      // The four edges that run along this axis.
      const side = (axis + 1) % 3;
      const other = (axis + 2) % 3;
      for (const sideValue of [low[side], high[side]]) {
        for (const otherValue of [low[other], high[other]]) {
          const from = [0, 0, 0];
          from[side] = sideValue;
          from[other] = otherValue;
          const to = [...from];
          from[axis] = low[axis];
          to[axis] = high[axis];
          addLine(vertices, from, to, VOLUME_EDGE_PARTS);
        }
      }
    }
    volume.set(vertices);
  }

  /** @param {Frame} frame */
  function draw(frame) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.uViewProj, false, frame.viewProj);

    // Near the horizon many ground lines share a pixel. MAX blending keeps them from
    // adding up to a bright band.
    gl.blendEquation(gl.MAX);
    gl.uniform2fv(lineUniforms.uFade, GROUND_FADE);
    gl.uniform3fv(lineUniforms.uColor, GROUND_COLOR);
    ground.draw();
    gl.blendEquation(gl.FUNC_ADD);

    gl.uniform2fv(lineUniforms.uFade, NO_FADE);
    gl.uniform3fv(lineUniforms.uColor, AUDIENCE_COLOR);
    audience.draw();

    if (frame.showVolume) {
      gl.uniform3fv(lineUniforms.uColor, frame.volumeBroken ? VOLUME_BROKEN_COLOR : VOLUME_COLOR);
      volume.draw();
    }

    const selected = frame.selected >= 0 && frame.selected < frame.count ? frame.selected : -1;
    if (frame.showPaths) {
      gl.uniform3fv(
        lineUniforms.uColor,
        frame.color.map((channel) => channel * PATH_BRIGHTNESS),
      );
      paths.draw();
    }
    if (selected >= 0) {
      gl.uniform3f(lineUniforms.uColor, 1, 1, 1);
      paths.draw(selected * PATH_PARTS, PATH_PARTS);
    }

    gl.useProgram(pointProgram);
    gl.uniformMatrix4fv(pointUniforms.uViewProj, false, frame.viewProj);
    gl.uniform1f(pointUniforms.uPixelsPerMeter, frame.pixelsPerMeter * dpr);
    gl.bindVertexArray(drones.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, drones.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame.positions, gl.DYNAMIC_DRAW);

    gl.uniform1f(pointUniforms.uSize, LIGHT_SIZE);
    gl.uniform1f(pointUniforms.uMinPixels, MIN_LIGHT_PIXELS * dpr);
    gl.uniform3fv(pointUniforms.uColor, frame.color);
    gl.drawArrays(gl.POINTS, 0, frame.count);

    if (selected >= 0) {
      gl.uniform1f(pointUniforms.uSize, SELECTED_LIGHT_SIZE);
      gl.uniform1f(pointUniforms.uMinPixels, MIN_SELECTED_PIXELS * dpr);
      gl.uniform3f(pointUniforms.uColor, 1, 1, 1);
      gl.drawArrays(gl.POINTS, selected, 1);
    }
    gl.bindVertexArray(null);
  }

  return { draw, setPaths, setVolume };
}

/**
 * Adds one straight line to a vertex list, as short segments.
 *
 * Some WebGL implementations drop a whole segment when one end is behind the camera.
 * A long line would then vanish when the camera is near it. Short segments limit the loss
 * to the part next to the camera.
 * @param {number[]} vertices xyz of each segment end; the function adds to this list
 * @param {ArrayLike<number>} from
 * @param {ArrayLike<number>} to
 * @param {number} parts number of segments
 */
function addLine(vertices, from, to, parts) {
  for (let part = 0; part < parts; part++) {
    for (const share of [part / parts, (part + 1) / parts]) {
      for (let axis = 0; axis < 3; axis++) {
        vertices.push(from[axis] + share * (to[axis] - from[axis]));
      }
    }
  }
}

/** @returns {number[]} line segments of a square grid on the ground */
function groundGrid() {
  /** @type {number[]} */
  const vertices = [];
  const parts = (2 * GROUND_EXTENT) / GROUND_STEP;
  for (let offset = -GROUND_EXTENT; offset <= GROUND_EXTENT; offset += GROUND_STEP) {
    addLine(vertices, [offset, -GROUND_EXTENT, 0], [offset, GROUND_EXTENT, 0], parts);
    addLine(vertices, [-GROUND_EXTENT, offset, 0], [GROUND_EXTENT, offset, 0], parts);
  }
  return vertices;
}

/**
 * Makes a set of line segments that the caller can replace and draw.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 */
function createLines(gl, program) {
  const { vertexArray, buffer } = createVertexArray(gl, program);
  let segmentCount = 0;
  return {
    /** @param {number[]} vertices xyz of each segment end */
    set(vertices) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      segmentCount = vertices.length / 6;
    },
    /**
     * Draws all segments, or a part of them.
     * @param {number} [first] index of the first segment
     * @param {number} [count] number of segments
     */
    draw(first = 0, count = segmentCount) {
      const last = Math.min(segmentCount, first + count);
      if (last <= first) return;
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.LINES, first * 2, (last - first) * 2);
    },
  };
}

/**
 * Makes a vertex array with one buffer that feeds `aPosition`.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 */
function createVertexArray(gl, program) {
  const vertexArray = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const location = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vertexArray, buffer };
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertexSource
 * @param {string} fragmentSource
 */
function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ]) {
    const shader = gl.createShader(/** @type {number} */ (type));
    gl.shaderSource(shader, /** @type {string} */ (source));
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string[]} names
 * @returns {Record<string, WebGLUniformLocation>}
 */
function uniformLocations(gl, program, names) {
  /** @type {Record<string, WebGLUniformLocation>} */
  const locations = {};
  for (const name of names) locations[name] = gl.getUniformLocation(program, name);
  return locations;
}
