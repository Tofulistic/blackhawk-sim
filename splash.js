// Opening sequence: a 2D Black Hawk lands on a helipad, then a 3-note rising chime reveals the BHS logo,
// with notes 2 and 3 echoing away. Browsers only allow sound after a tap, so it starts on "Tap to start".
const $ = (id) => document.getElementById(id);

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const out = ctx.createGain(); out.gain.value = 0.55; out.connect(ctx.destination);
    // feedback echo for notes 2 and 3 (darkens and fades each repeat)
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.58;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    delay.connect(tone).connect(fb).connect(delay); tone.connect(wet).connect(out);
    const bell = (f, t, echo) => {
      for (const [mult, amp, dec] of [[1, 0.5, 1.6], [2, 0.14, 0.7], [3.01, 0.06, 0.4]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g); g.connect(out); if (echo) g.connect(delay);
        o.start(t); o.stop(t + dec + 0.05);
      }
    };
    const t0 = ctx.currentTime + 0.05;
    return { ctx, play(offset) { const t = t0 + offset; bell(523.25, t, false); bell(659.25, t + 0.26, true); bell(783.99, t + 0.52, true); } };
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
