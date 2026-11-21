// SVG import. Reads the outlines of the shapes in an SVG drawing and makes a candidate cloud
// on them. The drawing stands upright and faces the audience, like the built-in flat shapes.
//
// The reader is plain JavaScript with no DOM, so Node can test it. It reads these elements:
// path, rect, circle, ellipse, line, polyline, and polygon, with the transforms of their
// groups. It skips the contents of elements that the browser does not draw directly, such
// as defs and clipPath, and elements with display none. It does not read text or use.
//
// Each outline also gets a color: its stroke color, or its fill color when it has no stroke.
// The reader takes stroke, fill, and color from attributes, from the style attribute, and
// from the groups around the element. It does not read CSS classes or gradients.

import { createRng } from './rng.js';
import { CLOUD_SIZE } from './shapes.js';

// A curve becomes this many straight segments.
const CURVE_PARTS = 24;
// An arc becomes straight segments that each cover at most this angle, radians.
const ARC_STEP = Math.PI / 48;

// The browser does not draw the contents of these elements where they stand.
const UNDRAWN = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'marker',
  'pattern',
  'linearGradient',
  'radialGradient',
  'filter',
  'style',
  'script',
  'title',
  'desc',
  'metadata',
]);

// A comment, a CDATA block, a declaration, or a tag with its name, attributes, and end.
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const TRANSFORM = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

// The basic CSS color names. Other names count as no color.
/** @type {Record<string, number>} */
const NAMED_COLORS = {
  black: 0x000000,
  silver: 0xc0c0c0,
  gray: 0x808080,
  grey: 0x808080,
  white: 0xffffff,
  maroon: 0x800000,
  red: 0xff0000,
  purple: 0x800080,
  fuchsia: 0xff00ff,
  magenta: 0xff00ff,
  green: 0x008000,
  lime: 0x00ff00,
  olive: 0x808000,
  yellow: 0xffff00,
  navy: 0x000080,
  blue: 0x0000ff,
  teal: 0x008080,
  aqua: 0x00ffff,
  cyan: 0x00ffff,
  orange: 0xffa500,
};

// The properties that give an outline its color. A child element inherits them.
const PAINT = ['stroke', 'fill', 'color'];

/**
 * A 2D affine transform as SVG writes it: x' = a x + c y + e, y' = b x + d y + f.
 * @typedef {number[]} Matrix [a, b, c, d, e, f]
 */

/**
 * One outline of a drawing.
 * @typedef {object} Outline
 * @property {number[]} points x and y of each point in turn, in drawing units, y down
 * @property {number[] | null} color red, green, blue, each 0 to 1; null when the outline has no color
 */

/** @type {Matrix} */
const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * Reads the outlines of an SVG drawing, with their colors.
 * @param {string} text contents of the SVG file
 * @returns {Outline[]}
 */
export function parseSvg(text) {
  if (!/<([\w.-]+:)?svg[\s/>]/.test(text)) throw new Error('The file is not an SVG drawing.');

  /** Open elements, from the root to the current one. */
  const stack = [{ name: '', matrix: IDENTITY, undrawn: false, paint: /** @type {Record<string, string>} */ ({}) }];
  /** @type {Outline[]} */
  const outlines = [];

  for (const match of text.matchAll(TAG)) {
    const [whole, closing, fullName, attributeText = ''] = match;
    // A comment, a CDATA block, or a declaration.
    if (fullName === undefined) continue;
    const name = fullName.split(':').pop();

    if (closing) {
      // Close up to the element with this name. This also repairs a missing end tag.
      const index = stack.findLastIndex((entry) => entry.name === name);
      if (index > 0) stack.length = index;
      continue;
    }

    const selfClosing = whole.endsWith('/>');
    const attributes = readAttributes(selfClosing ? attributeText.slice(0, -1) : attributeText);
    const parent = stack[stack.length - 1];
    const style = readStyle(attributes.style ?? '');
    const hidden = attributes.display === 'none' || style.display === 'none';
    /** @type {Record<string, string>} */
    const paint = { ...parent.paint };
    for (const property of PAINT) {
      // The style attribute wins over a presentation attribute.
      const value = style[property] ?? attributes[property]?.trim();
      if (value !== undefined && value !== 'inherit') paint[property] = value;
    }
    const entry = {
      name,
      matrix: multiply(parent.matrix, parseTransform(attributes.transform ?? '')),
      undrawn: parent.undrawn || hidden || UNDRAWN.has(name),
      paint,
    };

    if (!entry.undrawn) {
      const color = paintColor(paint.stroke, paint.color) ?? paintColor(paint.fill, paint.color);
      for (const points of shapeOutlines(name, attributes)) {
        outlines.push({ points: applyMatrix(entry.matrix, points), color });
      }
    }
    if (!selfClosing) stack.push(entry);
  }
  return outlines.filter((outline) => outline.points.length >= 4);
}

