import { describe, expect, it } from "vitest";
import { type Vec3, apparentDirection, impactParameter, referenceDeflection, traceRay } from "../src/engine/light";
import { B_CRIT, R_PHOTON, shadowAngle, weakDeflection } from "../src/engine/schwarzschild";

/** Launch angle whose ray, from r0, has impact parameter b and heads inward. */
const inwardAngle = (r0: number, b: number) => Math.PI - Math.asin((b * Math.sqrt(1 - 1 / r0)) / r0);

describe("light paths", () => {
  it("bend by 4GM/(b c^2) in the weak field", () => {
    for (const b of [200, 500, 1500]) {
      const ref = referenceDeflection(b, 400_000)!;
      expect(ref / weakDeflection(b)).toBeGreaterThan(0.995);
      expect(ref / weakDeflection(b)).toBeLessThan(1.02);
    }
  });

  it("the shader's integrator agrees with the reference in the strong field", () => {
    // Rays from an observer far out, passing the hole at a range of distances.
    const r0 = 3000;
    for (const b of [2.7, 3, 4, 6, 10, 30]) {
      const ray = traceRay(r0, inwardAngle(r0, b), { step: 0.12, maxSteps: 200 });
      expect(ray.fate).toBe("escaped");
      // Swept angle minus the half turn of a straight line is the bending.
      // The observer is at r0, not infinity: add back the angle it has not swept yet.
      const bending = ray.phi - Math.PI + Math.asin(b / r0);
      const ref = referenceDeflection(b, 200_000)!;
      expect(Math.abs(bending - ref)).toBeLessThan(2e-3 * Math.max(1, ref));
    }
  });

  it("the coarsest shader step still agrees with the finest", () => {
    for (const r0 of [3, 8, 20]) {
      for (const psi of [1.2, 2.0, 2.6, 2.9]) {
        const fine = traceRay(r0, psi, { step: 0.02, maxSteps: 2000 });
        const coarse = traceRay(r0, psi, { step: 0.22, maxSteps: 60 });
        expect(coarse.fate).toBe(fine.fate);
        if (fine.fate === "escaped") expect(Math.abs(coarse.phi - fine.phi)).toBeLessThan(2e-3);
      }
    }
  });

  it("are captured below the critical impact parameter 3 sqrt(3) GM/c^2, and escape above it", () => {
    expect(B_CRIT).toBeCloseTo(2.598076, 6);
    const r0 = 50;
    const opts = { step: 0.05, maxSteps: 2000 };
    expect(traceRay(r0, inwardAngle(r0, B_CRIT * 0.999), opts).fate).toBe("captured");
    expect(traceRay(r0, inwardAngle(r0, B_CRIT * 1.001), opts).fate).toBe("escaped");
    expect(referenceDeflection(B_CRIT * 0.99)).toBeNull();
    expect(referenceDeflection(B_CRIT * 1.01)).not.toBeNull();
  });

  it("circle at the photon sphere, 1.5 rs", () => {
    // A ray launched sideways from exactly 1.5 rs stays there; a hair outside it leaves, a hair inside it falls.
    const flat = traceRay(R_PHOTON, Math.PI / 2, { step: 0.05, maxSteps: 120 });
    expect(flat.fate).toBe("orbiting");
    expect(flat.radiusAt(5)).toBeCloseTo(1.5, 6);
    expect(traceRay(R_PHOTON + 0.01, Math.PI / 2, { step: 0.05, maxSteps: 2000 }).fate).toBe("escaped");
    expect(traceRay(R_PHOTON - 0.01, Math.PI / 2, { step: 0.05, maxSteps: 2000 }).fate).toBe("captured");
    // And its impact parameter is the critical one.
    expect(impactParameter(R_PHOTON, Math.PI / 2)).toBeCloseTo(B_CRIT, 12);
  });

  it("give the shadow its size: sin(theta) = (b_crit / r) sqrt(1 - rs/r)", () => {
    for (const r0 of [2, 3, 6, 12, 40]) {
      const edge = Math.PI - shadowAngle(r0); // launch angle of the shadow's rim
      const opts = { step: 0.04, maxSteps: 4000 };
      expect(traceRay(r0, edge + 0.002, opts).fate).toBe("captured");
      expect(traceRay(r0, edge - 0.002, opts).fate).toBe("escaped");
    }
    // From far away the shadow is 2.6 times wider than the horizon.
    expect(shadowAngle(1000) * 1000).toBeCloseTo(B_CRIT, 2);
  });

  it("show the far side of the disk: a ray over the top comes down behind the hole", () => {
    // Observer 20 rs out, 10 degrees above the disk plane. A ray passing just
    // over the hole must cross the plane on the far side.
    const r0 = 20;
    const ray = traceRay(r0, inwardAngle(r0, 4), { step: 0.12, maxSteps: 96 });
    const elevation = (10 * Math.PI) / 180;
    // In the ray's plane the disk is met at phi = pi - elevation (the far side).
    const rFar = ray.radiusAt(Math.PI - elevation);
    expect(rFar).not.toBeNull();
    expect(rFar!).toBeGreaterThan(3);
    expect(rFar!).toBeLessThan(12);
  });
});

describe("where things appear", () => {
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  it("matches a straight line far from the hole", () => {
    const cam: Vec3 = [300, 0, 0];
    const target: Vec3 = [300, 40, 10];
    const d = apparentDirection(cam, target);
    const flat = norm([0, 40, 10]);
    expect(d[0]).toBeCloseTo(flat[0], 2);
    expect(d[1]).toBeCloseTo(flat[1], 2);
    expect(d[2]).toBeCloseTo(flat[2], 2);
  });

  it("finds a point behind the hole displaced outward, and tracing that ray hits the point", () => {
    const cam: Vec3 = [15, 0, 0];
    const angle = 2.6; // well round the back
    const rp = 8;
    const target: Vec3 = [rp * Math.cos(angle), rp * Math.sin(angle), 0];
    const d = apparentDirection(cam, target);
    const psi = Math.acos(d[0]); // angle from the outward radial direction
    const ray = traceRay(15, psi, { step: 0.02, maxSteps: 2000 });
    expect(ray.radiusAt(angle)).toBeCloseTo(rp, 3);
    // A straight line would need a smaller angle off the hole's centre.
    const flat = norm([target[0] - 15, target[1], 0]);
    const flatOff = Math.acos(-flat[0]);
    expect(Math.PI - psi).toBeGreaterThan(flatOff);
  });
});
