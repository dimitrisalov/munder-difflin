// Day and night on the office floor, by the owner's own clock (wave 7).
//
// A tint laid over the floor: clear through the working day, warm at dusk,
// navy at night, pink at dawn. `night` (0..1) says how dark it is, and drives
// the lights that come on with it: lit monitors, the fireplace, the vending
// machine. Pure, so the curve is tested without a renderer.

export interface Daylight {
  /** Tint colour (0xRRGGBB) laid over the floor. */
  color: number;
  /** Tint opacity, 0 (broad day) .. NIGHT_ALPHA (deep night). */
  alpha: number;
  /** How dark it is, 0..1: how bright the lights should be. */
  night: number;
}

const NIGHT = 0x0a1238;
const NIGHT_ALPHA = 0.42;

/** Hour of day → tint, linearly interpolated between these stops. */
const STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0, NIGHT, NIGHT_ALPHA],
  [5, NIGHT, NIGHT_ALPHA],
  [6.5, 0xff9a7a, 0.12],   // dawn
  [8, 0xffffff, 0],
  [17.5, 0xffffff, 0],
  [19, 0xff8a3d, 0.16],    // sunset
  [20.5, 0x2a2060, 0.32],  // twilight
  [22, NIGHT, NIGHT_ALPHA],
  [24, NIGHT, NIGHT_ALPHA],
];

function mix(a: number, b: number, k: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** The tint for a time of day in hours (0..24, fractional; wraps). */
export function daylightAt(hours: number): Daylight {
  const h = ((hours % 24) + 24) % 24;
  let i = 0;
  while (i < STOPS.length - 2 && h >= STOPS[i + 1][0]) i++;
  const [h0, c0, a0] = STOPS[i];
  const [h1, c1, a1] = STOPS[i + 1];
  const k = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  // Fade the colour towards the next stop only while there is any tint at all;
  // a stop with alpha 0 has no colour worth blending through.
  const color = a0 === 0 ? c1 : a1 === 0 ? c0 : mix(c0, c1, k);
  const alpha = a0 + (a1 - a0) * k;
  return { color, alpha, night: Math.min(1, alpha / NIGHT_ALPHA) };
}

/** Local time as fractional hours. */
export function hoursOf(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** A light that shows at night: tile coordinates (fractional allowed) of its
 *  centre, radius in pixels, colour, and whether it flickers like a fire. */
export interface NightLight {
  x: number;
  y: number;
  radius: number;
  color: number;
  flicker?: boolean;
}
