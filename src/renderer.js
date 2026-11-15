// WebGL2 renderer for the ground grid and the drone lights.
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
const NO_FADE = [1e9, 2e9];

// Half the length of the ground line that marks where the audience stands, meters.
const AUDIENCE_HALF_WIDTH = 40;

// Diameter of the glow around one drone, meters.
const LIGHT_SIZE = 1.6;
const SELECTED_LIGHT_SIZE = 5;
// Far drones stay visible: a light never gets smaller than this many CSS pixels.
const MIN_LIGHT_PIXELS = 4;
const MIN_SELECTED_PIXELS = 14;

/**
 * @typedef {object} Frame
 * @property {Float32Array} viewProj
 * @property {number} pixelsPerMeter screen pixels that 1 m covers at a distance of 1 m
 * @property {Float32Array} positions xyz per drone
 * @property {number} count number of drones
 * @property {number[]} color light color, each channel 0 to 1
 * @property {number} selected index of the selected drone, or -1
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{draw: (frame: Frame) => void, canvas: HTMLCanvasElement}}
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

  const ground = createVertexArray(gl, lineProgram);
  const groundVertices = groundGrid();
  gl.bindBuffer(gl.ARRAY_BUFFER, ground.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, groundVertices, gl.STATIC_DRAW);

  const audience = createVertexArray(gl, lineProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, audience.buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -AUDIENCE_HALF_WIDTH, -AUDIENCE_DISTANCE, 0,
      AUDIENCE_HALF_WIDTH, -AUDIENCE_DISTANCE, 0,
    ]),
    gl.STATIC_DRAW,
  );

  const drones = createVertexArray(gl, pointProgram);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0.016, 0.02, 0.043, 1);

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

    gl.uniform2fv(lineUniforms.uFade, GROUND_FADE);
    gl.uniform3f(lineUniforms.uColor, 0.1, 0.13, 0.2);
    gl.bindVertexArray(ground.vertexArray);
    gl.drawArrays(gl.LINES, 0, groundVertices.length / 3);

    gl.uniform2fv(lineUniforms.uFade, NO_FADE);
    gl.uniform3f(lineUniforms.uColor, 0.45, 0.35, 0.15);
    gl.bindVertexArray(audience.vertexArray);
    gl.drawArrays(gl.LINES, 0, 2);

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

    if (frame.selected >= 0 && frame.selected < frame.count) {
      gl.uniform1f(pointUniforms.uSize, SELECTED_LIGHT_SIZE);
      gl.uniform1f(pointUniforms.uMinPixels, MIN_SELECTED_PIXELS * dpr);
      gl.uniform3f(pointUniforms.uColor, 1, 1, 1);
      gl.drawArrays(gl.POINTS, frame.selected, 1);
    }
    gl.bindVertexArray(null);
  }

  return { draw, canvas };
}

/**
 * Line segments of a square grid on the ground.
 * Each grid line is many short segments. Some WebGL implementations drop a whole segment
 * when one end is behind the camera, so a long line would vanish at low camera angles.
 * @returns {Float32Array}
 */
function groundGrid() {
  const vertices = [];
  for (let offset = -GROUND_EXTENT; offset <= GROUND_EXTENT; offset += GROUND_STEP) {
    for (let from = -GROUND_EXTENT; from < GROUND_EXTENT; from += GROUND_STEP) {
      const to = from + GROUND_STEP;
      vertices.push(offset, from, 0, offset, to, 0);
      vertices.push(from, offset, 0, to, offset, 0);
    }
  }
  return new Float32Array(vertices);
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
