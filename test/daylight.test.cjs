'use strict';
/**
 * Wave 7: day and night on the office floor by the local clock (daylight.ts),
 * and the lights the loft turns on at night.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { daylightAt, hoursOf } = loadTs('src/renderer/src/scene/office/daylight.ts');
const { LOFT_LIGHTS, LOFT_LAYOUT } = loadTs('src/renderer/src/assets/maps/loft.layout.ts');

test('the working day is clear, the night is dark navy', () => {
  for (const h of [8, 10, 12.5, 15, 17.5]) {
    assert.equal(daylightAt(h).alpha, 0, `${h}:00 is clear`);
    assert.equal(daylightAt(h).night, 0);
  }
  for (const h of [22, 23.5, 0, 2, 4.9]) {
    const d = daylightAt(h);
    assert.equal(d.color, 0x0a1238, `${h}:00 is navy`);
    assert.equal(d.night, 1);
  }
});

test('dusk warms then darkens; dawn lightens', () => {
  const sunset = daylightAt(19);
  assert.equal(sunset.color, 0xff8a3d);
  assert.ok(sunset.alpha > 0 && sunset.night < 0.5);
  // darker every half hour from 18:00 to 22:00, lighter from 05:00 to 08:00
  for (let h = 18; h < 22; h += 0.5) assert.ok(daylightAt(h + 0.5).alpha > daylightAt(h).alpha, `${h}`);
  for (let h = 5; h < 8; h += 0.5) assert.ok(daylightAt(h + 0.5).alpha < daylightAt(h).alpha, `${h}`);
  assert.equal(daylightAt(6.5).color, 0xff9a7a, 'pink at dawn');
});

test('the clock wraps and the colour blends between stops', () => {
  assert.deepEqual(daylightAt(24), daylightAt(0));
  assert.deepEqual(daylightAt(-1), daylightAt(23));
  assert.deepEqual(daylightAt(25.5), daylightAt(1.5));
  const mid = daylightAt(19.75).color; // halfway from sunset orange to twilight purple
  assert.ok(mid !== 0xff8a3d && mid !== 0x2a2060);
  assert.ok((mid >> 16) < 0xff && (mid >> 16) > 0x2a);
});

test('hoursOf reads local time', () => {
  assert.equal(hoursOf(new Date(2026, 9, 27, 18, 30, 0)), 18.5);
  assert.equal(hoursOf(new Date(2026, 9, 27, 0, 0, 36)), 0.01);
});

test('the loft lights sit on the map', () => {
  assert.ok(LOFT_LIGHTS.length >= 2);
  for (const l of LOFT_LIGHTS) {
    assert.ok(l.x >= 0 && l.x < LOFT_LAYOUT.width && l.y >= 0 && l.y < LOFT_LAYOUT.height);
    assert.ok(l.radius > 0);
  }
  assert.ok(LOFT_LIGHTS.some((l) => l.flicker), 'the fireplace flickers');
});
