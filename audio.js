// Synthesised rotor "whop" + turbine whine.
export class RotorAudio {
  constructor() { this.ctx = null; this.vol = 0.6; }
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); this.ctx = ctx;
      const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 4; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 420;
      const am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 20;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.45; lfo.connect(lfoGain).connect(am.gain);
      const whine = ctx.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 300;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 4;
      const wg = ctx.createGain(); wg.gain.value = 0.05;
      const master = ctx.createGain(); master.gain.value = 0;
      src.connect(bp).connect(am).connect(master); whine.connect(wf).connect(wg).connect(master);
      master.connect(ctx.destination);
      src.start(); lfo.start(); whine.start();
      Object.assign(this, { master, lfo, whine, wf, bp });
    } catch (e) { this.ctx = null; }
  }
  update(rpm, load) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.lfo.frequency.setTargetAtTime(4 + rpm * 24 + load * 2, t, 0.1);
    this.whine.frequency.setTargetAtTime(120 + rpm * 520 + load * 60, t, 0.1);
    this.wf.frequency.setTargetAtTime(400 + rpm * 1200, t, 0.1);
    this.bp.frequency.setTargetAtTime(200 + rpm * 300 + load * 250, t, 0.1);
    this.master.gain.setTargetAtTime(this.vol * rpm * (0.55 + load * 0.25), t, 0.08);
  }
  mute() { if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }
}
