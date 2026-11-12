import { C } from "./engine/constants";
import { HOLES, type Hole, type HoleScale, holeById, holeScale } from "./engine/holes";
import { type Vec3, apparentDirection } from "./engine/light";
import { type Controls, RULES, type Run, breakupRadius, isOver, newRun, resultOf, stepRun, tideGPerM } from "./engine/run";
import { dilation, localSpeed, predictPath } from "./engine/ship";
import { clockFace, clockStyle, duration, kilometres, nf } from "./engine/words";
import { QUALITY, type Quality, Renderer, type Scene, type Sprite, WebGLUnavailable } from "./render/renderer";
import { PATH_POINTS } from "./render/shaders";
import { add, clamp, cross, dot, length, mix, mul, norm, rotate, smooth, sub } from "./render/vec";
import { Sound } from "./ui/audio";
import { showCard } from "./ui/card";
import { buildPhysics } from "./ui/physics";
import { loadStore, saveStore } from "./ui/store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const coarse = matchMedia("(pointer: coarse)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- the world
// The ship flies in the world's x-z plane. The disk is tilted against it, so
// the view of the disk changes all the way round an orbit.
const ORB_N: Vec3 = [0, 1, 0];
const ORB_X: Vec3 = [1, 0, 0];
const ORB_Y: Vec3 = [0, 0, -1];
const TILT = (17 * Math.PI) / 180;
const DISK_N: Vec3 = norm([Math.sin(TILT), Math.cos(TILT), 0]);
const DISK_X: Vec3 = norm(cross(DISK_N, [0, 0, 1]));
const DISK_Y: Vec3 = cross(DISK_N, DISK_X);
const DISK_OUT = 10.5;
const tune = (name: string, fallback: number) => (DEBUG && params.has(name) ? Number(params.get(name)) : fallback);
const LOOK = { tPeak: tune("tp", 5200), diskGain: tune("dg", 0.4), exposure: tune("ex", 0.85), skyGain: tune("sg", 0.8) };

// The sky is the one seen from Earth, turned so the Milky Way crosses behind
// the hole in the opening view. Galactic centre and north galactic pole, J2000.
const SKY = (() => {
  const gc: Vec3 = [-0.0549, -0.4848, 0.8729];
  const ngp: Vec3 = [-0.8677, 0.456, 0.1982];
  const behind = norm(rotate(gc, ngp, (-22 * Math.PI) / 180));
  const x = mul(behind, -1);
  const upRaw = rotate(ngp, behind, (34 * Math.PI) / 180);
  const y = norm(sub(upRaw, mul(x, dot(upRaw, x))));
  const z = cross(x, y);
  return new Float32Array([...x, ...y, ...z]);
})();

const shipPos = (r: number, phi: number): Vec3 => add(mul(ORB_X, r * Math.cos(phi)), mul(ORB_Y, r * Math.sin(phi)));

// ---------------------------------------------------------------- state
const store = loadStore();
let hole: Hole = holeById(params.get("hole") ?? store.hole ?? "sgra");
let scale: HoleScale = holeScale(hole);
let run: Run = newRun();
let worldTime = 40;
let departMs = Date.now();
let readyOffsetMs = 0;
let mode: "fly" | "photo" = "fly";
let view: "chase" | "free" = "chase";
let rings = false;
let ended = false;
let endClock = 0;
let cardShown = false;
let uiHidden = false;
let firstBurnDone = false;
let hintStage = 0;
const controls: Controls = { radial: 0, along: 0 };
const keys = new Set<string>();
const sound = new Sound();
sound.muted = store.mute;

const free = { az: 0.5, el: 0.32, dist: 22 };
const photo = { tanY: Math.tan((26 * Math.PI) / 180), tPeak: LOOK.tPeak, exposure: 1 };
let camPos: Vec3 = [0, 0, 0];
let camLook: Vec3 = [0, 0, 0];
let camReady = false;
let fadeIn = 0;
let skyReady = false;

