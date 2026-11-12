// The Schwarzschild spacetime in the units the whole page uses:
//   lengths in Schwarzschild radii (rs = 2GM/c^2 = 1), times in rs/c, c = 1.
// In these units GM/c^2 = 1/2.

export const M = 0.5;
export const R_HORIZON = 1;
/** Photon sphere, 3GM/c^2: light can circle here. */
export const R_PHOTON = 1.5;
/** Innermost stable circular orbit, 6GM/c^2. */
export const R_ISCO = 3;
/** Innermost bound circular orbit, 4GM/c^2: a fall from rest far away can just whirl here. */
export const R_MB = 2;
/** Critical impact parameter, 3*sqrt(3)*GM/c^2: light aimed closer is captured. */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;

/** The metric function 1 - rs/r. */
export function lapse2(r: number): number {
  return 1 - 1 / r;
}

/** Angular velocity of a circular orbit as seen from far away, d(phi)/dt. Kepler's law is exact here. */
export function circularOmega(r: number): number {
  return Math.sqrt(M / (r * r * r));
}

/** Orbital period of a circular orbit in far-away time. */
export function circularPeriod(r: number): number {
  return (2 * Math.PI) / circularOmega(r);
}

/** dt/dtau on a circular orbit: 1/sqrt(1 - 3GM/(r c^2)). Gravity and speed together. */
export function circularDilation(r: number): number {
  return 1 / Math.sqrt(1 - 1.5 / r);
}

/** Energy per unit rest mass of a circular orbit. */
export function circularEnergy(r: number): number {
  return (1 - 1 / r) / Math.sqrt(1 - 1.5 / r);
}

/** Angular momentum per unit rest mass of a circular orbit, r^2 dphi/dtau. */
export function circularAngularMomentum(r: number): number {
  return Math.sqrt(M * r) / Math.sqrt(1 - 1.5 / r);
}

/** Speed of a circular orbit measured by someone hovering at the same radius. */
export function circularSpeed(r: number): number {
  return Math.sqrt(M / (r - 1));
}

/** dt/dtau for someone hovering at rest at radius r (gravity only). */
export function staticDilation(r: number): number {
  return 1 / Math.sqrt(lapse2(r));
}

/** Proper acceleration needed to hover at radius r, in units of c^2/rs. */
export function hoverAcceleration(r: number): number {
  return M / (r * r * Math.sqrt(lapse2(r)));
}

/**
 * Angular radius of the shadow for an observer hovering at radius r:
 * sin(theta) = (b_crit / r) sqrt(1 - rs/r). Past the photon sphere the shadow
 * covers more than half the sky.
 */
export function shadowAngle(r: number): number {
  const s = Math.min(1, (B_CRIT / r) * Math.sqrt(lapse2(r)));
  const a = Math.asin(s);
  return r >= R_PHOTON ? a : Math.PI - a;
}

/**
 * Tidal stretch along the radial direction per unit length, for a body in free
 * radial fall: 2GM/r^3. In units of (c^2/rs) per rs this is 1/r^3.
 */
export function tidalStretch(r: number): number {
  return 1 / (r * r * r);
}

/** Weak-field light deflection, 4GM/(b c^2) = 2 rs/b radians. */
export function weakDeflection(b: number): number {
  return 2 / b;
}

/** Weak-field perihelion advance per orbit, 6 pi GM / (c^2 p), p the semi-latus rectum. */
export function weakPrecession(p: number): number {
  return (3 * Math.PI) / p;
}
