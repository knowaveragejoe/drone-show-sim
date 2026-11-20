// WebGL2 renderer for the ground grid, the flight volume, the flight paths, and the drone lights.
// Every draw call uses additive blending and nothing is opaque, so no depth buffer is necessary.

import { AUDIENCE_DISTANCE } from './camera.js';

const POINT_VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in float aBrightness;
uniform mat4 uViewProj;
uniform float uPixelsPerMeter;
uniform float uSize;
uniform float uMinPixels;
out float vBrightness;
void main() {
  vBrightness = aBrightness;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  gl_PointSize = max(uSize * uPixelsPerMeter / gl_Position.w, uMinPixels);
}`;

const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uColor;
in float vBrightness;
out vec4 outColor;
void main() {
  // 0 at the center of the point, 1 at its edge.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float halo = pow(max(1.0 - d, 0.0), 2.5);
  float core = smoothstep(0.4, 0.1, d);
  outColor = vec4((uColor * halo + vec3(0.55) * core) * vBrightness, 1.0);
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

// Number of short segments in one flight path. See `addLine` for the reason.
const PATH_PARTS = 8;
// Longest segment of the selected drone's route, meters.
const ROUTE_PART_LENGTH = 10;
const VOLUME_EDGE_PARTS = 16;
// Brightness of a path that is not selected, as a share of the light color.
const PATH_BRIGHTNESS = 0.1;
// Brightness of the selected drone's route in the steps that are not the current one.
const OTHER_STEP_BRIGHTNESS = 0.3;

/**
 * @typedef {object} Frame
 * @property {Float32Array} viewProj
 * @property {number} pixelsPerMeter screen pixels that 1 m covers at a distance of 1 m
 * @property {Float32Array} positions xyz per drone
 * @property {Float32Array} brightness brightness of each drone light, 0 to 1
 * @property {number} count number of drones
 * @property {number[]} color light color, each channel 0 to 1
 * @property {number} selected index of the selected drone, or -1
 * @property {number} pathStep index of the step whose flight paths the view shows
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
  const route = createLines(gl, lineProgram);
  const drones = createVertexArray(gl, pointProgram);
  // A second buffer feeds the brightness of each light.
  const brightnessLocation = gl.getAttribLocation(pointProgram, 'aBrightness');
  const brightnessBuffer = gl.createBuffer();
  gl.bindVertexArray(drones.vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuffer);
  gl.enableVertexAttribArray(brightnessLocation);
  gl.vertexAttribPointer(brightnessLocation, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0.016, 0.02, 0.043, 1);

  /** First segment and number of segments of the flight paths of each step. @type {number[][]} */
  let pathRanges = [];

  /**
   * Stores the flight paths: for each step, one straight line per drone in each leg.
   * @param {import('./plan.js').Step[]} steps
   * @param {number} count number of drones
   */
  function setPaths(steps, count) {
    const legCount = steps.reduce((sum, step) => sum + step.legs.length, 0);
    // Each line is short segments, for the reason that `addLine` gives.
    const vertices = new Float32Array(legCount * count * PATH_PARTS * 6);
    let offset = 0;
    pathRanges = steps.map(({ legs }) => {
      const first = offset / 6;
      for (const { from, to } of legs) {
        for (let drone = 0; drone < count; drone++) {
          for (let part = 0; part < PATH_PARTS; part++) {
            for (let end = 0; end < 2; end++) {
              const share = (part + end) / PATH_PARTS;
              for (let axis = 0; axis < 3; axis++) {
                const start = from[drone * 3 + axis];
                vertices[offset++] = start + share * (to[drone * 3 + axis] - start);
              }
            }
          }
        }
      }
      return [first, offset / 6 - first];
    });
    paths.set(vertices);
  }

  /** First segment and number of segments of each step of the route. @type {number[][]} */
  let routeRanges = [];

  /**
   * Stores the route of the selected drone.
   * @param {Float32Array[]} steps for each step, the points that the drone passes, xyz per point;
   *   empty when no drone is selected
   */
  function setRoute(steps) {
    /** @type {number[]} */
    const vertices = [];
    routeRanges = steps.map((points) => {
      const first = vertices.length / 6;
      for (let i = 3; i < points.length; i += 3) {
        const from = points.subarray(i - 3, i);
        const to = points.subarray(i, i + 3);
        const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        addLine(vertices, from, to, Math.max(1, Math.ceil(length / ROUTE_PART_LENGTH)));
      }
      return [first, vertices.length / 6 - first];
    });
    route.set(vertices);
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
      // All paths of one step: the transition in flight, or the one that led to the current hold.
      gl.uniform3fv(
        lineUniforms.uColor,
        frame.color.map((channel) => channel * PATH_BRIGHTNESS),
      );
      const [first, count] = pathRanges[frame.pathStep] ?? [0, 0];
      paths.draw(first, count);
    }
    // The whole route of the selected drone, with the current step brightest.
    routeRanges.forEach(([first, count], step) => {
      const brightness = step === frame.pathStep ? 1 : OTHER_STEP_BRIGHTNESS;
      gl.uniform3f(lineUniforms.uColor, brightness, brightness, brightness);
      route.draw(first, count);
    });

    gl.useProgram(pointProgram);
    gl.uniformMatrix4fv(pointUniforms.uViewProj, false, frame.viewProj);
    gl.uniform1f(pointUniforms.uPixelsPerMeter, frame.pixelsPerMeter * dpr);
    gl.bindVertexArray(drones.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, drones.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame.brightness, gl.DYNAMIC_DRAW);

    gl.uniform1f(pointUniforms.uSize, LIGHT_SIZE);
    gl.uniform1f(pointUniforms.uMinPixels, MIN_LIGHT_PIXELS * dpr);
    gl.uniform3fv(pointUniforms.uColor, frame.color);
    gl.drawArrays(gl.POINTS, 0, frame.count);

    if (selected >= 0) {
      // The selected drone stays at full brightness, also in a light chase.
      gl.disableVertexAttribArray(brightnessLocation);
      gl.vertexAttrib1f(brightnessLocation, 1);
      gl.uniform1f(pointUniforms.uSize, SELECTED_LIGHT_SIZE);
      gl.uniform1f(pointUniforms.uMinPixels, MIN_SELECTED_PIXELS * dpr);
      gl.uniform3f(pointUniforms.uColor, 1, 1, 1);
      gl.drawArrays(gl.POINTS, selected, 1);
      gl.enableVertexAttribArray(brightnessLocation);
    }
    gl.bindVertexArray(null);
  }

  return { draw, setPaths, setRoute, setVolume };
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
    /** @param {number[] | Float32Array} vertices xyz of each segment end */
    set(vertices) {
      const data = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
