// Optional built-in soundtrack: an original, procedurally played slow groove with a big reverb tail.
// Nothing is sampled: every sound is synthesised in the browser.
const CHORDS = [ // A minor, F, C, G (root midi, minor?)
  [57, true], [53, false], [60, false], [55, false],
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class BuiltinTrack {
  constructor() { this.ctx = null; this.vol = 0.6; this.playing = false; this.paused = false; this.loaded = true; this.name = 'Built-in track'; }
  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    // reverb: generated impulse response (long, dark tail)
    const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55; this.verb.connect(wet).connect(this.master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(this.master); lp.connect(this.verb);
    this.bus = lp;
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
  }
  env(node, t, a, peak, d) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  voice(type, f, t, dur, peak, dest = this.bus, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = this.ctx.createGain(); this.env(g, t, 0.01, peak, dur); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.1);
  }
  kick(t) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); this.env(g, t, 0.004, 0.9, 0.35); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.5); }
  hit(t, freq, peak, dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2; const g = this.ctx.createGain(); this.env(g, t, 0.002, peak, dur); s.connect(f).connect(g).connect(this.bus); s.start(t); s.stop(t + dur + 0.05); }
  schedule() {
    const ctx = this.ctx, spb = 60 / 74 / 2; // eighth notes at 74 bpm (slowed feel)
    while (this.next < ctx.currentTime + 0.25) {
      const t = this.next, step = this.step % 64, bar = Math.floor(step / 16) % 4, s = step % 16;
      const [root, minor] = CHORDS[bar];
      if (s === 0 || s === 7 || s === 10) this.kick(t);
      if (s === 4 || s === 12) this.hit(t, 1800, 0.35, 0.25);              // soft snare
      if (s % 2 === 1) this.hit(t, 7000, 0.05, 0.05);                       // shaker
      if ([0, 3, 6, 8, 11, 14].includes(s)) this.voice('triangle', mtof(root - 24 + (s === 6 || s === 14 ? 7 : 0)), t, 0.32, 0.32); // bass
      if (s === 0) for (const iv of [0, minor ? 3 : 4, 7, 12]) this.voice('sawtooth', mtof(root + iv), t, spb * 15, 0.035, this.bus, (Math.random() - 0.5) * 14); // pad
      const arp = [0, minor ? 3 : 4, 7, 12, 7, minor ? 3 : 4];
      if (s % 2 === 0 && (this.step >> 6) % 2 === 1) this.voice('sine', mtof(root + 12 + arp[(s / 2) % arp.length]), t, 0.4, 0.08); // pluck lead on alternate loops
      this.next += spb; this.step++;
    }
  }
  play() {
    this.init(); this.ctx.resume?.(); this.stop(true);
    this.next = this.ctx.currentTime + 0.1; this.step = 0; this.playing = true; this.paused = false;
    this.master.gain.setTargetAtTime(this.vol * 0.55, this.ctx.currentTime, 0.4);
    this.timer = setInterval(() => { if (!this.paused) this.schedule(); }, 60);
  }
  pause() { if (!this.playing) return; this.paused = true; this.ctx.suspend?.(); }
  resume() { if (!this.playing) return; this.paused = false; this.ctx.resume?.(); }
  stop(keep) { clearInterval(this.timer); this.timer = null; if (this.ctx && !keep) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); if (!keep) this.playing = false; }
  setVolume(v) { this.vol = v; if (this.ctx && this.playing) this.master.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.1); }
}
