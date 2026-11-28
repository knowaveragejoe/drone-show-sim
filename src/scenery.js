// The scenery around the show: the crowd and the stars. A shader in renderer.js draws the sky,
// the ground, and the hills. This module makes plain lists, so Node can test them.

import { AUDIENCE_DISTANCE, AUDIENCE_SEAT } from './camera.js';
import { createRng } from './rng.js';

// The crowd stands on the field in front of the show. Its front row is at the audience
// distance. It is this wide and this deep, meters.
export const CROWD_WIDTH = 140;
export const CROWD_DEPTH = 35;
export const CROWD_SIZE = 1200;
// People stand at least this far apart, meters.
export const PERSON_SPACING = 0.8;
// Nobody stands this close to the audience seat, so no head fills the view, meters.
export const SEAT_CLEARANCE = 4;
// A faint barrier on the field marks the audience area: the area of the crowd, and this much
// room around it, so that nobody stands on the barrier, meters.
export const AUDIENCE_AREA_MARGIN = 2;
// The audience area on the field: the smallest x and y, then the largest x and y, meters. Its
// front edge faces the show.
export const AUDIENCE_AREA = [
  -CROWD_WIDTH / 2 - AUDIENCE_AREA_MARGIN,
  -AUDIENCE_DISTANCE - CROWD_DEPTH - AUDIENCE_AREA_MARGIN,
  CROWD_WIDTH / 2 + AUDIENCE_AREA_MARGIN,
  -AUDIENCE_DISTANCE + AUDIENCE_AREA_MARGIN,
];
// This share of the crowd holds up a phone to film the show.
const PHONE_SHARE = 0.05;
const CHILD_SHARE = 0.08;
// The numbers of one person in the list that `makeCrowd` returns.
export const PERSON_FIELDS = 6;

const CROWD_SEED = 7;
const STAR_SEED = 11;
export const STAR_COUNT = 1600;
// No star is lower than this, radians. The hills and the glow of the horizon hide them.
export const LOWEST_STAR = (4 * Math.PI) / 180;

/**
 * Places the people of the crowd. The crowd is denser at the front, near the show.
 * @returns {Float32Array} per person, `PERSON_FIELDS` numbers: x and y of the feet, meters;
 *   height, meters; half the shoulder width, meters; 1 for a person who holds up a phone,
 *   else 0; the side of the phone, -1 or 1
 */
export function makeCrowd() {
  const random = createRng(CROWD_SEED);
  const people = new Float32Array(CROWD_SIZE * PERSON_FIELDS);
  // A grid of cells as large as the spacing. A new person checks the cells around it only.
  const columns = Math.ceil(CROWD_WIDTH / PERSON_SPACING);
  const rows = Math.ceil(CROWD_DEPTH / PERSON_SPACING);
  /** @type {number[][]} */
  const cells = Array.from({ length: columns * rows }, () => []);
  const front = -AUDIENCE_DISTANCE;
  const [seatX, seatY] = AUDIENCE_SEAT;

  let count = 0;
  // Dart throwing: try random places, and keep the ones far enough from the others.
  for (let tries = 0; count < CROWD_SIZE && tries < CROWD_SIZE * 50; tries++) {
    const across = random() * CROWD_WIDTH;
    const back = random() * CROWD_DEPTH;
    // Fewer people stand at the back.
    if (random() > 1 - 0.6 * (back / CROWD_DEPTH)) continue;
    const x = across - CROWD_WIDTH / 2;
    const y = front - back;
    if (Math.hypot(x - seatX, y - seatY) < SEAT_CLEARANCE) continue;
    const column = Math.floor(across / PERSON_SPACING);
    const row = Math.floor(back / PERSON_SPACING);
    if (isCrowded(cells, people, columns, rows, column, row, x, y)) continue;
    cells[row * columns + column].push(count);

    const child = random() < CHILD_SHARE;
    const offset = count * PERSON_FIELDS;
    people[offset] = x;
    people[offset + 1] = y;
    people[offset + 2] = child ? 1.05 + 0.35 * random() : 1.55 + 0.37 * random();
    people[offset + 3] = child ? 0.13 + 0.03 * random() : 0.19 + 0.05 * random();
    people[offset + 4] = random() < PHONE_SHARE ? 1 : 0;
    people[offset + 5] = random() < 0.5 ? -1 : 1;
    count++;
  }
  return people.subarray(0, count * PERSON_FIELDS);
}

/**
 * @param {number[][]} cells the people in each cell
 * @param {Float32Array} people
 * @param {number} columns
 * @param {number} rows
 * @param {number} column cell of the new person
 * @param {number} row
 * @param {number} x place of the new person
 * @param {number} y
 * @returns {boolean} true when somebody stands closer than the spacing
 */
function isCrowded(cells, people, columns, rows, column, row, x, y) {
  for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
    for (let c = Math.max(0, column - 1); c <= Math.min(columns - 1, column + 1); c++) {
      for (const other of cells[r * columns + c]) {
        const offset = other * PERSON_FIELDS;
        if (Math.hypot(people[offset] - x, people[offset + 1] - y) < PERSON_SPACING) return true;
      }
    }
  }
  return false;
}

/**
 * Makes the stars: random directions above the lowest star, many dim stars and a few bright
 * ones, in white and faint blue and orange tints.
 * @returns {{directions: Float32Array, brightness: Float32Array, colors: Float32Array}}
 *   a unit direction per star, xyz; a brightness per star, 0 to 1; a color per star, red,
 *   green, blue, each 0 to 1
 */
export function makeStars() {
  const random = createRng(STAR_SEED);
  const directions = new Float32Array(STAR_COUNT * 3);
  const brightness = new Float32Array(STAR_COUNT);
  const colors = new Float32Array(STAR_COUNT * 3);
  const lowest = Math.sin(LOWEST_STAR);
  const tints = [
    [0.75, 0.85, 1],
    [1, 1, 1],
    [1, 0.86, 0.7],
  ];
  for (let star = 0; star < STAR_COUNT; star++) {
    // Uniform over the sky above the lowest star: the height of a uniform direction is uniform.
    const z = lowest + (1 - lowest) * random();
    const angle = 2 * Math.PI * random();
    const flat = Math.sqrt(1 - z * z);
    directions.set([flat * Math.cos(angle), flat * Math.sin(angle), z], star * 3);
    brightness[star] = 0.12 + 0.88 * random() ** 12;
    colors.set(tints[Math.floor(random() * tints.length)], star * 3);
  }
  return { directions, brightness, colors };
}
