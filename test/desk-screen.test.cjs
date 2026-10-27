'use strict';
/**
 * Wave 7: desk monitors show what their agent is up to (screenMode.ts).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { screenModeFor, GLYPHS, SCREEN_FILL } = loadTs('src/renderer/src/scene/office/screenMode.ts');

test('each status gets its own screen', () => {
  assert.equal(screenModeFor('working'), 'code');
  assert.equal(screenModeFor('thinking'), 'think');
  assert.equal(screenModeFor('waiting'), 'ask');
  assert.equal(screenModeFor('blocked'), 'ask', 'blocked waits on the human too');
  assert.equal(screenModeFor('looping'), 'alert');
  assert.equal(screenModeFor('compacting'), 'pack');
  assert.equal(screenModeFor('success'), 'done');
  for (const s of ['idle', 'ghost', 'typing', undefined, 'something-new']) assert.equal(screenModeFor(s), 'idle', String(s));
});

test('glyphs are rectangular and fit the 12×8 screen', () => {
  for (const [name, rows] of Object.entries(GLYPHS)) {
    assert.ok(rows.length <= 8, name);
    for (const r of rows) {
      assert.equal(r.length, rows[0].length, `${name} rows are even`);
      assert.match(r, /^[.#]+$/);
    }
    assert.ok(rows[0].length <= 12, name);
    assert.ok(rows.some((r) => r.includes('#')), name);
  }
});

test('the attention states colour the whole screen', () => {
  for (const m of ['ask', 'alert', 'done']) assert.equal(typeof SCREEN_FILL[m], 'number', m);
  assert.equal(SCREEN_FILL.code, null, 'working keeps the blue desktop');
});
