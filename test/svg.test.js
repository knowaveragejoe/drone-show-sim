import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLOUD_SIZE } from '../src/shapes.js';
import { parseColor, parsePathData, parseSvg, parseTransform, svgCloud } from '../src/svg.js';

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);
}

/** Points of one outline as [x, y] pairs. */
function pairs(outline) {
  const out = [];
  for (let i = 0; i < outline.length; i += 2) out.push([outline[i], outline[i + 1]]);
  return out;
}

/** The points of each outline of a drawing, without the colors. */
const outlinesOf = (text) => parseSvg(text).map((outline) => outline.points);

/** The color of each outline of a drawing. */
const colorsOf = (text) => parseSvg(text).map((outline) => outline.color);

/** Wraps SVG elements in a root element. */
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

// Path data.

test('parsePathData reads straight lines, absolute and relative', () => {
  assert.deepEqual(parsePathData('M10 20 L30 20 H40 V50 Z'), [[10, 20, 30, 20, 40, 20, 40, 50, 10, 20]]);
  assert.deepEqual(parsePathData('m10 20 l20 0 h10 v30 z'), [[10, 20, 30, 20, 40, 20, 40, 50, 10, 20]]);
});

test('parsePathData reads numbers after a moveto as lines', () => {
  assert.deepEqual(parsePathData('M0 0 10 0 10 10'), [[0, 0, 10, 0, 10, 10]]);
  assert.deepEqual(parsePathData('m0 0 10 0 0 10'), [[0, 0, 10, 0, 10, 10]]);
});

test('parsePathData reads compact numbers', () => {
  // "1.5.5" is 1.5 and .5. "-1-2" is -1 and -2. Commas also separate.
  assert.deepEqual(parsePathData('M1.5.5L-1-2,3e1,1E-1'), [[1.5, 0.5, -1, -2, 30, 0.1]]);
});

test('parsePathData starts a new outline at each moveto, and after a close', () => {
  const outlines = parsePathData('M0 0 L1 0 M5 5 L6 5 Z L7 7');
  assert.equal(outlines.length, 3);
  assert.deepEqual(outlines[0], [0, 0, 1, 0]);
  assert.deepEqual(outlines[1], [5, 5, 6, 5, 5, 5]);
  // After Z the current point is the start of the closed outline.
  assert.deepEqual(outlines[2], [5, 5, 7, 7]);
});

test('parsePathData follows cubic and quadratic curves', () => {
  // A cubic curve from (0,0) to (3,0) with controls (1,3) and (2,3). At t = 0.5 it is at (1.5, 2.25).
  const [cubic] = parsePathData('M0 0 C1 3 2 3 3 0');
  const points = pairs(cubic);
  assert.deepEqual(points.at(-1), [3, 0]);
  near(points[12][0], 1.5);
  near(points[12][1], 2.25);
  // A quadratic curve from (0,0) to (2,0) with control (1,2). At t = 0.5 it is at (1, 1).
  const [quadratic] = parsePathData('M0 0 Q1 2 2 0');
  near(pairs(quadratic)[12][0], 1);
  near(pairs(quadratic)[12][1], 1);
});

test('parsePathData reflects control points only after a curve of the same kind', () => {
  // S after C reflects the second control point: the second curve is a mirror of the first.
  const [smooth] = parsePathData('M0 0 C0 2 2 2 2 0 S4 -2 4 0');
  const points = pairs(smooth);
  near(points[12][1], 1.5);
  near(points[36][1], -1.5);
  // T after C does not reflect the cubic control point: the first control is the current point.
  const [mixed] = parsePathData('M0 0 C0 2 2 2 2 0 T4 0');
  for (const [, y] of pairs(mixed).slice(25)) near(y, 0);
});

test('parsePathData follows arcs on both sides and with both sweeps', () => {
  // Half circles of radius 1 from (0,0) to (2,0). The middle point is at (1, ±1).
  const middle = (d) => {
    const points = pairs(parsePathData(d)[0]);
    return points[Math.floor(points.length / 2)];
  };
  const below = middle('M0 0 A1 1 0 0 0 2 0');
  const above = middle('M0 0 A1 1 0 0 1 2 0');
  near(below[0], 1, 0.1);
  near(below[1], 1, 0.01);
  near(above[1], -1, 0.01);
  // Every point of the arc is on the circle.
  for (const [x, y] of pairs(parsePathData('M0 0 A1 1 0 0 1 2 0')[0])) near(Math.hypot(x - 1, y), 1, 1e-9);
  // The large arc goes the long way around a circle of radius 2.
  const [large] = parsePathData('M0 0 A2 2 0 1 1 2 0');
  const lowest = Math.max(...pairs(large).map(([, y]) => y));
  const highest = Math.min(...pairs(large).map(([, y]) => y));
  assert.ok(highest - lowest < -3, 'the long way covers most of the circle');
});

