// Opening sequence: a 2D Black Hawk lands on a helipad, then a 3-note rising chime reveals the BHS logo,
// with notes 2 and 3 echoing away. Browsers only allow sound after a tap, so it starts on "Tap to start".
const $ = (id) => document.getElementById(id);

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const out = ctx.createGain(); out.gain.value = 1.15; out.connect(ctx.destination);
    // feedback echo for notes 2 and 3 (darkens and fades each repeat)
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.58;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    delay.connect(tone).connect(fb).connect(delay); tone.connect(wet).connect(out);
    // piano-like voice: hammer click, slightly stretched harmonics, two-stage decay, brightness that fades
    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); }
    const piano = (f, t, echo) => {
      const bus = ctx.createGain(); bus.gain.value = 1;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(Math.min(9000, f * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 2), t + 1.6);
      bus.connect(lp); lp.connect(out); if (echo) lp.connect(delay);
      const parts = [[1, 0.42], [2, 0.22], [3, 0.11], [4, 0.07], [5, 0.035], [6, 0.02]];
      for (const [n, amp] of parts) {
        for (const det of [-1.2, 1.2]) { // two slightly detuned strings per note
          const o = ctx.createOscillator(); o.type = 'sine';
          o.frequency.value = f * n * Math.sqrt(1 + 0.00035 * n * n); o.detune.value = det;
          const g = ctx.createGain(); const a = amp * 0.5;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.006);
          g.gain.exponentialRampToValueAtTime(a * 0.35, t + 0.25 / n + 0.12); // fast initial drop
          g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 / Math.sqrt(n)); // long tail
          o.connect(g).connect(bus); o.start(t); o.stop(t + 2.7);
        }
      }
      const h = ctx.createBufferSource(); h.buffer = noise; const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = f * 4; hf.Q.value = 1.5;
      const hg = ctx.createGain(); hg.gain.value = 0.08; h.connect(hf).connect(hg).connect(bus); h.start(t);
    };
    const t0 = ctx.currentTime + 0.05;
    return { ctx, play(offset) { const t = t0 + offset; piano(523.25, t, false); piano(659.25, t + 0.26, true); piano(783.99, t + 0.52, true); } };
  } catch (e) { return null; }
}

export function runSplash() {
  return new Promise((resolve) => {
    const el = $('splash'); if (!el) return resolve();
    el.classList.remove('hidden');
    let started = false, done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.classList.add('hidden'); resolve(); }, 650); };
    const start = () => {
      if (started) { finish(); return; } // second tap skips
      started = true; el.classList.add('go');
      const snd = chime();
      const heli = $('spHeli'), rotor = $('spRotor');
      // rotor blur
      rotor.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.25)' }, { transform: 'scaleX(1)' }], { duration: 90, iterations: Infinity });
      // descend, flare, touch down
      heli.animate([
        { transform: 'translate(-60px,-330px) rotate(-7deg)' },
        { transform: 'translate(-12px,-70px) rotate(-4deg)', offset: 0.7 },
        { transform: 'translate(0,-8px) rotate(3deg)', offset: 0.9 },
        { transform: 'translate(0,0) rotate(0deg)' },
      ], { duration: 2100, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'forwards' });
      setTimeout(() => el.classList.add('down'), 2050);          // dust + pad lights
      setTimeout(() => {                                          // the chime reveals B, H, S
        snd?.play(0);
        ['spB', 'spH', 'spS'].forEach((id, i) => setTimeout(() => $(id).classList.add('on'), i * 260));
        setTimeout(() => el.classList.add('named'), 900);        // BLACK HAWK SIM while the echoes fade
      }, 2250);
      setTimeout(finish, 5600);
    };
    el.addEventListener('pointerdown', start);
    addEventListener('keydown', function k(e) { if (e.code === 'Enter' || e.code === 'Escape') { start(); if (done) removeEventListener('keydown', k); } });
  });
}
