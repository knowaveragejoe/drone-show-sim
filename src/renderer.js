// WebGL2 renderer for the scenery (sky, stars, ground, hills, and crowd), the ground grid, the
// flight volume, the flight paths, and the drone lights.
//
// The crowd is the only solid object. It writes the depth buffer, so it hides the lines and the
// lights behind it. The lines and the lights add their light to the picture and write no depth.

import { makeCrowd, makeStars, PERSON_FIELDS } from './scenery.js';

// One triangle that covers the whole view. A shader finds the direction of each pixel and draws
// the sky, the ground, and the hills.
const SCENERY_VERTEX_SHADER = `#version 300 es
in vec2 aCorner;
out vec2 vView;
void main() {
  vView = aCorner;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

const SCENERY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uEye;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
// Tangents of half the field of view: across and up.
uniform vec2 uTan;
// The mean light of the show, for the glow on the field under it.
uniform vec3 uShowLight;
in vec2 vView;
out vec4 outColor;

const vec3 ZENITH = vec3(0.004, 0.007, 0.02);
const vec3 HORIZON = vec3(0.045, 0.06, 0.1);
// The glow of a town far behind the show.
const vec3 TOWN = vec3(0.09, 0.055, 0.025);
const float TOWN_AZIMUTH = 0.35;
const vec3 GRASS = vec3(0.016, 0.022, 0.018);
const vec3 HILL = vec3(0.012, 0.015, 0.024);
// The hills stand on a ring around the show, this far away, meters.
const float HILL_DISTANCE = 3500.0;
// The air hides half of the ground at about 0.7 times this distance, meters.
const float HAZE_DISTANCE = 1800.0;
// The grain of the grass fades out at about this distance, so it does not flicker, meters.
const float GRAIN_DISTANCE = 250.0;
// The light of the show reaches about this far on the field, meters.
const float SHOW_GLOW_RADIUS = 160.0;

float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 32768);
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h ^= h >> 16u;
  return float(h) / 4294967295.0;
}

float noise(vec2 p) {
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(p);
  float b = hash(p + vec2(1.0, 0.0));
  float c = hash(p + vec2(0.0, 1.0));
  float d = hash(p + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Height of the hills in a direction from the show, meters.
float hillHeight(float azimuth) {
  float height = 80.0 + 45.0 * sin(3.0 * azimuth + 1.0) + 30.0 * sin(7.0 * azimuth + 2.3)
    + 14.0 * sin(13.0 * azimuth + 0.7) + 6.0 * sin(29.0 * azimuth + 4.1);
  return max(height, 8.0);
}

vec3 skyColor(vec3 direction) {
  float up = max(direction.z, 0.0);
  vec3 sky = mix(HORIZON, ZENITH, pow(up, 0.4));
  float azimuth = atan(direction.x, direction.y);
  float town = exp(-pow((azimuth - TOWN_AZIMUTH) / 0.5, 2.0)) * exp(-up * 16.0);
  return sky + TOWN * town;
}

void main() {
  vec3 direction = normalize(uForward + vView.x * uTan.x * uRight + vView.y * uTan.y * uUp);
  float horizontal = max(length(direction.xy), 1e-6);
  vec2 heading = direction.xy / horizontal;
  vec3 color = skyColor(direction);
  // The air at the horizon in this direction. Far ground and far hills fade into it.
  vec3 haze = skyColor(vec3(heading, 0.0));

  // Horizontal distance to the ground along the ray, or no ground.
  float ground = direction.z < 0.0 ? uEye.z / -direction.z * horizontal : -1.0;

  // The ring of hills: solve |eye + s * heading| = HILL_DISTANCE for s.
  float b = dot(uEye.xy, heading);
  float c = dot(uEye.xy, uEye.xy) - HILL_DISTANCE * HILL_DISTANCE;
  float s = -b + sqrt(max(b * b - c, 0.0));
  if (ground < 0.0 || s < ground) {
    vec2 foot = uEye.xy + heading * s;
    float rayHeight = uEye.z + s * direction.z / horizontal;
    if (rayHeight < hillHeight(atan(foot.x, foot.y))) {
      color = mix(HILL, haze, 0.45);
      ground = -1.0;
    }
  }

  if (ground > 0.0) {
    vec2 at = uEye.xy + heading * ground;
    float grain = 0.8 + 0.3 * noise(at * 0.07) + 0.25 * noise(at * 0.8);
    grain = mix(1.0, grain, exp(-ground / GRAIN_DISTANCE));
    vec3 field = GRASS * grain;
    field += uShowLight * 0.05 * exp(-dot(at, at) / (2.0 * SHOW_GLOW_RADIUS * SHOW_GLOW_RADIUS));
    color = mix(field, haze, 1.0 - exp(-ground / HAZE_DISTANCE));
  }

  // A little noise keeps the dark gradients from showing bands.
  color += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(color, 1.0);
}`;

