'use strict';
/**
 * Mia, the office designer: a black snake drawn in code (snakeArt.ts), on the
 * cast's canvases like Theo, so the floor, cards and picker treat her the same.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const snake = loadTs('src/renderer/src/scene/office/snakeArt.ts');
const alpha = (buf, w, x, y) => buf[(y * w + x) * 4 + 3];
const rgb = (buf, w, x, y) => Array.from(buf.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
const opaque = (buf) => { const px = []; for (let i = 0; i < buf.length; i += 4) if (buf[i + 3] === 255) px.push([buf[i], buf[i + 1], buf[i + 2]]); return px; };

test('portrait and walk frames have the cast canvas sizes', () => {
  assert.equal(snake.snakePortraitBuf().length, 18 * 28 * 4);
  const s = snake.snakeSceneBufs();
  assert.equal(s.front.length, 3);
  assert.equal(s.back.length, 3);
  for (const b of [...s.front, ...s.back]) assert.equal(b.length, 18 * 32 * 4);
});

test('she is black, with amber slit eyes, a red tongue and a coral beret', () => {
  const p = snake.snakePortraitBuf();
  const px = opaque(p);
  const dark = px.filter(([r, g, b]) => r + g + b < 3 * 70).length;
  assert.ok(dark / px.length > 0.55, `mostly black scales (${Math.round(dark / px.length * 100)}%)`);
  assert.deepEqual(rgb(p, 18, 4, 7), [236, 178, 52], 'amber eye');
  assert.deepEqual(rgb(p, 18, 5, 6), [18, 14, 20], 'slit pupil, top');
  assert.deepEqual(rgb(p, 18, 5, 8), [18, 14, 20], 'slit pupil, bottom');
  assert.deepEqual(rgb(p, 18, 8, 13), [222, 60, 78], 'forked tongue');
  assert.deepEqual(rgb(p, 18, 8, 3), [226, 102, 96], 'coral beret');
});

test('no legs: she stands on stacked coils that touch the floor', () => {
  const [stand] = snake.snakeSceneBufs().front;
  for (const x of [4, 8, 12]) assert.equal(alpha(stand, 18, x, 30), 255, `coil on the floor at x${x}`);
  // creases between the turns of the coil read as separate loops
  assert.deepEqual(rgb(stand, 18, 8, 27), [22, 22, 30]);
});

test('she sways as she moves and the tongue darts out on one step', () => {
  const [stand, stepL, stepR] = snake.snakeSceneBufs().front;
  const neckRow = (b) => [...Array(18).keys()].filter((x) => alpha(b, 18, x, 16) === 255 && rgb(b, 18, x, 16).join() !== '16,14,22');
  assert.notDeepEqual(neckRow(stepL), neckRow(stand), 'neck sways left');
  assert.notDeepEqual(neckRow(stepR), neckRow(stand), 'neck sways right');
  const TONGUE = '222,60,78';
  assert.equal(rgb(stepL, 18, 8, 13).join(), TONGUE);
  assert.notEqual(rgb(stand, 18, 8, 13).join(), TONGUE);
});

test('from behind: no eyes, the beret still on', () => {
  const [back] = snake.snakeSceneBufs().back;
  const amber = opaque(back).filter(([r, g, b]) => r === 236 && g === 178 && b === 52);
  assert.equal(amber.length, 0);
  assert.deepEqual(rgb(back, 18, 8, 3), [226, 102, 96]);
});

test('Mia is in the cast and drawn by her own module', () => {
  const castSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/src/scene/office/cast.ts'), 'utf8');
  assert.match(castSrc, /\| 'mia';/);
  assert.match(castSrc, /name: 'mia',\s+displayName: 'Mia'/);
  const art = fs.readFileSync(path.join(__dirname, '../src/renderer/src/scene/office/portraitArt.ts'), 'utf8');
  assert.match(art, /name === 'mia' \? snakePortraitBuf\(\)/);
  assert.match(art, /snakeSceneBufs\(\)/);
});
