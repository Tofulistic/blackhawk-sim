import * as THREE from 'three';
import { GEAR_CLEAR, ROTOR_R } from './heli.js';

const G = 9.81;
const V = THREE.Vector3, Q = THREE.Quaternion;
const _up = new V(), _v = new V(), _a = new V(), _q = new Q(), _qt = new Q(), _e = new THREE.Euler();

export const expo = (x, e) => x * (1 - e) + x * x * x * e;

const EMPTY = [];
export class World {
  constructor() { this.boxes = []; this.terrain = null; this.grid = null; this.big = []; }
  terrainAt(x, z) { return this.terrain ? this.terrain(x, z) : 0; }
  // bucket boxes into an 8 m grid so big maps stay fast
  finalize() {
    const C = 8; this.C = C; this.grid = new Map(); this.big = [];
    for (const b of this.boxes) {
      const x0 = Math.floor((b.min.x - 1) / C), x1 = Math.floor((b.max.x + 1) / C), z0 = Math.floor((b.min.z - 1) / C), z1 = Math.floor((b.max.z + 1) / C);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 600) { this.big.push(b); continue; }
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const k = (i + 4096) * 8192 + (j + 4096); let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(b);
      }
    }
  }
  near(x, z) {
    if (!this.grid) return this.boxes;
    const k = (Math.floor(x / this.C) + 4096) * 8192 + (Math.floor(z / this.C) + 4096);
    const a = this.grid.get(k) || EMPTY;
    return this.big.length ? a.concat(this.big) : a;
  }
  addBox(minX, minY, minZ, maxX, maxY, maxZ, tag = '') {
    this.boxes.push({ min: new V(minX, minY, minZ), max: new V(maxX, maxY, maxZ), tag });
  }
  // highest supporting surface under (x,z) that is at/below y
  groundAt(x, z, y) {
    let g = this.terrainAt(x, z);
    for (const b of this.near(x, z)) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= y + 0.12 && b.max.y > g) g = b.max.y;
    }
    return g;
  }
  // heli as short cylinder (rotor disc). returns hit box + push normal or null
  hitTest(p, r = ROTOR_R, bottom = GEAR_CLEAR, top = 0.12) {
    for (const b of this.near(p.x, p.z)) {
      if (b.max.y < p.y - bottom + 0.15 || b.min.y > p.y + top) continue;
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
      const dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-4;
        return { box: b, nx: dx / d, nz: dz / d, depth: r - d };
      }
    }
    return null;
  }
  segmentBlocked(a, b, steps = 10, minH = 0) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      for (const bx of this.near(x, z)) if (bx.max.y - bx.min.y >= minH && x > bx.min.x - 0.15 && x < bx.max.x + 0.15 && y > bx.min.y - 0.15 && y < bx.max.y + 0.15 && z > bx.min.z - 0.15 && z < bx.max.z + 0.15) return (i - 1) / steps;
    }
    return 1;
  }
}

export class HeliBody {
  constructor() {
    this.pos = new V(); this.vel = new V(); this.q = new Q(); this.w = new V();
    this.rpm = 0; this.armed = false; this.crashed = false; this.onGround = true;
    this.gyroYaw = 0; this.thrustAcc = 0; this.crashReason = '';
  }
  reset(pos, yaw, { airborne = false } = {}) {
    this.pos.copy(pos); this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.gyroYaw = yaw; this.crashed = false; this.onGround = !airborne;
    this.rpm = airborne ? 1 : 0; this.armed = airborne;
  }
  up(out = new V()) { return out.set(0, 1, 0).applyQuaternion(this.q); }
  fwd(out = new V()) { return out.set(0, 0, -1).applyQuaternion(this.q); }
  right(out = new V()) { return out.set(1, 0, 0).applyQuaternion(this.q); }

