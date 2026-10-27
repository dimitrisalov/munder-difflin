// Theo — the office's boss: a white Devon Rex cat.
//
// Drawn from scratch in code, like the human cast in portraitArt.ts, on the
// same canvases (18×28 portrait bust, 18×32 standing sprite) so the floor,
// cards and picker treat him like anyone else. Devon Rex cues: huge low-set
// ears, a round face with full cheeks, big round pale yellow eyes, a wavy white coat, a
// long thin tail. He stands upright like the rest of the floor and wears the
// boss's red tie.

export const CAT_PORTRAIT_W = 18;
export const CAT_PORTRAIT_H = 28;
export const CAT_SCENE_W = 18;
export const CAT_SCENE_H = 32;

type RGB = [number, number, number];
type Buf = Uint8ClampedArray;

const OUTLINE: RGB = [38, 34, 46];
const FUR = { hi: [255, 253, 250] as RGB, base: [243, 240, 234] as RGB, sh: [214, 208, 201] as RGB, deep: [184, 177, 170] as RGB };
const EAR_IN: RGB = [238, 172, 180];
const EAR_IN_SH: RGB = [214, 140, 152];
// Pale yellow eyes with a touch of green, darker under the lid, and big round
// pupils — as in the photo of the real Theo.
const IRIS_TOP: RGB = [192, 178, 84];
const IRIS: RGB = [224, 210, 108];
const IRIS_LO: RGB = [238, 230, 156];
const PUPIL: RGB = [34, 32, 40];
const GLINT: RGB = [252, 252, 246];
const NOSE: RGB = [234, 160, 170];
const MOUTH_LT: RGB = [214, 186, 190];
// The faint grey smudges on his forehead and by the eyes.
const SMUDGE: RGB = [206, 201, 202];
const TIE: RGB = [176, 52, 58];
const TIE_HI: RGB = [206, 84, 88];
const PAW: RGB = [226, 218, 210];
const WHISKER: RGB = [236, 236, 242];

class Canvas {
  readonly buf: Buf;
  constructor(readonly w: number, readonly h: number) { this.buf = new Uint8ClampedArray(w * h * 4); }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = a;
  }
  alpha(x: number, y: number): number {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return 0;
    return this.buf[(y * this.w + x) * 4 + 3];
  }
  row(y: number, x0: number, x1: number, c: RGB): void { for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  /** Dark outline around every opaque pixel, like the rest of the cast. */
  outline(): void {
    const pts: [number, number][] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.alpha(x, y) !== 0) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.alpha(x + dx, y + dy) === 255)) pts.push([x, y]);
    }
    for (const [x, y] of pts) this.set(x, y, OUTLINE);
  }
}

// ─── head ────────────────────────────────────────────────────────────────────
// Ears: very large triangles — a straight outer edge, a straight slope down to
// the crown, a pointed tip — pink almost to the rim (left; the right mirrors).
const EAR: Array<[number, number, number]> = [[0, 2, 2], [1, 2, 3], [2, 2, 4], [3, 2, 5], [4, 2, 6], [5, 2, 7], [6, 3, 6]];
const EAR_INNER: Array<[number, number, number]> = [[2, 3, 3], [3, 3, 4], [4, 3, 5], [5, 3, 6]];
// Skull + face rows: [y, x0, x1] — a round face with full cheeks, short chin.
const HEAD: Array<[number, number, number]> = [
  [5, 6, 11], [6, 5, 12], [7, 4, 13], [8, 3, 14], [9, 3, 14], [10, 3, 14],
  [11, 3, 14], [12, 4, 13], [13, 5, 12], [14, 6, 11], [15, 7, 10],
];
const mirror = (x: number) => 17 - x;

function drawEars(c: Canvas, inner: boolean): void {
  for (const [y, x0, x1] of EAR) { c.row(y, x0, x1, FUR.base); c.row(y, mirror(x1), mirror(x0), FUR.base); }
  if (!inner) {
    // From behind: just a shade down the middle of each ear.
    for (const [y, x0, x1] of EAR_INNER) { c.row(y, x0, x1, FUR.sh); c.row(y, mirror(x1), mirror(x0), FUR.sh); }
    return;
  }
  for (const [y, x0, x1] of EAR_INNER) { c.row(y, x0, x1, EAR_IN); c.row(y, mirror(x1), mirror(x0), EAR_IN); }
  for (const [x, y] of [[3, 4], [3, 5]] as const) { c.set(x, y, EAR_IN_SH); c.set(mirror(x), y, EAR_IN_SH); }
}