// ---------------------------------------------------------------- renderer
const canvas = $<HTMLCanvasElement>("view");
let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  const fatal = $("fatal");
  fatal.hidden = false;
  $("fatal-text").textContent =
    err instanceof WebGLUnavailable
      ? "This page traces light around a black hole on your graphics card, and needs WebGL2 to do it. This browser or device does not offer it. Any recent Chrome, Edge, Firefox or Safari will."
      : `The renderer could not start: ${String((err as Error).message ?? err)}`;
  $("credit").hidden = true;
  throw err;
}

type Tier = "low" | "medium" | "high";
let tier: Tier = (params.get("q") as Tier) || (coarse ? "medium" : "high");
let resScale = Number(params.get("scale")) || (coarse ? 0.6 : 0.8);
const fixedQuality = params.has("q") || params.has("scale");

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 2 : 1.5);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
window.addEventListener("resize", resize);
resize();

async function loadSky(): Promise<void> {
  try {
    const [img, stars] = await Promise.all([
      fetch("./sky/milkyway.jpg").then((r) => r.blob()).then((b) => createImageBitmap(b, { colorSpaceConversion: "none" })),
      fetch("./sky/stars.bin").then((r) => r.arrayBuffer()),
    ]);
    renderer.setSky(img);
    renderer.setStars(new Uint8Array(stars));
  } catch {
    // The hole and disk still render against a plain sky.
  }
  skyReady = true;
}
void loadSky();
setTimeout(() => (skyReady = true), 6000);

// ---------------------------------------------------------------- camera
const baseTanY = () => {
  const aspect = canvas.width / canvas.height;
  return Math.tan((25 * Math.PI) / 180) / Math.min(1, aspect ** 0.72);
};

function chaseTarget(): { pos: Vec3; look: Vec3 } {
  const r = Math.max(run.ship.r, 1.02);
  const phi = run.ship.phi;
  const rHat: Vec3 = add(mul(ORB_X, Math.cos(phi)), mul(ORB_Y, Math.sin(phi)));
  const pHat: Vec3 = add(mul(ORB_X, -Math.sin(phi)), mul(ORB_Y, Math.cos(phi)));
  const portrait = canvas.height > canvas.width;
  const back = (portrait ? 2.0 : 1.5) + (portrait ? 0.42 : 0.3) * r;
  const lift = 0.28 + 0.07 * r;
  const pos = add(add(mul(rHat, r + back), mul(ORB_N, lift)), mul(pHat, -(0.25 + 0.035 * r)));
  const look = mul(rHat, r * (portrait ? 0.42 : 0.36));
  return { pos, look };
}

function freeTarget(): { pos: Vec3; look: Vec3 } {
  const ce = Math.cos(free.el);
  const dir: Vec3 = add(add(mul(ORB_X, ce * Math.cos(free.az)), mul(ORB_Y, ce * Math.sin(free.az))), mul(ORB_N, Math.sin(free.el)));
  return { pos: mul(dir, free.dist), look: [0, 0, 0] };
}

function enterFree(): void {
  // Start the free camera where the chase camera is, so nothing jumps.
  const d = length(camPos);
  free.dist = clamp(d, 2.2, 60);
  free.el = Math.asin(clamp(dot(camPos, ORB_N) / d, -1, 1));
  free.az = Math.atan2(dot(camPos, ORB_Y), dot(camPos, ORB_X));
}

function updateCamera(dt: number): void {
  const target = view === "chase" && mode === "fly" && !(ended && run.phase === "horizon") ? chaseTarget() : freeTarget();
  if (!camReady) {
    camPos = target.pos;
    camLook = target.look;
    camReady = true;
  }
  const k = 1 - Math.exp(-dt * (view === "chase" ? 2.6 : 5));
  camPos = mix(camPos, target.pos, k);
  camLook = mix(camLook, target.look, k);
  const d = length(camPos);
  if (d < 1.12) camPos = mul(camPos, 1.12 / d);
}

// ---------------------------------------------------------------- scene
const pathBuf = new Float32Array(PATH_POINTS * 2);
let pathCount = 0;
let pathAge = 99;
const hiddenSprite = (): Sprite => ({ x: 0, y: 0, visible: false, angle: 0, burn: 0, plumeAngle: 0, fade: 1, warmth: 1 });

