// Mia — the office designer: a black snake.
//
// Drawn from scratch in code like Theo (catArt.ts), on the cast's canvases
// (18×28 portrait bust, 18×32 standing sprite). Glossy charcoal-black scales
// with a blue-violet sheen, amber eyes with slit pupils, a forked red tongue,
// and an artist's coral beret. No legs: she stands as stacked coils with her
// neck raised, and sways from side to side as she moves.

export const SNAKE_PORTRAIT_W = 18;
export const SNAKE_PORTRAIT_H = 28;
export const SNAKE_SCENE_W = 18;
export const SNAKE_SCENE_H = 32;

type RGB = [number, number, number];
type Buf = Uint8ClampedArray;

const OUTLINE: RGB = [16, 14, 22];
const SCALE = { spec: [158, 164, 220] as RGB, hi: [86, 90, 138] as RGB, base: [46, 47, 62] as RGB, sh: [31, 31, 42] as RGB, deep: [22, 22, 30] as RGB };
const BELLY: RGB = [78, 78, 96];
const BELLY_LINE: RGB = [56, 56, 70];
const IRIS_TOP: RGB = [196, 132, 30];
const IRIS: RGB = [236, 178, 52];
const IRIS_LO: RGB = [248, 212, 110];
const PUPIL: RGB = [18, 14, 20];
const GLINT: RGB = [255, 250, 236];
const NOSTRIL: RGB = [18, 16, 24];
const TONGUE: RGB = [222, 60, 78];
const BERET = { hi: [244, 142, 130] as RGB, base: [226, 102, 96] as RGB, sh: [186, 70, 70] as RGB };

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
// A snake's head from the front: wide and flat, widest at the cheeks where the
// eyes sit on the sides, a broad mouth, a short rounded chin. Rows: [y, x0, x1].
const HEAD: Array<[number, number, number]> = [
  [4, 6, 11], [5, 4, 13], [6, 3, 14], [7, 2, 15], [8, 2, 15],
  [9, 3, 14], [10, 4, 13], [11, 5, 12], [12, 6, 11],
];

function drawBeret(c: Canvas, back: boolean): void {
  // Tilted to her left (our right), with a little stalk on top.
  c.set(9, 0, BERET.sh);
  c.row(1, 6, 11, BERET.base);
  c.row(2, 4, 13, BERET.base);
  c.row(3, 3, 14, BERET.base);
  c.row(4, 4, 15, back ? BERET.base : BERET.sh);
  if (!back) { c.row(1, 7, 8, BERET.hi); c.row(2, 5, 7, BERET.hi); c.set(4, 3, BERET.hi); }
  for (let x = 11; x <= 14; x++) c.set(x, 3, BERET.sh);
}

function drawSkull(c: Canvas): void {
  for (const [y, x0, x1] of HEAD) c.row(y, x0, x1, SCALE.base);
  // Light from the upper left: a sheen on the left cheek and the brow.
  c.set(2, 7, SCALE.hi); c.set(3, 6, SCALE.hi); c.set(5, 5, SCALE.spec); c.set(6, 5, SCALE.hi);
  // Shade on the right cheek and under the jaw.
  c.set(15, 8, SCALE.sh); c.set(14, 9, SCALE.sh); c.set(13, 10, SCALE.sh); c.set(12, 11, SCALE.sh); c.set(11, 12, SCALE.sh);
  // The big plates on top of the head between the eyes.
  for (const [x, y] of [[7, 5], [10, 5], [8, 6], [9, 6]] as const) c.set(x, y, SCALE.sh);
  // The lower jaw, a shade lighter.
  c.row(11, 6, 11, SCALE.hi); c.row(12, 7, 10, SCALE.hi);
}

function drawFace(c: Canvas): void {
  // Big amber eyes on the sides of the head, vertical slit pupils, a glint,
  // and a dark brow scale over each one for a bit of attitude.
  for (const x0 of [4, 11]) {
    for (let x = x0; x <= x0 + 2; x++) { c.set(x, 6, IRIS_TOP); c.set(x, 7, IRIS); c.set(x, 8, IRIS_LO); }
    c.set(x0 + 1, 6, PUPIL); c.set(x0 + 1, 7, PUPIL); c.set(x0 + 1, 8, PUPIL);
    c.set(x0, 6, GLINT);
    c.row(5, x0, x0 + 2, SCALE.deep);
  }
  // Nostrils at the front of the snout, and a wide, satisfied smile.
  c.set(7, 8, NOSTRIL); c.set(10, 8, NOSTRIL);
  c.set(5, 9, SCALE.deep); c.set(12, 9, SCALE.deep);
  c.row(10, 6, 11, SCALE.deep);
}

function drawTongue(c: Canvas): void {
  c.set(8, 11, TONGUE); c.set(9, 11, TONGUE);
  c.set(8, 12, TONGUE); c.set(9, 12, TONGUE);
  c.set(8, 13, TONGUE); c.set(9, 13, TONGUE);
  c.set(7, 14, TONGUE); c.set(10, 14, TONGUE);
}

