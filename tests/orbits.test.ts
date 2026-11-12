import { describe, expect, it } from "vitest";
import { C, G0, GM_SUN, PARSEC, schwarzschildRadiusM } from "../src/engine/constants";
import { HOLES, holeById, holeScale } from "../src/engine/holes";
import { RULES, breakupRadius, tideGPerM } from "../src/engine/run";
import {
  R_ISCO,
  circularDilation,
  circularEnergy,
  circularPeriod,
  circularSpeed,
  hoverAcceleration,
  weakPrecession,
} from "../src/engine/schwarzschild";
import {
  type ShipState,
  advance,
  angularMomentum,
  circularOrbit,
  dilation,
  energy,
  localSpeed,
  predictPath,
  timeToCentre,
  turningPoints,
} from "../src/engine/ship";

describe("circular orbits", () => {
  it("stay circular for fifty orbits, and keep their energy", () => {
    for (const r of [12, 6, 3.2]) {
      const start = circularOrbit(r);
      const tauPerOrbit = circularPeriod(r) / circularDilation(r);
      let s = start;
      let worst = 0;
      for (let i = 0; i < 500; i++) {
        s = advance(s, tauPerOrbit / 10);
        worst = Math.max(worst, Math.abs(s.r - r));
      }
      expect(worst).toBeLessThan(1e-5 * r);
      expect(Math.abs(energy(s) / energy(start) - 1)).toBeLessThan(1e-8);
      expect(Math.abs(angularMomentum(s) / angularMomentum(start) - 1)).toBeLessThan(1e-8);
    }
  });

  it("take the Kepler period in far-away time: 2 pi sqrt(r^3 / M)", () => {
    const r = 8;
    let s = circularOrbit(r);
    // March until the ship has gone exactly once round.
    const dt = 0.01;
    while (s.phi < 2 * Math.PI) s = advance(s, dt);
    const overshoot = (s.phi - 2 * Math.PI) / s.vphi;
    const t = s.t - overshoot * dilation(s);
    expect(t).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / 0.5), 5);
    expect(t).toBeCloseTo(circularPeriod(r), 5);
  });

  it("run slow by 1/sqrt(1 - 3GM/rc^2): the clocks pull apart exactly that fast", () => {
    for (const r of [12, 5, 3, 2]) {
      const s = advance(circularOrbit(r), 3);
      expect(s.t / s.tau).toBeCloseTo(1 / Math.sqrt(1 - 1.5 / r), 6);
      expect(dilation(circularOrbit(r))).toBeCloseTo(circularDilation(r), 12);
    }
    // At the innermost stable orbit, Earth's clock runs sqrt(2) times faster.
    expect(circularDilation(R_ISCO)).toBeCloseTo(Math.SQRT2, 12);
  });

  it("move at half the speed of light at the innermost stable orbit", () => {
    expect(localSpeed(circularOrbit(R_ISCO))).toBeCloseTo(0.5, 12);
    expect(circularSpeed(R_ISCO)).toBeCloseTo(0.5, 12);
  });

  it("have least energy at 3 rs: the innermost stable orbit", () => {
    let best = 0;
    let bestE = Infinity;
    for (let r = 2; r <= 6; r += 0.0005) {
      const e = circularEnergy(r);
      if (e < bestE) {
        bestE = e;
        best = r;
      }
    }
    expect(best).toBeCloseTo(3, 2);
    expect(bestE).toBeCloseTo(Math.sqrt(8 / 9), 9);
  });

  it("are unstable below 3 rs: a nudge inward becomes a plunge", () => {
    const nudge = (r: number): ShipState => ({ ...circularOrbit(r), vr: -1e-4 });
    const stable = advance(nudge(4), 400);
    expect(stable.r).toBeGreaterThan(3.9);
    const unstable = advance(nudge(2.5), 400);
    expect(unstable.r).toBeLessThan(1);
  });
});