function basis(): { right: Vec3; up: Vec3; fwd: Vec3 } {
  const fwd = norm(sub(camLook, camPos));
  let right = cross(fwd, ORB_N);
  if (length(right) < 1e-4) right = cross(fwd, ORB_X);
  right = norm(right);
  return { right, up: cross(right, fwd), fwd };
}

interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

function project(p: Vec3, b: { right: Vec3; up: Vec3; fwd: Vec3 }, tanY: number): Projected {
  const d = apparentDirection(camPos, p);
  const z = dot(d, b.fwd);
  if (z <= 0.02) return { x: 0, y: 0, visible: false };
  const aspect = canvas.width / canvas.height;
  const x = dot(d, b.right) / (z * tanY * aspect);
  const y = dot(d, b.up) / (z * tanY);
  return { x, y, visible: Math.abs(x) < 1.1 && Math.abs(y) < 1.1 };
}

function buildScene(dt: number): Scene {
  const b = basis();
  const tanY = mode === "photo" ? photo.tanY : baseTanY();
  const rCam = length(camPos);
  const gCam = 1 / Math.sqrt(1 - 1 / rCam);
  const flying = mode === "fly" && !ended;

  // Predicted path, refreshed a few times a second.
  pathAge += dt;
  if (flying && pathAge > 0.07) {
    pathAge = 0;
    const pts = predictPath(run.ship, PATH_POINTS, 1.1, 26);
    pathCount = Math.min(PATH_POINTS, pts.length);
    for (let i = 0; i < pathCount; i++) {
      pathBuf[i * 2] = pts[i]!.x;
      pathBuf[i * 2 + 1] = pts[i]!.y;
    }
  }

  const ship = hiddenSprite();
  const station = hiddenSprite();
  if (mode === "fly") {
    const r = Math.max(run.ship.r, 1.004);
    const pos = shipPos(r, run.ship.phi);
    const pr = project(pos, b, tanY);
    const phi = run.ship.phi;
    const rHat: Vec3 = add(mul(ORB_X, Math.cos(phi)), mul(ORB_Y, Math.sin(phi)));
    const pHat: Vec3 = add(mul(ORB_X, -Math.sin(phi)), mul(ORB_Y, Math.cos(phi)));
    const vel = add(mul(rHat, run.ship.vr), mul(pHat, run.ship.r * run.ship.vphi));
    const aspect = canvas.width / canvas.height;
    ship.x = pr.x;
    ship.y = pr.y;
    ship.visible = pr.visible;
    ship.angle = Math.atan2(dot(vel, b.up), dot(vel, b.right) * 1) + 0 * aspect;
    const burning = flying && run.fuel > 0 && Math.hypot(controls.radial, controls.along) > 0.05;
    if (burning) {
      const th = add(mul(rHat, controls.radial), mul(pHat, controls.along));
      ship.burn = 1;
      ship.plumeAngle = Math.atan2(-dot(th, b.up), -dot(th, b.right));
    }
    if (ended) {
      if (run.phase === "horizon") {
        // What the station sees: the ship slows, reddens and fades, never crossing.
        ship.warmth = clamp(1 - endClock / 2.5);
        ship.fade = Math.exp(-endClock / 2.2);
      } else if (run.phase === "torn") {
        ship.fade = clamp(1 - endClock / 0.5);
      }
    }
    const st = project(shipPos(RULES.homeR, stationPhi()), b, tanY);
    station.x = st.x;
    station.y = st.y;
    station.visible = st.visible;
  }

  const showHome = flying && run.phase === "flying" ? 1 : flying ? 0.45 : 0;
  return {
    cam: camPos,
    ...b,
    tanY,
    time: worldTime,
    diskN: DISK_N,
    diskX: DISK_X,
    diskY: DISK_Y,
    diskOut: DISK_OUT,
    tPeak: mode === "photo" ? photo.tPeak : LOOK.tPeak,
    orbN: ORB_N,
    orbX: ORB_X,
    orbY: ORB_Y,
    path: pathBuf,
    pathCount,
    pathAlpha: flying ? 1 : 0,
    ringAlpha: mode === "fly" && rings ? 1 : 0,
    homeAlpha: showHome,
    homeR: RULES.homeR,
    sky: SKY,
    exposure: (LOOK.exposure * (mode === "photo" ? photo.exposure : 1)) / gCam ** 3,
    ship,
    station,
    fade: smooth(fadeIn),
    grain: 0.02,
    diskGain: LOOK.diskGain,
    skyGain: LOOK.skyGain,
  };
}

