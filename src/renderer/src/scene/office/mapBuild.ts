// Map builder — turns a readable layout (rooms, zones, "put a sofa here") into
// the Tiled JSON the floor already renders (TiledMapRenderer).
//
// Why: a hand-painted .tmj is a grid of tile ids; moving one sofa means
// repainting four layers and the collision by hand. A layout names the items
// and where they go (`{ item: 'sofa-gray', x: 4, y: 18 }`); the builder paints
// every layer, the collision, the seats, and checks the result (every seat is
// reachable from the door, nothing overlaps). Changing what is in a room is
// then a one-line edit. Pure: no Pixi, no DOM — tests run it under node.

/** One placeable thing: art per layer, what blocks walking, an optional seat. */
export interface Stamp {
  /** Art under / over (both are painted beneath the characters). Rows of gids, 0 = none. */
  below?: number[][];
  above?: number[][];
  /** 1 = blocks walking. Default: every tile with art blocks, unless `walkable`. */
  block?: number[][];
  /** Floor decor (rugs): never blocks. */
  walkable?: boolean;
  /** Hangs on the top wall (windows, pictures, boards): never blocks, may overlap walls. */
  wall?: boolean;
  /** Where an agent sits, relative to the stamp's top-left. */
  seat?: { x: number; y: number };
}

export interface Placement {
  item: string;
  x: number;
  y: number;
  /** Spawn-point name for this item's seat (default `<zone>-seat-<n>`). */
  seat?: string;
  /** Zone the seat belongs to (default: the zone rect containing the seat). */
  zone?: string;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** A walled room inside the hall. `doors` are gaps: on the bottom band
 *  (`s`, x = first tile of the gap) or the left wall (`w`, y = first tile). */
export interface Room extends Rect {
  /** Which sides get a wall drawn (the hall's own walls cover the rest). */
  walls: Array<'s' | 'w' | 'e'>;
  doors: Array<{ side: 's' | 'w' | 'e'; at: number; width?: number }>;
}

export interface Layout {
  width: number;
  height: number;
  /** Top-left gid of a 2×2 floor pattern for the whole hall, then per area. */
  floor: { base: number; areas: Array<Rect & { pattern: number }> };
  /** The door in the bottom wall: first tile and width. */
  entrance: { x: number; width: number };
  rooms: Room[];
  zones: Array<Rect & { name: string }>;
  items: Placement[];
  /** Extra named points (entrance, café stands, …). */
  points: Array<{ name: string; x: number; y: number }>;
}

export interface BuiltMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  infinite: false;
  type: 'map';
  version: string;
  tiledversion: string;
  nextlayerid: number;
  nextobjectid: number;
  layers: Array<
    | { id: number; name: string; type: 'tilelayer'; width: number; height: number; x: 0; y: 0; opacity: 1; visible: boolean; data: number[] }
    | { id: number; name: string; type: 'objectgroup'; x: 0; y: 0; opacity: 1; visible: boolean; draworder: 'topdown'; objects: Array<{ id: number; name: string; type: string; x: number; y: number; width: number; height: number; point?: boolean; rotation: 0; visible: true }> }
  >;
  tilesets: unknown[];
}

const TILE = 16;

// The hall's walls, from the office tileset's a5 sheet (firstgid 513).
const WALL = {
  topLeft: 514, top: 522, topRight: 517,
  face: 554, base: 570,            // the two rows of wall face under the top edge
  left: 530, right: 533,
  bottomLeft: 578, bottom: 579, bottomRight: 581,
  postCap: 611, post: 643,         // a free-standing vertical wall: cap + body
};

type Grid = number[];

class Painter {
  readonly floor: Grid; readonly walls: Grid; readonly below: Grid; readonly above: Grid; readonly block: Grid;
  constructor(readonly w: number, readonly h: number) {
    const g = () => new Array<number>(w * h).fill(0);
    this.floor = g(); this.walls = g(); this.below = g(); this.above = g(); this.block = g();
  }
  in(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  put(grid: Grid, x: number, y: number, v: number): void { if (this.in(x, y)) grid[y * this.w + x] = v; }
  get(grid: Grid, x: number, y: number): number { return this.in(x, y) ? grid[y * this.w + x] : 0; }
}

/** Paint a 2×2 floor pattern (top-left gid `tl`; the sheet is 16 wide) over a rect. */
function paintFloor(p: Painter, r: Rect, tl: number): void {
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      p.put(p.floor, x, y, tl + (x % 2) + (y % 2) * 16);
    }
  }
}

