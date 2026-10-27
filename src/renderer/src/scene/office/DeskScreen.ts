import { Container, Graphics, Sprite } from 'pixi.js';
import type { TiledMapRenderer } from './TiledMapRenderer';
import type { MonitorConfig } from './themeRegistry';
import { GLYPHS, SCREEN_FILL, type ScreenMode } from './screenMode';

// The office tileset ships every desk PC twice: a dark, switched-off monitor
// (gids 365/366 + 381/382 — what the map paints) and the SAME monitor with a
// lit blue desktop (367/368 + 383/384). DeskScreen overlays the lit variant on
// a desk's monitor block while its agent is seated, plus a tiny screen-life
// animation that shows what its owner is up to (screenMode.ts): the build log
// scrolling while working, dots while thinking, an amber "?" while waiting on
// the human, a red "!" when looping, a progress bar while compacting, a green
// check when done, a screensaver when idle. Hidden, the map's off art shows
// through — no state to undo.

/** gid of the OFF monitor block's top-left tile, as painted in the office map.
 *  Default for the office theme; a theme supplies its own via MonitorConfig. */
export const MONITOR_OFF_TOPLEFT_GID = 365;
/** Matching ON tiles for the office theme, laid out 2×2 directly right of the
 *  off block — used when no per-theme MonitorConfig is passed. */
const DEFAULT_ON_GIDS: ReadonlyArray<readonly [number, number, number]> = [
  // [gid, dx, dy] in tiles relative to the block's top-left
  [367, 0, 0], [368, 1, 0],
  [383, 0, 1], [384, 1, 1]
];

/** Screen interior of the 2×2 (32×32px) block, in local pixels: the lit
 *  desktop spans 1..14 × 9..18 in the tile art; this is that, one pixel in.
 *  Every animation stays inside it. */
const SCREEN = { x: 2, y: 10, w: 12, h: 8 };

export class DeskScreen {
  readonly container = new Container();
  private anim = new Graphics();
  private on = false;
  private t = 0;
  private mode: ScreenMode = 'code';

  constructor(mapRenderer: TiledMapRenderer, topLeft: { x: number; y: number }, monitor?: MonitorConfig) {
    const ts = mapRenderer.tileSize;
    const onGids = monitor?.onGids ?? DEFAULT_ON_GIDS;
    for (const [gid, dx, dy] of onGids) {
      const tex = mapRenderer.textureForGid(gid);
      if (!tex) continue;
      const s = new Sprite(tex);
      s.x = dx * ts;
      s.y = dy * ts;
      this.container.addChild(s);
    }
    this.anim.eventMode = 'none';
    this.container.addChild(this.anim);
    this.container.x = topLeft.x * ts;
    this.container.y = topLeft.y * ts;
    // Sort with the characters: the block's bottom edge sits above the seated
    // agent's anchor row, so the avatar's head draws over the keyboard, not
    // under it — same painter's order the map art implies.
    this.container.zIndex = (topLeft.y + 2) * ts - 1;
    this.container.visible = false;
    this.container.eventMode = 'none';
  }

  /** Light the screen (agent sat down) or cut it (stood up / left). */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.container.visible = on;
    if (!on) { this.anim.clear(); this.t = 0; }
  }

  /** What the screen shows (screenModeFor(agent.status)). */
  setMode(mode: ScreenMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.t = 0;
  }

  update(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    const g = this.anim;
    const { x, y, w, h } = SCREEN;
    const t = this.t;
    g.clear();
    const fill = SCREEN_FILL[this.mode];
    if (fill !== null) g.rect(x - 1, y - 1, w + 2, h + 2).fill({ color: fill, alpha: 0.9 });
    switch (this.mode) {
      case 'code': {
        // Two faint "output" lines scrolling up the desktop, wrapping around —
        // the eternal build log — plus a cursor blinking in the lower left.
        for (let i = 0; i < 2; i++) {
          const phase = (t * 3.2 + i * (h / 2)) % (h - 2);
          const lw = 3 + ((i * 7 + Math.floor(t / 1.7)) % (w - 4));
          g.rect(x + 1, Math.round(y + h - 3 - phase), lw, 1).fill({ color: 0xcfe6ff, alpha: 0.6 });
        }
        if (Math.floor(t / 0.53) % 2 === 0) g.rect(x + 1, y + h - 2, 2, 2).fill({ color: 0xffffff, alpha: 0.9 });
        break;
      }
      case 'think': {
        // three dots lighting up in turn
        for (let i = 0; i < 3; i++) {
          const lit = Math.floor(t * 3) % 3 === i;
          g.rect(x + 2 + i * 3, y + 3, 2, 2).fill({ color: 0xffffff, alpha: lit ? 0.95 : 0.4 });
        }
        break;
      }
      case 'ask':
      case 'alert': {
        if (Math.floor(t / 0.6) % 2 === 0) this.glyph(GLYPHS[this.mode], 0x2a2236);
        break;
      }
      case 'done': {
        this.glyph(GLYPHS.done, 0xffffff);
        break;
      }
      case 'pack': {
        // a progress bar that fills, then starts over
        g.rect(x + 1, y + 3, w - 2, 3).stroke({ width: 1, color: 0xffffff, alpha: 0.8 });
        g.rect(x + 2, y + 4, Math.round((w - 4) * ((t * 0.4) % 1)), 1).fill({ color: 0xffffff, alpha: 0.95 });
        break;
      }
      case 'idle': {
        // a dot drifting and bouncing off the screen's edges
        const bx = Math.abs(((t * 4) % (2 * (w - 2))) - (w - 2));
        const by = Math.abs(((t * 3) % (2 * (h - 2))) - (h - 2));
        g.rect(x + Math.round(bx), y + Math.round(by), 2, 2).fill({ color: 0x8fc8ff, alpha: 0.9 });
        break;
      }
    }
  }

  /** Draw a glyph bitmap centred on the screen. */
  private glyph(rows: readonly string[], color: number): void {
    const gw = rows[0].length, gh = rows.length;
    const ox = SCREEN.x + Math.floor((SCREEN.w - gw) / 2);
    const oy = SCREEN.y + Math.floor((SCREEN.h - gh) / 2);
    rows.forEach((row, r) => {
      for (let c = 0; c < gw; c++) if (row[c] === '#') this.anim.rect(ox + c, oy + r, 1, 1).fill(color);
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
