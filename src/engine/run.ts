// One run: the rules around the physics. Pure and deterministic: the same
// inputs in the same order always give the same run.

import { G0 } from "./constants";
import type { HoleScale } from "./holes";
import { tidalStretch } from "./schwarzschild";
import { type ShipState, type Thrust, advance, circularOrbit, dilation, localSpeed, timeToCentre } from "./ship";

export const RULES = {
  /** Radius of the station's orbit, rs. */
  homeR: 12,
  /** Coming back out past this radius ends the run safely. */
  homeGate: 11.5,
  /** The run counts as a dive once the ship has been below this. */
  awayR: 10,
  /** Too far out: the station cannot fetch you. */
  lostR: 30,
  /** Ship seconds of physics (rs/c) per real second. */
  rate: 5,
  /** Engine proper acceleration, c^2/rs. */
  accel: 0.003,
  /** Total change of speed the tanks hold, as a fraction of c. */
  deltaV: 0.4,
  /** Life support, in ship time (rs/c). */
  air: 700,
  /** What the hull takes before it is pulled apart, g per metre of length. */
  hullGPerM: 10_000,
} as const;

export type Phase = "ready" | "flying" | "home" | "horizon" | "torn" | "adrift";

export interface Run {
  ship: ShipState;
  phase: Phase;
  /** 1 full, 0 empty. */
  fuel: number;
  /** Ship time of life support left, rs/c. */
  air: number;
  hasLeft: boolean;
  minR: number;
  maxDilation: number;
  maxSpeed: number;
  /** Peak tidal stretch met, g per metre. */
  maxTide: number;
  /** Ship time from horizon to centre, set when the run ends at the horizon. */
  fallTime: number;
}

export interface Controls {
  /** -1..1, positive away from the hole. */
  radial: number;
  /** -1..1, positive speeds the ship along its orbit. */
  along: number;
}

export function newRun(): Run {
  return {
    ship: circularOrbit(RULES.homeR, 0),
    phase: "ready",
    fuel: 1,
    air: RULES.air,
    hasLeft: false,
    minR: RULES.homeR,
    maxDilation: 1,
    maxSpeed: 0,
    maxTide: 0,
    fallTime: 0,
  };
}

/** Tidal stretch at radius r (in rs) around this hole, g per metre of length. */
export function tideGPerM(r: number, scale: HoleScale): number {
  // (c^2/rs) per rs, times 1/r^3, expressed per metre and in g.
  return (scale.accelUnit / scale.rsM / G0) * tidalStretch(r);
}

/** Radius (rs) at which the hull fails around this hole. Below 1 means never outside the horizon. */
export function breakupRadius(scale: HoleScale): number {
  return Math.cbrt(scale.accelUnit / scale.rsM / G0 / RULES.hullGPerM);
}

export function isOver(p: Phase): boolean {
  return p !== "ready" && p !== "flying";
}

/** Advance the run by `dtau` of ship time with the controls held as given. */
export function stepRun(run: Run, dtau: number, c: Controls, scale: HoleScale): Run {
  if (isOver(run.phase)) return run;
  const mag = Math.min(1, Math.hypot(c.radial, c.along));
  const burning = mag > 0.05 && run.fuel > 0;
  const next: Run = { ...run };
  if (burning && next.phase === "ready") {
    // Departure: both clocks start from here.
    next.phase = "flying";
    next.ship = { ...next.ship, t: 0, tau: 0 };
  }
  const thrust: Thrust = burning
    ? { radial: c.radial, along: c.along, accel: RULES.accel * mag }
    : { radial: 0, along: 0, accel: 0 };
  next.ship = advance(next.ship, dtau, thrust);
  if (burning) next.fuel = Math.max(0, next.fuel - (RULES.accel * mag * dtau) / RULES.deltaV);
  if (next.phase !== "flying") return next;

  next.air = Math.max(0, next.air - dtau);
  const r = next.ship.r;
  next.minR = Math.min(next.minR, r);
  if (r > 1) {
    next.maxDilation = Math.max(next.maxDilation, dilation(next.ship));
    next.maxSpeed = Math.max(next.maxSpeed, localSpeed(next.ship));
  }
  const tide = tideGPerM(Math.max(r, 0.05), scale);
  next.maxTide = Math.max(next.maxTide, tide);
  if (r < RULES.awayR) next.hasLeft = true;

  if (tide >= RULES.hullGPerM && r > 1) next.phase = "torn";
  else if (r <= 1) {
    next.phase = "horizon";
    next.fallTime = timeToCentre(next.ship);
  } else if (next.hasLeft && r >= RULES.homeGate && next.ship.vr >= 0) next.phase = "home";
  else if (r >= RULES.lostR) next.phase = "adrift";
  else if (next.air <= 0) next.phase = "adrift";
  return next;
}

export interface Result {
  phase: Phase;
  /** Seconds by the ship's clock. */
  shipS: number;
  /** Seconds on Earth. */
  earthS: number;
  /** Earth minus ship, seconds. */
  stolenS: number;
  /** Earth time / ship time over the whole run. */
  ratio: number;
  minR: number;
  maxDilation: number;
  maxSpeed: number;
  fallS: number;
}

export function resultOf(run: Run, scale: HoleScale): Result {
  const shipS = run.ship.tau * scale.rsOverC;
  const earthS = run.ship.t * scale.rsOverC;
  return {
    phase: run.phase,
    shipS,
    earthS,
    stolenS: earthS - shipS,
    ratio: shipS > 0 ? earthS / shipS : 1,
    minR: run.minR,
    maxDilation: run.maxDilation,
    maxSpeed: run.maxSpeed,
    fallS: run.fallTime * scale.rsOverC,
  };
}