/**
 * The color of a stroke or a fill.
 * @param {string | undefined} value the stroke or fill value
 * @param {string | undefined} current the color property, for `currentColor`
 * @returns {number[] | null} null for none, a gradient, or a value that the reader does not know
 */
function paintColor(value, current) {
  if (value === undefined) return null;
  return parseColor(value.toLowerCase() === 'currentcolor' ? (current ?? '') : value);
}

/**
 * Reads a CSS color: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`, `rgba(…)`, or a basic
 * color name. The alpha part is ignored.
 * @param {string} text
 * @returns {number[] | null} red, green, blue, each 0 to 1; null when the text is not such a color
 */
export function parseColor(text) {
  const value = text.trim().toLowerCase();
  if (Object.hasOwn(NAMED_COLORS, value)) {
    const rgb = NAMED_COLORS[value];
    return [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
  }
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4) {
      return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16) / 255);
    }
    if (hex.length === 6 || hex.length === 8) {
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    }
    return null;
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(value)?.[1];
  if (functional !== undefined) {
    // Commas or spaces between the channels, and an optional alpha after a comma or a slash.
    const channels = functional.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (channels.length < 3) return null;
    const rgb = channels.map((channel) => {
      const number = parseFloat(channel);
      const share = channel.endsWith('%') ? number / 100 : number / 255;
      return Math.min(1, Math.max(0, share));
    });
    return rgb.every(Number.isFinite) ? rgb : null;
  }
  return null;
}

/**
 * The candidate cloud of an SVG drawing, with the color of each point.
 * @typedef {object} SvgCloud
 * @property {Float32Array} points xyz per point, `CLOUD_SIZE` points
 * @property {Float32Array | null} colors red, green, blue per point, each 0 to 1; -1 in each
 *   channel for a point on an outline with no color; null when no outline has a color
 */

/**
 * Makes the candidate cloud of an SVG drawing: random points on its outlines, in unit space.
 * The drawing stands in the XZ plane and faces the audience. Its top is up.
 * Each point gets the color of its outline.
 *
 * The points are in order along the outlines, one outline after the other. The outlines are
 * cut into `CLOUD_SIZE` slices of equal length, and each slice gets one point at a random
 * place in it, like the curves of the built-in shapes.
 * @param {string} text contents of the SVG file
 * @param {number} seed
 * @returns {SvgCloud}
 */