/** The station keeps its circular orbit; this is where it is now. */
function stationPhi(): number {
  return 0.35 + worldTime * Math.sqrt(0.5 / RULES.homeR ** 3);
}

// ---------------------------------------------------------------- the interface
const ui = $("ui");
const hint = $("hint");
const ghost = $("ghost");
const el = {
  shipTime: $("ship-time"),
  shipDate: $("ship-date"),
  earthTime: $("earth-time"),
  earthDate: $("earth-date"),
  gap: $("gap"),
  r: $("d-r"),
  km: $("d-km"),
  v: $("d-v"),
  kms: $("d-kms"),
  g: $("d-g"),
  tide: $("d-tide"),
  tideGauge: $("g-tide"),
  fuel: $("b-fuel"),
  air: $("b-air"),
  holes: $("holes"),
  labels: $("labels"),
  fps: $("fps"),
};

function sci(x: number): string {
  if (x === 0) return "0";
  if (x >= 0.01 && x < 100_000) return nf(x, x < 1 ? 3 : x < 100 ? 1 : 0);
  const e = Math.floor(Math.log10(x));
  const sup = String(e).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]!);
  return `${(x / 10 ** e).toFixed(1)} × 10${sup}`;
}

function buildHoles(): void {
  el.holes.textContent = "";
  for (const h of HOLES) {
    const b = document.createElement("button");
    b.className = "hole";
    b.type = "button";
    b.textContent = h.name;
    b.setAttribute("aria-pressed", String(h.id === hole.id));
    b.addEventListener("click", () => {
      if (h.id === hole.id) return;
      setHole(h);
    });
    el.holes.append(b);
  }
  const fact = document.createElement("span");
  fact.className = "hole-fact";
  fact.textContent = `${hole.massNote.split(",")[0]} · one radius is ${kilometres(scale.rsM)}`;
  el.holes.append(fact);
}

function setHole(h: Hole): void {
  hole = h;
  scale = holeScale(h);
  store.hole = h.id;
  saveStore(store);
  buildHoles();
  restart();
}

function setHint(html: string): void {
  if (hint.dataset.text === html) return;
  hint.dataset.text = html;
  hint.classList.remove("on");
  window.setTimeout(
    () => {
      hint.innerHTML = html;
      if (html) hint.classList.add("on");
    },
    hint.innerHTML ? 500 : 0,
  );
}

const firstLine = coarse
  ? "Drag left and hold to fall. Drag right to climb."
  : "Hold <kbd>←</kbd> to fall towards it. Hold <kbd>→</kbd> to climb.";

function updateHints(): void {
  if (mode !== "fly" || ended) return setHint("");
  if (run.phase === "ready") {
    setHint(firstLine);
    ghost.classList.toggle("on", !store.seen && fadeIn > 0.8);
    return;
  }
  ghost.classList.remove("on");
  const r = run.ship.r;
  if (run.fuel <= 0 && hintStage < 9) return setHint("The tanks are empty. The orbit you have is the one you keep.");
  if (run.air < RULES.air * 0.2 && r < RULES.homeGate) return setHint("Air is running low. Climb past the dashed ring.");
  if (store.runs >= 2) return setHint("");
  if (hintStage === 0 && r < 11.2) hintStage = 1;
  if (hintStage === 1 && r < 7.5) hintStage = 2;
  if (hintStage === 2 && run.ship.vr > 0 && r > 5) hintStage = 3;
  if (hintStage === 1) return setHint("Let go and you coast. The line shows where.");
  if (hintStage === 2) return setHint("The lower you go, the slower your clock runs against Earth’s.");
  if (hintStage === 3) return setHint("Climb back past the dashed ring to go home.");
  setHint(firstLine);
}

