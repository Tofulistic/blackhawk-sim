import * as THREE from 'three';
import { GEAR_CLEAR } from './heli.js';

const V3 = THREE.Vector3;
const G = 9.81;
const _m = new THREE.Matrix4(), _x = new V3(), _y = new V3(), _z = new V3(), _q = new THREE.Quaternion();

// Orient a helicopter so its rotor thrust explains its acceleration (bank in turns, nose down when speeding up)
function attitudeFrom(acc, vel, heading, out) {
  _y.set(acc.x, acc.y + G, acc.z);
  const sp = vel.length();
  _y.addScaledVector(vel, 0.16 + 0.024 * sp); // drag compensation => nose-down in cruise
  _y.normalize();
  const f = heading; // horizontal forward
  _x.crossVectors(f, _y); // right = fwd x up ... (fwd=-z) -> compute properly below
  // build basis: right = up x back, with back = -fwd
  _z.copy(f).negate();
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

class AIHeli {
  constructor(mesh) {
    this.mesh = mesh; this.pos = new V3(); this.vel = new V3(); this.acc = new V3();
    this.q = new THREE.Quaternion(); this.heading = new V3(0, 0, -1); this.rpm = 0;
  }
  place(p, heading) { this.pos.copy(p); this.vel.set(0, 0, 0); this.acc.set(0, 0, 0); this.heading.copy(heading).setY(0).normalize(); attitudeFrom(this.acc, this.vel, this.heading, this.q); }
  moveTo(p, dt) { // kinematic follow of an exact path position
    const nv = _x.copy(p).sub(this.pos).divideScalar(Math.max(dt, 1e-4));
    const na = _y.copy(nv).sub(this.vel).divideScalar(Math.max(dt, 1e-4));
    this.acc.lerp(na, 1 - Math.exp(-dt * 4));
    this.vel.copy(nv); this.pos.copy(p);
  }
  setPath(p, vel, acc, dt) { // exact path state, smooth analytic acceleration (no frame-to-frame noise)
    this.pos.copy(p); this.vel.copy(vel); this.acc.lerp(acc, 1 - Math.exp(-dt * 5));
  }
  spring(target, dt, w = 2.6, amax = 14) {
    const a = _x.copy(target).sub(this.pos).multiplyScalar(w * w).addScaledVector(this.vel, -2 * w);
    if (a.length() > amax) a.setLength(amax);
    this.acc.lerp(a, 1 - Math.exp(-dt * 6));
    this.vel.addScaledVector(a, dt); this.pos.addScaledVector(this.vel, dt);
  }
  finish(dt, groundAt) {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.6) { _z.set(this.vel.x, 0, this.vel.z).normalize(); this.heading.lerp(_z, 1 - Math.exp(-dt * 3)).normalize(); }
    const gy = groundAt(this.pos.x, this.pos.z, this.pos.y) + GEAR_CLEAR;
    let acc = this.acc;
    if (this.pos.y <= gy + 0.01) { this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; acc = _y.set(0, 0, 0); }
    attitudeFrom(acc, this.vel, this.heading, _q);
    this.q.slerp(_q, 1 - Math.exp(-dt * 8));
    this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.q);
    this.mesh.userData.animate(dt, this.rpm);
  }
}

export class Convoy {
  // mode: 'follow' (AI leads, you follow) | 'lead' (you lead, AI escorts)
  constructor({ scene, route, makeHeli, count, mode, world, speed = 8 }) {
    this.scene = scene; this.route = route; this.mode = mode; this.world = world;
    this.L = route.getLength(); this.count = count; this.spacing = 5.5; this.slotGap = 4.5;
    this.vCruise = speed; this.v = 0; this.s = 0; this.started = false; this.startT = 0; this.laps = 0;
    this.helis = []; for (let i = 0; i < count; i++) { const m = makeHeli(i); scene.add(m); this.helis.push(new AIHeli(m)); }
    this.trail = []; this.score = 0; this.inPosTime = 0; this.totalTime = 0; this.status = '';
    this.slot = new V3(); this.slotDist = 0; this.pauseT = 0;
    this.groundAt = (x, z, y) => world.groundAt(x, z, y);
    this.reset();
  }
  dispose() { for (const h of this.helis) this.scene.remove(h.mesh); }
  pt(s, out = new V3()) { return this.route.getPointAt((((s % this.L) + this.L) % this.L) / this.L, out); }
  tan(s, out = new V3()) { return this.route.getTangentAt((((s % this.L) + this.L) % this.L) / this.L, out); }

