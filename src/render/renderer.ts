// The WebGL2 pipeline: trace the scene in linear light into a float buffer,
// add the ship, spread the bright parts as bloom, then expose, tone-map and
// grain onto the screen.

import { blackbodyTable } from "../engine/blackbody";
import type { Vec3 } from "../engine/light";
import { buildStarGrid, decodeStars } from "../engine/stars";
import { COPY_FS, DOWN_FS, FINAL_FS, MAX_STEPS, PATH_POINTS, QUAD_VS, SPRITE_FS, SPRITE_VS, TRACE_FS, UP_FS } from "./shaders";

export interface Sprite {
  /** Position in clip space, -1..1. */
  x: number;
  y: number;
  visible: boolean;
  /** Heading on screen, radians. */
  angle: number;
  burn: number;
  plumeAngle: number;
  fade: number;
  /** 1 = normal, 0 = fully reddened. */
  warmth: number;
}

export interface Scene {
  cam: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  /** Tangent of half the vertical field of view. */
  tanY: number;
  /** Far-away time, rs/c: drives the disk's rotation. */
  time: number;
  diskN: Vec3;
  diskX: Vec3;
  diskY: Vec3;
  diskOut: number;
  /** Temperature of the hottest ring as the camera would see it at rest far away, kelvin. */
  tPeak: number;
  orbN: Vec3;
  orbX: Vec3;
  orbY: Vec3;
  /** Predicted path in the orbital plane, flat [x0, y0, x1, y1, ...]. */
  path: Float32Array;
  pathCount: number;
  pathAlpha: number;
  ringAlpha: number;
  homeAlpha: number;
  homeR: number;
  /** Rotation from world to the sky's own frame, column-major 3x3. */
  sky: Float32Array;
  exposure: number;
  ship: Sprite;
  station: Sprite;
  /** 0..1 fade of the whole picture. */
  fade: number;
  grain: number;
  diskGain: number;
  skyGain: number;
}

export interface Quality {
  step: number;
  steps: number;
  bloomLevels: number;
}

export const QUALITY: Record<"low" | "medium" | "high" | "photo", Quality> = {
  low: { step: 0.2, steps: 48, bloomLevels: 5 },
  medium: { step: 0.15, steps: 68, bloomLevels: 6 },
  high: { step: 0.11, steps: 100, bloomLevels: 6 },
  photo: { step: 0.08, steps: MAX_STEPS, bloomLevels: 7 },
};

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;
interface Program {
  prog: WebGLProgram;
  u: Uniforms;
}

