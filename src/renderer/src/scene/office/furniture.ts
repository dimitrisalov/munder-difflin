// The furniture library for built maps (mapBuild.ts): every placeable item by
// name, as tile gids from the bundled sheets — office-tileset @1, a5 floors and
// walls @513, interiors @1025. A layout says `{ item: 'sofa-gray', x, y }`;
// this says what a gray sofa is made of.
//
// Rows are top to bottom. `below` and `above` are both painted under the
// characters (above over below). Wall items (windows, pictures, charts) hang on
// the top wall's two face rows. Plants put their leaves in `above` one row up,
// like the hand-painted office map does.

import type { Stamp } from './mapBuild';

const plant = (top: number, pot: number): Stamp => ({ above: [[top], [0]], below: [[0], [pot]], block: [[0], [1]] });
const pot = (gid: number): Stamp => ({ below: [[gid]] });
const wall = (rows: number[][]): Stamp => ({ above: rows, wall: true });
const rug = (rows: number[][]): Stamp => ({ below: rows, walkable: true });

export const FURNITURE: Record<string, Stamp> = {
  // ─── desks & seats ─────────────────────────────────────────────────────────
  /** A work desk with a monitor; the agent sits on the stool in front (row 2). */
  desk: {
    below: [[0, 0, 0], [2, 3, 4], [0, 289, 0], [0, 305, 0]],
    above: [[0, 365, 366], [0, 381, 382], [18, 19, 20], [0, 0, 0]],
    block: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 0]],
    seat: { x: 1, y: 2 },
  },
  /** The boss's desk: he sits behind it (row 0), a visitor chair in front. */
  'boss-desk': {
    below: [[0, 289, 0], [2, 3, 4], [18, 289, 20], [0, 305, 0]],
    above: [[0, 0, 0], [431, 432, 349], [0, 19, 0], [0, 0, 0]],
    block: [[0, 0, 0], [1, 1, 1], [1, 1, 1], [0, 0, 0]],
    seat: { x: 1, y: 0 },
  },
  /** The meeting table with chairs all round, a plant and a laptop. */
  'meeting-table': {
    below: [[0, 257, 257, 257, 257, 0, 0], [162, 178, 229, 229, 178, 194, 260], [161, 177, 229, 229, 177, 193, 276], [0, 274, 274, 274, 274, 0, 0]],
    above: [[0, 0, 0, 0, 0, 0, 0], [451, 0, 0, 0, 0, 395, 0], [467, 258, 258, 258, 258, 411, 0], [0, 0, 0, 0, 0, 0, 0]],
    block: [[0, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 0, 0]],
  },
  stool: { below: [[289]], walkable: true },
  'table-wood': { below: [[293, 294], [309, 310]] },
  'table-glass': { below: [[295, 296], [311, 312]] },
  'coffee-table': { below: [[1240, 1241, 1242], [1256, 1257, 1258]] },
  'pc-tower': { below: [[425], [441]] },

  // ─── library ───────────────────────────────────────────────────────────────
  'bookcase-1': { below: [[2123, 2124], [2139, 2140], [2155, 2156]] },
  'bookcase-2': { below: [[2125, 2126], [2141, 2142], [2157, 2158]] },
  'bookcase-3': { below: [[2127, 2128], [2143, 2144], [2159, 2160]] },
  'bookcase-4': { below: [[2171, 2172], [2187, 2188], [2203, 2204]] },
  'bookcase-5': { below: [[2173, 2174], [2189, 2190], [2205, 2206]] },
  'bookcase-6': { below: [[2175, 2176], [2191, 2192], [2207, 2208]] },
  'shelf-low': { below: [[1254, 1255], [1270, 1271], [1286, 1287], [1302, 1303]] },
  globe: { below: [[2093], [2109]] },
  'world-map': wall([[2091, 2092], [2107, 2108]]),

  // ─── lounge ────────────────────────────────────────────────────────────────
  fireplace: { below: [[2117, 2118], [2133, 2134], [2149, 2150]] },
  'sofa-gray': { below: [[2178, 2179, 2180], [2194, 2195, 2196]] },
  'sofa-light': { below: [[2181, 2182, 2183], [2197, 2198, 2199]] },
  'sofa-beige': { below: [[2184, 2185, 2186], [2200, 2201, 2202]] },
  'sofa-lavender': { below: [[2216, 2217, 2218], [2232, 2233, 2234]] },
  'sofa-red': { below: [[1321, 1322, 1323], [1337, 1338, 1339]] },
  'armchair-gray': { below: [[2212], [2228]] },
  'armchair-light': { below: [[2215], [2231]] },
  tv: { below: [[1249, 1250], [1265, 1266]] },

  // ─── rugs (walkable) ───────────────────────────────────────────────────────
  'rug-red': rug([[1272, 1273, 1274, 1275], [1288, 1289, 1290, 1291], [1304, 1305, 1306, 1307]]),
  'rug-red-tall': rug([[1294, 1295, 1296], [1310, 1311, 1312], [1326, 1327, 1328], [1342, 1343, 1344]]),
  'rug-blue-gold': rug([[1246, 1247, 1248], [1262, 1263, 1264]]),
  'rug-green': rug([[1324, 1325], [1340, 1341]]),
  'rug-blue': rug([[481, 482]]),
  'rug-beige': rug([[483, 484]]),
  'rug-navy': rug([[485, 486]]),

  // ─── plants ────────────────────────────────────────────────────────────────
  'plant-small': plant(451, 467),
  'plant-white': plant(452, 468),
  // One-tile pots of greenery, eight kinds.
  'plant-grass': pot(453),
  'plant-grass-2': pot(454),
  'plant-sprout': pot(455),
  'plant-sprout-2': pot(456),
  'plant-fern': pot(469),
  'plant-fern-2': pot(470),
  'plant-leafy': pot(471),
  'plant-leafy-2': pot(472),
  tree: { below: [[1739, 1740], [1755, 1756], [1771, 1772]], block: [[0, 0], [1, 1], [1, 1]] },
  palm: { below: [[1742, 1743], [1758, 1759]], block: [[0, 0], [1, 1]] },
  bush: { below: [[1757], [1773]], block: [[0], [1]] },

  // ─── kitchen ───────────────────────────────────────────────────────────────
  /** Counter with the coffee machine on its left end. */
  'coffee-counter': {
    below: [[0, 0, 0], [38, 40, 39], [54, 56, 55]],
    above: [[313, 0, 0], [329, 330, 0], [0, 0, 0]],
    block: [[1, 0, 0], [1, 1, 1], [1, 1, 1]],
  },
  /** A plain white counter (the reception desk). */
  counter: { below: [[38, 40, 39], [54, 56, 55]] },
  fridge: { below: [[285, 286], [301, 302]] },
  vending: { below: [[287, 288], [303, 304]] },
  'water-cooler': { below: [[266], [282], [298]] },
  'food-shelf': { below: [[1315, 1316], [1331, 1332]] },
  bin: { below: [[281], [297]] },
  'cabinet-wood': { below: [[290], [306]] },
  'cabinet-gray': { below: [[291], [307]] },

  // ─── on the top wall ───────────────────────────────────────────────────────
  'window-wood': wall([[323, 324], [339, 340]]),
  window: wall([[327, 328], [343, 344]]),
  clock: wall([[354], [370]]),
  'picture-landscape': wall([[385, 386], [401, 402]]),
  'picture-lighthouse': wall([[387, 388], [403, 404]]),
  'picture-small': wall([[389], [405]]),
  chalkboard: wall([[417, 418], [433, 434]]),
  'chart-bars': wall([[419, 420], [435, 436]]),
  'chart-pie': wall([[421, 422], [437, 438]]),
  'chart-wide': wall([[423, 424], [439, 440]]),
  'chart-big': wall([[449, 450], [465, 466]]),
};
