'use strict';
/**
 * Wave 7: maps built from a readable layout (mapBuild.ts + furniture.ts), the
 * loft built from it, desks by department (seatZones.ts), and the props drawn
 * in code (props.ts) with the errands that use them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { buildMap } = loadTs('src/renderer/src/scene/office/mapBuild.ts');
const { FURNITURE } = loadTs('src/renderer/src/scene/office/furniture.ts');
const { LOFT_LAYOUT, LOFT_ERRANDS } = loadTs('src/renderer/src/assets/maps/loft.layout.ts');
const props = loadTs('src/renderer/src/scene/office/props.ts');
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

/** Tiles reachable on foot from the entrance point, as "x,y". */
function reachable(r) {
  const col = layer(r.map, 'collision').data, W = r.map.width, H = r.map.height;
  const e = layer(r.map, 'spawn-points').objects.find((o) => o.name === 'entrance');
  const start = [e.x / 16, e.y / 16];
  const seen = new Set([start.join(',')]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(k) || col[ny * W + nx]) continue;
      seen.add(k); queue.push([nx, ny]);
    }
  }
  return seen;
}

test('the loft builds clean: no overlaps, every seat and point reachable', () => {
  const r = buildMap(LOFT_LAYOUT, FURNITURE, officeTilesets, props.PROP_SIZE);
  assert.deepEqual(r.problems, []);
  assert.equal(r.map.width, 40);
  assert.equal(r.map.height, 26);
  const names = r.seats.map((s) => s.name);
  assert.ok(names.includes('desk-ceo'));
  for (const zone of ['atelier', 'library', 'studio', 'dev', 'guests']) {
    assert.ok(names.some((n) => n.startsWith(`${zone}-seat-`)), `${zone} has desks`);
  }
  assert.deepEqual(r.map.layers.map((l) => l.name),
    ['floor', 'walls', 'furniture-below', 'furniture-above', 'collision', 'spawn-points', 'zones']);
  for (const z of ['atelier', 'boardroom', 'cafeteria', 'lounge', 'reception', 'theo']) {
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
  assert.equal(seatZoneFor({ id: 'p', description: 'Designer' }), 'atelier');
  assert.equal(seatZoneFor({ id: 'mia', description: 'Дизайнер офиса: питч-деки' }), 'atelier');
  assert.equal(seatZoneFor({ id: 'k2', description: 'Content writer' }), 'studio');
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

test('props: sized by kind, block their footprint unless on a table or flat', () => {
  const r = buildMap(tiny([{ item: 'coffee-table', x: 2, y: 4 }], {
    props: [
      { kind: 'bong', x: 3, y: 4, onTop: true },
      { kind: 'scratching-post', x: 7, y: 4 },
      { kind: 'cat-bed', x: 8, y: 6, walkable: true },
    ],
  }), FURNITURE, officeTilesets, props.PROP_SIZE);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.props.map((p) => [p.kind, p.w, p.h]), [['bong', 1, 1], ['scratching-post', 1, 2], ['cat-bed', 1, 1]]);
  assert.equal(at(r.map, 'collision', 7, 4), 1);
  assert.equal(at(r.map, 'collision', 7, 5), 1, 'the post is two tiles tall');
  assert.equal(at(r.map, 'collision', 8, 6), 0, 'the bed can be walked into');
  assert.equal(at(r.map, 'collision', 3, 4), 1, 'the table under the bong still blocks');
});

test('props: unknown kinds, overlaps, walls and misfits are reported', () => {
  const run = (pr, items = []) => buildMap(tiny(items, { props: [pr] }), FURNITURE, officeTilesets, props.PROP_SIZE).problems;
  assert.match(run({ kind: 'hot-tub', x: 3, y: 4 })[0], /unknown prop "hot-tub"/);
  assert.match(run({ kind: 'easel', x: 3, y: 4 }, [{ item: 'fridge', x: 3, y: 4 }]).join('; '), /prop easel at 3,4 overlaps fridge@3,4/);
  assert.match(run({ kind: 'cat-bed', x: 3, y: 5, walkable: true }, [{ item: 'fridge', x: 3, y: 4 }]).join('; '), /overlaps fridge/, 'flat props still need clear floor');
  assert.match(run({ kind: 'food-bowl', x: 3, y: 0 }).join('; '), /inside a wall/);
  assert.match(run({ kind: 'easel', x: 4, y: 9 })[0], /does not fit/);
});

test('the loft: every errand spot can be walked to, and every prop is known', () => {
  const r = buildMap(LOFT_LAYOUT, FURNITURE, officeTilesets, props.PROP_SIZE);
  const seen = reachable(r);
  for (const s of LOFT_ERRANDS) {
    assert.ok(seen.has(`${s.stand.x},${s.stand.y}`), `${s.kind} stand ${s.stand.x},${s.stand.y} is reachable`);
    assert.ok(s.fx.x >= 0 && s.fx.y >= 0 && s.fx.x < r.map.width && s.fx.y < r.map.height, `${s.kind} fx is on the map`);
  }
  const kinds = new Set(LOFT_ERRANDS.map((s) => s.kind));
  for (const k of ['bong', 'gaming', 'console', 'nap', 'smoke']) assert.ok(kinds.has(k), k);
  for (const s of LOFT_ERRANDS.filter((e) => e.kind === 'nap' || e.kind === 'smoke')) assert.ok(s.godOnly, `${s.kind} is Theo's`);
  for (const k of ['bask', 'pin', 'sketch']) {
    const s = LOFT_ERRANDS.find((e) => e.kind === k);
    assert.equal(s && s.character, 'mia', `${k} is Mia's`);
  }
  for (const p of LOFT_LAYOUT.props) assert.ok(props.isPropKind(p.kind), p.kind);
  // The gaming errand sits in the gaming desk's chair.
  const gaming = LOFT_ERRANDS.find((s) => s.kind === 'gaming');
  const seat = r.seats.find((s) => s.name === 'gaming-seat');
  assert.deepEqual([gaming.stand.x, gaming.stand.y], [seat.x, seat.y]);
});

/** A stand-in for a Pixi Graphics: counts shapes, chains like the real one. */
function fakeGraphics() {
  const g = { shapes: 0, cleared: 0 };
  for (const m of ['rect', 'circle', 'ellipse', 'poly']) g[m] = () => { g.shapes++; return g; };
  g.fill = () => g; g.stroke = () => g; g.moveTo = () => g; g.lineTo = () => { g.shapes++; return g; }; g.clear = () => { g.cleared++; g.shapes = 0; return g; };
  return g;
}

test('props draw: every kind draws something, the in-use animations run', () => {
  for (const kind of Object.keys(props.PROP_SIZE)) {
    const g = fakeGraphics();
    props.drawProp(kind, g, 1.5);
    assert.ok(g.shapes > 0, kind);
  }
  for (const fn of ['drawBongSession', 'drawGamingSession', 'drawConsoleSession', 'drawNap', 'drawBask', 'drawPinning', 'drawSketching']) {
    for (const t of [0, 1, props.GRIND_SECONDS + 0.5, 12]) {
      const g = fakeGraphics();
      props[fn](g, t);
      assert.ok(g.shapes > 0, `${fn} @${t}`);
    }
  }
  assert.equal(props.idleAnimated('gaming-pc'), true);
  assert.equal(props.idleAnimated('bong'), false);
  assert.ok(props.FLAT_PROPS.has('cat-bed'));
  assert.ok(props.FLAT_PROPS.has('heat-stone'));
});

test("Mia's atelier: a walled room with a door into the library, her desk, her things", () => {
  const r = buildMap(LOFT_LAYOUT, FURNITURE, officeTilesets, props.PROP_SIZE);
  const room = LOFT_LAYOUT.rooms.find((rm) => rm.x0 === 1 && rm.y0 === 3);
  assert.ok(room, 'the atelier is a room');
  assert.equal(at(r.map, 'walls', 10, 3), 611, 'post cap by the library');
  assert.equal(at(r.map, 'walls', 10, 7), 0, 'door into the library');
  assert.equal(at(r.map, 'collision', 10, 8), 0);
  assert.equal(at(r.map, 'walls', 5, 9), 522, 'wall band below');
  const seat = r.seats.find((s) => s.name === 'atelier-seat-1');
  assert.deepEqual(seat && [seat.x, seat.y, seat.zone], [7, 7, 'atelier']);
  const kinds = r.props.filter((p) => p.x <= 9 && p.y <= 8).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['easel', 'heat-stone', 'layout-table', 'moodboard']);
  assert.equal(at(r.map, 'collision', 1, 3), 0, 'she can lie on the warm stone');
});

test('props: the RGB light walks the colour wheel', () => {
  assert.equal(props.rainbow(0), 0xff0000);
  assert.equal(props.rainbow(1 / 3), 0x00ff00);
  assert.equal(props.rainbow(2 / 3), 0x0000ff);
  assert.equal(props.rainbow(1.25), props.rainbow(0.25), 'wraps');
  assert.equal(props.rainbow(-0.75), props.rainbow(0.25), 'wraps below zero');
});