function drawSkull(c: Canvas): void {
  for (const [y, x0, x1] of HEAD) c.row(y, x0, x1, FUR.base);
  // Light from the upper left, shade on the right cheek and under the chin.
  for (let y = 7; y <= 11; y++) c.set(4, y, FUR.hi);
  c.set(6, 6, FUR.hi); c.set(7, 6, FUR.hi);
  for (let y = 8; y <= 12; y++) c.set(13, y, FUR.sh);
  c.set(14, 9, FUR.sh); c.set(14, 10, FUR.sh); c.set(12, 13, FUR.sh); c.set(11, 14, FUR.sh); c.set(10, 15, FUR.sh);
  // The rex coat: soft waves on the forehead, and his grey smudge by the left ear.
  for (const [x, y] of [[8, 6], [7, 7], [10, 7]] as const) c.set(x, y, FUR.sh);
  c.set(5, 6, SMUDGE); c.set(6, 7, SMUDGE);
}

function drawFace(c: Canvas): void {
  // Big round eyes: a 3×3 iris, darker under the lid, a round pupil, a glint.
  for (const x0 of [4, 11]) {
    for (let x = x0; x <= x0 + 2; x++) { c.set(x, 8, IRIS_TOP); c.set(x, 9, IRIS); c.set(x, 10, IRIS_LO); }
    c.set(x0 + 1, 9, PUPIL); c.set(x0 + 1, 10, PUPIL);
    c.set(x0, 8, GLINT);
  }
  // Faint grey at the inner corners of the eyes.
  c.set(7, 10, SMUDGE); c.set(10, 10, SMUDGE);
  // Muzzle: whisker pads, a small pink nose, a small serious mouth.
  c.set(6, 12, FUR.hi); c.set(11, 12, FUR.hi);
  c.set(8, 11, FUR.sh); c.set(9, 11, FUR.sh);
  c.set(8, 12, NOSE); c.set(9, 12, NOSE);
  c.set(8, 13, MOUTH_LT); c.set(9, 13, MOUTH_LT);
  c.set(7, 14, MOUTH_LT); c.set(10, 14, MOUTH_LT);
}

/** The rex coat on the body: small curls as arcs of shade. */
function drawCurls(c: Canvas, at: ReadonlyArray<readonly [number, number]>): void {
  for (const [x, y] of at) { c.set(x, y, FUR.sh); c.set(x + 1, y + 1, FUR.sh); }
}

/** Short, curly Devon whiskers, translucent so the outline pass leaves them thin. */
function drawWhiskers(c: Canvas): void {
  for (const [x, y] of [[2, 11], [1, 12], [2, 13], [15, 11], [16, 12], [15, 13]] as const) c.set(x, y, WHISKER, 210);
}

function drawHeadBack(c: Canvas): void {
  drawEars(c, false);
  for (const [y, x0, x1] of HEAD) c.row(y, x0, x1, FUR.base);
  for (let y = 7; y <= 13; y++) c.set(13, y, FUR.sh);
  for (const [x, y] of [[7, 8], [10, 9], [8, 11], [11, 12], [9, 13]] as const) c.set(x, y, FUR.sh); // waves
}

// ─── body ────────────────────────────────────────────────────────────────────
function drawTie(c: Canvas, top: number, bottom: number): void {
  c.set(8, top, TIE_HI); c.set(9, top, TIE);
  for (let y = top + 1; y <= bottom; y++) { c.set(8, y, TIE); c.set(9, y, TIE); }
  c.set(8, bottom + 1, TIE);
}