test('parsePathData reads arc flags that have no space between them', () => {
  const spaced = parsePathData('M0 0 A1 1 0 0 1 2 0');
  assert.deepEqual(parsePathData('M0 0A1 1 0 012 0'), spaced);
});

test('parsePathData makes arc radii large enough to reach the end', () => {
  // A radius of 0.5 cannot reach from (0,0) to (4,0). It grows to 2.
  const points = pairs(parsePathData('M0 0 A0.5 0.5 0 0 1 4 0')[0]);
  for (const [x, y] of points) near(Math.hypot(x - 2, y), 2, 1e-9);
  // A zero radius is a straight line.
  assert.deepEqual(parsePathData('M0 0 A0 5 0 0 1 4 0'), [[0, 0, 4, 0]]);
});

test('parsePathData keeps what it read before an error', () => {
  assert.deepEqual(parsePathData('M0 0 L10 0 L5 oops 10 10'), [[0, 0, 10, 0]]);
  assert.deepEqual(parsePathData('L5 5'), [[0, 0, 5, 5]]);
  assert.deepEqual(parsePathData('10 10'), []);
  assert.deepEqual(parsePathData(''), []);
});

// Transforms.

test('parseTransform reads each kind of transform', () => {
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  assert.deepEqual(apply(parseTransform('translate(5, -2)'), 1, 1), [6, -1]);
  assert.deepEqual(apply(parseTransform('translate(5)'), 1, 1), [6, 1]);
  assert.deepEqual(apply(parseTransform('scale(2 3)'), 1, 1), [2, 3]);
  assert.deepEqual(apply(parseTransform('scale(2)'), 1, 1), [2, 2]);
  assert.deepEqual(apply(parseTransform('matrix(1 2 3 4 5 6)'), 1, 1), [9, 12]);
  const [rx, ry] = apply(parseTransform('rotate(90)'), 1, 0);
  near(rx, 0);
  near(ry, 1);
  // Turn about the point (1, 1): (2, 1) goes to (1, 2).
  const [cx, cy] = apply(parseTransform('rotate(90 1 1)'), 2, 1);
  near(cx, 1);
  near(cy, 2);
  const [sx, sy] = apply(parseTransform('skewX(45)'), 0, 1);
  near(sx, 1);
  near(sy, 1);
});

test('parseTransform applies a list from right to left', () => {
  // Scale first, then move.
  const m = parseTransform('translate(10 0) scale(2)');
  assert.deepEqual([m[0] * 1 + m[4], m[3] * 1 + m[5]], [12, 2]);
  assert.deepEqual(parseTransform(''), [1, 0, 0, 1, 0, 0]);
});

// Elements.

test('parseSvg reads each basic shape', () => {
  const [rect] = outlinesOf(svg('<rect x="1" y="2" width="10" height="5"/>'));
  assert.deepEqual(rect, [1, 2, 11, 2, 11, 7, 1, 7, 1, 2]);

  const [circle] = outlinesOf(svg('<circle cx="50" cy="50" r="20"/>'));
  for (const [x, y] of pairs(circle)) near(Math.hypot(x - 50, y - 50), 20, 1e-9);
  assert.deepEqual(pairs(circle).at(-1), pairs(circle)[0]);

  const [ellipse] = outlinesOf(svg('<ellipse cx="0" cy="0" rx="4" ry="2"/>'));
  for (const [x, y] of pairs(ellipse)) near((x / 4) ** 2 + (y / 2) ** 2, 1, 1e-9);

  assert.deepEqual(outlinesOf(svg('<line x1="0" y1="0" x2="3" y2="4"/>')), [[0, 0, 3, 4]]);
  assert.deepEqual(outlinesOf(svg('<polyline points="0,0 1,0 1,1"/>')), [[0, 0, 1, 0, 1, 1]]);
  assert.deepEqual(outlinesOf(svg('<polygon points="0 0 1 0 1 1"/>')), [[0, 0, 1, 0, 1, 1, 0, 0]]);
});

test('parseSvg rounds the corners of a rect with a corner radius', () => {
  const [rounded] = outlinesOf(svg('<rect x="0" y="0" width="10" height="10" rx="2"/>'));
  const points = pairs(rounded);
  // No point is in a corner: the distance to the nearest corner is at least 2 - 2 / √2.
  for (const [x, y] of points) {
    const corner = Math.min(Math.hypot(x, y), Math.hypot(x - 10, y), Math.hypot(x, y - 10), Math.hypot(x - 10, y - 10));
    assert.ok(corner >= 2 - Math.SQRT2 - 1e-9, `(${x}, ${y})`);
  }
});

