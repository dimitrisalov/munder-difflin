// The loft — the owner's office, as a layout (built by scene/office/mapBuild.ts
// from the items in scene/office/furniture.ts).
//
// One big hall, 40×26 tiles. Zones are marked by floor and furniture; only
// Theo's office has walls. Top: the library along the whole wall, the task
// board, Theo's office in the corner. Middle: the content studio, the meeting
// table, the dev corner, the guest desks for temps. Bottom: the lounge, the
// reception by the door, the kitchen.
//
// To change what is in a room, edit `items` (tiles from the bundled sheets) or
// `props` (things drawn in code: the bong, the console, Theo's bed); x, y = the
// top-left tile. What agents do around the room is in LOFT_ERRANDS below. The
// builder checks that nothing overlaps and every seat is reachable; the map
// test also walks to every errand spot.

import type { Layout } from '../../scene/office/mapBuild';
import type { ErrandSpot } from '../../scene/office/themeRegistry';
import type { NightLight } from '../../scene/office/daylight';

const FLOOR = {
  sage: 783, beige: 777, cream: 781, gray: 779, teal: 813, blueDiamond: 809,
  beigeDiamond: 811, grayDiamond: 805, sageDiamond: 815, beigeTile: 801,
};

export const LOFT_LAYOUT: Layout = {
  width: 40,
  height: 26,
  floor: {
    base: FLOOR.sage,
    areas: [
      { x0: 1, y0: 3, x1: 22, y1: 7, pattern: FLOOR.cream },          // library
      { x0: 30, y0: 3, x1: 38, y1: 8, pattern: FLOOR.beigeDiamond },  // Theo
      { x0: 1, y0: 9, x1: 9, y1: 16, pattern: FLOOR.beigeTile },      // studio
      { x0: 11, y0: 9, x1: 21, y1: 13, pattern: FLOOR.blueDiamond },  // meeting
      { x0: 22, y0: 12, x1: 29, y1: 19, pattern: FLOOR.gray },        // dev
      { x0: 31, y0: 13, x1: 38, y1: 17, pattern: FLOOR.sageDiamond }, // guests
      { x0: 1, y0: 18, x1: 12, y1: 24, pattern: FLOOR.beige },        // lounge
      { x0: 14, y0: 20, x1: 23, y1: 24, pattern: FLOOR.teal },        // reception
      { x0: 26, y0: 20, x1: 38, y1: 24, pattern: FLOOR.grayDiamond }, // kitchen
    ],
  },
  entrance: { x: 19, width: 2 },
  rooms: [
    // Theo's office: a post down the left side, a wall band below, a door.
    { x0: 30, y0: 3, x1: 38, y1: 8, walls: ['w', 's'], doors: [{ side: 's', at: 33, width: 2 }] },
  ],
  zones: [
    { name: 'library', x0: 1, y0: 3, x1: 22, y1: 7 },
    { name: 'theo', x0: 30, y0: 3, x1: 38, y1: 8 },
    { name: 'studio', x0: 1, y0: 9, x1: 9, y1: 16 },
    { name: 'boardroom', x0: 11, y0: 9, x1: 21, y1: 13 },
    { name: 'dev', x0: 22, y0: 12, x1: 29, y1: 19 },
    { name: 'guests', x0: 31, y0: 13, x1: 38, y1: 17 },
    { name: 'lounge', x0: 1, y0: 18, x1: 12, y1: 24 },
    { name: 'reception', x0: 14, y0: 20, x1: 23, y1: 24 },
    { name: 'cafeteria', x0: 26, y0: 20, x1: 38, y1: 24 },
  ],
  items: [
    // ─── library: books along the whole top wall ───────────────────────────
    { item: 'bookcase-1', x: 1, y: 1 }, { item: 'bookcase-4', x: 3, y: 1 }, { item: 'bookcase-2', x: 5, y: 1 },
    { item: 'bookcase-5', x: 7, y: 1 }, { item: 'bookcase-3', x: 9, y: 1 },
    { item: 'world-map', x: 11, y: 1 },
    { item: 'globe', x: 13, y: 3 },
    { item: 'plant-grass', x: 14, y: 2 },
    { item: 'bookcase-6', x: 15, y: 1 }, { item: 'bookcase-1', x: 17, y: 1 }, { item: 'bookcase-4', x: 19, y: 1 },
    { item: 'bookcase-2', x: 21, y: 1 },
    { item: 'desk', x: 2, y: 4 }, { item: 'desk', x: 6, y: 4 },
    { item: 'armchair-gray', x: 11, y: 5 }, { item: 'table-wood', x: 12, y: 5 }, { item: 'armchair-light', x: 14, y: 5 },
    { item: 'desk', x: 17, y: 4 },
    { item: 'plant-white', x: 22, y: 5 },

    // ─── the task board hangs on the wall here (drawn live by the floor) ───
    { item: 'plant-sprout', x: 28, y: 3 },

    // ─── Theo's office ─────────────────────────────────────────────────────
    { item: 'window-wood', x: 31, y: 1 },
    { item: 'clock', x: 30, y: 1 },
    { item: 'picture-lighthouse', x: 35, y: 1 },
    { item: 'cabinet-wood', x: 30, y: 3 },
    { item: 'boss-desk', x: 33, y: 4, seat: 'desk-ceo', zone: 'theo' },
    { item: 'plant-white', x: 38, y: 2 },
    { item: 'rug-green', x: 35, y: 6 },

    // ─── content studio ────────────────────────────────────────────────────
    { item: 'desk', x: 1, y: 9 }, { item: 'desk', x: 5, y: 9 },
    { item: 'desk', x: 1, y: 13 }, { item: 'desk', x: 5, y: 13 },
    { item: 'plant-sprout-2', x: 9, y: 15 },

    // ─── meeting table ─────────────────────────────────────────────────────
    { item: 'meeting-table', x: 13, y: 9 },
    { item: 'plant-grass-2', x: 11, y: 12 },
    { item: 'plant-small', x: 21, y: 12 },

    // ─── dev corner ────────────────────────────────────────────────────────
    { item: 'desk', x: 22, y: 12 }, { item: 'desk', x: 26, y: 12 },
    { item: 'desk', x: 22, y: 16 }, { item: 'desk', x: 26, y: 16 },

    // ─── guest desks (temps) ───────────────────────────────────────────────
    { item: 'desk', x: 32, y: 13 }, { item: 'desk', x: 35, y: 13 },

    // ─── lounge: fire, sofas, TV, a gaming PC, lots of green ───────────────
    { item: 'fireplace', x: 1, y: 18 },
    { item: 'sofa-gray', x: 4, y: 18 },
    { item: 'tv', x: 8, y: 18 },
    { item: 'palm', x: 11, y: 18 },
    { item: 'rug-red', x: 4, y: 20 },
    { item: 'armchair-gray', x: 3, y: 21 },
    { item: 'coffee-table', x: 5, y: 21 },
    { item: 'desk', x: 9, y: 21, seat: 'gaming-seat', zone: 'lounge' },
    { item: 'tree', x: 1, y: 22 },
    { item: 'sofa-lavender', x: 4, y: 23 },
    { item: 'bush', x: 7, y: 23 },
    { item: 'plant-fern', x: 3, y: 20 },
    { item: 'plant-leafy-2', x: 3, y: 18 },
    { item: 'plant-sprout', x: 12, y: 21 },
    { item: 'plant-fern-2', x: 12, y: 24 },
    { item: 'plant-grass', x: 10, y: 20 },

    // ─── reception by the door ─────────────────────────────────────────────
    { item: 'counter', x: 17, y: 20 },
    { item: 'sofa-red', x: 14, y: 23 },
    { item: 'plant-grass-2', x: 22, y: 20 },
    { item: 'plant-small', x: 23, y: 23 },

    // ─── kitchen ───────────────────────────────────────────────────────────
    { item: 'coffee-counter', x: 27, y: 20 },
    { item: 'fridge', x: 31, y: 20 },
    { item: 'vending', x: 33, y: 20 },
    { item: 'water-cooler', x: 35, y: 20 },
    { item: 'food-shelf', x: 37, y: 20 },
    { item: 'table-wood', x: 31, y: 23 }, { item: 'table-wood', x: 35, y: 23 },
    { item: 'stool', x: 30, y: 23 }, { item: 'stool', x: 33, y: 23 },
    { item: 'stool', x: 34, y: 23 }, { item: 'stool', x: 37, y: 23 },
    { item: 'bin', x: 38, y: 23 },
    { item: 'plant-leafy', x: 26, y: 24 },
  ],
  props: [
    // lounge: grinder and bong on the coffee table, the console beside the TV
    // (not under it: that tile is the way into the gaming corner), the gaming
    // PC's tower on the gaming desk
    { kind: 'grinder', x: 5, y: 21, onTop: true },
    { kind: 'bong', x: 6, y: 21, onTop: true },
    { kind: 'console', x: 10, y: 19 },
    { kind: 'gaming-pc', x: 9, y: 21 },
    // Theo's office: his bed, scratching post and bowl
    { kind: 'cat-bed', x: 37, y: 7, walkable: true },
    { kind: 'scratching-post', x: 30, y: 6 },
    { kind: 'food-bowl', x: 30, y: 8 },
    // the bell on the reception counter, an easel in the studio
    { kind: 'bell', x: 18, y: 20, onTop: true },
    { kind: 'easel', x: 9, y: 9 },
  ],
  points: [
    { name: 'entrance', x: 19, y: 24 },
    { name: 'cafe-seat-1', x: 30, y: 23 }, { name: 'cafe-seat-2', x: 33, y: 23 },
    { name: 'cafe-seat-3', x: 34, y: 23 }, { name: 'cafe-seat-4', x: 37, y: 23 },
    { name: 'cafe-stand-coffee', x: 27, y: 23 },
    { name: 'cafe-stand-vending', x: 33, y: 22 },
  ],
};