let dialClock = 0;
function updateHud(dt: number): void {
  const style = clockStyle(scale.rsOverC);
  const k = scale.rsOverC * 1000;
  const shipMs = departMs + (run.phase === "ready" ? readyOffsetMs : run.ship.tau * k);
  const earthMs = departMs + (run.phase === "ready" ? readyOffsetMs : run.ship.t * k);
  const sf = clockFace(shipMs, style);
  const ef = clockFace(earthMs, style);
  el.shipTime.textContent = sf.time;
  el.shipDate.textContent = sf.date;
  el.earthTime.textContent = ef.time;
  el.earthDate.textContent = ef.date;

  dialClock += dt;
  if (dialClock < 0.09) return;
  dialClock = 0;
  const s = run.ship;
  const r = Math.max(s.r, 1);
  const rate = s.r > 1.0005 ? dilation(s) : Infinity;
  const gapS = (s.t - s.tau) * scale.rsOverC;
  el.gap.textContent =
    run.phase === "ready"
      ? "The clocks agree. For now."
      : Number.isFinite(rate)
        ? `Earth is ${duration(gapS)} ahead of you`
        : "Earth’s clock has left you behind";
  el.r.textContent = nf(r, 2);
  el.km.textContent = `${kilometres((r - 1) * scale.rsM)} above the horizon`;
  const v = s.r > 1 ? localSpeed(s) : 1;
  el.v.textContent = nf(v, 3);
  el.kms.textContent = `${nf((v * C) / 1000)} km/s`;
  el.g.textContent = Number.isFinite(rate) ? `×${nf(rate, rate < 10 ? 2 : 1)}` : "×∞";
  el.g.parentElement!.parentElement!.classList.toggle("hot", rate > 1.3);
  const tide = tideGPerM(r, scale);
  el.tide.textContent = sci(tide);
  const frac = clamp(Math.log10(Math.max(tide, 1e-10) / 1e-10) / Math.log10(RULES.hullGPerM / 1e-10));
  (el.tideGauge.firstElementChild as HTMLElement).style.width = `${(frac * 100).toFixed(1)}%`;
  el.tideGauge.classList.toggle("hot", frac > 0.9);
  (el.fuel.firstElementChild as HTMLElement).style.transform = `scaleX(${run.fuel.toFixed(3)})`;
  el.fuel.classList.toggle("low", run.fuel < 0.2);
  (el.air.firstElementChild as HTMLElement).style.transform = `scaleX(${(run.air / RULES.air).toFixed(3)})`;
  el.air.classList.toggle("low", run.air < RULES.air * 0.2);
  el.holes.classList.toggle("locked", run.phase === "flying");
  updateHints();
}

// Names for the rings, pinned to where each ring appears through the bent light.
const RING_LABELS: Array<{ r: number; text: string; node?: HTMLSpanElement }> = [
  { r: 1.012, text: "Event horizon" },
  { r: 1.5, text: "Photon sphere · 1.5" },
  { r: 3, text: "Innermost stable orbit · 3" },
  { r: RULES.homeR, text: "Station orbit · 12" },
];
function updateLabels(scene: Scene): void {
  const show = mode === "fly" && rings && !ended;
  const camAz = Math.atan2(dot(camPos, ORB_Y), dot(camPos, ORB_X));
  RING_LABELS.forEach((l, i) => {
    if (!l.node) {
      l.node = document.createElement("span");
      l.node.textContent = l.text;
      el.labels.append(l.node);
    }
    if (!show) return l.node.classList.remove("on");
    const p = project(shipPos(l.r, camAz + 0.55 + i * 0.16), scene, scene.tanY);
    l.node.classList.toggle("on", p.visible);
    if (p.visible) {
      const x = (p.x * 0.5 + 0.5) * canvas.clientWidth;
      const y = (0.5 - p.y * 0.5) * canvas.clientHeight;
      l.node.style.transform = `translate(${x.toFixed(1)}px, ${(y - 9).toFixed(1)}px)`;
    }
  });
}

// ---------------------------------------------------------------- run control
function restart(): void {
  run = newRun();
  run.ship.phi = Math.random() * 0.01;
  departMs = Date.now();
  readyOffsetMs = 0;
  ended = false;
  endClock = 0;
  cardShown = false;
  hintStage = 0;
  view = "chase";
  camReady = false;
  $("card").hidden = true;
  $("t-view").textContent = "Orbit view";
  ui.classList.remove("away");
  $("credit").classList.remove("away");
}

