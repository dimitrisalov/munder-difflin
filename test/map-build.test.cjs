'use strict';
/**
 * Wave 7: maps built from a readable layout (mapBuild.ts + furniture.ts), the
 * loft built from it, and desks by department (seatZones.ts).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { buildMap } = loadTs('src/renderer/src/scene/office/mapBuild.ts');
const { FURNITURE } = loadTs('src/renderer/src/scene/office/furniture.ts');
const { LOFT_LAYOUT } = loadTs('src/renderer/src/assets/maps/loft.layout.ts');
const { seatZoneFor, freeSeatInZone } = loadTs('src/renderer/src/scene/office/seatZones.ts');
const officeTilesets = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/renderer/src/assets/maps/office.tmj'), 'utf8')).tilesets;

const layer = (map, name) => map.layers.find((l) => l.name === name);
const at = (map, name, x, y) => layer(map, name).data[y * map.width + x];

function tiny(items, extra = {}) {
  return {
    width: 12, height: 10,
    floor: { base: 783, areas: [] },
    entrance: { x: 5, width: 2 },
    rooms: [], zones: [{ name: 'work', x0: 1, y0: 3, x1: 10, y1: 8 }],
    items, points: [{ name: 'entrance', x: 5, y: 8 }],
    ...extra,
  };
}

test('the loft builds clean: no overlaps, every seat and point reachable', () => {
  const r = buildMap(LOFT_LAYOUT, FURNITURE, officeTilesets);
  assert.deepEqual(r.problems, []);
  assert.equal(r.map.width, 40);
  assert.equal(r.map.height, 26);
  const names = r.seats.map((s) => s.name);
  assert.ok(names.includes('desk-ceo'));
  for (const zone of ['library', 'studio', 'dev', 'guests']) {
    assert.ok(names.some((n) => n.startsWith(`${zone}-seat-`)), `${zone} has desks`);
  }
  assert.deepEqual(r.map.layers.map((l) => l.name),
    ['floor', 'walls', 'furniture-below', 'furniture-above', 'collision', 'spawn-points', 'zones']);
  for (const z of ['boardroom', 'cafeteria', 'lounge', 'reception', 'theo']) {
    assert.ok(layer(r.map, 'zones').objects.some((o) => o.name === z), z);
  }
});

test('the hall gets walls all round with a door at the entrance', () => {
  const r = buildMap(tiny([]), FURNITURE, officeTilesets);
  const m = r.map;
  assert.equal(at(m, 'walls', 0, 0), 514);
  assert.equal(at(m, 'walls', 11, 0), 517);
  assert.equal(at(m, 'walls', 3, 9), 579);
  assert.equal(at(m, 'walls', 5, 9), 0, 'door');
  assert.equal(at(m, 'collision', 5, 9), 0);
  assert.equal(at(m, 'collision', 4, 9), 1);
  assert.equal(at(m, 'collision', 3, 1), 1, 'top wall blocks');
  assert.equal(at(m, 'collision', 3, 4), 0, 'floor is free');
});

test('a desk paints its art, blocks around the stool, and makes a named seat', () => {
  const r = buildMap(tiny([{ item: 'desk', x: 2, y: 3 }]), FURNITURE, officeTilesets);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.seats, [{ name: 'work-seat-1', zone: 'work', x: 3, y: 5 }]);
  assert.equal(at(r.map, 'furniture-above', 3, 3), 365, 'monitor');
  assert.equal(at(r.map, 'furniture-below', 3, 5), 289, 'stool');
  assert.equal(at(r.map, 'collision', 3, 4), 1);
  assert.equal(at(r.map, 'collision', 3, 5), 0, 'the seat is walkable');
  const pt = layer(r.map, 'spawn-points').objects.find((o) => o.name === 'work-seat-1');
  assert.deepEqual([pt.x, pt.y], [48, 80]);
});

test('rugs never block; wall items never block', () => {
  const r = buildMap(tiny([{ item: 'rug-red', x: 2, y: 4 }, { item: 'window', x: 2, y: 1 }]), FURNITURE, officeTilesets);
  assert.deepEqual(r.problems, []);
  assert.equal(at(r.map, 'collision', 3, 5), 0);
  assert.equal(at(r.map, 'furniture-above', 2, 1), 327);
});

test('the builder reports overlaps, unknown items, misfits and dead ends', () => {
  const overlap = buildMap(tiny([{ item: 'sofa-gray', x: 2, y: 4 }, { item: 'fridge', x: 3, y: 4 }]), FURNITURE, officeTilesets);
  assert.ok(overlap.problems.some((p) => /fridge at 3,4 overlaps sofa-gray@2,4/.test(p)), overlap.problems.join('; '));
  const unknown = buildMap(tiny([{ item: 'hot-tub', x: 2, y: 4 }]), FURNITURE, officeTilesets);
  assert.match(unknown.problems[0], /unknown item "hot-tub"/);
  const misfit = buildMap(tiny([{ item: 'meeting-table', x: 8, y: 4 }]), FURNITURE, officeTilesets);
  assert.match(misfit.problems[0], /does not fit/);
  // A desk walled in by sofas: its seat cannot be reached.
  const boxed = buildMap(tiny([
    { item: 'desk', x: 4, y: 3 },
    { item: 'sofa-gray', x: 1, y: 6 }, { item: 'sofa-gray', x: 7, y: 6 }, { item: 'sofa-gray', x: 4, y: 7 },
    { item: 'armchair-gray', x: 3, y: 5 }, { item: 'armchair-gray', x: 7, y: 4 },
  ]), FURNITURE, officeTilesets);
  assert.ok(boxed.problems.some((p) => /work-seat-1 .* cannot be reached/.test(p)), boxed.problems.join('; '));
});

test('a walled room: posts down the side, a band below, a door gap, closed corners', () => {
  const r = buildMap(tiny([], { rooms: [{ x0: 6, y0: 3, x1: 10, y1: 4, walls: ['w', 's'], doors: [{ side: 's', at: 8 }] }] }), FURNITURE, officeTilesets);
  const m = r.map;
  assert.equal(at(m, 'walls', 5, 3), 611, 'post cap');
  assert.equal(at(m, 'walls', 5, 4), 643);
  assert.equal(at(m, 'walls', 5, 5), 522, 'band closes the corner');
  assert.equal(at(m, 'walls', 7, 6), 554);
  assert.equal(at(m, 'walls', 8, 5), 0, 'door');
  assert.equal(at(m, 'collision', 8, 6), 0);
});

test('agents sit by department', () => {
  assert.equal(seatZoneFor({ id: 'phyllis-1', description: 'Researcher' }), 'library');
  assert.equal(seatZoneFor({ id: 'k', description: 'копирайтер офиса' }), 'studio');
  assert.equal(seatZoneFor({ id: 'p', description: 'Designer' }), 'studio');
  assert.equal(seatZoneFor({ id: 'r', description: 'разработчик' }), 'dev');
  assert.equal(seatZoneFor({ id: 'temp-kelly-headlines', description: 'Copywriter' }), 'guests');
  assert.equal(seatZoneFor({ id: 'god', isGod: true }), 'theo');
  assert.equal(seatZoneFor({ id: 'x', description: 'accountant' }), undefined);
  const names = ['desk-ceo', 'library-seat-1', 'library-seat-2', 'studio-seat-1', null];
  assert.equal(freeSeatInZone('library', names, new Set([0])), 1);
  assert.equal(freeSeatInZone('library', names, new Set([0, 1])), 2);
  assert.equal(freeSeatInZone('library', names, new Set([0, 1, 2])), -1);
  assert.equal(freeSeatInZone('theo', names, new Set()), -1, 'the boss seat is never handed out here');
});