const STAR_VERTEX_SHADER = `#version 300 es
in vec3 aDirection;
in float aBrightness;
in vec3 aColor;
uniform mat4 uViewProj;
uniform float uPixelScale;
uniform float uTime;
out vec3 vColor;
void main() {
  // A direction, not a point: a star is infinitely far away, so the camera never passes it.
  gl_Position = uViewProj * vec4(aDirection, 0.0);
  // Keep the star inside the far plane.
  gl_Position.z = gl_Position.w * 0.9999;
  // Stars low in the sky fade in the haze. Each star twinkles at its own rate.
  float haze = smoothstep(0.07, 0.3, aDirection.z);
  float rate = 1.5 + 4.0 * fract(aDirection.x * 91.7);
  float twinkle = 0.8 + 0.2 * sin(uTime * rate + aDirection.y * 57.3);
  vColor = aColor * aBrightness * haze * twinkle;
  gl_PointSize = (1.2 + 1.8 * aBrightness) * uPixelScale;
}`;

const STAR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  outColor = vec4(vColor * smoothstep(1.0, 0.2, d), 1.0);
}`;

// One quad per person. The quad turns about its vertical axis to face the camera, and the
// fragment shader cuts the outline of a person out of it.
const CROWD_VERTEX_SHADER = `#version 300 es
in vec2 aCorner;
in vec4 aPerson;
in vec2 aPhone;
uniform mat4 uViewProj;
uniform vec3 uEye;
out vec2 vLocal;
flat out vec4 vShape;
void main() {
  float height = aPerson.z;
  float halfWidth = max(aPerson.w + 0.08, aPhone.x * 0.42);
  float top = height + 0.04 + aPhone.x * 0.48;
  vec2 toEye = uEye.xy - aPerson.xy;
  float away = length(toEye);
  vec2 across = away > 0.001 ? vec2(toEye.y, -toEye.x) / away : vec2(1.0, 0.0);
  vLocal = vec2(aCorner.x * halfWidth, aCorner.y * top);
  vShape = vec4(height, aPerson.w, aPhone);
  gl_Position = uViewProj * vec4(aPerson.xy + across * vLocal.x, vLocal.y, 1.0);
}`;

const CROWD_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uShowLight;
// Meters from the feet of the person: across, up.
in vec2 vLocal;
// Height, half the shoulder width, 1 for a phone, the side of the phone.
flat in vec4 vShape;
out vec4 outColor;

const vec3 SILHOUETTE = vec3(0.01, 0.011, 0.016);
const vec3 SCREEN = vec3(0.55, 0.7, 1.0);

// A trapezoid about the origin: half width "bottom" at y = -halfHeight, "top" at y = halfHeight.
float trapezoid(vec2 p, float bottom, float top, float halfHeight) {
  vec2 k1 = vec2(top, halfHeight);
  vec2 k2 = vec2(top - bottom, 2.0 * halfHeight);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, p.y < 0.0 ? bottom : top), abs(p.y) - halfHeight);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

// The union of two shapes with a round fillet of about this size where they meet.
float smoothUnion(float a, float b, float size) {
  float h = max(size - abs(a - b), 0.0) / size;
  return min(a, b) - h * h * size * 0.25;
}

float roundBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float segment(vec2 p, vec2 a, vec2 b, float radius) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

void main() {
  float height = vShape.x;
  float shoulder = vShape.y;
  float side = vShape.w;
  float scale = height / 1.75;
  // Children have larger heads for their height. Hair makes some heads wider.
  float headScale = mix(1.0, scale, 0.6);
  float hair = fract(sin(dot(vShape.xy, vec2(127.1, 311.7))) * 43758.5);
  vec2 headRadius = vec2(0.08 * (1.0 + 0.3 * hair), 0.112) * headScale;
  vec2 head = vec2(0.0, height - headRadius.y);
  float neckBase = height - 2.0 * headRadius.y - 0.05 * scale;
  // The shoulders slope down from the neck to the shoulder points.
  float shoulderPoint = neckBase - 0.08 * scale;

  // Signed distance to the outline: negative inside the person.
  float body = (length((vLocal - head) / headRadius) - 1.0) * headRadius.x;
  float neckWidth = 0.05 * headScale;
  body = smoothUnion(body, roundBox(vLocal - vec2(0.0, neckBase + 0.03), vec2(neckWidth, 0.06 * headScale), 0.02), 0.03);
  // The body and the arms: a box with round shoulders. The slope from the neck ends where
  // the round shoulder starts, so the outline has no step.
  float corner = 0.07 * scale;
  float torso = roundBox(vLocal - vec2(0.0, shoulderPoint * 0.5), vec2(shoulder, shoulderPoint * 0.5), corner);
  float slope = (neckBase - shoulderPoint + corner) * 0.5;
  torso = smoothUnion(torso, trapezoid(vLocal - vec2(0.0, shoulderPoint - corner + slope), shoulder - corner, neckWidth, slope), 0.04);
  body = smoothUnion(body, torso, 0.05);
  vec2 phoneCenter = vec2(side * 0.22, height + 0.36);
  float screen = 1e3;
  if (vShape.z > 0.5) {
    vec2 hand = phoneCenter - vec2(0.0, 0.05);
    body = min(body, segment(vLocal, vec2(side * shoulder * 0.75, shoulderPoint - 0.02), hand, 0.04));
    screen = roundBox(vLocal - phoneCenter, vec2(0.036, 0.068), 0.008);
  }
  float shape = min(body, screen);
  // Derivatives first: they are not defined after a discard.
  float edge = max(fwidth(shape), 1e-5);
  vec2 gradient = vec2(dFdx(body), dFdy(body));
  float coverage = clamp(0.5 - shape / edge, 0.0, 1.0);
  if (coverage <= 0.0) discard;

  // The show above lights the upper edges a little: a rim about one and a half pixels wide.
  float upward = clamp(gradient.y / max(length(gradient), 1e-6), 0.0, 1.0);
  float rim = smoothstep(-1.5 * edge, 0.0, body) * upward;
  vec3 color = SILHOUETTE + uShowLight * rim * 0.5;
  if (screen < body) color = SCREEN;
  outColor = vec4(color, coverage);
}`;

