// Builds the two sky files in public/sky from their public sources.
// Run once; the outputs are committed. Needs ffmpeg on the PATH.
//
//   node scripts/build-sky.mjs --exr milkyway_2020_4k.exr --hyg hyg_v44.csv.gz
//
// Sources
//   milkyway_2020_4k.exr  NASA/Goddard Space Flight Center Scientific Visualization Studio,
//                         "Deep Star Maps 2020", https://svs.gsfc.nasa.gov/4851
//                         (Gaia DR2: ESA/Gaia/DPAC). NASA imagery, free to use with credit.
//                         This is the layer without the bright stars: the glow of the
//                         Milky Way and the faint stars only. The bright ones are drawn
//                         from the catalogue, as points.
//   hyg_v44.csv.gz        HYG database v4.4, David Nash, https://codeberg.org/astronexus/hyg
//                         Creative Commons Attribution-ShareAlike 4.0.
//
// Outputs
//   public/sky/milkyway.jpg   the all-sky map, 4096 x 2048, right ascension along x
//                             (0h at the centre, increasing to the left), north up.
//                             Stored with a 2.2 gamma after a fixed gain; the shader undoes both.
//                             An even floor is subtracted first, so empty sky is black.
//   public/sky/stars.bin      every star to magnitude 8: six bytes each (see src/engine/stars.ts).
//                             A derived database, so also CC BY-SA 4.0.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exr = arg("exr");
const hyg = arg("hyg");
const MAG_LIMIT = 8.0;
const SKY_GAIN = 3; // linear value 1/3 maps to white
const SKY_FLOOR = 0.009; // the even haze of unresolved stars, taken off so empty sky is black
const W = 4096;
const H = 2048;

mkdirSync("public/sky", { recursive: true });

// ---------------------------------------------------------------- stars
let stars = [];
if (hyg) {
  const text = gunzipSync(readFileSync(hyg)).toString("utf8");
  const lines = text.split("\n");
  const head = lines[0].replace(/"/g, "").split(",");
  const col = (n) => head.indexOf(n);
  const [iRa, iDec, iMag, iCi, iProper] = [col("ra"), col("dec"), col("mag"), col("ci"), col("proper")];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    if (f.length < head.length) continue;
    if (f[iProper] === "Sol") continue;
    const mag = Number(f[iMag]);
    if (!(mag <= MAG_LIMIT)) continue;
    const ci = f[iCi] === "" ? 0.6 : Number(f[iCi]);
    stars.push({ ra: (Number(f[iRa]) / 24) * 2 * Math.PI, dec: (Number(f[iDec]) * Math.PI) / 180, mag, bv: ci });
  }
  stars.sort((a, b) => a.mag - b.mag);
  const out = new Uint8Array(stars.length * 6);
  const view = new DataView(out.buffer);
  stars.forEach((s, i) => {
    const o = i * 6;
    view.setUint16(o, Math.round((s.ra / (2 * Math.PI)) * 65536) % 65536, true);
    view.setUint16(o + 2, Math.min(65535, Math.round(((s.dec + Math.PI / 2) / Math.PI) * 65535)), true);
    out[o + 4] = Math.max(0, Math.min(255, Math.round((s.mag + 2) * 25)));
    out[o + 5] = Math.max(0, Math.min(255, Math.round((s.bv + 0.5) * 100)));
  });
  writeFileSync("public/sky/stars.bin", out);
  console.log(`stars.bin: ${stars.length} stars to magnitude ${MAG_LIMIT}, ${out.length} bytes`);
}

// ---------------------------------------------------------------- all-sky map
if (exr) {
  const dir = join(tmpdir(), `eh-sky-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, "sky.f32");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", exr, "-f", "rawvideo", "-pix_fmt", "gbrpf32le", raw]);
  const buf = readFileSync(raw);
  const px = new Float32Array(buf.buffer, buf.byteOffset, W * H * 3);
  const G = px.subarray(0, W * H);
  const B = px.subarray(W * H, 2 * W * H);
  const R = px.subarray(2 * W * H);

  // Report the range, and check the orientation against the catalogue: the
  // map must be bright exactly where the brightest stars are.
  const sample = Float32Array.from({ length: 20000 }, (_, i) => G[Math.floor((i / 20000) * W * H)]).sort();
  console.log("green percentiles 50/90/99/99.9:", [0.5, 0.9, 0.99, 0.999].map((q) => sample[Math.floor(q * 19999)].toFixed(4)).join(" "));
  if (stars.length) {
    const at = (ra, dec, flip) => {
      const u = flip ? 0.5 - ra / (2 * Math.PI) : 0.5 + ra / (2 * Math.PI);
      const x = Math.floor((((u % 1) + 1) % 1) * W);
      const y = Math.min(H - 1, Math.floor((0.5 - dec / Math.PI) * H));
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, G[Math.min(H - 1, Math.max(0, y + dy)) * W + ((x + dx + W) % W)]);
      return m;
    };
    for (const flip of [true, false]) {
      let sum = 0;
      for (const s of stars.slice(0, 300)) sum += Math.min(1, at(s.ra, s.dec, flip));
      console.log(`RA ${flip ? "increasing to the left" : "increasing to the right"}: mean brightness at the 300 brightest stars = ${(sum / 300).toFixed(3)}`);
    }
  }

  const rgb = Buffer.alloc(W * H * 3);
  const enc = (v) => Math.round(255 * Math.min(1, Math.max(0, (v - SKY_FLOOR) * SKY_GAIN)) ** (1 / 2.2));
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = enc(R[i]);
    rgb[i * 3 + 1] = enc(G[i]);
    rgb[i * 3 + 2] = enc(B[i]);
  }
  const rawRgb = join(dir, "sky.rgb");
  writeFileSync(rawRgb, rgb);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", rawRgb, "-q:v", arg("q") ?? "8", "-pix_fmt", "yuvj444p", "public/sky/milkyway.jpg"], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) process.exit(1);
  console.log("milkyway.jpg written");
}