export function svgCloud(text, seed) {
  const outlines = parseSvg(text);

  // Every segment, with a running total of the lengths, to pick a point with a chance in
  // proportion to the length.
  /** @type {number[]} */
  const segments = [];
  /** @type {number[]} */
  const lengthUpTo = [];
  /** Outline of each segment. @type {number[]} */
  const outlineOf = [];
  let total = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [index, { points: outline }] of outlines.entries()) {
    for (let i = 0; i < outline.length; i += 2) {
      minX = Math.min(minX, outline[i]);
      maxX = Math.max(maxX, outline[i]);
      minY = Math.min(minY, outline[i + 1]);
      maxY = Math.max(maxY, outline[i + 1]);
      if (i === 0) continue;
      const length = Math.hypot(outline[i] - outline[i - 2], outline[i + 1] - outline[i - 1]);
      if (length === 0) continue;
      segments.push(outline[i - 2], outline[i - 1], outline[i], outline[i + 1]);
      outlineOf.push(index);
      total += length;
      lengthUpTo.push(total);
    }
  }
  if (!(total > 0)) throw new Error('The SVG drawing has no outlines that the simulator can read.');

  const extent = Math.max(maxX - minX, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const random = createRng(seed);
  const cloud = new Float32Array(CLOUD_SIZE * 3);
  const colored = outlines.some((outline) => outline.color !== null);
  const colors = colored ? new Float32Array(CLOUD_SIZE * 3) : null;
  let first = 0;
  for (let i = 0; i < CLOUD_SIZE; i++) {
    // One point in each slice of equal length, so the points are in order along the outlines.
    const along = ((i + random()) / CLOUD_SIZE) * total;
    // The places grow, so the segment that holds the place only moves forward.
    while (first < lengthUpTo.length - 1 && lengthUpTo[first] < along) first++;
    const segmentStart = first === 0 ? 0 : lengthUpTo[first - 1];
    const share = Math.min(1, Math.max(0, (along - segmentStart) / (lengthUpTo[first] - segmentStart)));
    const o = first * 4;
    const x = segments[o] + share * (segments[o + 2] - segments[o]);
    const y = segments[o + 1] + share * (segments[o + 3] - segments[o + 1]);
    cloud[i * 3] = (x - centerX) / extent;
    cloud[i * 3 + 1] = 0;
    // SVG y points down. World z points up.
    cloud[i * 3 + 2] = (centerY - y) / extent;
    if (colors) colors.set(outlines[outlineOf[first]].color ?? NO_COLOR, i * 3);
  }
  return { points: cloud, colors };
}

const NO_COLOR = [-1, -1, -1];

/**
 * Reads the properties of a style attribute, such as `fill: red; stroke: none`.
 * @param {string} text
 * @returns {Record<string, string>} property names in lowercase
 */
function readStyle(text) {
  /** @type {Record<string, string>} */
  const properties = {};
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).replace(/!important/i, '').trim();
    if (name && value) properties[name] = value;
  }
  return properties;
}

/**
 * @param {string} text the attributes part of a tag
 * @returns {Record<string, string>}
 */
function readAttributes(text) {
  /** @type {Record<string, string>} */
  const attributes = {};
  for (const [, name, double, single] of text.matchAll(ATTRIBUTE)) {
    attributes[name] = double ?? single;
  }
  return attributes;
}

/**
 * The outlines of one element, in its own units.
 * @param {string} name element name
 * @param {Record<string, string>} attributes
 * @returns {number[][]}
 */