function finish(): void {
  ended = true;
  endClock = 0;
  store.runs++;
  if (run.phase === "home") sound.chime();
  if (run.phase === "horizon") {
    // Cut to the view from outside.
    enterFree();
    free.dist = Math.max(free.dist, 13);
    free.el = Math.max(free.el, 0.3);
    view = "free";
  }
  if (run.phase === "torn") {
    const f = document.createElement("div");
    f.className = "flash";
    document.body.append(f);
    setTimeout(() => f.remove(), 600);
  }
  saveStore(store);
}

function maybeShowCard(): void {
  if (!ended || cardShown) return;
  const wait = run.phase === "horizon" ? 4.2 : 1.4;
  if (endClock < wait) return;
  cardShown = true;
  const result = resultOf(run, scale);
  const prev = store.best[hole.id];
  const isBest = result.phase === "home" && (!prev || result.stolenS > prev.stolenS);
  if (isBest) {
    store.best[hole.id] = { stolenS: result.stolenS, ratio: result.ratio };
    saveStore(store);
  }
  ui.classList.add("away");
  $("credit").classList.add("away");
  showCard({ result, hole, departMs, best: store.best[hole.id], isBest, breakup: breakupRadius(scale), canvas, redraw: () => frame(0), onAgain: restart });
}

// ---------------------------------------------------------------- input
function readControls(): void {
  let along = 0;
  let radial = 0;
  if (keys.has("ArrowLeft") || keys.has("a")) along -= 1;
  if (keys.has("ArrowRight") || keys.has("d")) along += 1;
  if (keys.has("ArrowUp") || keys.has("w")) radial -= 1;
  if (keys.has("ArrowDown") || keys.has("s")) radial += 1;
  if (along || radial) {
    controls.along = along;
    controls.radial = radial;
  } else if (!drag.thrust) {
    controls.along = 0;
    controls.radial = 0;
  }
}

const drag = { active: false, thrust: false, x0: 0, y0: 0, lastX: 0, lastY: 0 };
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;

canvas.addEventListener("pointerdown", (e) => {
  sound.wake();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    return;
  }
  drag.active = true;
  drag.x0 = drag.lastX = e.clientX;
  drag.y0 = drag.lastY = e.clientY;
  canvas.classList.add("dragging");
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinch > 0 && (mode === "photo" || view === "free")) free.dist = clamp((free.dist * pinch) / d, 1.6, 70);
    pinch = d;
    return;
  }
  if (!drag.active) return;
  const steer = mode === "photo" || view === "free" || ended;
  if (steer) {
    free.az -= (e.clientX - drag.lastX) * 0.006;
    free.el = clamp(free.el + (e.clientY - drag.lastY) * 0.005, -1.45, 1.45);
  } else {
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    const d = Math.hypot(dx, dy);
    if (d > 14) {
      drag.thrust = true;
      controls.along = dx / d;
      controls.radial = dy / d;
    } else if (drag.thrust) {
      controls.along = 0;
      controls.radial = 0;
    }
  }
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
});