function paintHallWalls(p: Painter, entrance: Layout['entrance']): void {
  const { w, h } = p;
  for (let x = 0; x < w; x++) {
    p.put(p.walls, x, 0, x === 0 ? WALL.topLeft : x === w - 1 ? WALL.topRight : WALL.top);
    p.put(p.walls, x, 1, x === 0 ? WALL.left : x === w - 1 ? WALL.right : WALL.face);
    p.put(p.walls, x, 2, x === 0 ? WALL.left : x === w - 1 ? WALL.right : WALL.base);
    for (const y of [0, 1, 2]) p.put(p.block, x, y, 1);
  }
  for (let y = 3; y < h - 1; y++) {
    p.put(p.walls, 0, y, WALL.left); p.put(p.block, 0, y, 1);
    p.put(p.walls, w - 1, y, WALL.right); p.put(p.block, w - 1, y, 1);
  }
  for (let x = 0; x < w; x++) {
    const door = x >= entrance.x && x < entrance.x + entrance.width;
    if (door) continue;
    p.put(p.walls, x, h - 1, x === 0 ? WALL.bottomLeft : x === w - 1 ? WALL.bottomRight : WALL.bottom);
    p.put(p.block, x, h - 1, 1);
  }
}

function isDoor(room: Room, side: 's' | 'w' | 'e', i: number): boolean {
  return room.doors.some((d) => d.side === side && i >= d.at && i < d.at + (d.width ?? 2));
}

/** Inner walls: a 3-row band along the bottom (like the hall's top wall) and
 *  one-tile posts down the sides, with door gaps. */
function paintRoom(p: Painter, room: Room): void {
  if (room.walls.includes('s')) {
    const rows = [WALL.top, WALL.face, WALL.base];
    // The band runs under the side posts too, so the corners close.
    const from = room.x0 - (room.walls.includes('w') ? 1 : 0);
    const to = room.x1 + (room.walls.includes('e') ? 1 : 0);
    for (let x = from; x <= to; x++) {
      if (isDoor(room, 's', x)) continue;
      rows.forEach((gid, i) => { p.put(p.walls, x, room.y1 + 1 + i, gid); p.put(p.block, x, room.y1 + 1 + i, 1); });
    }
  }
  for (const side of ['w', 'e'] as const) {
    if (!room.walls.includes(side)) continue;
    const x = side === 'w' ? room.x0 - 1 : room.x1 + 1;
    for (let y = room.y0; y <= room.y1; y++) {
      if (isDoor(room, side, y)) continue;
      p.put(p.walls, x, y, y === room.y0 ? WALL.postCap : WALL.post);
      p.put(p.block, x, y, 1);
    }
  }
}

function stampSize(s: Stamp): { w: number; h: number } {
  const rows = [s.below, s.above, s.block].filter((r): r is number[][] => !!r);
  return {
    w: Math.max(0, ...rows.map((r) => Math.max(0, ...r.map((row) => row.length)))),
    h: Math.max(0, ...rows.map((r) => r.length)),
  };
}

export interface BuildResult { map: BuiltMap; seats: Array<{ name: string; zone: string; x: number; y: number }>; problems: string[] }

/** Build the map. `tilesets` is copied verbatim into the result (the office
 *  map's: embedded office sheet @1, a5 @513, interiors @1025). */