export class WebGLUnavailable extends Error {}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly float: boolean;
  readonly gpu: string;
  private trace: Program;
  private sprite: Program;
  private down: Program;
  private up: Program;
  private copy: Program;
  private final: Program;
  private skyTex: WebGLTexture;
  private starTex: WebGLTexture;
  private bbTex: WebGLTexture;
  private noiseTex: WebGLTexture;
  private scene: Target | null = null;
  private chain: Target[] = [];
  private frame = 0;
  private lost = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new WebGLUnavailable("WebGL2 is not available");
    this.gl = gl;
    this.float = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
    gl.getExtension("OES_texture_float_linear");
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));

    this.trace = this.program(QUAD_VS, TRACE_FS);
    this.sprite = this.program(SPRITE_VS, SPRITE_FS);
    this.down = this.program(QUAD_VS, DOWN_FS);
    this.up = this.program(QUAD_VS, UP_FS);
    this.copy = this.program(QUAD_VS, COPY_FS);
    this.final = this.program(QUAD_VS, FINAL_FS);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const p of [this.trace, this.sprite, this.down, this.up, this.copy, this.final]) {
      gl.bindAttribLocation(p.prog, 0, "aPos");
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Placeholder sky until the real one arrives.
    this.skyTex = this.texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([4, 4, 5, 255]), gl.LINEAR, gl.REPEAT);
    this.starTex = this.texture(6, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(24), gl.NEAREST, gl.CLAMP_TO_EDGE);
    const bb = blackbodyTable(256);
    this.bbTex = this.float
      ? this.texture(256, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, bb, gl.LINEAR, gl.CLAMP_TO_EDGE)
      : this.texture(256, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.from(bb, (v) => Math.min(255, v * 80)), gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.noiseTex = this.texture(512, 512, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, tileableNoise(512), gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);

    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => location.reload());
  }

  /** Sky map: an equirectangular image, right ascension increasing to the left. */
  setSky(img: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skyTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setStars(bytes: Uint8Array): number {
    const gl = this.gl;
    const grid = buildStarGrid(decodeStars(bytes));
    gl.bindTexture(gl.TEXTURE_2D, this.starTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid.width, grid.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, grid.data);
    return grid.kept;
  }

  /** Draw one frame to the canvas. `scale` is the fraction of the canvas resolution the scene is traced at. */
  render(s: Scene, q: Quality, scale: number): void {
    if (this.lost) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const w = Math.max(64, Math.round(W * scale));
    const h = Math.max(64, Math.round(H * scale));
    this.ensureTargets(w, h, q.bloomLevels);
    this.frame++;
    this.drawScene(s, q, this.scene!, 0, 0, 1);
    this.bloom(q.bloomLevels);
    this.present(s, null, W, H, (this.frame % 1024) / 1024);
  }

  /**
   * Render a still at any size: many slightly shifted frames averaged in a
   * float buffer, so edges are smooth and the finest rings resolve.
   * Returns top-down RGBA bytes.
   */
  photograph(s: Scene, width: number, height: number, samples: number): Uint8ClampedArray {
    const gl = this.gl;
    const q = QUALITY.photo;
    const one = this.target(width, height, true);
    const sum = this.target(width, height, true);
    const out = this.target(width, height, false);
    const savedScene = this.scene;
    const savedChain = this.chain;
    this.chain = [];
    this.scene = null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, sum.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const n = Math.max(1, samples);
    for (let i = 0; i < n; i++) {
      // Halton (2,3) offsets inside the pixel.
      const jx = n === 1 ? 0 : halton(i + 1, 2) - 0.5;
      const jy = n === 1 ? 0 : halton(i + 1, 3) - 0.5;
      this.drawScene(s, q, one, jx, jy, height / 1080);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sum.fbo);
      gl.viewport(0, 0, width, height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.copy.prog);
      this.bind(0, one.tex, this.copy.u.uTex!);
      gl.uniform1f(this.copy.u.uScale!, 1 / n);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }
    this.scene = sum;
    this.buildChain(width, height, q.bloomLevels);
    this.bloom(q.bloomLevels);
    this.present(s, out, width, height, 0.37);
    const px = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    for (const t of [one, sum, out, ...this.chain]) this.free(t);
    this.chain = savedChain;
    this.scene = savedScene;

    // WebGL rows run bottom-up.
    const flipped = new Uint8ClampedArray(px.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) flipped.set(px.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return flipped;
  }

  /** Largest photograph this device can render, long side in pixels. */
  maxPhotoSide(): number {
    const gl = this.gl;
    return Math.min(4096, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)));
  }

  // ------------------------------------------------------------------ passes

  private drawScene(s: Scene, q: Quality, into: Target, jx: number, jy: number, starScale: number): void {
    const gl = this.gl;
    const u = this.trace.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    gl.viewport(0, 0, into.w, into.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.trace.prog);
    gl.uniform2f(u.uRes!, into.w, into.h);
    gl.uniform2f(u.uJitter!, jx, jy);
    gl.uniform3fv(u.uCam!, s.cam);
    gl.uniform3fv(u.uRight!, s.right);
    gl.uniform3fv(u.uUp!, s.up);
    gl.uniform3fv(u.uFwd!, s.fwd);
    gl.uniform2f(u.uTan!, (s.tanY * into.w) / into.h, s.tanY);
    gl.uniform1f(u.uTime!, s.time);
    gl.uniform3fv(u.uDiskN!, s.diskN);
    gl.uniform3fv(u.uDiskX!, s.diskX);
    gl.uniform3fv(u.uDiskY!, s.diskY);
    gl.uniform1f(u.uDiskOut!, s.diskOut);
    gl.uniform1f(u.uTpeak!, s.tPeak);
    gl.uniform1f(u.uDiskGain!, s.diskGain);
    gl.uniform3fv(u.uOrbN!, s.orbN);
    gl.uniform3fv(u.uOrbX!, s.orbX);
    gl.uniform3fv(u.uOrbY!, s.orbY);
    gl.uniform2fv(u["uPath[0]"]!, s.path);
    gl.uniform1i(u.uPathCount!, Math.min(PATH_POINTS, s.pathCount));
    gl.uniform1f(u.uPathAlpha!, s.pathAlpha);
    gl.uniform1f(u.uRingAlpha!, s.ringAlpha);
    gl.uniform1f(u.uHomeAlpha!, s.homeAlpha);
    gl.uniform1f(u.uHomeR!, s.homeR);
    gl.uniform1f(u.uOverlayGain!, 0.5 / s.exposure);
    gl.uniformMatrix3fv(u.uSky!, false, s.sky);
    gl.uniform1f(u.uSkyGain!, s.skyGain / 6);
    gl.uniform1f(u.uStarGain!, (5.5 * s.skyGain) / (starScale * starScale));
    gl.uniform1f(u.uStarSize!, 0.62 * Math.max(1, starScale));
    gl.uniform1f(u.uStep!, q.step);
    gl.uniform1i(u.uSteps!, q.steps);
    gl.uniform1f(u.uEncode!, this.float ? 0 : 1);
    this.bind(0, this.skyTex, u.uSkyTex!);
    this.bind(1, this.starTex, u.uStarTex!);
    this.bind(2, this.bbTex, u.uBBTex!);
    this.bind(3, this.noiseTex, u.uNoiseTex!);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // The ship and the station, added on top in linear light.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.sprite.prog);
    const su = this.sprite.u;
    gl.uniform1f(su.uEncode!, this.float ? 0 : 1);
    const px = Math.max(1, into.h / 900);
    const draw = (sp: Sprite, kind: number, sizePx: number) => {
      if (!sp.visible || sp.fade <= 0) return;
      gl.uniform2f(su.uCentre!, sp.x, sp.y);
      gl.uniform2f(su.uSize!, (sizePx * px * 2) / into.w, (sizePx * px * 2) / into.h);
      gl.uniform1f(su.uKind!, kind);
      gl.uniform1f(su.uAngle!, sp.angle);
      gl.uniform1f(su.uGain!, 0.42 / s.exposure);
      gl.uniform1f(su.uBurn!, sp.burn);
      gl.uniform1f(su.uPlumeAngle!, sp.plumeAngle);
      gl.uniform1f(su.uFade!, sp.fade);
      gl.uniform3f(su.uTint!, sp.warmth, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    draw(s.station, 1, 9);
    draw(s.ship, 0, 30);
    gl.disable(gl.BLEND);
  }

  private bloom(levels: number): void {
    if (!this.float) return;
    const gl = this.gl;
    const n = Math.min(levels, this.chain.length);
    let src = this.scene!;
    gl.useProgram(this.down.prog);
    for (let i = 0; i < n; i++) {
      const dst = this.chain[i]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      this.bind(0, src.tex, this.down.u.uTex!);
      gl.uniform2f(this.down.u.uTexel!, 1 / src.w, 1 / src.h);
      gl.uniform1f(this.down.u.uFirst!, i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      src = dst;
    }
    // Back up, each level added to the wider one below it.
    gl.useProgram(this.up.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = n - 1; i > 0; i--) {
      const from = this.chain[i]!;
      const dst = this.chain[i - 1]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      this.bind(0, from.tex, this.up.u.uTex!);
      gl.uniform2f(this.up.u.uTexel!, 1 / from.w, 1 / from.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }

  private present(s: Scene, into: Target | null, W: number, H: number, seed: number): void {
    const gl = this.gl;
    const u = this.final.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fbo : null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.final.prog);
    this.bind(0, this.scene!.tex, u.uScene!);
    this.bind(1, (this.chain[0] ?? this.scene!).tex, u.uBloom!);
    gl.uniform1f(u.uExposure!, s.exposure);
    gl.uniform1f(u.uBloomAmount!, this.float && this.chain.length ? 0.085 / Math.max(1, this.chain.length - 1) : 0);
    gl.uniform1f(u.uGrain!, s.grain);
    gl.uniform1f(u.uSeed!, seed);
    gl.uniform1f(u.uVignette!, 0.55);
    gl.uniform1f(u.uEncode!, this.float ? 0 : 1);
    gl.uniform1f(u.uFade!, s.fade);
    gl.uniform2f(u.uOut!, W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ------------------------------------------------------------------ plumbing

  private ensureTargets(w: number, h: number, levels: number): void {
    if (this.scene && this.scene.w === w && this.scene.h === h && this.chain.length === (this.float ? levels : 0)) return;
    if (this.scene) this.free(this.scene);
    for (const t of this.chain) this.free(t);
    this.scene = this.target(w, h, true);
    this.buildChain(w, h, levels);
  }

  private buildChain(w: number, h: number, levels: number): void {
    this.chain = [];
    if (!this.float) return;
    let cw = w;
    let ch = h;
    for (let i = 0; i < levels; i++) {
      cw = Math.max(2, cw >> 1);
      ch = Math.max(2, ch >> 1);
      this.chain.push(this.target(cw, ch, true));
    }
  }

  private target(w: number, h: number, hdr: boolean): Target {
    const gl = this.gl;
    const useFloat = hdr && this.float;
    const tex = this.texture(w, h, useFloat ? gl.RGBA16F : gl.RGBA8, gl.RGBA, useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null, gl.LINEAR, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }

  private free(t: Target): void {
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  private texture(w: number, h: number, internal: number, format: number, type: number, data: ArrayBufferView | null, filter: number, wrap: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private program(vs: string, fs: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Link: ${gl.getProgramInfoLog(prog)}`);
    const u: Uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u };
  }
}

function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * Smooth noise that repeats exactly at its edges, several octaves, in two
 * independent channels. Wrapped once round the disk it has no seam.
 */
export function tileableNoise(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const acc = [new Float32Array(size * size), new Float32Array(size * size)];
  for (let ch = 0; ch < 2; ch++) {
    let amp = 1;
    for (let period = 6; period <= 192; period *= 2) {
      const lattice = Float32Array.from({ length: period * period }, rand);
      const a = acc[ch]!;
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * period;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * period;
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const x1 = (x0 + 1) % period;
          const y1 = (y0 + 1) % period;
          const v00 = lattice[y0 * period + x0]!;
          const v10 = lattice[y0 * period + x1]!;
          const v01 = lattice[y1 * period + x0]!;
          const v11 = lattice[y1 * period + x1]!;
          a[y * size + x]! += amp * (v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy);
        }
      }
      amp *= 0.55;
    }
  }
  for (let ch = 0; ch < 2; ch++) {
    const a = acc[ch]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of a) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (let i = 0; i < a.length; i++) out[i * 4 + ch] = Math.round((255 * (a[i]! - lo)) / (hi - lo));
  }
  for (let i = 0; i < size * size; i++) out[i * 4 + 3] = 255;
  return out;
}
