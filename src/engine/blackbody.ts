// The colour of a glowing body at a given temperature.
//
// Planck's law is integrated against the CIE 1931 colour matching functions
// (the analytic fit of Wyman, Sloan & Shirley 2013, JCGT 2(2), "Simple
// Analytic Approximations to the CIE XYZ Color Matching Functions"), then
// converted to linear sRGB (IEC 61966-2-1 primaries, D65 white).

import { C, H_PLANCK, K_BOLTZMANN } from "./constants";

function lobe(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 colour matching functions at a wavelength in nanometres. */
export function cie1931(nm: number): [number, number, number] {
  const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** Planck spectral radiance per unit wavelength, up to a constant factor. */
function planck(nm: number, kelvin: number): number {
  const l = nm * 1e-9;
  const x = (H_PLANCK * C) / (l * K_BOLTZMANN * kelvin);
  return 1 / (l ** 5 * Math.expm1(x));
}

/** CIE XYZ of a blackbody, unnormalised. */
export function blackbodyXYZ(kelvin: number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let nm = 380; nm <= 780; nm += 2) {
    const p = planck(nm, kelvin);
    const [x, y, z] = cie1931(nm);
    X += p * x;
    Y += p * y;
    Z += p * z;
  }
  return [X, Y, Z];
}

/** CIE xy chromaticity of a blackbody. */
export function blackbodyXY(kelvin: number): [number, number] {
  const [X, Y, Z] = blackbodyXYZ(kelvin);
  const s = X + Y + Z;
  return [X / s, Y / s];
}

/**
 * Linear sRGB colour of a blackbody, scaled to unit luminance. Colours
 * outside the sRGB gamut (deep reds) are pulled towards grey just enough to
 * fit, keeping luminance.
 */
export function blackbodyRGB(kelvin: number): [number, number, number] {
  const [X, Y, Z] = blackbodyXYZ(kelvin);
  const x = X / Y;
  const z = Z / Y;
  let r = 3.2406 * x - 1.5372 - 0.4986 * z;
  let g = -0.9689 * x + 1.8758 + 0.0415 * z;
  let b = 0.0557 * x - 0.204 + 1.057 * z;
  const lo = Math.min(r, g, b);
  if (lo < 0) {
    const k = 1 / (1 - lo); // mix with white (1,1,1), which has luminance 1
    r = (r - lo) * k;
    g = (g - lo) * k;
    b = (b - lo) * k;
  }
  return [r, g, b];
}

export const LUT_MIN_K = 800;
export const LUT_MAX_K = 40_000;

/** Lookup table of blackbody colours, evenly spaced in log temperature. RGBA floats. */
export function blackbodyTable(size = 256): Float32Array {
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const k = LUT_MIN_K * (LUT_MAX_K / LUT_MIN_K) ** (i / (size - 1));
    const [r, g, b] = blackbodyRGB(k);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/**
 * Surface temperature of a star from its B-V colour index.
 * Ballesteros 2012, EPL 97, 34008.
 */
export function temperatureFromBV(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}