describe("coasting", () => {
  it("conserves energy and angular momentum on a deep eccentric orbit", () => {
    // From the station, brake to a pass at about 2.6 rs.
    let s: ShipState = { ...circularOrbit(12), vphi: circularOrbit(12).vphi * 0.78 };
    const e0 = energy(s);
    const l0 = angularMomentum(s);
    let minR = s.r;
    for (let i = 0; i < 4000; i++) {
      s = advance(s, 0.5);
      minR = Math.min(minR, s.r);
    }
    expect(minR).toBeLessThan(5);
    expect(minR).toBeGreaterThan(1.5);
    expect(Math.abs(energy(s) / e0 - 1)).toBeLessThan(1e-7);
    expect(Math.abs(angularMomentum(s) / l0 - 1)).toBeLessThan(1e-7);
  });

  it("precesses by 6 pi GM / (c^2 p) per orbit in the weak field", () => {
    // An ellipse with semi-latus rectum p = 400 rs, eccentricity 0.3.
    const p = 400;
    const ecc = 0.3;
    const rp = p / (1 + ecc);
    const ra = p / (1 - ecc);
    // Exact conserved quantities for these turning points.
    const l2 = (0.5 * p * p) / (p - 1.5 - 0.5 * ecc * ecc) ; // M p^2 / (p - M(3 + e^2)) with M = 1/2
    const vphi = Math.sqrt(l2) / (rp * rp);
    let s: ShipState = { r: rp, phi: 0, vr: 0, vphi, t: 0, tau: 0 };
    const tp = turningPoints({ ...s, r: rp * 1.2, vr: 0, vphi: Math.sqrt(l2) / (rp * 1.2) ** 2 });
    expect(tp.bound).toBe(true);
    // Step until the ship comes back to its lowest point.
    let prevVr = 0;
    let turned = false;
    let phiAtPeri = 0;
    for (let i = 0; i < 4_000_000; i++) {
      const before = s;
      s = advance(s, 2);
      if (s.vr > 0) turned = true;
      if (turned && prevVr < 0 && s.vr >= 0) {
        const k = -before.vr / (s.vr - before.vr);
        phiAtPeri = before.phi + k * (s.phi - before.phi);
        break;
      }
      prevVr = s.vr;
    }
    const advancePerOrbit = phiAtPeri - 2 * Math.PI;
    expect(ra).toBeGreaterThan(rp);
    expect(advancePerOrbit).toBeGreaterThan(0);
    expect(advancePerOrbit / weakPrecession(p)).toBeGreaterThan(0.98);
    expect(advancePerOrbit / weakPrecession(p)).toBeLessThan(1.03);
  });

  it("falls from rest far away to the centre in (2/3) rs/c after the horizon", () => {
    // Radial fall from rest at infinity: E = 1, dr/dtau = -sqrt(rs/r).
    const s: ShipState = { r: 1, phi: 0, vr: -1, vphi: 0, t: 0, tau: 0 };
    expect(timeToCentre(s)).toBeCloseTo(2 / 3, 2);
  });

  it("predicts the path it then flies", () => {
    const s: ShipState = { ...circularOrbit(12), vphi: circularOrbit(12).vphi * 0.8 };
    const path = predictPath(s, 48);
    expect(path.length).toBeGreaterThan(20);
    const tp = turningPoints(s);
    const lowest = Math.min(...path.map((q) => q.r));
    expect(lowest).toBeGreaterThan(tp.peri - 0.02);
    expect(lowest).toBeLessThan(tp.peri + 0.6);
    expect(tp.apo).toBeCloseTo(12, 3);
  });
});

describe("the engine", () => {
  it("is felt as exactly the acceleration asked for, whatever the ship is doing", () => {
    // Hovering needs M / (r^2 sqrt(1 - rs/r)). Thrust exactly that, outward, from rest.
    const r = 4;
    let s: ShipState = { r, phi: 0, vr: 0, vphi: 0, t: 0, tau: 0 };
    s = advance(s, 50, { radial: 1, along: 0, accel: hoverAcceleration(r) });
    expect(s.r).toBeCloseTo(r, 6);
    expect(s.t / s.tau).toBeCloseTo(1 / Math.sqrt(1 - 1 / r), 6);
  });

  it("brakes into a lower orbit and boosts into a higher one", () => {
    const brake = advance(circularOrbit(12), 10, { radial: 0, along: -1, accel: RULES.accel });
    const boost = advance(circularOrbit(12), 10, { radial: 0, along: 1, accel: RULES.accel });
    expect(turningPoints(brake).peri).toBeLessThan(9);
    expect(turningPoints(boost).apo).toBeGreaterThan(15);
    expect(energy(brake)).toBeLessThan(energy(circularOrbit(12)));
  });
});

describe("the black holes", () => {
  it("get their size from the published mass: rs = 2GM/c^2", () => {
    expect(schwarzschildRadiusM(1)).toBeCloseTo((2 * GM_SUN) / C ** 2, 6);
    expect(schwarzschildRadiusM(1) / 1e3).toBeCloseTo(2.953, 3);
    const sgr = holeScale(holeById("sgra"));
    const m87 = holeScale(holeById("m87"));
    const cyg = holeScale(holeById("cygx1"));
    expect(sgr.rsM / 1e9).toBeCloseTo(12.69, 1); // million km
    expect(m87.rsOverC / 3600).toBeCloseTo(17.8, 0); // hours
    expect(cyg.rsM / 1e3).toBeCloseTo(62.6, 1); // km
    expect(HOLES.length).toBe(3);
  });

  it("cast shadows the size the Event Horizon Telescope measured", () => {
    // Sagittarius A*: ring diameter 51.8 +- 2.3 microarcseconds (EHT 2022).
    // M87*: 42 +- 3 (EHT 2019). The shadow of a non-spinning hole is 2 * 3 sqrt(3) GM/c^2 across.
    const sgr = holeScale(holeById("sgra"));
    const m87 = holeScale(holeById("m87"));
    expect(sgr.shadowMuas).toBeGreaterThan(51.8 - 2 * 2.3);
    expect(sgr.shadowMuas).toBeLessThan(51.8 + 2 * 2.3);
    expect(m87.shadowMuas).toBeGreaterThan(42 - 2 * 3);
    expect(m87.shadowMuas).toBeLessThan(42 + 2 * 3);
    expect(holeById("sgra").distancePc * PARSEC).toBeGreaterThan(2.5e20);
  });

  it("pull harder on small ships near small holes: tides scale as 1/M^2 at the horizon", () => {
    const sgr = holeScale(holeById("sgra"));
    const cyg = holeScale(holeById("cygx1"));
    const ratio = tideGPerM(1, cyg) / tideGPerM(1, sgr);
    expect(ratio / (4.297e6 / 21.2) ** 2).toBeCloseTo(1, 9);
    // 2GM/r^3 per metre, in g.
    const direct = (2 * GM_SUN * 21.2) / (5 * cyg.rsM) ** 3 / G0;
    expect(tideGPerM(5, cyg) / direct).toBeCloseTo(1, 9);
    // Cygnus X-1 breaks the hull well outside the horizon; the giants never do.
    expect(breakupRadius(cyg)).toBeGreaterThan(3);
    expect(breakupRadius(sgr)).toBeLessThan(1);
    expect(breakupRadius(holeScale(holeById("m87")))).toBeLessThan(1);
  });
});
