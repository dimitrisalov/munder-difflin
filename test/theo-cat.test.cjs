'use strict';
/**
 * Theo, the owner's boss: a white Devon Rex drawn in code (catArt.ts), on the
 * same canvases as the human cast so the floor and cards treat him the same.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const cat = loadTs('src/renderer/src/scene/office/catArt.ts');
const alpha = (buf, w, x, y) => buf[(y * w + x) * 4 + 3];
const rgb = (buf, w, x, y) => Array.from(buf.slice((y * w + x) * 4, (y * w + x) * 4 + 3));

test('portrait and walk frames have the cast canvas sizes', () => {
  assert.equal(cat.catPortraitBuf().length, 18 * 28 * 4);
  const s = cat.catSceneBufs();
  assert.equal(s.front.length, 3);
  assert.equal(s.back.length, 3);
  for (const b of [...s.front, ...s.back]) assert.equal(b.length, 18 * 32 * 4);
});

test('he is white, with pink ears and yellow-green eyes, in a red tie', () => {
  const p = cat.catPortraitBuf();
  assert.deepEqual(rgb(p, 18, 8, 7), [243, 240, 234], 'white forehead');
  assert.deepEqual(rgb(p, 18, 3, 3), [238, 172, 180], 'pink inner ear');
  assert.deepEqual(rgb(p, 18, 6, 9), [178, 196, 58], 'yellow-green eye');
  assert.deepEqual(rgb(p, 18, 9, 21), [176, 52, 58], 'red tie');
});

test('the walk cycle lifts one paw at a time', () => {
  const PAW = [226, 218, 210];
  const pawDown = (b, x) => JSON.stringify(rgb(b, 18, x, 31)) === JSON.stringify(PAW);
  const [stand, stepL, stepR] = cat.catSceneBufs().front;
  assert.ok(pawDown(stand, 5) && pawDown(stand, 11), 'both paws on the floor');
  assert.ok(!pawDown(stepL, 5) && pawDown(stepL, 11), 'left paw up');
  assert.ok(pawDown(stepR, 5) && !pawDown(stepR, 11), 'right paw up');
});

test('the gap between his legs stays see-through (no dark "trousers")', () => {
  const [stand] = cat.catSceneBufs().front;
  assert.equal(alpha(stand, 18, 8, 29), 0);
  assert.equal(alpha(stand, 18, 9, 29), 0);
});

test('whiskers are translucent so the outline does not thicken them', () => {
  const p = cat.catPortraitBuf();
  const a = alpha(p, 18, 1, 12);
  assert.ok(a > 0 && a < 255, `alpha ${a}`);
});

test('Theo is in the cast and the boss keeps his look across launches', () => {
  const castSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/src/scene/office/cast.ts'), 'utf8');
  assert.match(castSrc, /\| 'theo';/);
  assert.match(castSrc, /name: 'theo',\s+displayName: 'Theo'/);
  const hive = fs.readFileSync(path.join(__dirname, '../src/renderer/src/hooks/useHive.ts'), 'utf8');
  assert.match(hive, /character: CAST_BY_NAME\[config\.godCharacter/);
  const edit = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/EditAgentModal.tsx'), 'utf8');
  assert.match(edit, /updateConfig\(\{ godCharacter: character \}\)/);
});