test('parseSvg applies the transforms of the element and of its groups', () => {
  const text = svg(
    '<g transform="translate(100 0)"><g transform="scale(2)">' +
      '<line x1="1" y1="1" x2="2" y2="1" transform="translate(0 5)"/></g></g>' +
      '<line x1="0" y1="0" x2="1" y2="0"/>',
  );
  // Inside out: move down 5, then scale by 2, then move right 100.
  assert.deepEqual(outlinesOf(text), [[102, 12, 104, 12], [0, 0, 1, 0]]);
});

test('parseSvg skips elements that the browser does not draw where they stand', () => {
  const text = svg(
    '<defs><circle cx="0" cy="0" r="5"/></defs>' +
      '<clipPath id="c"><rect width="9" height="9"/></clipPath>' +
      '<g display="none"><line x1="0" y1="0" x2="1" y2="1"/></g>' +
      '<line x1="0" y1="0" x2="2" y2="2" style="stroke: red; display: none"/>' +
      '<!-- <line x1="0" y1="0" x2="3" y2="3"/> -->' +
      '<line x1="5" y1="5" x2="6" y2="6"/>',
  );
  assert.deepEqual(outlinesOf(text), [[5, 5, 6, 6]]);
});

test('parseSvg reads a file with a declaration, namespaces, and other elements', () => {
  const text =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg>\n' +
    '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="10px">' +
    '<svg:title>Logo</svg:title><svg:text x="0" y="0">Hi</svg:text>' +
    "<svg:path d='M0 0 L4 0'></svg:path></svg:svg>";
  assert.deepEqual(outlinesOf(text), [[0, 0, 4, 0]]);
});

test('parseSvg rejects a file that is not an SVG drawing', () => {
  assert.throws(() => parseSvg('v 0 0 0\nf 1 2 3\n'), /not an SVG drawing/);
});

// Candidate cloud.

test('svgCloud puts the drawing in unit space, upright and facing the audience', () => {
  // A 20 wide and 10 high rectangle, far from the origin.
  const cloud = svgCloud(svg('<rect x="100" y="50" width="20" height="10"/>'), 1).points;
  assert.equal(cloud.length, CLOUD_SIZE * 3);
  let lowX = Infinity;
  let highX = -Infinity;
  let lowZ = Infinity;
  let highZ = -Infinity;
  for (let i = 0; i < CLOUD_SIZE; i++) {
    lowX = Math.min(lowX, cloud[i * 3]);
    highX = Math.max(highX, cloud[i * 3]);
    assert.equal(cloud[i * 3 + 1], 0);
    lowZ = Math.min(lowZ, cloud[i * 3 + 2]);
    highZ = Math.max(highZ, cloud[i * 3 + 2]);
  }
  near(lowX, -0.5, 0.01);
  near(highX, 0.5, 0.01);
  near(lowZ, -0.25, 0.01);
  near(highZ, 0.25, 0.01);
});

test('svgCloud keeps the top of the drawing up', () => {
  // A short line at the top of the drawing (small y), and a long line at the bottom.
  const cloud = svgCloud(svg('<line x1="0" y1="0" x2="1" y2="0"/><line x1="0" y1="10" x2="10" y2="10"/>'), 1).points;
  let top = 0;
  for (let i = 0; i < CLOUD_SIZE; i++) if (cloud[i * 3 + 2] > 0) top++;
  // The top line has 1/11 of the length, so it gets about 1/11 of the points.
  near(top / CLOUD_SIZE, 1 / 11, 0.01);
});

test('svgCloud puts the points in order along the outlines', () => {
  // A square, then a separate line under it.
  const { points } = svgCloud(svg('<rect x="0" y="0" width="10" height="10"/><line x1="0" y1="20" x2="10" y2="20"/>'), 1);
  let jumps = 0;
  for (let i = 1; i < CLOUD_SIZE; i++) {
    const o = i * 3;
    const step = Math.hypot(points[o] - points[o - 3], points[o + 2] - points[o - 1]);
    // The outlines are 50 long in a drawing 20 high, so a slice is 50 / 20 / 20,000 in unit space.
    if (step > (2 * 50) / 20 / CLOUD_SIZE + 1e-6) jumps++;
  }
  // One jump: from the square to the line.
  assert.equal(jumps, 1);
});

