import { describe, expect, it } from "vitest";
import { JULIAN_YEAR_S } from "../src/engine/constants";
import { holeById, holeScale } from "../src/engine/holes";
import { type Controls, RULES, type Run, newRun, resultOf, stepRun } from "../src/engine/run";
import { clockFace, clockStyle, duration, ending, kilometres, missed, shareText } from "../src/engine/words";

const sgr = holeScale(holeById("sgra"));
const cyg = holeScale(holeById("cygx1"));
const m87 = holeScale(holeById("m87"));
const COAST: Controls = { radial: 0, along: 0 };
const BRAKE: Controls = { radial: 0, along: -1 };
const DT = RULES.rate / 60;

function fly(run: Run, seconds: number, c: Controls, scale = sgr): Run {
  let r = run;
  for (let i = 0; i < seconds * 60; i++) r = stepRun(r, DT, c, scale);
  return r;
}

describe("a run", () => {
  it("waits in orbit at the station until the engine is first used", () => {
    const r = fly(newRun(), 30, COAST);
    expect(r.phase).toBe("ready");
    expect(r.ship.r).toBeCloseTo(RULES.homeR, 4);
    expect(r.air).toBe(RULES.air);
  });

  it("one brake, then coasting, comes home on its own with time stolen", () => {
    let r = fly(newRun(), 2.5, BRAKE);
    expect(r.phase).toBe("flying");
    expect(r.fuel).toBeLessThan(1);
    r = fly(r, 120, COAST);
    expect(r.phase).toBe("home");
    const res = resultOf(r, sgr);
    expect(res.minR).toBeLessThan(9);
    expect(res.earthS).toBeGreaterThan(res.shipS);
    expect(res.ratio).toBeGreaterThan(1.07);
  });

  it("braking hard ends at the horizon, with a finite fall to the centre", () => {
    let r = fly(newRun(), 12, BRAKE);
    r = fly(r, 120, COAST);
    expect(r.phase).toBe("horizon");
    const res = resultOf(r, sgr);
    expect(res.fallS).toBeGreaterThan(0);
    expect(res.fallS).toBeLessThan((Math.PI / 2) * sgr.rsOverC * 1.001); // the longest possible fall
  });

  it("is the same every time", () => {
    const a = fly(fly(newRun(), 3, BRAKE), 20, COAST);
    const b = fly(fly(newRun(), 3, BRAKE), 20, COAST);
    expect(a.ship).toEqual(b.ship);
  });

  it("runs out of fuel, and then the engine does nothing", () => {
    let r = newRun();
    for (let i = 0; i < 40; i++) r = fly(fly(r, 0.5, { radial: 0, along: 1 }), 0.5, BRAKE);
    expect(r.fuel).toBe(0);
    const before = r.ship;
    const after = stepRun(r, DT, { radial: 1, along: 0 }, sgr);
    const coast = stepRun(r, DT, COAST, sgr);
    if (after.phase === "flying") expect(after.ship).toEqual(coast.ship);
    expect(before.r).toBeGreaterThan(1);
  });

  it("ends adrift when the air runs out", () => {
    // Drop to a low stable orbit and stay.
    let r = fly(newRun(), 1.5, BRAKE);
    r = fly(r, 400, COAST);
    expect(["adrift", "home"]).toContain(r.phase);
    let s = fly(newRun(), 0.4, BRAKE);
    s = fly(s, 400, COAST);
    expect(s.phase).toBe("adrift");
    expect(s.air).toBe(0);
  });

  it("the tides of the small hole pull the ship apart before the horizon; the giants do not", () => {
    let small = fly(newRun(), 12, BRAKE, cyg);
    small = fly(small, 120, COAST, cyg);
    expect(small.phase).toBe("torn");
    expect(small.ship.r).toBeGreaterThan(3);
    let big = fly(newRun(), 12, BRAKE, m87);
    big = fly(big, 120, COAST, m87);
    expect(big.phase).toBe("horizon");
    expect(big.maxTide).toBeLessThan(1e-6);
  });
});

describe("words", () => {
  it("writes durations in the units that matter", () => {
    expect(duration(0.00021)).toBe("210 μs");
    expect(duration(0.31)).toBe("310 ms");
    expect(duration(75)).toBe("1 min 15 s");
    expect(duration(3 * 3600 + 12 * 60)).toBe("3 h 12 min");
    expect(duration(2 * JULIAN_YEAR_S + 41 * 86400 + 5)).toBe("2 y 41 d");
  });

  it("reads each hole's clocks at the right grain", () => {
    expect(clockStyle(m87.rsOverC)).toBe("calendar");
    expect(clockStyle(sgr.rsOverC)).toBe("day");
    expect(clockStyle(cyg.rsOverC)).toBe("fast");
    const ms = Date.UTC(2026, 10, 13, 14, 3, 22, 417);
    expect(clockFace(ms, "day")).toEqual({ date: "13 Nov 2026", time: "14:03:22" });
    expect(clockFace(ms + 0.25, "fast").time).toBe("14:03:22.417.25");
    expect(clockFace(ms, "calendar").time).toBe("14:03");
  });

  it("says what was missed, scaled to how long", () => {
    expect(missed(0)).toEqual([]);
    expect(missed(0.01)[0]).toContain("light crossed");
    expect(missed(600)[0]).toContain("along its orbit");
    expect(missed(40 * 86400)[0]).toBe("You missed 40 sunrises and 1 full moon.");
    expect(missed(2.2 * JULIAN_YEAR_S)[0]).toContain("2 birthdays");
    expect(kilometres(29_785 * 1000)).toBe("29.8 thousand km");
  });

  it("writes the end card and the share text", () => {
    const run = fly(fly(newRun(), 2.5, BRAKE, m87), 120, COAST, m87);
    const res = resultOf(run, m87);
    const card = ending(res, holeById("m87"), Date.UTC(2026, 10, 13));
    expect(card.title).toBe("Home");
    expect(card.lines[0]).toContain("by your clock");
    const text = shareText(res, holeById("m87"), "https://example.org/");
    expect(text.split("\n")[0]).toBe("Event Horizon · M87*");
    expect(text).toContain("I stole");
  });
});
