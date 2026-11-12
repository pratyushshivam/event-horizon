// The ship: a timelike path through Schwarzschild spacetime, with thrust.
//
// The orbit stays in one plane, so the state is (r, phi) with their rates per
// unit of ship (proper) time. The equations are the geodesic equations with
// the normalisation u.u = -1 folded in:
//
//   d2r/dtau2   = -M/r^2 + (r - 3M) (dphi/dtau)^2 + a^r
//   d2phi/dtau2 = -(2/r) (dr/dtau) (dphi/dtau)    + a^phi
//   dt/dtau     = sqrt( (1 + (dr/dtau)^2/f + r^2 (dphi/dtau)^2) / f ),  f = 1 - rs/r
//
// a is the four-acceleration of the engine: always perpendicular to the
// four-velocity, with the magnitude the pilot feels.

import { M, circularAngularMomentum, lapse2 } from "./schwarzschild";

export interface ShipState {
  r: number;
  phi: number;
  /** dr/dtau */
  vr: number;
  /** dphi/dtau */
  vphi: number;
  /** Far-away (Earth) time elapsed. */
  t: number;
  /** Ship time elapsed. */
  tau: number;
}

/** Thrust as the pilot aims it: a direction in the hovering observer's frame, and a proper acceleration. */
export interface Thrust {
  /** Component away from the hole. */
  radial: number;
  /** Component along the direction of increasing phi. */
  along: number;
  /** Proper acceleration, c^2/rs. */
  accel: number;
}

export const NO_THRUST: Thrust = { radial: 0, along: 0, accel: 0 };

export function circularOrbit(r: number, phi = 0): ShipState {
  return { r, phi, vr: 0, vphi: circularAngularMomentum(r) / (r * r), t: 0, tau: 0 };
}

/** dt/dtau: how fast Earth's clock runs against the ship's, right now. */
export function dilation(s: ShipState): number {
  const f = lapse2(s.r);
  return Math.sqrt((1 + (s.vr * s.vr) / f + s.r * s.r * s.vphi * s.vphi) / f);
}

/** Conserved while coasting: energy per unit mass, f dt/dtau. */
export function energy(s: ShipState): number {
  return lapse2(s.r) * dilation(s);
}

/** Conserved while coasting: angular momentum per unit mass, r^2 dphi/dtau. */
export function angularMomentum(s: ShipState): number {
  return s.r * s.r * s.vphi;
}

/** Speed measured by someone hovering where the ship is, as a fraction of c. */
export function localSpeed(s: ShipState): number {
  const f = lapse2(s.r);
  if (f <= 0) return 1;
  const e = energy(s);
  return Math.sqrt(Math.max(0, 1 - f / (e * e)));
}

type D = [number, number, number, number, number];

function deriv(r: number, vr: number, vphi: number, th: Thrust): D {
  const f = 1 - 1 / r;
  let ar = 0;
  let aphi = 0;
  let ut = 0;
  if (f > 0) {
    ut = Math.sqrt((1 + (vr * vr) / f + r * r * vphi * vphi) / f);
    if (th.accel > 0) {
      const len = Math.hypot(th.radial, th.along) || 1;
      const nr = th.radial / len;
      const np = th.along / len;
      // n as a four-vector with no time part in the hovering frame, projected
      // perpendicular to u and renormalised. |P n|^2 = 1 + (u.n)^2.
      const sf = Math.sqrt(f);
      const un = (vr * nr) / sf + r * vphi * np;
      const k = th.accel / Math.sqrt(1 + un * un);
      ar = k * (nr * sf + un * vr);
      aphi = k * (np / r + un * vphi);
    }
  }
  return [vr, vphi, -M / (r * r) + (r - 3 * M) * vphi * vphi + ar, (-2 * vr * vphi) / r + aphi, ut];
}

function rk4(s: ShipState, h: number, th: Thrust): ShipState {
  const k1 = deriv(s.r, s.vr, s.vphi, th);
  const k2 = deriv(s.r + 0.5 * h * k1[0], s.vr + 0.5 * h * k1[2], s.vphi + 0.5 * h * k1[3], th);
  const k3 = deriv(s.r + 0.5 * h * k2[0], s.vr + 0.5 * h * k2[2], s.vphi + 0.5 * h * k2[3], th);
  const k4 = deriv(s.r + h * k3[0], s.vr + h * k3[2], s.vphi + h * k3[3], th);
  const w = h / 6;
  return {
    r: s.r + w * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    phi: s.phi + w * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    vr: s.vr + w * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    vphi: s.vphi + w * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
    t: s.t + w * (k1[4] + 2 * k2[4] + 2 * k3[4] + k4[4]),
    tau: s.tau + h,
  };
}

