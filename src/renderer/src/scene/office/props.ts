// Props the floor draws in code: things the bundled tile sheets don't have.
// Drawn from scratch with plain shapes (no third-party art), at 16 px per tile,
// in local coordinates from the prop's top-left tile. A layout places them
// (mapBuild.ts `props`); OfficeFloor draws each once, redraws the ones with an
// idle animation every frame, and plays the in-use animations below while an
// agent runs the matching errand ('bong', 'gaming', 'console', 'nap', and in
// Mia's studio 'bask', 'pin', 'sketch').

import type { Graphics } from 'pixi.js';

export type PropKind =
  | 'bong' | 'grinder' | 'console' | 'gaming-pc'
  | 'cat-bed' | 'scratching-post' | 'food-bowl'
  | 'bell' | 'easel'
  | 'heat-stone' | 'moodboard' | 'layout-table'
  | 'palette-rug' | 'neon-nib' | 'string-lights' | 'plan-chest' | 'paint-cans' | 'paint-splatter' | 'pen-display';

/** Footprint in tiles (w × h), for the map builder. */
export const PROP_SIZE: Record<PropKind, { w: number; h: number }> = {
  bong: { w: 1, h: 1 }, grinder: { w: 1, h: 1 }, console: { w: 1, h: 1 }, 'gaming-pc': { w: 1, h: 1 },
  'cat-bed': { w: 1, h: 1 }, 'scratching-post': { w: 1, h: 2 }, 'food-bowl': { w: 1, h: 1 },
  bell: { w: 1, h: 1 }, easel: { w: 1, h: 2 },
  'heat-stone': { w: 2, h: 1 }, moodboard: { w: 4, h: 2 }, 'layout-table': { w: 3, h: 2 },
  'palette-rug': { w: 4, h: 2 }, 'neon-nib': { w: 1, h: 2 },
  // two rows tall only so it sorts with (and over) the moodboard; it hangs
  // across the top of the wall
  'string-lights': { w: 6, h: 2 },
  'plan-chest': { w: 2, h: 1 }, 'paint-cans': { w: 1, h: 1 }, 'paint-splatter': { w: 1, h: 1 }, 'pen-display': { w: 1, h: 1 },
};

/** Lies flat on the floor: drawn under anyone standing on it (Theo in his bed,
 *  Mia on her warm stone). */
export const FLAT_PROPS: ReadonlySet<string> = new Set(['cat-bed', 'heat-stone', 'palette-rug', 'paint-splatter']);

export function isPropKind(kind: string): kind is PropKind {
  return Object.prototype.hasOwnProperty.call(PROP_SIZE, kind);
}

const INK = 0x26222e;

