import { describe, expect, it } from "vitest";
import { blackbodyRGB, blackbodyTable, blackbodyXY, temperatureFromBV } from "../src/engine/blackbody";
import { DISK_PEAK, diskFlux, diskFluxByQuadrature, diskFluxRaw, diskShift, diskTemperature } from "../src/engine/disk";
import { circularOmega, circularSpeed } from "../src/engine/schwarzschild";
import { buildStarGrid, cubeDirection, cubeFace, decodeStars, encodeStars, skyDirection } from "../src/engine/stars";

describe("the disk", () => {
  it("closed-form flux matches the Page-Thorne integral", () => {
    const k = diskFluxByQuadrature(8) / diskFluxRaw(8);
    for (const r of [3.2, 4, 6, 10, 20, 60]) {
      expect(diskFluxByQuadrature(r) / diskFluxRaw(r) / k).toBeCloseTo(1, 3);
    }
  });

  it("is dark at the inner edge, peaks near 4.8 rs, and falls as r^-3 far out", () => {
    expect(diskFlux(3)).toBe(0);
    expect(diskFlux(2)).toBe(0);
    expect(DISK_PEAK.r).toBeGreaterThan(4.7);
    expect(DISK_PEAK.r).toBeLessThan(4.9);
    expect(diskFlux(DISK_PEAK.r)).toBeCloseTo(1, 12);
    // Newtonian limit: F ~ r^-3 (1 - sqrt(r_in / r)).
    const newton = (r: number) => r ** -3 * (1 - Math.sqrt(3 / r));
    const ratio = (diskFluxRaw(80000) / diskFluxRaw(40000)) / (newton(80000) / newton(40000));
    expect(ratio).toBeCloseTo(1, 2);
    expect(diskTemperature(DISK_PEAK.r)).toBeCloseTo(1, 12);
  });

  it("shifts light by gravity and motion together", () => {
    const r = 6;
    const far = 1e9;
    // Seen face-on (no angular momentum about the axis): pure time dilation of the orbit.
    expect(diskShift(r, 0, far)).toBeCloseTo(Math.sqrt(1 - 1.5 / r), 9);
    // Edge-on, gas coming straight at us: the special-relativistic Doppler
    // factor for its orbital speed, times the gravitational redshift.
    const v = circularSpeed(r);
    const bTangent = r / Math.sqrt(1 - 1 / r); // impact parameter of a ray leaving tangentially
    const doppler = Math.sqrt((1 + v) / (1 - v));
    const gravity = Math.sqrt(1 - 1 / r);
    expect(diskShift(r, bTangent, far)).toBeCloseTo(doppler * gravity, 7);
    expect(diskShift(r, -bTangent, far)).toBeCloseTo(gravity / doppler, 7);
    expect(diskShift(r, bTangent, far)).toBeGreaterThan(1);
    expect(circularOmega(r)).toBeCloseTo(Math.sqrt(0.5 / r ** 3), 12);
    // An observer deep in the well sees everything bluer.
    expect(diskShift(r, 0, 2) / diskShift(r, 0, far)).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("blackbody colour", () => {
  it("matches the CIE chromaticities of known sources", () => {
    // CIE standard illuminant A is a blackbody at 2856 K: (0.4476, 0.4074).
    const a = blackbodyXY(2856);
    expect(a[0]).toBeCloseTo(0.4476, 2);
    expect(a[1]).toBeCloseTo(0.4074, 2);
    // 6500 K on the Planckian locus: (0.3135, 0.3237).
    const d = blackbodyXY(6500);
    expect(d[0]).toBeCloseTo(0.3135, 2);
    expect(d[1]).toBeCloseTo(0.3237, 2);
  });

  it("runs from red through white to blue, always at unit luminance", () => {
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const cool = blackbodyRGB(2000);
    const sun = blackbodyRGB(5772);
    const hot = blackbodyRGB(20000);
    expect(cool[0]).toBeGreaterThan(cool[2] * 5);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(Math.abs(sun[0] - sun[2])).toBeLessThan(0.35);
    for (const c of [cool, sun, hot]) {
      expect(lum(c)).toBeCloseTo(1, 2);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
    }
    expect(blackbodyTable(64).length).toBe(256);
  });

  it("turns a star's colour index into its temperature", () => {
    expect(temperatureFromBV(0.656)).toBeGreaterThan(5500); // the Sun
    expect(temperatureFromBV(0.656)).toBeLessThan(6000);
    expect(temperatureFromBV(0)).toBeGreaterThan(9000); // Vega-like
    expect(temperatureFromBV(1.85)).toBeLessThan(3800); // Betelgeuse-like
  });
});

describe("the star grid", () => {
  it("round-trips the catalogue encoding", () => {
    const stars = [
      { ra: 1.7677, dec: -0.2917, mag: -1.44, bv: 0.009 },
      { ra: 4.8735, dec: 0.6769, mag: 0.03, bv: -0.001 },
    ];
    const back = decodeStars(encodeStars(stars));
    back.forEach((s, i) => {
      expect(s.ra).toBeCloseTo(stars[i]!.ra, 3);
      expect(s.dec).toBeCloseTo(stars[i]!.dec, 3);
      expect(s.mag).toBeCloseTo(stars[i]!.mag, 1);
      expect(s.bv).toBeCloseTo(stars[i]!.bv, 1);
    });
  });

  it("maps directions to cube cells and back", () => {
    for (let i = 0; i < 200; i++) {
      const ra = (i * 2.399963) % (2 * Math.PI);
      const dec = Math.asin(((i + 0.5) / 200) * 2 - 1);
      const d = skyDirection(ra, dec);
      const { face, u, v } = cubeFace(d);
      const back = cubeDirection(face, u, v);
      expect(back[0]).toBeCloseTo(d[0], 9);
      expect(back[1]).toBeCloseTo(d[1], 9);
      expect(back[2]).toBeCloseTo(d[2], 9);
    }
  });

  it("keeps the brightest star of each cell", () => {
    const grid = buildStarGrid(
      [
        { ra: 1, dec: 0.2, mag: 5, bv: 0.5 },
        { ra: 1.0001, dec: 0.2001, mag: 1, bv: 0.5 },
        { ra: 4, dec: -1, mag: 3, bv: 1.2 },
      ],
      32,
    );
    expect(grid.kept).toBe(2);
    expect(grid.width).toBe(192);
  });
});