/** Largest safe step at this radius: a small fraction of the local orbital time. */
function stepLimit(r: number): number {
  return 0.02 * Math.max(0.05, r) ** 1.5;
}

/**
 * Advance the ship by `dtau` of its own time. Fourth-order Runge-Kutta with
 * the step cut to a small fraction of the local orbital time, so a circular
 * orbit stays circular and energy holds to better than a part in a million.
 * Inside the horizon the far-away clock is no longer advanced: it has no
 * meaning there.
 */
export function advance(s: ShipState, dtau: number, th: Thrust = NO_THRUST): ShipState {
  let left = dtau;
  let cur = s;
  let guard = 0;
  while (left > 1e-12 && guard++ < 100_000) {
    if (cur.r <= 0.02) break;
    const h = Math.min(left, stepLimit(cur.r));
    const next = rk4(cur, h, cur.r > 1 ? th : NO_THRUST);
    if (cur.r <= 1) next.t = cur.t;
    cur = next;
    left -= h;
  }
  return cur;
}

/** Ship time from the horizon to the centre along the actual path, by continuing it. */
export function timeToCentre(s: ShipState): number {
  let cur: ShipState = { ...s };
  const start = cur.tau;
  let guard = 0;
  while (cur.r > 0.03 && guard++ < 200_000) {
    cur = rk4(cur, Math.min(0.002, stepLimit(cur.r)), NO_THRUST);
    if (!Number.isFinite(cur.r)) break;
  }
  return cur.tau - start;
}

export interface PathPoint {
  x: number;
  y: number;
  r: number;
}

/**
 * The coasting path ahead: where the ship goes if the engine stays off.
 * Sampled evenly in angle so the curve is smooth where it bends hardest.
 * Stops at the horizon, after `maxTurns` turns, or past `rMax`.
 */
export function predictPath(s: ShipState, count: number, maxTurns = 1.15, rMax = 40): PathPoint[] {
  const out: PathPoint[] = [];
  let cur: ShipState = { ...s };
  const dphi = (maxTurns * 2 * Math.PI) / (count - 1);
  out.push({ x: cur.r * Math.cos(cur.phi), y: cur.r * Math.sin(cur.phi), r: cur.r });
  let guard = 0;
  let swept = 0;
  while (out.length < count && guard++ < 20_000) {
    const speed = Math.hypot(cur.vr, cur.r * cur.vphi) || 1e-6;
    // Step by a small arc so radial plunges are sampled as well as orbits.
    const h = Math.min(stepLimit(cur.r), (0.25 * dphi * Math.max(cur.r, 1)) / speed);
    const next = rk4(cur, h, NO_THRUST);
    swept += Math.abs(next.phi - cur.phi) + Math.abs(next.r - cur.r) / Math.max(cur.r, 1.5);
    cur = next;
    const done = cur.r <= 1.001 || cur.r > rMax;
    if (swept >= dphi || done) {
      out.push({ x: cur.r * Math.cos(cur.phi), y: cur.r * Math.sin(cur.phi), r: cur.r });
      swept = 0;
    }
    if (done) break;
  }
  return out;
}

/** Lowest and highest radius of the coasting orbit ahead, from the conserved quantities. */
export function turningPoints(s: ShipState): { peri: number; apo: number; bound: boolean; plunges: boolean } {
  const e = energy(s);
  const l = angularMomentum(s);
  // Radial motion: (dr/dtau)^2 = e^2 - (1 - 1/r)(1 + l^2/r^2) =: R(r)
  const R = (r: number) => e * e - (1 - 1 / r) * (1 + (l * l) / (r * r));
  // Walk away from the ship in one direction until the motion is forbidden.
  // The ship may be sitting exactly on a turning point, so first wait for the
  // motion to be allowed at all.
  const walk = (next: (r: number) => number, stop: (r: number) => boolean): number | null => {
    let a = s.r;
    let allowed = false;
    for (let i = 0; i < 6000; i++) {
      const b = next(a);
      if (stop(b)) return null;
      const fb = R(b);
      if (fb > 1e-12) allowed = true;
      else if (allowed) {
        let lo = a;
        let hi = b;
        for (let k = 0; k < 50; k++) {
          const mid = 0.5 * (lo + hi);
          if (R(mid) > 0) lo = mid;
          else hi = mid;
        }
        return 0.5 * (lo + hi);
      } else if (i > 8) return s.r;
      a = b;
    }
    return null;
  };
  const inner = walk((r) => r - Math.max(0.0005, 0.002 * (r - 1)), (r) => r <= 1.0001);
  const outer = walk((r) => r * 1.002 + 0.0005, (r) => r > 1e6);
  return {
    peri: inner ?? 1,
    apo: outer ?? Infinity,
    bound: outer !== null,
    plunges: inner === null,
  };
}