/** Hue (0..1, wraps) → 0xRRGGBB at full saturation: the gaming PC's light. */
export function rainbow(h: number): number {
  const f = (n: number): number => {
    const k = (n + (((h % 1) + 1) % 1) * 6) % 6;
    return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/** Is this prop drawn differently over time even when nobody uses it? */
export function idleAnimated(kind: string): boolean {
  return kind === 'gaming-pc';
}

/** Draw a prop at rest. `t` (seconds) only matters for idle-animated ones. */
export function drawProp(kind: string, g: Graphics, t = 0): void {
  g.clear();
  switch (kind) {
    case 'bong': {
      // a round water bulb, a tall glass tube, a metal stem with the bowl
      g.ellipse(8, 12, 4.5, 3.5).fill({ color: 0xcfe8ef, alpha: 0.85 }).stroke({ width: 1, color: INK });
      g.ellipse(8, 13, 3.5, 2).fill({ color: 0x6fb3c4, alpha: 0.9 });
      g.rect(6.5, 1, 3, 9).fill({ color: 0xd8eef4, alpha: 0.85 }).stroke({ width: 1, color: INK });
      g.rect(6, 0, 4, 1.5).fill(0x9fd2df);
      g.poly([10, 11, 13, 8, 14, 9, 11, 12]).fill(0x8b8f99);
      g.rect(12, 6.5, 3, 2).fill(0x5d616b);
      break;
    }
    case 'grinder': {
      g.circle(8, 11, 4).fill(0x6fae6f).stroke({ width: 1, color: INK });
      g.circle(8, 11, 2.2).fill(0x8fcf8f);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.rect(8 + Math.cos(a) * 3.2 - 0.5, 11 + Math.sin(a) * 3.2 - 0.5, 1, 1).fill(0x3f6f3f);
      }
      break;
    }
    case 'console': {
      // a black box under the TV with a blue power light, a controller in front
      g.rect(2, 2, 12, 5).fill(0x1d1b24).stroke({ width: 1, color: INK });
      g.rect(3, 3, 10, 1).fill(0x34313d);
      g.rect(11, 5, 2, 1).fill(0x3d8bff);
      g.ellipse(6, 12, 3.5, 2).fill(0x2a2833).stroke({ width: 1, color: INK });
      g.rect(4, 11.5, 1, 1).fill(0x9a9aa8);
      g.rect(7, 11.5, 1, 1).fill(0x5bd1ff);
      break;
    }
    case 'gaming-pc': {
      // a tower on the desk's left end, glass side, a fan ring cycling colours
      g.rect(3, 4, 10, 15).fill(0x18161e).stroke({ width: 1, color: INK });
      g.rect(4, 5, 8, 12).fill(0x2b2836);
      g.circle(8, 9, 3).stroke({ width: 1.2, color: rainbow(t * 0.25) });
      g.circle(8, 9, 0.8).fill(rainbow(t * 0.25 + 0.3));
      g.rect(4, 15, 8, 1).fill(rainbow(t * 0.25 + 0.5));
      break;
    }
    case 'cat-bed': {
      // a round cushion a little wider than its tile, sized to Theo
      g.ellipse(8, 11, 10, 6.5).fill(0xe7a3b1).stroke({ width: 1, color: INK });
      g.ellipse(8, 11.5, 7, 4).fill(0xf6d3da);
      g.ellipse(8, 12, 4.5, 2.5).fill(0xfbe6ea);
      for (const [x, y] of [[3, 10], [12, 12], [7, 14]] as const) g.rect(x, y, 1, 1).fill(0xffffff); // white hairs
      break;
    }
    case 'scratching-post': {
      g.rect(2, 25, 12, 6).fill(0xc9b28a).stroke({ width: 1, color: INK });
      g.rect(6, 6, 4, 20).fill(0xb08a52).stroke({ width: 1, color: INK });
      for (let y = 8; y < 25; y += 3) g.rect(6, y, 4, 1).fill(0x8a6a3a);   // rope turns
      g.rect(1, 3, 14, 4).fill(0xc9b28a).stroke({ width: 1, color: INK });
      g.rect(12.5, 7, 1, 2).fill(0x5d616b);
      g.circle(13, 10, 1.5).fill(0xe25b5b);                                 // a dangling toy
      break;
    }
    case 'food-bowl': {
      g.ellipse(8, 11, 5.5, 3.5).fill(0xf0f0f4).stroke({ width: 1, color: INK });
      g.ellipse(8, 10.5, 4, 2).fill(0xb9824f);
      for (const [x, y] of [[6, 10], [9, 10], [8, 11]] as const) g.rect(x, y, 1, 1).fill(0x8a5a2f);
      break;
    }
    case 'bell': {
      g.rect(4, 12, 8, 2).fill(0x7a5a2a);
      g.ellipse(8, 11, 4, 3.5).fill(0xe2b84a).stroke({ width: 1, color: INK });
      g.rect(7.5, 6, 1, 2).fill(0x9a7a3a);
      g.rect(6.5, 9, 2, 1).fill(0xfbe7a0);
      break;
    }
    case 'easel': {
      g.poly([3, 31, 7, 4, 8, 4, 5, 31]).fill(0x9a6a3a);
      g.poly([13, 31, 9, 4, 8, 4, 11, 31]).fill(0x9a6a3a);
      g.rect(1, 6, 14, 12).fill(0xfbf8ef).stroke({ width: 1, color: INK });
      g.rect(3, 8, 5, 3).fill(0xe2725b);
      g.rect(7, 11, 6, 2).fill(0x5b9be2);
      g.circle(11, 9, 1.5).fill(0xe2c75b);
      g.rect(4, 13, 4, 2).fill(0x6fae6f);
      g.rect(2, 18, 12, 1.5).fill(0x7a5030);
      break;
    }
    case 'heat-stone': {
      // a flat sandstone slab under the window, sun-warmed in the middle: Mia
      // basks here
      g.ellipse(16, 11, 14.5, 4.5).fill(0x9a6e52).stroke({ width: 1, color: INK });
      g.ellipse(16, 10, 13, 3.6).fill(0xd2a47c);
      g.ellipse(14, 9.2, 8, 1.8).fill(0xe6c29c);
      g.ellipse(17, 10.5, 5, 1.4).fill({ color: 0xf08a4a, alpha: 0.35 });
      for (const [x, y] of [[6, 10], [24, 11], [20, 9]] as const) g.rect(x, y, 1, 1).fill(0xb48462);
      break;
    }
    case 'moodboard': {
      // a cork board on the wall: photos, sketches, colour chips, pins and a
      // red thread between two ideas
      g.rect(1, 2, 62, 28).fill(0x6b4a2a).stroke({ width: 1, color: INK });
      g.rect(3, 4, 58, 24).fill(0xc89a62);
      for (const [x, y] of [[9, 7], [22, 19], [44, 9], [53, 22], [33, 6]] as const) g.rect(x, y, 1, 1).fill(0xa87a46);
      const photo = (x: number, y: number, w: number, h: number, c: number): void => {
        g.rect(x, y, w, h).fill(0xfbf8ef).stroke({ width: 0.5, color: 0x8a7a66 });
        g.rect(x + 1.5, y + 1.5, w - 3, h - 5).fill(c);
      };
      photo(5, 6, 13, 11, 0x5b8fb0);   // a sea photo
      g.rect(6.5, 12, 10, 2).fill(0x3e6f8c);
      photo(20, 8, 10, 12, 0xd98c6a);  // a sunset
      g.circle(25, 12, 2).fill(0xf6d06a);
      g.rect(33, 5, 12, 10).fill(0xfbf8ef).stroke({ width: 0.5, color: 0x8a7a66 }); // a sketch
      g.rect(35, 7, 6, 1).fill(0x9a9aa8); g.rect(35, 9, 8, 1).fill(0x9a9aa8); g.rect(35, 11, 4, 3).stroke({ width: 0.5, color: 0x9a9aa8 });
      photo(47, 6, 11, 13, 0x8fb39a);  // leaves
      g.rect(50, 9, 1, 6).fill(0x5d8a68);
      // the palette: five chips along the bottom
      [0xe2665f, 0x2e3a5c, 0xe0b84a, 0x8fb39a, 0xf3ead8].forEach((c, i) => {
        g.rect(6 + i * 7, 20, 6, 6).fill(c).stroke({ width: 0.5, color: 0x6b5a46 });
      });
      g.moveTo(25, 8).lineTo(52, 7).stroke({ width: 0.6, color: 0xc0392b });
      for (const [x, y, c] of [[11, 6, 0xd83a3a], [25, 8, 0xd83a3a], [39, 5, 0x3a6fd8], [52, 7, 0xd83a3a], [44, 21, 0x3a6fd8]] as const) {
        g.circle(x, y, 1.2).fill(c);
      }
      g.rect(42, 19, 14, 7).fill(0xf6e7a0);   // a sticky note
      g.rect(44, 21, 9, 1).fill(0xb8a35a); g.rect(44, 23, 6, 1).fill(0xb8a35a);
      break;
    }
    case 'layout-table': {
      // a big drafting table: a layout in progress, a cutting mat, a swatch
      // fan, a pen tablet, and an architect's lamp on the right
      g.rect(3, 22, 3, 9).fill(0x6b4a2a);
      g.rect(42, 22, 3, 9).fill(0x6b4a2a);
      g.rect(1, 7, 46, 16).fill(0xd9b98a).stroke({ width: 1, color: INK });
      g.rect(1, 21, 46, 2).fill(0xb8956a);
      g.rect(4, 9, 15, 11).fill(0xfbf8ef).stroke({ width: 0.5, color: 0x8a7a66 }); // the layout
      g.rect(6, 11, 11, 3).fill(0xe2665f);
      g.rect(6, 15, 5, 3).fill(0x2e3a5c);
      g.rect(12, 15, 5, 1).fill(0x9a9aa8); g.rect(12, 17, 4, 1).fill(0x9a9aa8);
      g.rect(21, 10, 11, 9).fill(0x4f8f6a);                                     // cutting mat
      for (let x = 23; x < 32; x += 3) g.rect(x, 10, 0.5, 9).fill({ color: 0xcfe8d8, alpha: 0.6 });
      for (let y = 12; y < 19; y += 3) g.rect(21, y, 11, 0.5).fill({ color: 0xcfe8d8, alpha: 0.6 });
      g.rect(22, 13, 9, 5).fill(0x26262b);                                      // pen tablet on the mat
      g.rect(23, 14, 7, 3).fill(0x3d5a80);
      g.rect(29, 18, 6, 1).fill(0x9a9aa8);                                      // the pen
      [0xe2665f, 0xe0b84a, 0x8fb39a, 0x5b8fb0].forEach((c, i) => {             // swatch fan
        g.poly([34, 18, 35 + i * 2, 11, 37 + i * 2, 11.5, 35.5, 18]).fill(c);
      });
      g.rect(42, 15, 4, 2).fill(0x3a3a44);                                      // lamp base
      g.moveTo(44, 15).lineTo(41, 6).lineTo(37, 3).stroke({ width: 1, color: 0x3a3a44 });
      g.poly([33, 2, 39, 0, 41, 5, 35, 7]).fill(0xe2665f).stroke({ width: 0.8, color: INK });
      g.poly([35, 7, 41, 5, 40, 12, 30, 14]).fill({ color: 0xfff2c4, alpha: 0.28 });
      break;
    }
    case 'palette-rug': {
      // a rug cut like a painter's palette: a thumb hole showing the floor,
      // paint blobs round the edge
      g.ellipse(32, 16, 30, 14).fill(0xf1e6d0).stroke({ width: 1, color: INK });
      g.ellipse(32, 16, 27, 11.5).stroke({ width: 1, color: 0xd9c8a8 });
      g.ellipse(46, 21, 4.5, 3.2).fill(0xb7ac93).stroke({ width: 1, color: INK }); // thumb hole (the atelier's floor)
      const blobs: Array<[number, number, number]> = [
        [12, 9, 0xe2665f], [22, 6, 0xe0b84a], [33, 5.5, 0x8fb39a], [44, 7, 0x5bb0d8], [54, 12, 0x9b7ad8], [16, 20, 0x2e3a5c],
      ];
      for (const [x, y, c] of blobs) {
        g.ellipse(x, y, 4, 3).fill(c);
        g.rect(x - 2, y - 2, 1.5, 1).fill({ color: 0xffffff, alpha: 0.5 });
      }
      g.ellipse(28, 17, 5, 2.5).fill({ color: 0xe2665f, alpha: 0.55 });         // a smear of mixed colour
      g.ellipse(31, 18, 4, 2).fill({ color: 0x5bb0d8, alpha: 0.45 });
      break;
    }
    case 'neon-nib': {
      // a neon sign on the wall: a pen nib in coral tube on a dark board
      g.rect(1, 3, 14, 26).fill(0x2b2836).stroke({ width: 1, color: INK });
      const nib = [8, 7, 13, 17, 8, 26, 3, 17];
      g.poly(nib).stroke({ width: 3, color: 0xff6f61, alpha: 0.3 });
      g.poly(nib).stroke({ width: 1.2, color: 0xffb3a8 });
      g.moveTo(8, 13).lineTo(8, 21).stroke({ width: 1, color: 0xffb3a8 });
      g.circle(8, 13, 1.6).stroke({ width: 1, color: 0xffb3a8 });
      break;
    }
    case 'string-lights': {
      // fairy lights hung across the window and the moodboard: a sagging wire,
      // bulbs in the studio's colours
      const span = 32;
      const yAt = (x: number): number => 1 + 3 * Math.sin(Math.PI * ((x % span) / span));
      g.moveTo(0, yAt(0));
      for (let x = 2; x <= 96; x += 2) g.lineTo(x, yAt(x));
      g.stroke({ width: 0.6, color: 0x3a3a44 });
      const bulbs = [0xfff3c4, 0xe2665f, 0xe0b84a, 0x8fe0c0, 0xfff3c4, 0x9bb8ff];
      for (let i = 0, x = 5; x < 96; x += 9, i++) {
        g.circle(x, yAt(x) + 1.6, 1.3).fill(bulbs[i % bulbs.length]);
      }
      break;
    }
    case 'plan-chest': {
      // a low plan chest for prints, rolled posters sticking out of a tube,
      // magazines stacked on top
      g.rect(1, 6, 30, 10).fill(0x4a5a6a).stroke({ width: 1, color: INK });
      for (const y of [9, 12]) g.rect(2, y, 28, 0.6).fill(0x2f3b47);
      for (const y of [7.5, 10.5, 13.5]) { g.rect(9, y, 3, 0.8).fill(0xc9ced6); g.rect(20, y, 3, 0.8).fill(0xc9ced6); }
      g.rect(3, 3, 9, 3).fill(0xe2665f); g.rect(4, 1.5, 8, 1.6).fill(0xf3ead8); g.rect(3.5, 0.5, 7, 1.2).fill(0x2e3a5c);
      g.rect(23, -2, 5, 8).fill(0xb8956a).stroke({ width: 0.6, color: INK });   // the tube
      g.rect(23.5, -7, 1.6, 6).fill(0xf3ead8); g.rect(25.5, -9, 1.6, 8).fill(0x8fb39a); g.rect(26.8, -6, 1.4, 5).fill(0xe0b84a);
      break;
    }
    case 'paint-cans': {
      // two paint cans, one dripping, and a jar of brushes
      g.rect(1, 8, 6, 7).fill(0xe2665f).stroke({ width: 0.8, color: INK });
      g.ellipse(4, 8, 3, 1.2).fill(0xc94f48);
      g.rect(2, 10, 1, 3).fill({ color: 0xffffff, alpha: 0.4 });
      g.rect(6, 14, 1, 2).fill(0xe2665f);
      g.rect(8, 10, 5, 5).fill(0x5bb0a0).stroke({ width: 0.8, color: INK });
      g.ellipse(10.5, 10, 2.5, 1).fill(0x3f8f80);
      g.rect(12, 6, 3, 9).fill({ color: 0xcfe8ef, alpha: 0.8 }).stroke({ width: 0.6, color: INK }); // the jar
      g.rect(12.6, 1, 0.8, 7).fill(0x9a6a3a); g.rect(14, 2.5, 0.8, 6).fill(0x7a5030);
      g.rect(12.3, 0, 1.4, 1.6).fill(0xe0b84a); g.rect(13.8, 1.5, 1.4, 1.4).fill(0x9b7ad8);
      break;
    }
    case 'paint-splatter': {
      // paint on the floor under the easel: drips and splashes
      const spots: Array<[number, number, number, number]> = [
        [5, 6, 2.5, 0xe2665f], [10, 9, 1.8, 0x5bb0d8], [7, 12, 1.4, 0xe0b84a], [12, 4, 1, 0x9b7ad8], [3, 11, 1, 0x8fb39a], [13, 13, 1.2, 0xe2665f],
      ];
      for (const [x, y, r, c] of spots) g.circle(x, y, r).fill({ color: c, alpha: 0.75 });
      g.ellipse(6, 7, 1, 0.6).fill({ color: 0xffffff, alpha: 0.4 });
      break;
    }
    case 'pen-display': {
      // a second screen on an arm at the desk's end: the layout she is on
      g.rect(7.5, 11, 1.2, 5).fill(0x3a3a44);
      g.rect(1, 1, 14, 10).fill(0x1d1b24).stroke({ width: 1, color: INK });
      g.rect(2, 2, 12, 8).fill(0xf6f1e6);
      g.rect(3, 3, 6, 3).fill(0xe2665f);
      g.rect(10, 3, 3, 6).fill(0x2e3a5c);
      g.rect(3, 7, 5, 0.8).fill(0x9a9aa8); g.rect(3, 8.5, 4, 0.8).fill(0x9a9aa8);
      break;
    }
  }
}

// ─── in-use animations (errand fx) ───────────────────────────────────────────

/** How long the bong errand grinds before it smokes. */
export const GRIND_SECONDS = 3;

/** Grind first, then smoke. Local coordinates are the grinder's tile; the bong
 *  stands one tile to the right. */
export function drawBongSession(g: Graphics, t: number): void {
  g.clear();
  if (t < GRIND_SECONDS) {
    // the grinder's lid turning: two marks circling, a crumb flying off
    const a = t * 7;
    for (const off of [0, Math.PI]) {
      g.rect(8 + Math.cos(a + off) * 2.6 - 0.75, 11 + Math.sin(a + off) * 2.6 - 0.75, 1.5, 1.5).fill(0xffffff);
    }
    if (Math.floor(t * 4) % 2 === 0) g.rect(12, 7, 1, 1).fill(0x6a8f3a);
    return;
  }
  const s = t - GRIND_SECONDS;
  const bx = 16 + 8; // the bong's centre line
  // bubbles rising through the water
  for (let i = 0; i < 4; i++) {
    const ph = (s * 1.6 + i / 4) % 1;
    g.circle(bx + Math.sin(i * 2.1 + s * 3) * 1.5, 14 - ph * 5, 0.8).fill({ color: 0xffffff, alpha: 0.9 * (1 - ph) });
  }
  // milky smoke filling the tube, then puffs drifting up
  g.rect(bx - 1, 2, 2, 7).fill({ color: 0xe9e9ee, alpha: 0.35 + 0.25 * Math.sin(s * 4) });
  for (let i = 0; i < 3; i++) {
    const ph = (s * 0.45 + i / 3) % 1;
    g.circle(bx - 6 + Math.sin(ph * 6 + i) * 3, -10 - ph * 18, 2 + ph * 3).fill({ color: 0xdedee6, alpha: 0.55 * (1 - ph) });
  }
}

/** The gaming desk in use: the monitor flickers with game colours and an RGB
 *  strip runs under the desk's front. Local coordinates are the desk's
 *  top-left tile (the monitor's screen is at 18..30 × 11..18). */
export function drawGamingSession(g: Graphics, t: number): void {
  g.clear();
  const flash = [0x3d8bff, 0xff5b7a, 0x5bffb0, 0xffd45b][Math.floor(t * 5) % 4];
  g.rect(18, 11, 12, 7).fill({ color: flash, alpha: 0.7 });
  g.rect(20 + ((t * 9) % 8), 15, 2, 2).fill(0xffffff);                 // something moving on screen
  for (let x = 6; x < 42; x += 2) g.rect(x, 37, 2, 1).fill(rainbow(t * 0.5 + x / 48));
}

/** Playing the console: the TV shows a game. Local coordinates are the TV's
 *  top-left tile (its screen is at 4..28 × 13..26). */
export function drawConsoleSession(g: Graphics, t: number): void {
  g.clear();
  g.rect(4, 13, 24, 13).fill(0x1c2a4a);
  for (let i = 0; i < 3; i++) g.rect(((i * 9 + t * 6) % 22) + 5, 15 + i * 2, 2, 1).fill(0xffffff); // stars
  g.rect(4, 23, 24, 3).fill(0x3fa34d);                                                             // ground
  const hop = Math.abs(Math.sin(t * 4)) * 3;
  g.rect(5 + ((t * 10) % 20), 20 - hop, 3, 3).fill(0xffd45b);                                     // the hero
}

/** The boss napping in his bed: Zzz floating up past his head. Local
 *  coordinates are the tile above the bed (his head is there). */
export function drawNap(g: Graphics, t: number): void {
  g.clear();
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.35 + i / 3) % 1;
    const size = 2 + i;
    const x = Math.round(12 + ph * 8), y = Math.round(6 - ph * 16);
    const fill = { color: 0x5b6bd8, alpha: 0.9 * (1 - ph) };
    g.rect(x, y, size + 1, 1).fill(fill);
    for (let k = 1; k < size; k++) g.rect(x + size - k, y + k, 1, 1).fill(fill);
    g.rect(x, y + size, size + 1, 1).fill(fill);
  }
}

