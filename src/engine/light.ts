// Light in Schwarzschild spacetime.
//
// Every light path lies in a plane through the hole. In that plane, with
// u = rs/r and phi the angle swept around the hole, the null geodesic
// equation reduces exactly to
//
//     d2u/dphi2 = -u + (3/2) u^2
//
// `traceRay` integrates this with the same fixed-step fourth-order
// Runge-Kutta scheme the fragment shader runs for every pixel, so the tests
// can check the shader's arithmetic on the CPU. `referenceDeflection`
// integrates the same physics in a different formulation (Cartesian position
// and velocity, tiny steps) as an independent check.

import { B_CRIT } from "./schwarzschild";

export type Vec3 = [number, number, number];

export interface RayResult {
  fate: "captured" | "escaped" | "orbiting";
  /** Angle swept when the ray ended. For an escaped ray this is its direction at infinity. */
  phi: number;
  /** Impact parameter b = L/E in rs. */
  b: number;
  /** Radius at angle `at` along the ray, or null if the ray never got there. */
  radiusAt(at: number): number | null;
}

export interface TraceOptions {
  /** Angular step, radians. The shader uses 0.12 to 0.22 depending on quality. */
  step?: number;
  maxSteps?: number;
}

/** Impact parameter of a ray leaving radius r0 at angle psi from the outward radial direction, seen by a hovering observer. */
export function impactParameter(r0: number, psi: number): number {
  return (r0 * Math.sin(psi)) / Math.sqrt(1 - 1 / r0);
}

/**
 * Trace one ray backwards from an observer hovering at r0, leaving at angle
 * psi from the outward radial direction (psi = pi looks straight at the hole).
 */
export function traceRay(r0: number, psi: number, opts: TraceOptions = {}): RayResult {
  const h = opts.step ?? 0.12;
  const n = opts.maxSteps ?? 96;
  const s = Math.max(Math.sin(psi), 1e-5);
  const us: number[] = [1 / r0];
  // A hovering observer measures radial lengths stretched by 1/sqrt(1 - rs/r),
  // so the slope du/dphi picks up a factor sqrt(1 - rs/r) against flat space.
  const ws: number[] = [(-Math.cos(psi) / s) * (1 / r0) * Math.sqrt(1 - 1 / r0)];
  let u = us[0]!;
  let w = ws[0]!;
  let fate: RayResult["fate"] = "orbiting";
  let phiEnd = n * h;
  for (let i = 0; i < n; i++) {
    const k1u = w;
    const k1w = -u + 1.5 * u * u;
    const u2 = u + 0.5 * h * k1u;
    const k2u = w + 0.5 * h * k1w;
    const k2w = -u2 + 1.5 * u2 * u2;
    const u3 = u + 0.5 * h * k2u;
    const k3u = w + 0.5 * h * k2w;
    const k3w = -u3 + 1.5 * u3 * u3;
    const u4 = u + h * k3u;
    const k4u = w + h * k3w;
    const k4w = -u4 + 1.5 * u4 * u4;
    const un = u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    const wn = w + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    us.push(un);
    ws.push(wn);
    if (un >= 1) {
      fate = "captured";
      phiEnd = (i + 1) * h;
      break;
    }
    if (un <= 0) {
      fate = "escaped";
      phiEnd = (i + u / (u - un)) * h;
      break;
    }
    u = un;
    w = wn;
  }
  return {
    fate,
    phi: phiEnd,
    b: impactParameter(r0, psi),
    radiusAt(at: number): number | null {
      if (at < 0 || at > phiEnd) return null;
      const i = Math.min(us.length - 2, Math.floor(at / h));
      const uc = hermite(us[i]!, ws[i]!, us[i + 1]!, ws[i + 1]!, at / h - i, h);
      return uc > 0 && uc < 1 ? 1 / uc : null;
    },
  };
}

/** Cubic Hermite interpolation of u between two steps, as the shader does at plane crossings. */
export function hermite(u0: number, w0: number, u1: number, w1: number, s: number, h: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * u0 + (s3 - 2 * s2 + s) * h * w0 + (-2 * s3 + 3 * s2) * u1 + (s3 - s2) * h * w1
  );
}

/**
 * Independent check. A ray comes in from far away with impact parameter b and
 * is integrated as a particle under the acceleration -(3/2) h^2 x / r^5, which
 * traces the same null geodesic. Returns the total bending angle, or null if
 * the ray is captured.
 */