/** The portrait's shoulders and chest: fluffy white, the boss's tie. */
function drawBust(c: Canvas): void {
  // The neck widens a little toward the shoulders, like the floor sprite's.
  c.row(16, 7, 10, FUR.sh); c.row(17, 6, 11, FUR.sh); c.row(18, 5, 12, FUR.base);
  const rows: Array<[number, number, number]> = [[19, 5, 12], [20, 4, 13], [21, 3, 14], [22, 3, 14], [23, 2, 15], [24, 2, 15], [25, 2, 15], [26, 2, 15], [27, 2, 15]];
  for (const [y, x0, x1] of rows) c.row(y, x0, x1, FUR.base);
  for (let y = 22; y <= 27; y++) { c.set(3, y, FUR.sh); c.set(14, y, FUR.sh); }
  for (const [x, y] of [[6, 21], [11, 21], [7, 24], [10, 25]] as const) c.set(x, y, FUR.hi); // chest fluff
  drawCurls(c, [[4, 21], [11, 20], [5, 24], [12, 23], [3, 26], [6, 26], [10, 26], [13, 26]]);
  drawTie(c, 19, 24);
}

/** Standing body for the floor sprite: torso, paws, legs, a long tail. */
function drawStanding(c: Canvas, phase: number, back: boolean): void {
  c.row(16, 7, 10, FUR.sh); c.row(17, 6, 11, FUR.base);
  for (let y = 18; y <= 24; y++) c.row(y, 5, 12, FUR.base);
  c.row(25, 6, 11, FUR.base);
  for (let y = 19; y <= 24; y++) c.set(12, y, FUR.sh);
  // Arms hanging at the sides, paws at the ends.
  for (let y = 19; y <= 22; y++) { c.set(4, y, FUR.base); c.set(13, y, FUR.sh); }
  c.set(4, 23, PAW); c.set(13, 23, PAW);
  if (!back) {
    for (const [x, y] of [[7, 21], [10, 23]] as const) c.set(x, y, FUR.hi);
    drawCurls(c, [[5, 19], [10, 19], [6, 22], [10, 22]]);
    drawTie(c, 18, 22);
  } else {
    drawCurls(c, [[6, 19], [9, 20], [6, 23], [10, 23]]);
  }
  // Legs, one lifted per walk phase. Set wide apart: a narrower gap would be
  // filled solid by the outline and read as dark trousers on a white cat.
  const lift = (leg: 0 | 1) => (phase === leg + 1 ? 1 : 0);
  for (const [leg, x0] of [[0, 5], [1, 11]] as const) {
    const end = 30 - lift(leg);
    for (let y = 26; y <= end; y++) { c.set(x0, y, FUR.base); c.set(x0 + 1, y, FUR.sh); }
    c.set(x0, end + 1, PAW); c.set(x0 + 1, end + 1, PAW);
  }
  // The tail: from the base of the back, curling up past the right hip.
  const tail: Array<[number, number]> = back
    ? [[9, 25], [10, 26], [11, 26], [12, 25], [13, 24], [14, 23], [14, 22], [15, 21]]
    : [[12, 25], [13, 26], [14, 26], [15, 25], [16, 24], [16, 23], [15, 22]];
  for (const [x, y] of tail) c.set(x, y, FUR.sh);
}

// ─── public ──────────────────────────────────────────────────────────────────
export function catPortraitBuf(): Buf {
  const c = new Canvas(CAT_PORTRAIT_W, CAT_PORTRAIT_H);
  drawBust(c);
  drawEars(c, true);
  drawSkull(c);
  drawFace(c);
  c.outline();
  drawWhiskers(c);
  return c.buf;
}

/** Walk-phase frames (stand, step-L, step-R), front and back. */
export function catSceneBufs(): { front: Buf[]; back: Buf[] } {
  const frame = (phase: number, back: boolean): Buf => {
    const c = new Canvas(CAT_SCENE_W, CAT_SCENE_H);
    drawStanding(c, phase, back);
    if (back) drawHeadBack(c);
    else { drawEars(c, true); drawSkull(c); drawFace(c); }
    c.outline();
    if (!back) drawWhiskers(c);
    return c.buf;
  };
  return {
    front: [frame(0, false), frame(1, false), frame(2, false)],
    back: [frame(0, true), frame(1, true), frame(2, true)],
  };
}