/** Mia basking on her warm stone: heat shimmering up around her. Local
 *  coordinates are the stone's left tile. */
export function drawBask(g: Graphics, t: number): void {
  g.clear();
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.5 + i / 4) % 1;
    const x0 = 4 + i * 7;
    for (let k = 0; k < 5; k++) {
      const y = 6 - ph * 22 - k * 2;
      g.rect(x0 + Math.sin(t * 3 + k + i) * 1.5, y, 1, 1.5).fill({ color: 0xffb27a, alpha: 0.5 * (1 - ph) });
    }
  }
  g.ellipse(16, 10, 9 + Math.sin(t * 2) * 1.2, 2.5).fill({ color: 0xff9a5a, alpha: 0.18 });
}

/** Pinning a new find on the moodboard: a card swings in and settles, a pin
 *  glints. Local coordinates are the board's top-left tile. */
export function drawPinning(g: Graphics, t: number): void {
  g.clear();
  const ph = Math.min(1, (t % 6) / 1.2);
  const x = 34 + (1 - ph) * 10, y = 17 + (1 - ph) * 9;
  g.rect(x, y, 7, 6).fill(0xfbf8ef).stroke({ width: 0.5, color: 0x8a7a66 });
  g.rect(x + 1, y + 1, 5, 3).fill([0x9b7ad8, 0xe2665f, 0x5bb0a0][Math.floor(t / 6) % 3]);
  if (ph >= 1) g.circle(x + 3.5, y, 1.2).fill(0xd83a3a);
  const gl = (t * 0.8) % 1;
  g.rect(6 + gl * 50, 5 + Math.sin(gl * Math.PI) * 2, 1.5, 1.5).fill({ color: 0xffffff, alpha: 0.7 * Math.sin(gl * Math.PI) });
}

/** Painting at the easel: strokes appearing on the canvas, one by one. Local
 *  coordinates are the easel's top tile (its canvas is 1..15 × 6..18). */
export function drawSketching(g: Graphics, t: number): void {
  g.clear();
  const strokes: Array<[number, number, number, number, number]> = [
    [3, 14, 10, 1.5, 0x2e3a5c], [4, 9, 4, 2, 0xe2665f], [9, 8, 4, 1, 0xe0b84a],
    [3, 12, 6, 1, 0x8fb39a], [10, 11, 3, 3, 0x9b7ad8], [6, 16, 7, 1, 0xe2665f],
  ];
  const n = Math.floor(t * 0.9) % (strokes.length + 2);
  strokes.slice(0, n).forEach(([x, y, w, h, c]) => g.rect(x, y, w, h).fill(c));
  const [bx, by] = strokes[Math.min(n, strokes.length - 1)];
  g.rect(bx + 2 + Math.sin(t * 6), by - 3, 1, 3).fill(0x7a5030);           // the brush
}