test('svgCloud rejects a drawing with no outlines', () => {
  assert.throws(() => svgCloud(svg('<text x="0" y="0">Hello</text>'), 1), /no outlines/);
  assert.throws(() => svgCloud(svg('<circle cx="5" cy="5" r="0"/>'), 1), /no outlines/);
});

test('svgCloud gives the same cloud for the same seed', () => {
  const text = svg('<circle cx="5" cy="5" r="4"/><path d="M0 0 Q5 9 10 0"/>');
  assert.deepEqual(svgCloud(text, 2), svgCloud(text, 2));
  assert.notDeepEqual(svgCloud(text, 2), svgCloud(text, 3));
});

// Colors.

test('parseColor reads hex colors, rgb functions, and basic names', () => {
  assert.deepEqual(parseColor('#ff0000'), [1, 0, 0]);
  assert.deepEqual(parseColor('#F00'), [1, 0, 0]);
  assert.deepEqual(parseColor(' #00ff0080 '), [0, 1, 0]);
  assert.deepEqual(parseColor('#00f8'), [0, 0, 1]);
  assert.deepEqual(parseColor('rgb(255, 0, 255)'), [1, 0, 1]);
  assert.deepEqual(parseColor('rgba(0,255,0,0.5)'), [0, 1, 0]);
  assert.deepEqual(parseColor('rgb(100% 0% 50% / 0.3)'), [1, 0, 0.5]);
  assert.deepEqual(parseColor('Red'), [1, 0, 0]);
  assert.deepEqual(parseColor('white'), [1, 1, 1]);
  for (const text of ['none', 'transparent', 'url(#gradient)', 'rebeccapurple', '#12345', 'rgb(1, 2)', '']) {
    assert.equal(parseColor(text), null, text);
  }
});

test('an outline takes its stroke color, or its fill color when it has no stroke', () => {
  const text = svg(
    '<line x1="0" y1="0" x2="1" y2="0" stroke="#ff0000" fill="#0000ff"/>' +
      '<line x1="0" y1="0" x2="1" y2="0" fill="#0000ff"/>' +
      '<line x1="0" y1="0" x2="1" y2="0" stroke="none" fill="#00ff00"/>' +
      '<line x1="0" y1="0" x2="1" y2="0"/>' +
      '<line x1="0" y1="0" x2="1" y2="0" stroke="none" fill="url(#g)"/>',
  );
  assert.deepEqual(colorsOf(text), [[1, 0, 0], [0, 0, 1], [0, 1, 0], null, null]);
});

test('the style attribute wins, and groups pass their colors on', () => {
  const text = svg(
    '<g stroke="#ff0000"><g style="stroke: #00ff00">' +
      '<line x1="0" y1="0" x2="1" y2="0"/>' +
      '<line x1="0" y1="0" x2="1" y2="0" stroke="#0000ff"/>' +
      '<line x1="0" y1="0" x2="1" y2="0" stroke="#0000ff" style="stroke:#ffffff !important"/>' +
      '<line x1="0" y1="0" x2="1" y2="0" stroke="inherit"/>' +
      '</g><line x1="0" y1="0" x2="1" y2="0"/></g>' +
      '<line x1="0" y1="0" x2="1" y2="0"/>',
  );
  assert.deepEqual(colorsOf(text), [[0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 1, 0], [1, 0, 0], null]);
});

test('currentColor takes the color property, also from a group', () => {
  const text = svg(
    '<g color="#ff0000"><path d="M0 0 L1 0" stroke="currentColor"/>' +
      '<path d="M0 0 L1 0" style="color: #00ff00; fill: currentcolor"/></g>' +
      '<path d="M0 0 L1 0" stroke="currentColor"/>',
  );
  assert.deepEqual(colorsOf(text), [[1, 0, 0], [0, 1, 0], null]);
});

test('svgCloud gives each point the color of its outline', () => {
  // A red line at the top, and a long line with no color at the bottom.
  const { points, colors } = svgCloud(
    svg('<line x1="0" y1="0" x2="10" y2="0" stroke="red"/><line x1="0" y1="10" x2="10" y2="10"/>'),
    1,
  );
  assert.equal(colors.length, CLOUD_SIZE * 3);
  for (let i = 0; i < CLOUD_SIZE; i++) {
    const expected = points[i * 3 + 2] > 0 ? [1, 0, 0] : [-1, -1, -1];
    assert.deepEqual(Array.from(colors.subarray(i * 3, i * 3 + 3)), expected);
  }
  // A drawing with no colors at all has no color list.
  assert.equal(svgCloud(svg('<line x1="0" y1="0" x2="10" y2="0"/>'), 1).colors, null);
});
