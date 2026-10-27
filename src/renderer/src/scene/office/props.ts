// Props the floor draws in code: things the bundled tile sheets don't have.
// Drawn from scratch with plain shapes (no third-party art), at 16 px per tile,
// in local coordinates from the prop's top-left tile. A layout places them
// (mapBuild.ts `props`); OfficeFloor draws each once, redraws the ones with an
// idle animation every frame, and plays the in-use animations below while an
// agent runs the matching errand ('bong', 'gaming', 'console', 'nap').

import type { Graphics } from 'pixi.js';

export type PropKind =
  | 'bong' | 'grinder' | 'console' | 'gaming-pc'
  | 'cat-bed' | 'scratching-post' | 'food-bowl'
  | 'bell' | 'easel';

/** Footprint in tiles (w × h), for the map builder. */
export const PROP_SIZE: Record<PropKind, { w: number; h: number }> = {
  bong: { w: 1, h: 1 }, grinder: { w: 1, h: 1 }, console: { w: 1, h: 1 }, 'gaming-pc': { w: 1, h: 1 },
  'cat-bed': { w: 1, h: 1 }, 'scratching-post': { w: 1, h: 2 }, 'food-bowl': { w: 1, h: 1 },
  bell: { w: 1, h: 1 }, easel: { w: 1, h: 2 },
};

/** Lies flat on the floor: drawn under anyone standing on it (Theo in his bed). */
export const FLAT_PROPS: ReadonlySet<string> = new Set(['cat-bed']);

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