/** What agents do around the loft when idle: stand on `stand` facing `facing`
 *  (or sit there, `seated`), with a small animation on the `fx` tile. */
export const LOFT_ERRANDS: ErrandSpot[] = [
  // plants
  { kind: 'water', stand: { x: 21, y: 6 }, facing: 'right', fx: { x: 22, y: 6 }, duration: 4.5 },
  { kind: 'water', stand: { x: 11, y: 13 }, facing: 'up', fx: { x: 11, y: 12 }, duration: 4.5 },
  { kind: 'water', stand: { x: 20, y: 13 }, facing: 'right', fx: { x: 21, y: 13 }, duration: 4.5 },
  { kind: 'water', stand: { x: 11, y: 20 }, facing: 'up', fx: { x: 11, y: 19 }, duration: 4.5 },
  { kind: 'water', stand: { x: 21, y: 20 }, facing: 'right', fx: { x: 22, y: 20 }, duration: 4.5 },
  // Theo's office: his plant, the cigar at his window, a nap in his bed
  { kind: 'water', stand: { x: 37, y: 3 }, facing: 'right', fx: { x: 38, y: 3 }, duration: 4.5, godOnly: true },
  { kind: 'smoke', stand: { x: 31, y: 3 }, facing: 'up', fx: { x: 31, y: 1 }, duration: 18, godOnly: true },
  { kind: 'nap', stand: { x: 37, y: 7 }, facing: 'down', seated: true, fx: { x: 37, y: 6 }, duration: 16, godOnly: true },
  // the library's shelves
  { kind: 'shelf', stand: { x: 10, y: 4 }, facing: 'up', fx: { x: 9, y: 2 }, duration: 4 },
  { kind: 'shelf', stand: { x: 16, y: 4 }, facing: 'up', fx: { x: 15, y: 2 }, duration: 4 },
  // lounge: grind then smoke at the coffee table, a game on the PC, the console
  { kind: 'bong', stand: { x: 5, y: 20 }, facing: 'down', fx: { x: 5, y: 21 }, duration: 9 },
  { kind: 'gaming', stand: { x: 10, y: 23 }, facing: 'up', seated: true, fx: { x: 9, y: 21 }, duration: 14 },
  { kind: 'console', stand: { x: 9, y: 20 }, facing: 'up', seated: true, fx: { x: 8, y: 18 }, duration: 14 },
  // kitchen: water cooler, fridge, bin
  { kind: 'dispenser', stand: { x: 34, y: 22 }, facing: 'right', fx: { x: 35, y: 21 }, duration: 3.5 },
  { kind: 'fridge', stand: { x: 31, y: 22 }, facing: 'up', fx: { x: 31, y: 21 }, duration: 3.2 },
  { kind: 'bin', stand: { x: 37, y: 24 }, facing: 'right', fx: { x: 38, y: 23 }, duration: 2.6 },
];

/** What glows when it gets dark (besides the lit monitors): the fireplace and
 *  the vending machine. Tile coordinates of the light's centre. */
export const LOFT_LIGHTS: NightLight[] = [
  { x: 2, y: 19.8, radius: 36, color: 0xff9a3d, flicker: true },
  { x: 34, y: 21, radius: 26, color: 0x9fe6ff },
];