export function referenceDeflection(b: number, far = 4000, dl = 0.002): number | null {
  let x = -far;
  let y = b;
  let vx = 1;
  let vy = 0;
  const h2 = b * b;
  const acc = (px: number, py: number): [number, number] => {
    const r2 = px * px + py * py;
    const k = (-1.5 * h2) / (r2 * r2 * Math.sqrt(r2));
    return [k * px, k * py];
  };
  let guard = 0;
  while (guard++ < 50_000_000) {
    const r = Math.hypot(x, y);
    if (r < 1) return null;
    if (r > far * 1.0001 && x * vx + y * vy > 0) break;
    const h = Math.min(Math.max(dl, 0.01 * (r - 1.4)), 0.02 * r);
    const [a1x, a1y] = acc(x, y);
    const [a2x, a2y] = acc(x + 0.5 * h * vx, y + 0.5 * h * vy);
    const m2x = vx + 0.5 * h * a1x;
    const m2y = vy + 0.5 * h * a1y;
    const m3x = vx + 0.5 * h * a2x;
    const m3y = vy + 0.5 * h * a2y;
    const [a3x, a3y] = acc(x + 0.5 * h * m2x, y + 0.5 * h * m2y);
    const m4x = vx + h * a3x;
    const m4y = vy + h * a3y;
    const [a4x, a4y] = acc(x + h * m3x, y + h * m3y);
    x += (h / 6) * (vx + 2 * m2x + 2 * m3x + m4x);
    y += (h / 6) * (vy + 2 * m2y + 2 * m3y + m4y);
    vx += (h / 6) * (a1x + 2 * a2x + 2 * a3x + a4x);
    vy += (h / 6) * (a1y + 2 * a2y + 2 * a3y + a4y);
  }
  // Bending: the angle between the incoming direction (+x) and the outgoing
  // velocity, counted through however many turns the ray made. With y = b > 0
  // the ray bends clockwise, towards the hole.
  let turn = Math.atan2(-vy, vx);
  if (turn < 0) turn += 2 * Math.PI;
  return turn;
}

/** True if a ray with this impact parameter, coming from far away, is captured. */
export function isCaptured(b: number): boolean {
  return b < B_CRIT;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** u at angle `delta` for the ray leaving r0 at angle psi; 2 if captured first, -1 if escaped first. */
function uAt(r0: number, psi: number, delta: number): number {
  const steps = Math.max(8, Math.ceil(delta / 0.04));
  const h = delta / steps;
  let u = 1 / r0;
  let w = (-Math.cos(psi) / Math.max(Math.sin(psi), 1e-9)) * u * Math.sqrt(1 - u);
  for (let i = 0; i < steps; i++) {
    const k1w = -u + 1.5 * u * u;
    const u2 = u + 0.5 * h * w;
    const k2u = w + 0.5 * h * k1w;
    const k2w = -u2 + 1.5 * u2 * u2;
    const u3 = u + 0.5 * h * k2u;
    const k3u = w + 0.5 * h * k2w;
    const k3w = -u3 + 1.5 * u3 * u3;
    const u4 = u + h * k3u;
    const k4u = w + h * k3w;
    const k4w = -u4 + 1.5 * u4 * u4;
    u += (h / 6) * (w + 2 * k2u + 2 * k3u + k4u);
    w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    if (u >= 1) return 2;
    if (u <= 0) return -1;
  }
  return u;
}

/**
 * Where does an observer hovering at `cam` see a point at `target`? Returns
 * the unit direction of the direct image (the light path that goes the short
 * way round), found by shooting rays in the plane of the observer, the target
 * and the hole and bisecting on the launch angle.
 */
export function apparentDirection(cam: Vec3, target: Vec3): Vec3 {
  const r0 = len(cam);
  const rp = len(target);
  const e1 = scale(cam, 1 / r0);
  const tHat = scale(target, 1 / rp);
  const c = Math.min(1, Math.max(-1, dot(e1, tHat)));
  const delta = Math.acos(c);
  const perp = add(tHat, scale(e1, -c));
  const pl = len(perp);
  if (delta < 1e-5 || pl < 1e-9) {
    const d = add(target, scale(cam, -1));
    const dl = len(d) || 1;
    return scale(d, 1 / dl);
  }
  const e2 = scale(perp, 1 / pl);
  const want = 1 / rp;
  let lo = 1e-6; // looking outwards
  let hi = Math.PI - 1e-6; // looking at the hole
  for (let i = 0; i < 44; i++) {
    const mid = 0.5 * (lo + hi);
    if (uAt(r0, mid, delta) < want) lo = mid;
    else hi = mid;
  }
  const psi = 0.5 * (lo + hi);
  return add(scale(e1, Math.cos(psi)), scale(e2, Math.sin(psi)));
}