  // where the player spawns (on the ground)
  playerSpawn() {
    if (this.mode === 'follow') {
      const s = -(this.count - 1) * this.spacing - this.slotGap - 3;
      const p = this.pt(s); const t = this.tan(s); p.y = this.groundAt(p.x, p.z, 0.5) + GEAR_CLEAR;
      return { pos: p, yaw: Math.atan2(-t.x, -t.z) };
    }
    const p = this.pt(0); const t = this.tan(0); p.y = this.groundAt(p.x, p.z, 0.5) + GEAR_CLEAR;
    return { pos: p, yaw: Math.atan2(-t.x, -t.z) };
  }
  reset() {
    this.s = 0; this.v = 0; this.started = false; this.laps = 0; this.score = 0; this.inPosTime = 0; this.totalTime = 0; this.trail = [];
    this.phase = 'route'; this.K = null; this.vPlan = this.vCruise; this.landT = 0; this.aiDownAt = null;
    const sp0 = this.playerSpawn(); this.pad = sp0.pos.clone(); this.padYaw = sp0.yaw;
    if (this.mode === 'follow') {
      this.helis.forEach((h, i) => {
        const s = -i * this.spacing; const p = this.pt(s); p.y = this.groundAt(p.x, p.z, 0.5) + GEAR_CLEAR;
        h.place(p, this.tan(s)); h.rpm = 0; h.mesh.position.copy(h.pos); h.mesh.quaternion.copy(h.q);
      });
    } else {
      const sp = this.playerSpawn(); const back = new V3(Math.sin(sp.yaw), 0, Math.cos(sp.yaw));
      const side = new V3(back.z, 0, -back.x);
      this.trail = [];
      this.helis.forEach((h, i) => {
        const p = sp.pos.clone().addScaledVector(back, 3.2 * (i + 1)).addScaledVector(side, (i % 2 ? 1 : -1) * 0.0);
        p.y = this.groundAt(p.x, p.z, 0.5) + GEAR_CLEAR;
        h.place(p, back.clone().negate()); h.landed = false; h.rpm = 0; h.mesh.position.copy(h.pos); h.mesh.quaternion.copy(h.q); h.home = p.clone();
      });
      // seed trail from last wingman to player
      for (let i = this.helis.length - 1; i >= 0; i--) this.trail.push(this.helis[i].pos.clone());
      this.trail.push(sp.pos.clone());
    }
  }
  curvatureSpeed(s0, cap = this.vCruise) {
    let vmax = cap; const a = new V3(), b = new V3(), c = new V3();
    for (let d = 0; d <= 18; d += 3) {
      this.pt(s0 + d - 2.5, a); this.pt(s0 + d, b); this.pt(s0 + d + 2.5, c);
      const ab = b.clone().sub(a), bc = c.clone().sub(b), ac = c.clone().sub(a);
      const k = (2 * ab.clone().cross(bc).length()) / (ab.length() * bc.length() * ac.length() + 1e-6);
      if (k > 1e-4) vmax = Math.min(vmax, Math.sqrt(5.5 / k));
    }
    return Math.max(2.5, vmax);
  }
  // after a crash in follow mode: put player at the slot
  respawnPoint() {
    const sLast = this.s - (this.count - 1) * this.spacing; const s = sLast - this.slotGap;
    const p = this.pt(s); const t = this.tan(s); this.pauseT = 2.5; this.v = 0;
    return { pos: p, yaw: Math.atan2(-t.x, -t.z) };
  }