function drawHeadBack(c: Canvas): void {
  for (const [y, x0, x1] of HEAD) c.row(y, x0, x1, SCALE.base);
  c.set(2, 7, SCALE.hi); c.set(3, 6, SCALE.hi); c.set(15, 8, SCALE.sh); c.set(14, 9, SCALE.sh);
  // The glossy dorsal stripe and the plates of the crown.
  for (let y = 5; y <= 12; y++) c.set(y % 2 ? 8 : 9, y, SCALE.hi);
  for (const [x, y] of [[5, 7], [12, 7], [6, 9], [11, 9]] as const) c.set(x, y, SCALE.sh);
}

// ─── body ────────────────────────────────────────────────────────────────────
/** One turn of the coil seen from the front: a three-pixel tube with rounded
 *  ends, glossy on top, shaded underneath, and a dark crease below it so the
 *  stacked turns read as separate loops. */
function drawBand(c: Canvas, y: number, x0: number, x1: number, crease: boolean): void {
  c.row(y, x0 + 1, x1 - 1, SCALE.base);
  c.row(y + 1, x0, x1, SCALE.base);
  c.row(y + 2, x0 + 1, x1 - 1, SCALE.sh);
  c.row(y, x0 + 1, x0 + 4, SCALE.hi);
  c.set(x0 + 2, y, SCALE.spec);
  c.set(x0, y + 1, SCALE.hi);
  c.set(x1, y + 1, SCALE.sh);
  if (crease) c.row(y + 3, x0 + 1, x1 - 1, SCALE.deep);
}

/** The raised neck: an S-curve from the right end of the top coil up to the
 *  chin, the pale belly scales showing from the front. `dx` sways the middle. */
function drawNeck(c: Canvas, dx: number, front: boolean, chin: number, base: number): void {
  // [x0 of a three-pixel-wide neck] per row, from the chin down to the coil.
  const path = [7, 7, 6, 6, 7, 8, 9, 10];
  for (let i = 0; i < path.length && chin + i <= base; i++) {
    const y = chin + i;
    const sway = i >= 2 && i <= 5 ? dx : 0;
    const x0 = path[i] + sway;
    c.row(y, x0, x0 + 2, SCALE.base);
    c.set(x0, y, SCALE.hi);
    c.set(x0 + 2, y, SCALE.sh);
    if (front) c.set(x0 + 1, y, y % 2 ? BELLY_LINE : BELLY);
    else if (i % 2 === 0) c.set(x0 + 1, y, SCALE.hi);
  }
}

/** Three stacked turns of the coil on the floor, joined in a spiral; the top
 *  turn sways with the neck and the tail tip curls out of the bottom one. */
function drawCoils(c: Canvas, dx: number, tail: 0 | 1 | 2): void {
  drawBand(c, 28, 2, 15, false);
  drawBand(c, 24, 3, 14, true);
  // where the middle turn runs down into the bottom one
  c.set(15, 27, SCALE.base); c.set(15, 28, SCALE.sh);
  drawBand(c, 20 + 0, 5 + dx, 12 + dx, true);
  // where the top turn runs down into the middle one
  c.set(4 + dx, 23, SCALE.base); c.set(3, 24, SCALE.base);
  const tips: Array<Array<[number, number]>> = [
    [[1, 30], [0, 29], [0, 28]],
    [[1, 30], [0, 30], [0, 29]],
    [[1, 30], [1, 29], [0, 28]],
  ];
  for (const [x, y] of tips[tail]) c.set(x, y, SCALE.sh);
}

/** The portrait's lower half: the neck rising out of two turns of the coil. */
function drawBust(c: Canvas): void {
  drawBand(c, 24, 2, 15, false);
  drawBand(c, 20, 5, 12, true);
  c.set(4, 23, SCALE.base); c.set(3, 24, SCALE.base);
  drawNeck(c, 0, true, 13, 20);
}

// ─── public ──────────────────────────────────────────────────────────────────
export function snakePortraitBuf(): Buf {
  const c = new Canvas(SNAKE_PORTRAIT_W, SNAKE_PORTRAIT_H);
  drawBust(c);
  drawSkull(c);
  drawFace(c);
  drawBeret(c, false);
  drawTongue(c);
  c.outline();
  return c.buf;
}

/** Walk-phase frames (stand, step-L, step-R), front and back: the neck and
 *  top coil sway, the tail tip flicks, the tongue darts out on one phase. */
export function snakeSceneBufs(): { front: Buf[]; back: Buf[] } {
  const frame = (phase: 0 | 1 | 2, back: boolean): Buf => {
    const c = new Canvas(SNAKE_SCENE_W, SNAKE_SCENE_H);
    const dx = phase === 1 ? -1 : phase === 2 ? 1 : 0;
    drawCoils(c, dx, phase);
    drawNeck(c, dx, !back, 13, 20);
    if (back) drawHeadBack(c);
    else { drawSkull(c); drawFace(c); }
    drawBeret(c, back);
    if (!back && phase === 1) drawTongue(c);
    c.outline();
    return c.buf;
  };
  return {
    front: [frame(0, false), frame(1, false), frame(2, false)],
    back: [frame(0, true), frame(1, true), frame(2, true)],
  };
}