const release = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinch = 0;
  if (pointers.size > 0) return;
  drag.active = false;
  drag.thrust = false;
  controls.along = 0;
  controls.radial = 0;
  canvas.classList.remove("dragging");
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (mode !== "photo" && view !== "free") return;
    free.dist = clamp(free.dist * Math.exp(e.deltaY * 0.0012), 1.6, 70);
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k.startsWith("Arrow") || "wasd".includes(k)) {
    sound.wake();
    keys.add(k);
    if (k.startsWith("Arrow")) e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (k === "Escape") {
    if (!$("physics").hidden) togglePhysics(false);
    else if (mode === "photo") setPhoto(false);
  } else if (k === "m") toggleMute();
  else if (k === "r") toggleRings();
  else if (k === "v") toggleView();
  else if (k === "p") setPhoto(mode !== "photo");
  else if (k === "h" && mode === "photo") {
    uiHidden = !uiHidden;
    $("photo-bar").classList.toggle("away", uiHidden);
  } else if ((k === " " || k === "Enter") && cardShown) restart();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener("blur", () => keys.clear());

function toggleMute(): void {
  sound.wake();
  store.mute = !store.mute;
  sound.setMuted(store.mute);
  $("t-mute").setAttribute("aria-pressed", String(store.mute));
  $("t-mute").setAttribute("aria-label", store.mute ? "Unmute sound" : "Mute sound");
  saveStore(store);
}
function toggleRings(): void {
  rings = !rings;
  $("t-rings").setAttribute("aria-pressed", String(rings));
}
function toggleView(): void {
  if (mode !== "fly" || ended) return;
  if (view === "chase") {
    enterFree();
    free.dist = Math.max(free.dist * 1.25, 14);
    free.el = Math.max(free.el, 0.45);
    view = "free";
  } else view = "chase";
  $("t-view").textContent = view === "chase" ? "Orbit view" : "Chase view";
}
function togglePhysics(open: boolean): void {
  const sheet = $("physics");
  if (open && !sheet.dataset.built) {
    buildPhysics($("physics-body"), hole);
    sheet.dataset.built = "1";
  }
  sheet.hidden = !open;
}

function setPhoto(on: boolean): void {
  if (on === (mode === "photo")) return;
  if (on) {
    if (view === "chase" || ended) enterFree();
    photo.tanY = baseTanY();
    ($("p-fov") as HTMLInputElement).value = String(Math.round((2 * Math.atan(photo.tanY) * 180) / Math.PI));
    mode = "photo";
    uiHidden = false;
  } else {
    mode = "fly";
    if (!ended) view = "chase";
  }
  $("photo-bar").hidden = !on;
  $("photo-bar").classList.remove("away");
  ui.classList.toggle("away", on || cardShown);
  $("credit").classList.toggle("away", on || cardShown);
  $("card").hidden = on || !cardShown;
}

$("t-mute").addEventListener("click", toggleMute);
$("t-mute").setAttribute("aria-pressed", String(store.mute));
$("t-rings").addEventListener("click", toggleRings);
$("t-view").addEventListener("click", toggleView);
$("t-photo").addEventListener("click", () => setPhoto(true));
$("t-physics").addEventListener("click", () => togglePhysics(true));
$("physics-close").addEventListener("click", () => togglePhysics(false));
$("p-done").addEventListener("click", () => setPhoto(false));
$<HTMLInputElement>("p-fov").addEventListener("input", (e) => {
  photo.tanY = Math.tan((Number((e.target as HTMLInputElement).value) * Math.PI) / 360);
});
$<HTMLInputElement>("p-temp").addEventListener("input", (e) => {
  photo.tPeak = 2500 * 12 ** (Number((e.target as HTMLInputElement).value) / 100);
});
$<HTMLInputElement>("p-exp").addEventListener("input", (e) => {
  photo.exposure = 2 ** ((Number((e.target as HTMLInputElement).value) - 50) / 22);
});
$("p-save").addEventListener("click", () => void savePhoto());

async function savePhoto(): Promise<void> {
  const btn = $<HTMLButtonElement>("p-save");
  btn.disabled = true;
  btn.textContent = "Developing…";
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 30));
  try {
    const aspect = canvas.width / canvas.height;
    const side = Math.min(renderer.maxPhotoSide(), Number(params.get("photo")) || (coarse ? 2560 : 3840));
    const w = aspect >= 1 ? side : Math.round(side * aspect);
    const h = aspect >= 1 ? Math.round(side / aspect) : side;
    const scene = { ...buildScene(0), pathAlpha: 0, ringAlpha: 0, homeAlpha: 0, ship: hiddenSprite(), station: hiddenSprite(), fade: 1, grain: 0.012 };
    const px = renderer.photograph(scene, w, h, coarse ? 6 : 12);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d")!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
    if (blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `event-horizon-${hole.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      lastPhoto = { w, h, blob };
    }
    const f = document.createElement("div");
    f.className = "flash";
    document.body.append(f);
    setTimeout(() => f.remove(), 600);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save photo";
  }
}
let lastPhoto: { w: number; h: number; blob: Blob } | null = null;

// ---------------------------------------------------------------- the loop
let last = performance.now();
let ema = 16.7;
let refresh = 16.7;
let warm = 0;
let adaptClock = 0;
let goodChecks = 0;

function adapt(dtMs: number): void {
  ema += (Math.min(dtMs, 100) - ema) * 0.08;
  warm += dtMs;
  if (warm < 1500) {
    refresh = Math.max(6.9, Math.min(refresh, dtMs));
    return;
  }
  if (fixedQuality || mode === "photo") return;
  adaptClock += dtMs;
  if (adaptClock < 500) return;
  adaptClock = 0;
  const budget = Math.max(refresh, 1000 / 61) * 1.12;
  if (ema > budget) {
    goodChecks = 0;
    resScale = Math.max(0.34, resScale * (ema > budget * 1.5 ? 0.78 : 0.9));
    if (resScale <= 0.5 && tier !== "low") {
      tier = tier === "high" ? "medium" : "low";
      resScale = 0.62;
    }
  } else if (ema < budget * 0.93 && ++goodChecks >= 3) {
    goodChecks = 0;
    if (resScale < 1) resScale = Math.min(1, resScale * 1.06);
    else if (tier !== "high" && !coarse) tier = tier === "low" ? "medium" : "high";
  }
}

function frame(dtReal: number): void {
  const dt = Math.min(dtReal, 0.05);
  readControls();
  if (skyReady) fadeIn = Math.min(1, fadeIn + dt / 1.6);

  if (mode === "fly") {
    const before = run.phase;
    if (!ended) {
      const dtau = dt * RULES.rate;
      const rate = run.ship.r > 1.001 ? dilation(run.ship) : 1;
      run = stepRun(run, dtau, controls, scale);
      worldTime += dtau * Math.min(rate, 8);
      if (run.phase === "ready") readyOffsetMs += dtau * rate * scale.rsOverC * 1000;
      if (before === "ready" && run.phase === "flying") {
        // Departure: both clocks read the same instant.
        departMs += readyOffsetMs;
        firstBurnDone = true;
        if (!store.seen) {
          store.seen = true;
          saveStore(store);
        }
      }
      if (isOver(run.phase)) finish();
    } else {
      endClock += dt;
      worldTime += dt * RULES.rate;
      maybeShowCard();
    }
  }

  updateCamera(dt);
  const scene = buildScene(dt);
  const q: Quality = QUALITY[tier];
  renderer.render(scene, mode === "photo" && !fixedQuality ? QUALITY.high : q, resScale);
  updateHud(dt);
  updateLabels(scene);

  const depth = clamp((RULES.homeR - run.ship.r) / (RULES.homeR - 1));
  const burning = !ended && run.fuel > 0 && Math.hypot(controls.along, controls.radial) > 0.05 ? 1 : 0;
  const silent = ended && run.phase === "horizon";
  sound.update(dt, depth, burning, run.ship.r > 1.001 ? dilation(run.ship) : 1, !silent && mode === "fly" && !document.hidden, run.phase === "flying" && !ended);
}

function loop(now: number): void {
  const dtMs = now - last;
  last = now;
  if (!document.hidden) {
    adapt(dtMs);
    frame(dtMs / 1000);
    if (DEBUG) el.fps.textContent = `${(1000 / ema).toFixed(0)} fps  ${ema.toFixed(1)} ms\n${tier}  scale ${resScale.toFixed(2)}\n${Math.round(canvas.width * resScale)}×${Math.round(canvas.height * resScale)}\n${renderer.gpu}`;
  }
  requestAnimationFrame(loop);
}

buildHoles();
ui.hidden = false;
if (DEBUG) {
  el.fps.hidden = false;
  (window as unknown as Record<string, unknown>).__eh = {
    get run() {
      return run;
    },
    get stats() {
      return { ema, tier, resScale, gpu: renderer.gpu, w: canvas.width, h: canvas.height, float: renderer.float, view, mode, ended, cardShown, firstBurnDone, lastPhoto };
    },
    controls,
    free,
    photo,
    setPhoto,
    savePhoto,
    restart,
    frame,
  };
}
if (reducedMotion) ghost.remove();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(loop);
});