function shapeOutlines(name, attributes) {
  /** @param {string} key */
  const value = (key) => {
    const number = parseFloat(attributes[key] ?? '');
    return Number.isFinite(number) ? number : 0;
  };
  switch (name) {
    case 'path':
      return parsePathData(attributes.d ?? '');
    case 'rect': {
      const x = value('x');
      const y = value('y');
      const width = value('width');
      const height = value('height');
      if (width <= 0 || height <= 0) return [];
      // A rect with one corner radius uses it for both directions.
      let rx = attributes.rx === undefined ? value('ry') : value('rx');
      let ry = attributes.ry === undefined ? rx : value('ry');
      rx = Math.min(Math.max(rx, 0), width / 2);
      ry = Math.min(Math.max(ry, 0), height / 2);
      if (rx === 0 || ry === 0) {
        return [[x, y, x + width, y, x + width, y + height, x, y + height, x, y]];
      }
      return parsePathData(
        `M${x + rx},${y} H${x + width - rx} A${rx},${ry} 0 0 1 ${x + width},${y + ry}` +
          ` V${y + height - ry} A${rx},${ry} 0 0 1 ${x + width - rx},${y + height}` +
          ` H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + height - ry}` +
          ` V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`,
      );
    }
    case 'circle':
    case 'ellipse': {
      const cx = value('cx');
      const cy = value('cy');
      const rx = name === 'circle' ? value('r') : value('rx');
      const ry = name === 'circle' ? value('r') : value('ry');
      if (rx <= 0 || ry <= 0) return [];
      return parsePathData(
        `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`,
      );
    }
    case 'line':
      return [[value('x1'), value('y1'), value('x2'), value('y2')]];
    case 'polyline':
    case 'polygon': {
      const numbers = (attributes.points ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
      const points = numbers.slice(0, numbers.length - (numbers.length % 2)).map(Number);
      if (name === 'polygon' && points.length >= 4) points.push(points[0], points[1]);
      return [points];
    }
    default:
      return [];
  }
}

/**
 * Reads SVG path data. Curves and arcs become short straight segments.
 * Like a browser, the reader stops at the first error and keeps what it read before it.
 * @param {string} d the path data
 * @returns {number[][]} one list per subpath: x and y of each point in turn
 */
export function parsePathData(d) {
  /** @type {number[][]} */
  const outlines = [];
  /** @type {number[] | null} */
  let outline = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point of the curve just before, for the smooth curve commands S and T.
  // S reflects it only after a cubic curve, and T only after a quadratic curve.
  let controlX = 0;
  let controlY = 0;
  /** @type {'' | 'cubic' | 'quadratic'} */
  let lastCurve = '';
  let command = '';
  let i = 0;

  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = () => {
    skip();
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(d);
    if (!match) throw new Error('number expected');
    i = NUMBER.lastIndex;
    return Number(match[0]);
  };
  // An arc flag is one digit. Path data can write two flags with no space between them.
  const flag = () => {
    skip();
    const digit = d[i];
    if (digit !== '0' && digit !== '1') throw new Error('flag expected');
    i++;
    return digit === '1';
  };
  /** @param {number} px @param {number} py */
  const lineTo = (px, py) => {
    if (!outline) {
      outline = [x, y];
      outlines.push(outline);
    }
    outline.push(px, py);
  };

  try {
    for (skip(); i < d.length; skip()) {
      if (/[a-zA-Z]/.test(d[i])) {
        command = d[i++];
      } else if (command === '' || command === 'Z' || command === 'z') {
        throw new Error('command expected');
      } else if (command === 'M') {
        // Numbers after a moveto are lineto commands.
        command = 'L';
      } else if (command === 'm') {
        command = 'l';
      }

      const relative = command === command.toLowerCase();
      const baseX = relative ? x : 0;
      const baseY = relative ? y : 0;
      const kind = command.toUpperCase();
      /** @type {'' | 'cubic' | 'quadratic'} */
      let curve = '';

      if (kind === 'M') {
        x = baseX + number();
        y = baseY + number();
        startX = x;
        startY = y;
        outline = null;
      } else if (kind === 'Z') {
        if (outline) lineTo(startX, startY);
        x = startX;
        y = startY;
        outline = null;
      } else if (kind === 'L') {
        const nx = baseX + number();
        const ny = baseY + number();
        lineTo(nx, ny);
        x = nx;
        y = ny;
      } else if (kind === 'H') {
        const nx = baseX + number();
        lineTo(nx, y);
        x = nx;
      } else if (kind === 'V') {
        const ny = baseY + number();
        lineTo(x, ny);
        y = ny;
      } else if (kind === 'C' || kind === 'S') {
        let x1 = lastCurve === 'cubic' ? 2 * x - controlX : x;
        let y1 = lastCurve === 'cubic' ? 2 * y - controlY : y;
        if (kind === 'C') {
          x1 = baseX + number();
          y1 = baseY + number();
        }
        const x2 = baseX + number();
        const y2 = baseY + number();
        const ex = baseX + number();
        const ey = baseY + number();
        for (let part = 1; part <= CURVE_PARTS; part++) {
          const t = part / CURVE_PARTS;
          const s = 1 - t;
          lineTo(
            s * s * s * x + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t * t * t * ex,
            s * s * s * y + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t * t * t * ey,
          );
        }
        controlX = x2;
        controlY = y2;
        x = ex;
        y = ey;
        curve = 'cubic';
      } else if (kind === 'Q' || kind === 'T') {
        let x1 = lastCurve === 'quadratic' ? 2 * x - controlX : x;
        let y1 = lastCurve === 'quadratic' ? 2 * y - controlY : y;
        if (kind === 'Q') {
          x1 = baseX + number();
          y1 = baseY + number();
        }
        const ex = baseX + number();
        const ey = baseY + number();
        for (let part = 1; part <= CURVE_PARTS; part++) {
          const t = part / CURVE_PARTS;
          const s = 1 - t;
          lineTo(s * s * x + 2 * s * t * x1 + t * t * ex, s * s * y + 2 * s * t * y1 + t * t * ey);
        }
        controlX = x1;
        controlY = y1;
        x = ex;
        y = ey;
        curve = 'quadratic';
      } else if (kind === 'A') {
        const rx = number();
        const ry = number();
        const rotation = number();
        const largeArc = flag();
        const sweep = flag();
        const ex = baseX + number();
        const ey = baseY + number();
        arcPoints(x, y, rx, ry, rotation, largeArc, sweep, ex, ey, lineTo);
        x = ex;
        y = ey;
      } else {
        throw new Error('unknown command');
      }

      lastCurve = curve;
    }
  } catch {
    // Keep what the reader read before the error.
  }
  return outlines;
}

/**
 * Adds the points of an elliptical arc, from the SVG endpoint form.
 * The math follows the SVG specification, appendix "Elliptical arc implementation notes".
 * @param {number} x1 start
 * @param {number} y1
 * @param {number} rx radii
 * @param {number} ry
 * @param {number} rotation x axis rotation of the ellipse, degrees
 * @param {boolean} largeArc
 * @param {boolean} sweep
 * @param {number} x2 end
 * @param {number} y2
 * @param {(x: number, y: number) => void} lineTo
 */
function arcPoints(x1, y1, rx, ry, rotation, largeArc, sweep, x2, y2, lineTo) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    lineTo(x2, y2);
    return;
  }
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  // Radii that are too small to reach the end grow until they reach it.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let factor = Math.sqrt(Math.max(0, numerator / denominator));
  if (largeArc === sweep) factor = -factor;
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  /** Signed angle from vector u to vector v. */
  const angle = (/** @type {number} */ ux, /** @type {number} */ uy, /** @type {number} */ vx, /** @type {number} */ vy) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const startAngle = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const parts = Math.max(2, Math.ceil(Math.abs(delta) / ARC_STEP));
  for (let part = 1; part < parts; part++) {
    const t = startAngle + (delta * part) / parts;
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    lineTo(cos * px - sin * py + cx, sin * px + cos * py + cy);
  }
  lineTo(x2, y2);
}

