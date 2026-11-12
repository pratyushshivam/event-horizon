// The star catalogue, and the grid the shader looks stars up in.
//
// `public/sky/stars.bin` holds every star to magnitude 7 from the HYG
// database, six bytes each: right ascension and declination as 16-bit
// fractions, magnitude and B-V colour as bytes.
//
// To draw a star as a sharp point in an image traced backwards through bent
// light, the shader has to ask "is there a star in this direction?" for every
// pixel. The sky is cut into a cube of cells; each cell remembers its
// brightest star. The shader checks the four cells nearest its direction.

import { LUT_MAX_K, LUT_MIN_K, temperatureFromBV } from "./blackbody";
import type { Vec3 } from "./light";

export interface Star {
  /** Right ascension, radians. */
  ra: number;
  /** Declination, radians. */
  dec: number;
  mag: number;
  bv: number;
}

export const STAR_BYTES = 6;
export const CELLS_PER_FACE = 96;

export function encodeStars(stars: readonly Star[]): Uint8Array {
  const out = new Uint8Array(stars.length * STAR_BYTES);
  const view = new DataView(out.buffer);
  stars.forEach((s, i) => {
    const o = i * STAR_BYTES;
    view.setUint16(o, Math.min(65535, Math.round((s.ra / (2 * Math.PI)) * 65536) % 65536), true);
    view.setUint16(o + 2, Math.min(65535, Math.round(((s.dec + Math.PI / 2) / Math.PI) * 65535)), true);
    out[o + 4] = Math.max(0, Math.min(255, Math.round((s.mag + 2) * 25)));
    out[o + 5] = Math.max(0, Math.min(255, Math.round((s.bv + 0.5) * 100)));
  });
  return out;
}

export function decodeStars(bytes: Uint8Array): Star[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / STAR_BYTES);
  const out: Star[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STAR_BYTES;
    out.push({
      ra: (view.getUint16(o, true) / 65536) * 2 * Math.PI,
      dec: (view.getUint16(o + 2, true) / 65535) * Math.PI - Math.PI / 2,
      mag: bytes[o + 4]! / 25 - 2,
      bv: bytes[o + 5]! / 100 - 0.5,
    });
  }
  return out;
}

/**
 * Unit vector for a sky position. The same convention maps the all-sky image:
 * +y is the north celestial pole, right ascension runs from +x towards -z.
 */
export function skyDirection(ra: number, dec: number): Vec3 {
  const c = Math.cos(dec);
  return [c * Math.cos(ra), Math.sin(dec), -c * Math.sin(ra)];
}

/** Which cube face a direction points through, and where on it (0..1, 0..1). Mirrored in the shader. */
export function cubeFace(d: Vec3): { face: number; u: number; v: number } {
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  let face: number;
  let a: number;
  let b: number;
  let m: number;
  if (ax >= ay && ax >= az) {
    face = d[0] > 0 ? 0 : 1;
    m = ax;
    a = d[1];
    b = d[2];
  } else if (ay >= az) {
    face = d[1] > 0 ? 2 : 3;
    m = ay;
    a = d[2];
    b = d[0];
  } else {
    face = d[2] > 0 ? 4 : 5;
    m = az;
    a = d[0];
    b = d[1];
  }
  return { face, u: 0.5 * (a / m + 1), v: 0.5 * (b / m + 1) };
}

/** The inverse of `cubeFace`. */
export function cubeDirection(face: number, u: number, v: number): Vec3 {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  const s = face % 2 === 0 ? 1 : -1;
  let d: Vec3;
  if (face < 2) d = [s, a, b];
  else if (face < 4) d = [b, s, a];
  else d = [a, b, s];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** Magnitude to byte and back, as stored in the grid. */
const MAG_LO = -2;
const MAG_SPAN = 9.5;

/**
 * Build the lookup grid: an RGBA8 image, six faces side by side, one texel
 * per cell. R,G: where the star sits inside its cell. B: brightness
 * (255 = magnitude -2, falling to 1 at magnitude 7.5; 0 = empty).
 * A: temperature, as a position in the blackbody table.
 */
export function buildStarGrid(stars: readonly Star[], n = CELLS_PER_FACE): { data: Uint8Array; width: number; height: number; kept: number } {
  const width = n * 6;
  const data = new Uint8Array(width * n * 4);
  const best = new Float32Array(width * n).fill(99);
  let kept = 0;
  for (const s of stars) {
    const { face, u, v } = cubeFace(skyDirection(s.ra, s.dec));
    const cu = Math.min(n - 1, Math.floor(u * n));
    const cv = Math.min(n - 1, Math.floor(v * n));
    const idx = cv * width + face * n + cu;
    if (s.mag >= best[idx]!) continue;
    if (best[idx] === 99) kept++;
    best[idx] = s.mag;
    const kelvin = Math.max(LUT_MIN_K, Math.min(LUT_MAX_K, temperatureFromBV(s.bv)));
    const tIndex = Math.log(kelvin / LUT_MIN_K) / Math.log(LUT_MAX_K / LUT_MIN_K);
    data[idx * 4] = Math.max(0, Math.min(255, Math.round((u * n - cu) * 255)));
    data[idx * 4 + 1] = Math.max(0, Math.min(255, Math.round((v * n - cv) * 255)));
    data[idx * 4 + 2] = Math.max(1, Math.min(255, Math.round(255 * (1 - (s.mag - MAG_LO) / MAG_SPAN))));
    data[idx * 4 + 3] = Math.round(255 * tIndex);
  }
  return { data, width, height: n, kept };
}

export const STAR_MAG_LO = MAG_LO;
export const STAR_MAG_SPAN = MAG_SPAN;
