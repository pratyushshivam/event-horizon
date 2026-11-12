// Sound, made on the spot with WebAudio. A deep bed that swells as the ship
// goes lower, the engine as filtered noise, and two ticks: one for the ship's
// second, one for Earth's. As the clocks pull apart, so do the ticks.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private engine: GainNode | null = null;
  private oscs: OscillatorNode[] = [];
  private shipPhase = 0;
  private earthPhase = 0;
  muted = false;

  /** Must be called from a user gesture the first time. */
  wake(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // The bed: three slow, slightly detuned low tones through a low-pass.
    const bed = ctx.createGain();
    bed.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    filter.Q.value = 0.7;
    for (const [freq, type, gain] of [
      [41.2, "sine", 0.9],
      [61.9, "triangle", 0.34],
      [82.9, "sawtooth", 0.1],
      [123.1, "sine", 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = freq * 0.006;
      lfo.connect(lg).connect(o.frequency);
      lfo.start();
      o.connect(g).connect(filter);
      o.start();
      this.oscs.push(o);
    }
    filter.connect(bed).connect(master);
    this.bed = bed;
    this.bedFilter = filter;

    // The engine: brown-ish noise through a band-pass.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03;
      data[i] = last * 4;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 240;
    band.Q.value = 0.6;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    noise.connect(band).connect(eg).connect(master);
    noise.start();
    this.engine = eg;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /**
   * Called every frame.
   * depth: 0 at the station, 1 at the horizon. burn: 0..1. dt: real seconds.
   * rate: dt(Earth)/dt(ship). live: false silences everything (the horizon).
   */
  update(dt: number, depth: number, burn: number, rate: number, live: boolean, ticking: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.bed || !this.bedFilter || !this.engine) return;
    const now = ctx.currentTime;
    this.bed.gain.setTargetAtTime(live ? 0.1 + 0.42 * depth : 0, now, live ? 0.6 : 0.25);
    this.bedFilter.frequency.setTargetAtTime(110 + 520 * depth * depth, now, 0.5);
    for (let i = 0; i < this.oscs.length; i++) {
      const base = [41.2, 61.9, 82.9, 123.1][i]!;
      this.oscs[i]!.frequency.setTargetAtTime(base * (1 - 0.22 * depth), now, 0.8);
    }
    this.engine.gain.setTargetAtTime(live ? 0.22 * burn : 0, now, 0.06);
    if (!live || !ticking) return;
    // One tick per second of each clock, as the pilot hears them.
    this.shipPhase += dt;
    this.earthPhase += dt * Math.min(rate, 12);
    if (this.shipPhase >= 1) {
      this.shipPhase %= 1;
      this.tick(1480, 0.05);
    }
    if (this.earthPhase >= 1) {
      this.earthPhase %= 1;
      this.tick(880, 0.07);
    }
  }

  private tick(freq: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.09);
  }

  /** A soft rising chord for coming home. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    [220, 277.2, 329.6, 440].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.09, t + i * 0.09 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 1.8);
      o.connect(g).connect(this.master!);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 2);
    });
  }
}
