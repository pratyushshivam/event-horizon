// The accretion disk: a geometrically thin, optically thick disk of gas on
// circular orbits in one plane, ending at the innermost stable circular orbit.
//
// The energy each ring radiates is the relativistic thin-disk result of
// Page & Thorne (1974, ApJ 191, 499), here for a non-spinning hole. With
// x = sqrt(r/M), x0 = sqrt(6) at the inner edge:
//
//   F(r)  proportional to
//     [ x - x0 + (sqrt(3)/2) ln( (x + sqrt3)(x0 - sqrt3) / ((x - sqrt3)(x0 + sqrt3)) ) ]
//     -----------------------------------------------------------------------------
//                                  x^5 (x^2 - 3)
//
// Far out this becomes the Newtonian Shakura-Sunyaev profile, F ~ r^-3.
// Each ring glows as a blackbody at T = (F/sigma)^(1/4).

import { M, R_ISCO, circularOmega } from "./schwarzschild";

const S3 = Math.sqrt(3);
const S6 = Math.sqrt(6);

/** Page-Thorne flux, arbitrary units, r in rs. Zero at and inside the inner edge. */
export function diskFluxRaw(r: number): number {
  if (r <= R_ISCO) return 0;
  const x = Math.sqrt(r / M);
  const bracket = x - S6 + (S3 / 2) * Math.log(((x + S3) * (S6 - S3)) / ((x - S3) * (S6 + S3)));
  return bracket / (x ** 5 * (x * x - 3));
}

/**
 * The same flux from its definition, by numerical integration:
 *   F ~ (-dOmega/dr) / (E - Omega L)^2 * integral_{r_isco}^{r} (E - Omega L) dL/dr dr / r
 * Used only by the tests, to check the closed form above.
 */
export function diskFluxByQuadrature(r: number, steps = 20_000): number {
  if (r <= R_ISCO) return 0;
  const E = (q: number) => (1 - 1 / q) / Math.sqrt(1 - 1.5 / q);
  const L = (q: number) => Math.sqrt(M * q) / Math.sqrt(1 - 1.5 / q);
  const dL = (q: number) => (L(q + 1e-5) - L(q - 1e-5)) / 2e-5;
  const g = (q: number) => (E(q) - circularOmega(q) * L(q)) * dL(q);
  const h = (r - R_ISCO) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const a = R_ISCO + (i + 0.5) * h;
    sum += g(a) * h;
  }
  const dOmega = -1.5 * circularOmega(r) / r;
  const denom = (E(r) - circularOmega(r) * L(r)) ** 2;
  return ((-dOmega / denom) * sum) / r;
}

function findPeak(): { r: number; f: number } {
  let lo = R_ISCO;
  let hi = 12;
  for (let i = 0; i < 80; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (diskFluxRaw(a) < diskFluxRaw(b)) lo = a;
    else hi = b;
  }
  const r = 0.5 * (lo + hi);
  return { r, f: diskFluxRaw(r) };
}

/** Where the disk radiates most per unit area (about 4.8 rs), and how much. */
export const DISK_PEAK = findPeak();

/** Flux as a fraction of its peak. */
export function diskFlux(r: number): number {
  return diskFluxRaw(r) / DISK_PEAK.f;
}

/** Temperature of a ring as a fraction of the hottest ring's. */
export function diskTemperature(r: number): number {
  return diskFlux(r) ** 0.25;
}

/**
 * Frequency shift of light from the disk: observed / emitted.
 *
 * The gas is on a circular orbit at radius r; the photon carries angular
 * momentum `lz` per unit energy about the disk's axis (positive when it
 * travels the way the disk turns); the observer hovers at rObs. Gravity and
 * the gas's motion are both in here:
 *
 *   g = sqrt(1 - 3M/r) / (1 - Omega lz) / sqrt(1 - rs/rObs)
 *
 * A blackbody seen through this shift is a blackbody at g T, and its total
 * brightness scales as g^4.
 */
export function diskShift(r: number, lz: number, rObs: number): number {
  return Math.sqrt(1 - 1.5 / r) / (1 - circularOmega(r) * lz) / Math.sqrt(1 - 1 / rObs);
}
