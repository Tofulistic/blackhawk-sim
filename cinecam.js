// Cinematic camera: cuts between film-style shots. Long straight flight earns the dramatic angles
// (fly-bys, hero front shot, orbits, wide convoy shots); hard manoeuvring falls back to steady follow shots.
import * as THREE from 'three';
const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _up = new V3(0, 1, 0);

const DRAMATIC = ['closeby', 'flyby', 'side', 'closeby', 'front', 'orbit', 'convoy', 'low', 'closeby', 'flyby'];
const STEADY = ['high', 'trail', 'side'];

export class CineCam {
  constructor() { this.shot = null; this.t = 0; this.len = 0; this.straightT = 0; this.pos = new V3(); this.look = new V3(); this.anchor = new V3(); this.last = ''; this.side = 1; this.yawPrev = null; }
  heading(b) { const f = _a.set(0, 0, -1).applyQuaternion(b.q); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); return f.normalize().clone(); }
  pick(g, turning) {
    const pool = this.straightT > 1.8 && !turning ? DRAMATIC : STEADY;
    let s; do { s = pool[Math.floor(Math.random() * pool.length)]; } while (s === this.last && pool.length > 1);
    if (s === 'convoy' && !g.convoy) s = 'side';
    this.shot = s; this.last = s; this.t = 0; this.side = Math.random() < 0.5 ? -1 : 1;
    this.len = { closeby: 5, flyby: 6, side: 5.5, front: 4.5, orbit: 7, convoy: 6, low: 5, high: 5, trail: 4.5 }[s];
    this.orbitA = Math.random() * Math.PI * 2;
    const b = g.body, fwd = this.heading(b), right = _b.crossVectors(fwd, _up).normalize();
    const spd = Math.max(3, b.vel.length());
    if (s === 'flyby') { // planted camera ahead of the heli, slightly off its path, close to the ground
      this.anchor.copy(b.pos).addScaledVector(fwd, spd * 3.2 + 4).addScaledVector(right, this.side * (2 + Math.random() * 2));
      this.anchor.y = Math.max(g.world.terrainAt(this.anchor.x, this.anchor.z) + 0.5, b.pos.y - 1.2 + Math.random() * 1.5);
    }
    if (s === 'closeby') { // lens planted right beside your path, at your height: you whip past within a metre
      this.anchor.copy(b.pos).addScaledVector(fwd, spd * 1.7 + 2.5).addScaledVector(right, this.side * (0.55 + Math.random() * 0.4));
      this.anchor.y = Math.max(g.world.terrainAt(this.anchor.x, this.anchor.z) + 0.3, b.pos.y + (Math.random() - 0.4) * 0.35);
    }
    this.snap = true;
  }
  update(dt, g, cam) {
    const b = g.body;
    // track how long you've flown straight
    const fwd = this.heading(b); const yaw = Math.atan2(fwd.x, fwd.z);
    let yr = 0; if (this.yawPrev !== null) { yr = Math.abs(Math.atan2(Math.sin(yaw - this.yawPrev), Math.cos(yaw - this.yawPrev))) / Math.max(dt, 1e-3); }
    this.yawPrev = yaw;
    const turning = yr > 0.6 || Math.abs(_c.set(1, 0, 0).applyQuaternion(b.q).y) > 0.45;
    const moving = b.vel.length() > 2.5;
    this.straightT = !turning && moving ? this.straightT + dt : Math.max(0, this.straightT - dt * 3);
    this.t += dt;
    const past = _a.copy(b.pos).sub(this.anchor).dot(fwd);
    const passed = (this.shot === 'flyby' && past > 6) || (this.shot === 'closeby' && past > 4.5);
    if (!this.shot || this.t > this.len || passed || (turning && DRAMATIC.includes(this.shot) && this.shot !== 'side' && this.t > 1.2)) this.pick(g, turning);

    const right = _b.crossVectors(fwd, _up).normalize();
    const want = _c; const look = _a.copy(b.pos); let fov = 55, follow = 4;
    switch (this.shot) {
      case 'flyby': want.copy(this.anchor); fov = 38; follow = 50; break;
      case 'closeby': want.copy(this.anchor); fov = 62; follow = 50; break;
      case 'side': want.copy(b.pos).addScaledVector(right, this.side * 2.6).addScaledVector(fwd, -0.6 + this.t * 0.12).add(_up.clone().multiplyScalar(0.35)); fov = 50; follow = 5; break;
      case 'front': want.copy(b.pos).addScaledVector(fwd, 2.2).addScaledVector(right, this.side * 0.6).add(_up.clone().multiplyScalar(0.25 + this.t * 0.04)); fov = 55; follow = 6; break;
      case 'orbit': { const a = this.orbitA + this.t * 0.35 * this.side; want.set(b.pos.x + Math.cos(a) * 2.8, b.pos.y + 0.6, b.pos.z + Math.sin(a) * 2.8); fov = 58; follow = 6; break; }
      case 'convoy': {
        const all = [b.pos, ...g.convoy.helis.map((h) => h.pos)]; const mid = _a.set(0, 0, 0); all.forEach((p) => mid.add(p)); mid.divideScalar(all.length);
        let spread = 2; all.forEach((p) => { spread = Math.max(spread, p.distanceTo(mid)); });
        want.copy(mid).addScaledVector(right, this.side * (spread * 1.6 + 5)).addScaledVector(fwd, spread * 0.3).add(_up.clone().multiplyScalar(1.6 + spread * 0.25));
        look.copy(mid); fov = 48; follow = 3; break;
      }
      case 'low': want.copy(b.pos).addScaledVector(fwd, -2.4).addScaledVector(right, this.side * 1.2); want.y = g.world.terrainAt(want.x, want.z) + 0.25; fov = 62; follow = 5; break;
      case 'high': want.copy(b.pos).addScaledVector(fwd, -6).add(_up.clone().multiplyScalar(4.5)); look.addScaledVector(fwd, 3); fov = 52; follow = 3; break;
      default: /* trail */ want.copy(b.pos).addScaledVector(fwd, -1.8).addScaledVector(right, this.side * 0.8).add(_up.clone().multiplyScalar(0.55)); look.addScaledVector(fwd, 4); fov = 60; follow = 6;
    }
    // keep the lens out of walls and the ground
    const blockT = g.world.segmentBlocked(b.pos, want, 10, 1.2);
    if (blockT < 1) want.lerpVectors(b.pos, want, Math.max(0.25, blockT));
    const gy = g.world.groundAt(want.x, want.z, want.y) + 0.15; if (want.y < gy) want.y = gy;
    if (this.snap) { this.pos.copy(want); this.look.copy(look); this.snap = false; cam.fov = fov; }
    else { this.pos.lerp(want, 1 - Math.exp(-dt * follow)); this.look.lerp(look, 1 - Math.exp(-dt * (this.shot === 'closeby' ? 30 : 12))); }
    cam.position.copy(this.pos); cam.up.set(0, 1, 0); cam.lookAt(this.look);
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4)); cam.near = 0.05;
  }
}