  step(dt, inp, cfg, world) {
    if (this.crashed) { // tumble to ground
      this.vel.y -= G * dt; this.vel.multiplyScalar(Math.exp(-dt * 0.4));
      this.pos.addScaledVector(this.vel, dt);
      const wl = this.w.length(); if (wl > 0) { _q.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * dt); this.q.multiply(_q).normalize(); }
      this.rpm = Math.max(0, this.rpm - dt * 0.8);
      const gy = world.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y < gy + 0.05) { this.pos.y = gy + 0.05; this.vel.set(0, 0, 0); this.w.multiplyScalar(0.8); }
      return;
    }
    // spool
    const target = this.armed ? 1 : 0;
    const rate = this.armed ? 1 / 2.2 : 1 / 3;
    this.rpm += Math.sign(target - this.rpm) * Math.min(Math.abs(target - this.rpm), rate * dt);

    const e = cfg.expo;
    const up = this.up(_up);
    const wd = _v;
    let thrust;
    if (cfg.mode === 'air') {
      // Betaflight-style rates: 200°/s centre, super-rate so full stick = max rate
      const bf = (x, max) => { const sr = Math.min(0.95, Math.max(0, 1 - 200 / max)); const xe = expo(x, e); return (200 * xe) / (1 - Math.abs(xe) * sr) * Math.PI / 180; };
      const ey = cfg.yawExpo ?? e;
      const bfy = (x, max) => { const sr = Math.min(0.95, Math.max(0, 1 - 200 / max)); const xe = expo(x, ey); return (200 * xe) / (1 - Math.abs(xe) * sr) * Math.PI / 180; };
      wd.set(-bf(inp.pitch, cfg.airRate), -bfy(inp.yaw, cfg.airYawRate), -bf(inp.roll, cfg.airRate));
      const c = inp.climb || 0;
      const thr = inp.spring ? (c >= 0 ? 0.31 + 0.69 * c : 0.31 * (1 + c)) : inp.thr; // self-centring stick: centre ≈ hover
      thrust = thr * 3.2 * G; // positive-only throttle, ~3:1 thrust/weight, hover ≈ 31%
    } else {
      const maxA = cfg.maxAngle * Math.PI / 180;
      if (!this.onGround || inp.thr > 0.15 || (inp.climb || 0) > 0.15) this.gyroYaw += -expo(inp.yaw, cfg.yawExpo ?? e) * cfg.gyroYawRate * Math.PI / 180 * dt;
      _e.set(-expo(inp.pitch, e * 0.6) * maxA, this.gyroYaw, -expo(inp.roll, e * 0.6) * maxA, 'YXZ');
      _qt.setFromEuler(_e);
      _q.copy(this.q).invert().multiply(_qt);
      if (_q.w < 0) { _q.x *= -1; _q.y *= -1; _q.z *= -1; _q.w *= -1; }
      const s = Math.sqrt(1 - Math.min(1, _q.w * _q.w));
      const ang = 2 * Math.acos(Math.min(1, _q.w));
      if (s > 1e-5) wd.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang * 7.5); else wd.set(0, 0, 0);
      if (wd.length() > 7) wd.setLength(7);
      if (inp.spring) { // beginner altitude hold: stick up = climb, centre = hold height
        const c = inp.climb || 0;
        if (this.onGround && c < 0.15) thrust = 0.3 * G;
        else thrust = Math.min(2.2 * G, Math.max(0, (G + (c * 3 - this.vel.y) * 5) / Math.max(0.5, up.y)));
      } else {
        thrust = inp.thr * 2.0 * G;
        thrust /= Math.max(0.75, up.y) ** 0.6; // partial tilt compensation
      }
    }
    thrust *= this.rpm * this.rpm;
    // ground handling: if sitting on ground and not lifting, keep it planted
    const lifting = thrust * Math.max(0, up.y) > G * 0.98;
    if (this.onGround && !lifting) wd.multiplyScalar(0.1);
    // rotor response
    const k = 1 - Math.exp(-dt / (cfg.mode === 'air' ? 0.035 : 0.06));
    this.w.x += (wd.x - this.w.x) * k; this.w.y += (wd.y - this.w.y) * k; this.w.z += (wd.z - this.w.z) * k;
    if (this.rpm < 0.3 && !this.onGround) this.w.multiplyScalar(1 - dt * 0.5);
    const wl = this.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_a.copy(this.w).divideScalar(wl), wl * dt); this.q.multiply(_q).normalize(); }

    // linear
    this.up(up);
    _a.copy(up).multiplyScalar(thrust);
    _a.y -= G;
    const gy = world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const h = this.pos.y - GEAR_CLEAR - gy;
    if (h < 0.35 && up.y > 0.5) _a.addScaledVector(up, thrust * 0.12 * (1 - h / 0.35)); // ground effect
    const sp = this.vel.length();
    _a.addScaledVector(this.vel, -(0.16 + 0.024 * sp));
    _a.y -= this.vel.y * 0.55 * this.rpm;
    this.thrustAcc = thrust;
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);

    // ground contact
    if (this.pos.y - GEAR_CLEAR < gy) {
      const impact = -this.vel.y; const hs = Math.hypot(this.vel.x, this.vel.z);
      if (impact > 3.2 || hs > 5 || (up.y < 0.55 && this.rpm > 0.25)) return this.crash(impact > 3.2 ? 'Hard landing' : (up.y < 0.55 ? 'Rotor strike' : 'Hit the ground'));
      this.pos.y = gy + GEAR_CLEAR; if (this.vel.y < 0) this.vel.y = 0;
      const f = Math.exp(-dt * 7); this.vel.x *= f; this.vel.z *= f;
      this.onGround = true;
      if (!lifting) { // settle level
        _e.setFromQuaternion(this.q, 'YXZ'); _qt.setFromEuler(_e.set(0, _e.y, 0, 'YXZ'));
        this.q.slerp(_qt, 1 - Math.exp(-dt * 12)); this.w.multiplyScalar(Math.exp(-dt * 12));
        if (cfg.mode !== 'air') this.gyroYaw = _e.y;
      }
    } else if (this.pos.y - GEAR_CLEAR > gy + 0.02) this.onGround = false;

    // obstacles
    const hit = world.hitTest(this.pos);
    if (hit) {
      const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (-vn > 1.6 && this.rpm > 0.3) return this.crash('Rotor strike');
      const push = Math.min(hit.depth, 0.6 * dt + 0.002);
      this.pos.x += hit.nx * push; this.pos.z += hit.nz * push;
      if (vn < 0) { this.vel.x -= vn * hit.nx; this.vel.z -= vn * hit.nz; }
    }
  }
  crash(reason) {
    this.crashed = true; this.crashReason = reason; this.armed = false;
    this.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 14);
    this.vel.multiplyScalar(0.35);
  }
}
