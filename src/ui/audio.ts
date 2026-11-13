// Sound, made on the spot with WebAudio. A deep bed that swells and sinks as
// you go lower; over it, closer in, a cold cluster of voices a semitone apart
// and a howl of filtered noise; the engine; and two ticks, one for the ship's
// second, one for Earth's. Inside the horizon there is nothing at all.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private engine: GainNode | null = null;
  private voices: GainNode | null = null;
  private voiceOscs: OscillatorNode[] = [];
  private howl: GainNode | null = null;
  private howlBand: BiquadFilterNode | null = null;
  private pulse: OscillatorNode | null = null;
  private pulseDepth: GainNode | null = null;
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

    // The voices: pairs of tones a semitone and a tritone apart, each wavering
    // slowly, so they beat against each other and never settle.
    const voices = ctx.createGain();
    voices.gain.value = 0;
    const voiceTone = ctx.createBiquadFilter();
    voiceTone.type = "lowpass";
    voiceTone.frequency.value = 1400;
    for (const [freq, gain] of [
      [155.6, 0.5],
      [164.8, 0.42],
      [220.0, 0.3],
      [311.1, 0.2],
      [329.6, 0.16],
      [466.2, 0.07],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.16;
      const lg = ctx.createGain();
      lg.gain.value = gain * 0.6;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      const drift = ctx.createOscillator();
      drift.frequency.value = 0.03 + Math.random() * 0.05;
      const dg = ctx.createGain();
      dg.gain.value = freq * 0.012;
      drift.connect(dg).connect(o.frequency);
      drift.start();
      o.connect(g).connect(voiceTone);
      o.start();
      this.voiceOscs.push(o);
    }
    voiceTone.connect(voices).connect(master);
    this.voices = voices;

    // The howl: the same noise through a narrow, wandering band.
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    wind.playbackRate.value = 1.7;
    const howlBand = ctx.createBiquadFilter();
    howlBand.type = "bandpass";
    howlBand.frequency.value = 420;
    howlBand.Q.value = 9;
    const wander = ctx.createOscillator();
    wander.frequency.value = 0.11;
    const wg = ctx.createGain();
    wg.gain.value = 140;
    wander.connect(wg).connect(howlBand.frequency);
    wander.start();
    const hg = ctx.createGain();
    hg.gain.value = 0;
    wind.connect(howlBand).connect(hg).connect(master);
    wind.start();
    this.howl = hg;
    this.howlBand = howlBand;

    // A slow pulse on the bed, quickening as you go in.
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 0.4;
    const pd = ctx.createGain();
    pd.gain.value = 0;
    pulse.connect(pd).connect(bed.gain);
    pulse.start();
    this.pulse = pulse;
    this.pulseDepth = pd;
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
    this.bed.gain.setTargetAtTime(live ? 0.1 + 0.42 * depth : 0, now, live ? 0.6 : 0.05);
    this.bedFilter.frequency.setTargetAtTime(110 + 520 * depth * depth, now, 0.5);
    for (let i = 0; i < this.oscs.length; i++) {
      const base = [41.2, 61.9, 82.9, 123.1][i]!;
      this.oscs[i]!.frequency.setTargetAtTime(base * (1 - 0.22 * depth), now, 0.8);
    }
    this.engine.gain.setTargetAtTime(live ? 0.22 * burn : 0, now, 0.06);
    if (this.voices && this.howl && this.howlBand && this.pulse && this.pulseDepth) {
      const near = Math.max(0, (depth - 0.25) / 0.75);
      const quick = live ? 0.7 : 0.05;
      this.voices.gain.setTargetAtTime(live ? 0.16 * near ** 1.6 : 0, now, quick);
      this.howl.gain.setTargetAtTime(live ? 1.5 * near ** 2.2 : 0, now, quick);
      this.howlBand.frequency.setTargetAtTime(380 + 520 * near, now, 1.2);
      this.pulse.frequency.setTargetAtTime(0.35 + 1.5 * near * near, now, 1);
      this.pulseDepth.gain.setTargetAtTime(live ? 0.16 * near : 0, now, quick);
      // The whole cluster sinks in pitch as you go deeper, like the light.
      const sink = 1 - 0.2 * near;
      const base = [155.6, 164.8, 220.0, 311.1, 329.6, 466.2];
      for (let i = 0; i < this.voiceOscs.length; i++) this.voiceOscs[i]!.frequency.setTargetAtTime(base[i]! * sink, now, 1.5);
    }
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