export function buildMap(layout: Layout, stamps: Record<string, Stamp>, tilesets: unknown[]): BuildResult {
  const p = new Painter(layout.width, layout.height);
  const problems: string[] = [];
  paintFloor(p, { x0: 0, y0: 0, x1: p.w - 1, y1: p.h - 1 }, layout.floor.base);
  for (const a of layout.floor.areas) paintFloor(p, a, a.pattern);
  paintHallWalls(p, layout.entrance);
  for (const room of layout.rooms) paintRoom(p, room);

  const zoneAt = (x: number, y: number): string =>
    layout.zones.find((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1)?.name ?? 'floor';
  const seats: BuildResult['seats'] = [];
  const seatCount: Record<string, number> = {};
  const occupied = new Map<string, string>(); // tile → item that blocks it

  for (const pl of layout.items) {
    const s = stamps[pl.item];
    if (!s) { problems.push(`unknown item "${pl.item}" at ${pl.x},${pl.y}`); continue; }
    const { w, h } = stampSize(s);
    if (pl.x < 0 || pl.y < 0 || pl.x + w > p.w || pl.y + h > p.h) {
      problems.push(`${pl.item} at ${pl.x},${pl.y} does not fit the map`);
      continue;
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = pl.x + dx, y = pl.y + dy;
        const b = s.below?.[dy]?.[dx] ?? 0;
        const a = s.above?.[dy]?.[dx] ?? 0;
        if (b) p.put(p.below, x, y, b);
        if (a) p.put(p.above, x, y, a);
        const blocks = s.walkable || s.wall ? 0 : s.block ? (s.block[dy]?.[dx] ?? 0) : (b || a ? 1 : 0);
        if (blocks) {
          const k = `${x},${y}`;
          const prev = occupied.get(k);
          if (prev) problems.push(`${pl.item} at ${pl.x},${pl.y} overlaps ${prev} at ${k}`);
          occupied.set(k, `${pl.item}@${pl.x},${pl.y}`);
          p.put(p.block, x, y, 1);
        }
      }
    }
    if (s.seat) {
      const x = pl.x + s.seat.x, y = pl.y + s.seat.y;
      const zone = pl.zone ?? zoneAt(x, y);
      seatCount[zone] = (seatCount[zone] ?? 0) + 1;
      seats.push({ name: pl.seat ?? `${zone}-seat-${seatCount[zone]}`, zone, x, y });
    }
  }

  // Seats are walkable by definition (the agent stands on the chair tile).
  for (const s of seats) {
    if (p.get(p.walls, s.x, s.y)) problems.push(`seat ${s.name} at ${s.x},${s.y} is inside a wall`);
    p.put(p.block, s.x, s.y, 0);
  }
  for (const pt of layout.points) {
    if (p.get(p.block, pt.x, pt.y)) problems.push(`point ${pt.name} at ${pt.x},${pt.y} is blocked`);
  }

  // Every seat and point must be reachable from the entrance.
  const start = layout.points.find((pt) => pt.name === 'entrance');
  if (!start) problems.push('no entrance point');
  else {
    const seen = new Set<string>([`${start.x},${start.y}`]);
    const queue: Array<[number, number]> = [[start.x, start.y]];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (!p.in(nx, ny) || seen.has(k) || p.get(p.block, nx, ny)) continue;
        seen.add(k); queue.push([nx, ny]);
      }
    }
    for (const s of [...seats, ...layout.points]) {
      if (!seen.has(`${s.x},${s.y}`)) problems.push(`${s.name} at ${s.x},${s.y} cannot be reached from the entrance`);
    }
  }

  const names = new Set<string>();
  for (const n of [...seats.map((s) => s.name), ...layout.points.map((pt) => pt.name)]) {
    if (names.has(n)) problems.push(`duplicate point name ${n}`);
    names.add(n);
  }

  let id = 1;
  const tileLayer = (name: string, data: Grid, visible = true) =>
    ({ id: id++, name, type: 'tilelayer' as const, width: p.w, height: p.h, x: 0 as const, y: 0 as const, opacity: 1 as const, visible, data: data.slice() });
  const layers: BuiltMap['layers'] = [
    tileLayer('floor', p.floor),
    tileLayer('walls', p.walls),
    tileLayer('furniture-below', p.below),
    tileLayer('furniture-above', p.above),
    tileLayer('collision', p.block.map((v) => (v ? 1 : 0)), false),
  ];
  let oid = 1;
  layers.push({
    id: id++, name: 'spawn-points', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
    objects: [...seats.map((s) => ({ name: s.name, x: s.x, y: s.y })), ...layout.points].map((pt) => ({
      id: oid++, name: pt.name, type: '', x: pt.x * TILE, y: pt.y * TILE, width: 0, height: 0, point: true, rotation: 0 as const, visible: true as const,
    })),
  });
  layers.push({
    id: id++, name: 'zones', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
    objects: layout.zones.map((z) => ({
      id: oid++, name: z.name, type: '', x: z.x0 * TILE, y: z.y0 * TILE,
      width: (z.x1 - z.x0 + 1) * TILE, height: (z.y1 - z.y0 + 1) * TILE, rotation: 0 as const, visible: true as const,
    })),
  });

  const map: BuiltMap = {
    width: p.w, height: p.h, tilewidth: TILE, tileheight: TILE,
    orientation: 'orthogonal', renderorder: 'right-down', infinite: false, type: 'map',
    version: '1.10', tiledversion: '1.10.2', nextlayerid: id, nextobjectid: oid,
    layers, tilesets,
  };
  return { map, seats, problems };
}
