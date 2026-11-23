import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AUDIENCE_DISTANCE, AUDIENCE_SEAT } from '../src/camera.js';
import {
  CROWD_DEPTH,
  CROWD_SIZE,
  CROWD_WIDTH,
  LOWEST_STAR,
  PERSON_FIELDS,
  PERSON_SPACING,
  SEAT_CLEARANCE,
  STAR_COUNT,
  makeCrowd,
  makeStars,
} from '../src/scenery.js';

test('the crowd stands in its area, apart, and clear of the audience seat', () => {
  const people = makeCrowd();
  const count = people.length / PERSON_FIELDS;
  assert.equal(count, CROWD_SIZE);
  let phones = 0;
  let front = 0;
  for (let i = 0; i < count; i++) {
    const [x, y, height, shoulder, phone, side] = people.subarray(i * PERSON_FIELDS, (i + 1) * PERSON_FIELDS);
    assert.ok(Math.abs(x) <= CROWD_WIDTH / 2);
    assert.ok(y <= -AUDIENCE_DISTANCE && y >= -AUDIENCE_DISTANCE - CROWD_DEPTH);
    assert.ok(height >= 1 && height <= 2, `height ${height}`);
    assert.ok(shoulder > 0.1 && shoulder < 0.3);
    assert.ok(phone === 0 || phone === 1);
    assert.ok(side === -1 || side === 1);
    assert.ok(Math.hypot(x - AUDIENCE_SEAT[0], y - AUDIENCE_SEAT[1]) >= SEAT_CLEARANCE);
    phones += phone;
    if (y > -AUDIENCE_DISTANCE - CROWD_DEPTH / 2) front++;
  }
  assert.ok(phones > 0 && phones < count / 10, `${phones} phones`);
  assert.ok(front > count / 2, 'the front half holds more people');
  // Every pair stands at least the spacing apart.
  let closest = Infinity;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const a = i * PERSON_FIELDS;
      const b = j * PERSON_FIELDS;
      closest = Math.min(closest, Math.hypot(people[a] - people[b], people[a + 1] - people[b + 1]));
    }
  }
  assert.ok(closest >= PERSON_SPACING, `closest pair ${closest} m`);
});

test('the crowd and the stars are the same each time', () => {
  assert.deepEqual(makeCrowd(), makeCrowd());
  assert.deepEqual(makeStars(), makeStars());
});

test('the stars are unit directions above the lowest star', () => {
  const { directions, brightness, colors } = makeStars();
  assert.equal(directions.length, STAR_COUNT * 3);
  assert.equal(colors.length, STAR_COUNT * 3);
  let bright = 0;
  for (let star = 0; star < STAR_COUNT; star++) {
    const [x, y, z] = directions.subarray(star * 3, star * 3 + 3);
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6);
    assert.ok(z >= Math.sin(LOWEST_STAR) - 1e-6);
    assert.ok(brightness[star] > 0 && brightness[star] <= 1);
    if (brightness[star] > 0.5) bright++;
  }
  assert.ok(bright > 0 && bright < STAR_COUNT / 10, `${bright} bright stars`);
});
