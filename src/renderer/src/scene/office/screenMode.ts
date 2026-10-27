// What a desk monitor shows for its agent's status (wave 7), and the little
// glyphs it draws. Pure, so the mapping is tested without a renderer;
// DeskScreen.ts does the drawing.

export type ScreenMode = 'code' | 'think' | 'ask' | 'alert' | 'pack' | 'done' | 'idle';

/** The agent's status → what its screen shows. */
export function screenModeFor(status: string | undefined): ScreenMode {
  switch (status) {
    case 'working': return 'code';      // the build log scrolls
    case 'thinking': return 'think';    // dots pulse
    case 'waiting':
    case 'blocked': return 'ask';       // amber, a blinking "?" — it's waiting on you
    case 'looping': return 'alert';     // red, "!" — stuck in a loop
    case 'compacting': return 'pack';   // a progress bar fills
    case 'success': return 'done';      // green, a check
    default: return 'idle';             // a screensaver
  }
}

/** Glyph bitmaps, rows top to bottom, '#' = lit. */
export const GLYPHS: Record<'ask' | 'alert' | 'done', readonly string[]> = {
  ask: ['###', '..#', '.##', '...', '.#.'],
  alert: ['.#.', '.#.', '.#.', '...', '.#.'],
  done: ['....#', '...#.', '#.#..', '.#...'],
};

/** Screen colours per mode (the fill laid over the blue desktop), or null to
 *  keep the desktop as it is. */
export const SCREEN_FILL: Record<ScreenMode, number | null> = {
  code: null, think: null, idle: 0x24345c, pack: null,
  ask: 0xf2b84a, alert: 0xe2574c, done: 0x5cc37a,
};