  update(dt, player, playerRpm, mission = null) {
    const H = this.helis;
    if (this.mode === 'follow') {
      const airborne = !player.onGround && player.pos.y > this.groundAt(player.pos.x, player.pos.z, player.pos.y) + 0.6;
      if (!this.started && airborne) { this.started = true; this.startT = 0; }
      const sLast = this.s - (this.count - 1) * this.spacing; const sSlot = sLast - this.slotGap;
      this.pt(sSlot, this.slot);
      // player progress along route near slot
      let best = 1e9, bestS = sSlot; const tmp = new V3();
      for (let d = -40; d <= 20; d += 1) { this.pt(sSlot + d, tmp); const dd = tmp.distanceToSquared(player.pos); if (dd < best) { best = dd; bestS = sSlot + d; } }
      const along = bestS - sSlot; this.slotDist = player.pos.distanceTo(this.slot);
      // mission timing: pace the convoy so it is back at the start line when the song ends
      if (this.started && this.phase === 'route' && mission) {
        const Tr = Math.max(1, mission.timeLeft - 9);
        if (this.K == null) this.K = Math.max(Math.floor(this.s / this.L) + 1, Math.round((this.s + this.vCruise * 0.85 * Tr) / this.L));
        let need = (this.K * this.L - this.s) / Tr;
        if (need > 11.5 && (this.K - 1) * this.L > this.s + 40) this.K--;
        else if (need < 3.5 && mission.timeLeft > 30) this.K++;
        need = (this.K * this.L - this.s) / Tr;
        this.vPlan = THREE.MathUtils.clamp(need, 3, 12);
        this.padS = this.K * this.L - (this.count - 1) * this.spacing - this.slotGap - 3;
      }
      let v = this.curvatureSpeed(this.s, mission ? this.vPlan * 1.15 : this.vCruise);
      if (this.phase !== 'route') v = 0;
      if (this.started) {
        this.startT += dt;
        if (this.slotDist > 9 && along < 0) v *= THREE.MathUtils.clamp(1 - (this.slotDist - 9) / 22, 0.15, 1);
        if (along > 1.5) v *= 1.25;
        if (player.crashed) v = 0;
      } else v = 0;
      if (this.pauseT > 0) { this.pauseT -= dt; v = 0; }
      const ramp = Math.min(1, this.startT / 3);
      const prevV = this.v;
      this.v += (v * ramp - this.v) * Math.min(1, dt * 1.6);
      this.dvdt = (this.dvdt || 0) + (((this.v - prevV) / Math.max(dt, 1e-4)) - (this.dvdt || 0)) * Math.min(1, dt * 4);
      const prev = this.s; this.s += this.v * dt;
      if (Math.floor(this.s / this.L) > Math.floor(prev / this.L)) this.laps++;
      if (this.phase === 'route' && this.K != null && mission && this.s >= this.K * this.L) { this.s = this.K * this.L; this.v = 0; this.dvdt = 0; this.phase = 'landing'; this.landT = 0; }
      if (this.padS != null) { this.pt(this.padS, this.pad); this.pad.y = this.groundAt(this.pad.x, this.pad.z, this.pad.y + 0.5); const t = this.tan(this.padS); this.padYaw = Math.atan2(-t.x, -t.z); }
      if (this.phase !== 'route') this.landT += dt;
      H.forEach((h, i) => {
        if (this.phase === 'route') h.rpm = Math.min(1, h.rpm + dt * (playerRpm > 0.05 || this.started ? 0.5 : 0));
        const s = this.s - i * this.spacing; const p = this.pt(s);
        let lift = this.started ? THREE.MathUtils.smoothstep(this.startT, 0.3 + i * 0.4, 2.6 + i * 0.4) : 0;
        if (this.phase !== 'route') { // descend and land on the spot they took off from
          lift = Math.min(lift, 1 - THREE.MathUtils.smoothstep(this.landT, 0.8 + i * 0.6, 7 + i * 0.6));
          if (this.landT > 8 + i * 0.6) h.rpm = Math.max(0, h.rpm - dt * 0.22);
        }
        const gy = this.groundAt(p.x, p.z, p.y) + GEAR_CLEAR;
        p.y = gy + (p.y - gy) * lift;
        const T = this.tan(s); const pa = this.pt(s - 2.5), pb = this.pt(s + 2.5), pc = this.pt(s);
        const kv = pa.add(pb).addScaledVector(pc, -2).divideScalar(6.25); // curvature vector d²p/ds²
        const vel = T.clone().multiplyScalar(this.v);
        const acc = kv.multiplyScalar(this.v * this.v).addScaledVector(T, this.dvdt || 0);
        if (lift < 1) acc.y = 0;
        h.setPath(p, vel, acc, dt);
        h.heading.copy(T).setY(0).normalize();
        h.finish(dt, this.groundAt);
      });
      if (this.phase === 'landing' && this.landT > 7.5 + (this.count - 1) * 0.6) { this.phase = 'down'; this.aiDownAt = mission ? mission.now : 0; }
      // score
      if (this.phase !== 'route') this.status = this.phase === 'down' ? 'CONVOY DOWN' : 'LANDING';
      else if (this.started && !player.crashed) {
        this.totalTime += dt;
        const d = this.slotDist;
        if (d < 3) { this.status = 'TIGHT'; this.score += dt * 10; this.inPosTime += dt; }
        else if (d < 7) { this.status = 'GOOD'; this.score += dt * 4; this.inPosTime += dt; }
        else if (d < 15) this.status = 'LOOSE';
        else this.status = 'LOST';
      } else this.status = this.started ? '' : 'TAKE OFF TO START';
    } else {
      // lead: escorts follow the breadcrumb trail you leave
      const last = this.trail[this.trail.length - 1];
      if (!last || last.distanceTo(player.pos) > 0.3) { this.trail.push(player.pos.clone()); if (this.trail.length > 1200) this.trail.shift(); }
      const tgt = new V3();
      H.forEach((h, i) => {
        if (!h.landed) h.rpm = Math.min(1, Math.max(0, h.rpm + dt * (playerRpm > 0.05 ? 0.5 : -0.3)));
        const want = 3.6 + i * 3.6;
        // walk back along trail from player
        let acc = player.pos.distanceTo(this.trail[this.trail.length - 1]); let k = this.trail.length - 1;
        tgt.copy(this.trail[k]);
        while (k > 0) {
          const seg = this.trail[k].distanceTo(this.trail[k - 1]);
          if (acc + seg >= want) { tgt.copy(this.trail[k]).lerp(this.trail[k - 1], (want - acc) / seg); break; }
          acc += seg; k--; tgt.copy(this.trail[k]);
        }
        if (player.crashed) tgt.copy(h.pos).setY(Math.max(h.pos.y, 2.5));
        if (this.phase === 'rtb' && this.playerOnPad) {
          tgt.copy(h.home); const hd = Math.hypot(h.pos.x - h.home.x, h.pos.z - h.home.z);
          if (hd > 0.8) tgt.y = Math.max(h.pos.y, h.home.y + 2.5); // get over the spot first, then descend
          if (hd < 0.3 && h.pos.y - h.home.y < 0.05) h.landed = true;
        }
        if (h.landed) { h.rpm = Math.max(0, h.rpm - dt * 0.22); tgt.copy(h.home); }
        if (h.rpm < 0.85 && !h.landed) tgt.copy(h.pos).setY(this.groundAt(h.pos.x, h.pos.z, h.pos.y) + GEAR_CLEAR);
        h.spring(tgt, dt, h.landed ? 4 : 2.6);
        h.finish(dt, this.groundAt);
      });
      if (this.phase === 'rtb' && this.helis.every((h) => h.landed)) { this.phase = 'down'; this.aiDownAt = mission ? mission.now : 0; }
      this.status = '';
    }
  }
  collidesWith(p, r = 0.55) { return this.helis.some((h) => h.pos.distanceToSquared(p) < r * r); }
  nearestDist(p) { return Math.min(...this.helis.map((h) => h.pos.distanceTo(p))); }
}