/**
 * Reads an SVG transform list. The transforms apply to a point from right to left.
 * @param {string} text
 * @returns {Matrix}
 */
export function parseTransform(text) {
  let result = IDENTITY;
  for (const [, kind, argumentText] of text.matchAll(TRANSFORM)) {
    const values = (argumentText.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    const [a = 0, b = 0, c = 0] = values;
    /** @type {Matrix} */
    let matrix = IDENTITY;
    if (kind === 'matrix' && values.length === 6) {
      matrix = values;
    } else if (kind === 'translate') {
      matrix = [1, 0, 0, 1, a, b];
    } else if (kind === 'scale') {
      matrix = [a, 0, 0, values.length > 1 ? b : a, 0, 0];
    } else if (kind === 'rotate') {
      const turn = (a * Math.PI) / 180;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      // rotate(angle, cx, cy) turns about the point (cx, cy).
      matrix = multiply(multiply([1, 0, 0, 1, b, c], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -b, -c]);
    } else if (kind === 'skewX') {
      matrix = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    } else if (kind === 'skewY') {
      matrix = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    }
    result = multiply(result, matrix);
  }
  return result;
}

/**
 * @param {Matrix} m first transform
 * @param {Matrix} n second transform
 * @returns {Matrix} the transform that applies `n` and then `m`
 */
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * @param {Matrix} m
 * @param {number[]} points x and y of each point in turn
 * @returns {number[]}
 */
function applyMatrix(m, points) {
  if (m === IDENTITY) return points;
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = m[0] * points[i] + m[2] * points[i + 1] + m[4];
    out[i + 1] = m[1] * points[i] + m[3] * points[i + 1] + m[5];
  }
  return out;
}