const POINT_VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in float aBrightness;
in vec3 aColor;
uniform mat4 uViewProj;
uniform float uPixelsPerMeter;
uniform float uSize;
uniform float uMinPixels;
uniform float uGlarePixels;
out float vBrightness;
out vec3 vColor;
// The share of the point that the light itself covers. The rest is glare.
out float vLight;
void main() {
  vBrightness = aBrightness;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  float light = max(uSize * uPixelsPerMeter / gl_Position.w, uMinPixels);
  float size = max(light * 2.5, uGlarePixels);
  vLight = light / size;
  gl_PointSize = size;
}`;

const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float vBrightness;
in vec3 vColor;
in float vLight;
// The gray of the mark on a drone whose light is off. 0 shows no mark.
uniform float uUnlit;
// 1 draws a ring in the color of the point, with no light in it: the mark of a problem.
uniform float uRing;
out vec4 outColor;
void main() {
  // 0 at the center of the point, 1 at its edge.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // 0 at the center, 1 at the edge of the light itself.
  float r = d / vLight;
  float light = smoothstep(1.0, 0.3, r);
  float hot = smoothstep(0.55, 0.0, r);
  // A soft glare around the light, as a camera or an eye sees a bright light at night.
  float glare = exp(-d * d * 8.0) * (1.0 - d);
  if (uRing > 0.5) {
    float ring = smoothstep(0.62, 0.74, d) * smoothstep(0.98, 0.86, d);
    outColor = vec4(vColor * ring * vBrightness, 1.0);
    return;
  }
  vec3 color = vColor * (light + 0.3 * glare) + vec3(0.55) * hot;
  // A dull gray dot, with no glare, shows where a dark drone is.
  float lit = vBrightness * max(vColor.r, max(vColor.g, vColor.b));
  float mark = uUnlit * light * (1.0 - smoothstep(0.0, 0.1, lit));
  outColor = vec4(color * vBrightness + vec3(mark), 1.0);
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
const GROUND_COLOR = [0.09, 0.12, 0.18];
const NO_FADE = [1e9, 2e9];

const VOLUME_COLOR = [0.2, 0.3, 0.42];
// Color of the flight volume when a drone leaves it.
const VOLUME_BROKEN_COLOR = [0.9, 0.2, 0.2];

// Diameter of one drone light, meters.
const LIGHT_SIZE = 1.6;
const SELECTED_LIGHT_SIZE = 5;
// A drone that a problem marks: an amber ring around its light, as large as a light of this
// size would be, and at least `MIN_MARKED_PIXELS` wide.
const MARKED_LIGHT_SIZE = 4;
/** @type {[number, number, number]} */
const MARKED_COLOR = [1, 0.78, 0.2];
// Far drones stay visible: a light never gets smaller than this many CSS pixels.
const MIN_LIGHT_PIXELS = 4;
const MIN_SELECTED_PIXELS = 14;
const MIN_MARKED_PIXELS = 14;
// Diameter of the glare around a light, CSS pixels.
const GLARE_PIXELS = 22;
// The gray of the mark that the editor puts on a drone whose light is off.
const UNLIT_GRAY = 0.22;

// The light of the show reaches its full strength on the scenery at this total brightness:
// about this many drones at full brightness.
const SHOW_LIGHT_FULL = 150;

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
 * @property {ReturnType<typeof import('./camera.js').cameraAxes>} camera the axes of the camera
 * @property {number} pixelsPerMeter screen pixels that 1 m covers at a distance of 1 m
 * @property {number} time seconds; the stars twinkle with it
 * @property {Float32Array} positions xyz per drone
 * @property {Float32Array} brightness brightness of each drone light: 1 is full brightness, and
 *   the flash of a starburst goes above 1
 * @property {Float32Array} colors light color of each drone, red, green, blue, each 0 to 1
 * @property {number} count number of drones
 * @property {number[]} pathColor color of the flight paths, each channel 0 to 1
 * @property {number} selected index of the selected drone, or -1
 * @property {number[]} marked indices of the drones that a problem marks; each gets an amber ring
 * @property {number} pathStep index of the step whose flight paths the view shows
 * @property {boolean} showGrid
 * @property {boolean} showUnlit true to mark the drones whose lights are off with a dull gray dot
 * @property {boolean} showPaths
 * @property {boolean} showVolume
 * @property {boolean} volumeBroken true when a drone leaves the flight volume
 */

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!context) throw new Error('This browser does not support WebGL2.');
  // A second constant keeps the checked type in the functions below. The type checker does
  // not carry the check above into a function declaration.
  const gl = context;

  const sceneryProgram = createProgram(gl, SCENERY_VERTEX_SHADER, SCENERY_FRAGMENT_SHADER);
  const starProgram = createProgram(gl, STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER);
  const crowdProgram = createProgram(gl, CROWD_VERTEX_SHADER, CROWD_FRAGMENT_SHADER);
  const pointProgram = createProgram(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);
  const lineProgram = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
  const sceneryUniforms = uniformLocations(gl, sceneryProgram, [
    'uEye',
    'uForward',
    'uRight',
    'uUp',
    'uTan',
    'uShowLight',
  ]);
  const starUniforms = uniformLocations(gl, starProgram, ['uViewProj', 'uPixelScale', 'uTime']);
  const crowdUniforms = uniformLocations(gl, crowdProgram, ['uViewProj', 'uEye', 'uShowLight']);
  const pointUniforms = uniformLocations(gl, pointProgram, [
    'uViewProj',
    'uPixelsPerMeter',
    'uSize',
    'uMinPixels',
    'uGlarePixels',
    'uUnlit',
    'uRing',
  ]);
  const lineUniforms = uniformLocations(gl, lineProgram, ['uViewProj', 'uColor', 'uFade']);

  const sky = createAttributes(gl, sceneryProgram, [['aCorner', 2, new Float32Array([-1, -1, 3, -1, -1, 3])]]);
  const stars = makeStars();
  const starCount = stars.brightness.length;
  const starField = createAttributes(gl, starProgram, [
    ['aDirection', 3, stars.directions],
    ['aBrightness', 1, stars.brightness],
    ['aColor', 3, stars.colors],
  ]);
  const crowd = createCrowd(gl, crowdProgram, makeCrowd());

  const ground = createLines(gl, lineProgram);
  ground.set(groundGrid());
  const volume = createLines(gl, lineProgram);
  const paths = createLines(gl, lineProgram);
  const route = createLines(gl, lineProgram);
  const drones = createVertexArray(gl, pointProgram);
  // Two more buffers feed the brightness and the color of each light.
  const brightnessLocation = gl.getAttribLocation(pointProgram, 'aBrightness');
  const colorLocation = gl.getAttribLocation(pointProgram, 'aColor');
  const brightnessBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  gl.bindVertexArray(drones.vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuffer);
  gl.enableVertexAttribArray(brightnessLocation);
  gl.vertexAttribPointer(brightnessLocation, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
  // The indices of the marked drones. The vertex array keeps this buffer.
  const markedBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, markedBuffer);
  gl.bindVertexArray(null);
  /** The marks in the buffer, to upload a new list only when it changes. @type {number[] | null} */
  let markedShown = null;

  gl.depthFunc(gl.LEQUAL);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 1);

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
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const showLight = meanLight(frame.colors, frame.brightness, frame.count);
    const { eye, forward, right, up, tanHalfFovY } = frame.camera;

    // The sky, the ground, and the hills cover the whole view. They are behind everything.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(sceneryProgram);
    gl.uniform3fv(sceneryUniforms.uEye, eye);
    gl.uniform3fv(sceneryUniforms.uForward, forward);
    gl.uniform3fv(sceneryUniforms.uRight, right);
    gl.uniform3fv(sceneryUniforms.uUp, up);
    gl.uniform2f(sceneryUniforms.uTan, tanHalfFovY * (width / height), tanHalfFovY);
    gl.uniform3fv(sceneryUniforms.uShowLight, showLight);
    gl.bindVertexArray(sky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.useProgram(starProgram);
    gl.uniformMatrix4fv(starUniforms.uViewProj, false, frame.viewProj);
    gl.uniform1f(starUniforms.uPixelScale, dpr);
    gl.uniform1f(starUniforms.uTime, frame.time);
    gl.bindVertexArray(starField);
    gl.drawArrays(gl.POINTS, 0, starCount);

    // The crowd is solid. Alpha to coverage smooths its outlines with the multisample buffer.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.useProgram(crowdProgram);
    gl.uniformMatrix4fv(crowdUniforms.uViewProj, false, frame.viewProj);
    gl.uniform3fv(crowdUniforms.uEye, eye);
    gl.uniform3fv(crowdUniforms.uShowLight, showLight);
    crowd.draw();
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);

    // The lines and the lights add light and write no depth.
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniforms.uViewProj, false, frame.viewProj);

    if (frame.showGrid) {
      // Near the horizon many ground lines share a pixel. MAX blending keeps them from
      // adding up to a bright band.
      gl.blendEquation(gl.MAX);
      gl.uniform2fv(lineUniforms.uFade, GROUND_FADE);
      gl.uniform3fv(lineUniforms.uColor, GROUND_COLOR);
      ground.draw();
      gl.blendEquation(gl.FUNC_ADD);
    }

    gl.uniform2fv(lineUniforms.uFade, NO_FADE);
    if (frame.showVolume) {
      gl.uniform3fv(lineUniforms.uColor, frame.volumeBroken ? VOLUME_BROKEN_COLOR : VOLUME_COLOR);
      volume.draw();
    }

    const selected = frame.selected >= 0 && frame.selected < frame.count ? frame.selected : -1;
    if (frame.showPaths) {
      // All paths of one step: the transition in flight, or the one that led to the current hold.
      gl.uniform3fv(
        lineUniforms.uColor,
        frame.pathColor.map((channel) => channel * PATH_BRIGHTNESS),
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
    gl.uniform1f(pointUniforms.uGlarePixels, GLARE_PIXELS * dpr);
    gl.uniform1f(pointUniforms.uUnlit, frame.showUnlit ? UNLIT_GRAY : 0);
    gl.uniform1f(pointUniforms.uRing, 0);
    gl.bindVertexArray(drones.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, drones.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame.brightness, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame.colors, gl.DYNAMIC_DRAW);

    gl.uniform1f(pointUniforms.uSize, LIGHT_SIZE);
    gl.uniform1f(pointUniforms.uMinPixels, MIN_LIGHT_PIXELS * dpr);
    gl.drawArrays(gl.POINTS, 0, frame.count);

    const marked = frame.marked.filter((drone) => drone < frame.count);
    if (marked.length > 0) {
      // The drones that a problem marks get a ring, with one draw call for all of them.
      if (markedShown !== frame.marked) {
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint32Array.from(marked), gl.DYNAMIC_DRAW);
        markedShown = frame.marked;
      }
      gl.disableVertexAttribArray(brightnessLocation);
      gl.disableVertexAttribArray(colorLocation);
      gl.vertexAttrib1f(brightnessLocation, 1);
      gl.vertexAttrib3f(colorLocation, ...MARKED_COLOR);
      gl.uniform1f(pointUniforms.uSize, MARKED_LIGHT_SIZE);
      gl.uniform1f(pointUniforms.uMinPixels, MIN_MARKED_PIXELS * dpr);
      gl.uniform1f(pointUniforms.uRing, 1);
      gl.drawElements(gl.POINTS, marked.length, gl.UNSIGNED_INT, 0);
      gl.uniform1f(pointUniforms.uRing, 0);
      gl.enableVertexAttribArray(brightnessLocation);
      gl.enableVertexAttribArray(colorLocation);
    }

    if (selected >= 0) {
      // The selected drone is white and at full brightness, also in a light chase.
      gl.disableVertexAttribArray(brightnessLocation);
      gl.disableVertexAttribArray(colorLocation);
      gl.vertexAttrib1f(brightnessLocation, 1);
      gl.vertexAttrib3f(colorLocation, 1, 1, 1);
      gl.uniform1f(pointUniforms.uSize, SELECTED_LIGHT_SIZE);
      gl.uniform1f(pointUniforms.uMinPixels, MIN_SELECTED_PIXELS * dpr);
      gl.drawArrays(gl.POINTS, selected, 1);
      gl.enableVertexAttribArray(brightnessLocation);
      gl.enableVertexAttribArray(colorLocation);
    }
    gl.bindVertexArray(null);
  }

  return { draw, setPaths, setRoute, setVolume };
}

/**
 * The light that the show sheds on the scenery: the mean color of the lights, weighted by
 * their brightness. It grows with the total brightness up to `SHOW_LIGHT_FULL`.
 * @param {Float32Array} colors red, green, blue per drone
 * @param {Float32Array} brightness per drone
 * @param {number} count
 * @returns {number[]} red, green, blue
 */
function meanLight(colors, brightness, count) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const level = brightness[i];
    red += colors[i * 3] * level;
    green += colors[i * 3 + 1] * level;
    blue += colors[i * 3 + 2] * level;
    total += level;
  }
  if (total <= 0) return [0, 0, 0];
  const scale = Math.min(1, total / SHOW_LIGHT_FULL) / total;
  return [red * scale, green * scale, blue * scale];
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
 * Makes the crowd: one quad per person, drawn with instancing.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {Float32Array} people `PERSON_FIELDS` numbers per person, from `makeCrowd`
 */
function createCrowd(gl, program, people) {
  const count = people.length / PERSON_FIELDS;
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  // The corners of the quad, as a triangle strip: across from -1 to 1, up from 0 to 1.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  // One set of numbers per person.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, people, gl.STATIC_DRAW);
  const stride = PERSON_FIELDS * 4;
  for (const [name, size, offset] of [
    ['aPerson', 4, 0],
    ['aPhone', 2, 16],
  ]) {
    const location = gl.getAttribLocation(program, /** @type {string} */ (name));
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, /** @type {number} */ (size), gl.FLOAT, false, stride, /** @type {number} */ (offset));
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return {
    draw() {
      gl.bindVertexArray(vertexArray);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
  };
}

/**
 * Makes a vertex array with one static buffer per attribute.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {[string, number, Float32Array][]} attributes name, numbers per vertex, and data of each attribute
 */
function createAttributes(gl, program, attributes) {
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  for (const [name, size, data] of attributes) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  gl.bindVertexArray(null);
  return vertexArray;
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
  /** @type {[number, string][]} */
  const stages = [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ];
  for (const [type, source] of stages) {
    // The browser gives no shader when it lost the WebGL context.
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL could not make a shader.');
    gl.shaderSource(shader, source);
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
 * @returns {Record<string, WebGLUniformLocation | null>} null for a name that the program does not use
 */
function uniformLocations(gl, program, names) {
  /** @type {Record<string, WebGLUniformLocation | null>} */
  const locations = {};
  for (const name of names) locations[name] = gl.getUniformLocation(program, name);
  return locations;
}
