import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildBlackHawk, GEAR_CLEAR } from './heli.js';
import { World, HeliBody } from './physics.js';
import { buildFarm, buildYard } from './maps.js';
import { buildDesert, buildForest, buildBeach } from './maps2.js';
const MAPS = { farm: buildFarm, yard: buildYard, desert: buildDesert, forest: buildForest, beach: buildBeach };
const MAP_NAMES = { farm: 'Farm', yard: 'Container Yard', desert: 'Desert FOB', forest: 'Forest River', beach: 'Beach Sunrise' };
import { Convoy } from './ai.js';
import { Input } from './input.js';
import { RotorAudio } from './audio.js';
import { initSetup } from './setup.js';
import { Music } from './music.js';
import { initTouch } from './touch.js';
import { PhoneLink, runPadPage, newCode, SITE_URL } from './phone.js';
import { helipadTex } from './textures.js';
import { blobShadowTex, glowTex } from './textures.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const _cv = new THREE.Vector3(), _cv2 = new THREE.Vector3();

// ---------------- settings
const CFG_KEY = 'rcbh.cfg.v1';
const COARSE = matchMedia('(pointer: coarse)').matches;
const DEFAULTS = { safe: 'on', touch: 'auto', musicVol: 0.6, missionMin: 5, map: 'farm', flight: 'gyro', mission: 'follow', count: '2', cam: 'chase', quality: COARSE ? 'low' : 'high',
  airRate: 670, airYawRate: 500, uptilt: 20, gyroYawRate: 160, maxAngle: 38, expo: 0.35, yawExpo: 0.25, smoothMs: 30, delayMs: 0, fov: 74, camDist: 0.55, camHeight: 0.33, speed: 8, volume: 0.6 };
let cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY)) || {}); } catch (e) { /* ignore */ }
if (cfg.flight !== 'gyro' && cfg.flight !== 'air') cfg.flight = 'air';
for (const k of Object.keys(DEFAULTS)) if (cfg[k] === undefined) cfg[k] = DEFAULTS[k];
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

const INPUT_SLIDERS = [
  ['expo', 'Roll / pitch expo', 0, 0.9, 0.05], ['yawExpo', 'Yaw expo', 0, 0.9, 0.05],
  ['smoothMs', 'Stick smoothing (ms) · lower = snappier', 0, 150, 5], ['delayMs', 'Added input delay (ms) · 0 = none', 0, 250, 5],
  ['airRate', 'Air mode roll/pitch max rate (°/s)', 300, 1200, 10], ['airYawRate', 'Air mode yaw max rate (°/s)', 200, 1000, 10],
  ['uptilt', 'FPV camera uptilt (°, Air mode)', 0, 50, 1],
  ['maxAngle', 'Gyro max tilt (°)', 15, 60, 1], ['gyroYawRate', 'Gyro yaw rate (°/s)', 60, 360, 10],
];
const SLIDERS = [
  ['speed', 'Convoy cruise speed (m/s)', 4, 14, 0.5],
  ['fov', 'Camera FOV', 50, 110, 1], ['camDist', 'Chase distance (m)', 0.4, 4, 0.05],
  ['camHeight', 'Chase height (m)', 0.1, 1.5, 0.05], ['volume', 'Rotor volume', 0, 1, 0.05],
  ['missionMin', 'Mission length without a song (min)', 1, 15, 1],
];

// ---------------- renderer (shared)
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const input = new Input();
const audio = new RotorAudio();
const music = new Music();
const link = new PhoneLink(); input.remote = link;
let game = null;

class Game {
  constructor(c) {
    this.c = c; const hi = c.quality === 'high';
    renderer.setPixelRatio(Math.min(devicePixelRatio, hi ? 1.5 : 1));
    renderer.shadowMap.enabled = hi;
    const scene = this.scene = new THREE.Scene();
    this.world = new World();
    this.camera = new THREE.PerspectiveCamera(c.fov, innerWidth / innerHeight, 0.03, 2500);
    this.map = (MAPS[c.map] || buildFarm)({ scene, world: this.world, quality: c.quality, renderer });
    this.world.finalize();
    // environment reflections
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const skyClone = this.map.sky.clone(); skyClone.position.set(0, 0, 0); envScene.add(skyClone);
    if (c.map === 'yard') {
      for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(30, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 2 ? '#ffb070' : '#dfe8ff').multiplyScalar(3) })); const a = i / 8 * Math.PI * 2; m.position.set(Math.cos(a) * 400, 150, Math.sin(a) * 400); envScene.add(m); }
    }
    scene.environment = pm.fromScene(envScene, 0.02).texture; pm.dispose();
    scene.environmentIntensity = c.map === 'yard' ? 0.6 : 1;

    // player
    this.player = buildBlackHawk({ tailNumber: '55' }); scene.add(this.player);
    this.body = new HeliBody();
    this.blobs = [];
    this.mission = c.mission;
    if (c.mission !== 'free') {
      const nums = ['21', '34', '47', '62'];
      this.convoy = new Convoy({ scene, route: this.map.route, world: this.world, count: +c.count, mode: c.mission, speed: +c.speed,
        sync: c.safe !== 'off',
        makeHeli: (i) => buildBlackHawk({ tailNumber: nums[i % 4], tint: i % 2 ? '#e9ecdf' : '#ffffff' }) });
    }
    this.spawn = this.convoy ? this.convoy.playerSpawn() : (() => {
      const p = this.map.route.getPointAt(0); const t = this.map.route.getTangentAt(0); p.y = this.world.groundAt(p.x, p.z, 0.5) + GEAR_CLEAR; return { pos: p, yaw: Math.atan2(-t.x, -t.z) };
    })();
    this.body.reset(this.spawn.pos, this.spawn.yaw);
    for (const h of [this.player, ...(this.convoy ? this.convoy.helis.map((a) => a.mesh) : [])]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobShadowTex(), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }));
      scene.add(b); this.blobs.push([h, b]);
    }
    // slot marker
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.018, 8, 40), new THREE.MeshBasicMaterial({ color: 0x6fd08c, transparent: true, opacity: 0.45, depthWrite: false }));
    this.slotMarker = ring; ring.visible = c.mission === 'follow'; scene.add(ring);
    const padM = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: helipadTex(), transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -6, depthWrite: false }));
    this.padMarker = padM; padM.visible = false; scene.add(padM);
    this.resetMission();
    // pilot position
    const back = new V3(Math.sin(this.spawn.yaw), 0, Math.cos(this.spawn.yaw));
    this.pilotPos = this.spawn.pos.clone().addScaledVector(back, 5); this.pilotPos.y = this.world.terrainAt(this.pilotPos.x, this.pilotPos.z) + 1.7;

    // post
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    const night = c.map === 'yard';
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), night ? 0.85 : 0.35, night ? 0.6 : 0.5, night ? 0.75 : 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.t = 0; this.camK = 1; this.camRoll = 0; this.camYaw = this.spawn.yaw; this.camPos = new V3(); this.crashT = 0; this.freezeT = 0; this.paused = false;
    this.debris = []; this.camMode = c.cam; this.hudT = 0; this.wasArmReq = false; this.armBlockedMsg = 0;
    this.placeCameraInstant();
  }
  dispose() {
    this.convoy?.dispose();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => { if (!x) return; for (const k in x) if (x[k]?.isTexture) x[k].dispose(); x.dispose?.(); }); });
    this.map.reflector?.getRenderTarget?.().dispose();
    this.composer.dispose?.();
    this.scene.environment?.dispose();
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight);
    this.map.reflector?.getRenderTarget?.().setSize(Math.floor(innerWidth * 0.5), Math.floor(innerHeight * 0.5));
  }
  resetMission() {
    this.mStart = null; this.missionLen = music.loaded ? music.duration : (+this.c.missionMin || 5) * 60;
    this.playerDownAt = null; this.done = false; music.stop(); $('results').classList.add('hidden');
  }
  missionState() {
    if (!this.convoy || this.mStart == null) return null;
    return { timeLeft: this.missionLen - (this.t - this.mStart), now: this.t };
  }
  restart() {
    this.resetMission();
    this.convoy?.reset();
    this.spawn = this.convoy ? this.convoy.playerSpawn() : this.spawn;
    this.body.reset(this.spawn.pos, this.spawn.yaw);
    this.crashT = 0; this.freezeT = 0; this.camYaw = this.spawn.yaw; this.clearDebris(); this.placeCameraInstant();
  }
  clearDebris() { for (const d of this.debris) this.scene.remove(d.m); this.debris = []; }
  explode() {
    const mat = new THREE.MeshStandardMaterial({ color: '#4a4d40', roughness: 0.7 });
    const blade = new THREE.MeshStandardMaterial({ color: '#2b2d2b', roughness: 0.6 });
    for (let i = 0; i < 14; i++) {
      const isBlade = i < 4;
      const m = new THREE.Mesh(isBlade ? new THREE.BoxGeometry(0.26, 0.004, 0.022) : new THREE.BoxGeometry(0.02 + Math.random() * 0.03, 0.015, 0.02 + Math.random() * 0.03), isBlade ? blade : mat);
      m.position.copy(this.body.pos); m.castShadow = true; this.scene.add(m);
      const v = new V3((Math.random() - 0.5) * 6, Math.random() * 3 + 1, (Math.random() - 0.5) * 6).add(this.body.vel.clone().multiplyScalar(0.5));
      this.debris.push({ m, v, w: new V3(Math.random() * 20, Math.random() * 20, Math.random() * 20) });
    }
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffd49a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.position.copy(this.body.pos); flash.scale.setScalar(1.5); this.scene.add(flash);
    this.debris.push({ m: flash, v: new V3(), w: new V3(), flash: true, life: 0.25 });
  }

  controls(dt) {
    input.smoothMs = +this.c.smoothMs; input.delayMs = +this.c.delayMs;
    const st = input.update(dt);
    const b = this.body;
    // arming
    const req = st.arm;
    const safe = st.spring ? (st.climb || 0) < 0.2 : (this.c.flight === 'air' ? st.thr < 0.1 : st.thr < 0.3);
    if (req && !b.armed && !b.crashed && this.crashT <= 0) {
      if (safe || !b.onGround) b.armed = true; else this.armBlockedMsg = 0.5;
    }
    if (!req && b.armed) b.armed = false;
    if (st.reset) this.restart();
    return st;
  }

  update(dt) {
    if (link.fresh && link.state.mode && link.state.mode !== this.c.flight && (link.state.mode === 'gyro' || link.state.mode === 'air')) this.c.flight = link.state.mode;
    if (link.status === 'connected' && (this.tellT = (this.tellT || 0) - dt) <= 0) { this.tellT = 0.5; link.tell({ flying: true, armed: this.body.armed, paused: this.paused }); }
    if (this.paused) return;
    this.t += dt;
    const st = this.controls(dt);
    const b = this.body;
    const pc = { mode: this.c.flight, airRate: +this.c.airRate, airYawRate: +this.c.airYawRate, gyroYawRate: +this.c.gyroYawRate, maxAngle: +this.c.maxAngle, expo: +this.c.expo, yawExpo: +this.c.yawExpo };
    if (this.freezeT > 0) { this.freezeT -= dt; b.vel.set(0, 0, 0); b.w.set(0, 0, 0); }
    else {
      const n = Math.ceil(dt / (1 / 240)); const h = dt / n;
      for (let i = 0; i < n; i++) { b.step(h, st, pc, this.world); if (b.crashed) break; }
    }
    if (!b.crashed && this.convoy) {
      // safe mode: your heli is never pushed; the convoy dodges you (see ai.js) and contact can't crash you
      if (this.c.safe === 'off' && this.convoy.collidesWith(b.pos)) b.crash('Mid-air collision');
    }
    const wl = this.map.waterLevel;
    if (!b.crashed && wl !== undefined && b.pos.y - GEAR_CLEAR < wl + 0.02) b.crash('Splashdown');
    if (b.crashed) {
      if (this.crashT <= 0) { this.crashT = 2.6; this.explode(); if (this.convoy) this.convoy.score = Math.max(0, this.convoy.score - 50); }
      this.crashT -= dt;
      if (this.crashT <= 0) {
        this.clearDebris();
        const cv = this.convoy;
        if (cv && cv.phase !== 'route') { // crashed while coming home: put you on the pad
          this.body.reset(cv.pad.clone().setY(cv.pad.y + GEAR_CLEAR), cv.padYaw);
        } else if (this.mission === 'lead' && cv) {
          this.body.reset(this.spawn.pos, this.spawn.yaw);
        } else if (this.mission === 'follow' && cv.started) {
          const r = this.convoy.respawnPoint(); this.body.reset(r.pos, r.yaw, { airborne: true }); this.freezeT = 2.0;
          if (input.state.armSwitch && !input.state.arm) this.body.armed = false;
        } else this.restart();
        this.camYaw = this.body.q ? new THREE.Euler().setFromQuaternion(this.body.q, 'YXZ').y : 0;
        this.placeCameraInstant();
      }
    }
    // visuals
    this.player.position.copy(b.pos); this.player.quaternion.copy(b.q);
    this.player.userData.animate(dt, b.rpm);
    this.updateMission(dt, b);
    // debris
    for (const d of this.debris) {
      if (d.flash) { d.life -= dt; d.m.material.opacity = Math.max(0, d.life * 4); continue; }
      d.v.y -= 9.81 * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
      const gy = this.world.groundAt(d.m.position.x, d.m.position.z, d.m.position.y);
      if (d.m.position.y < gy + 0.01) { d.m.position.y = gy + 0.01; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.5); }
    }
    // blob shadows
    for (const [h, s] of this.blobs) {
      const gy = Math.max(this.world.groundAt(h.position.x, h.position.z, h.position.y), this.map.waterLevel ?? -1e9);
      const ht = h.position.y - gy;
      s.position.set(h.position.x, gy + 0.012, h.position.z);
      const k = Math.max(0, 1 - ht / 8);
      s.material.opacity = k * (this.c.map === 'yard' || this.c.quality !== 'high' ? 0.85 : 0.35);
      s.scale.setScalar(1 + ht * 0.08);
    }
    if (this.convoy && this.mission === 'follow') {
      this.slotMarker.position.copy(this.convoy.slot);
      this.slotMarker.lookAt(this.camera.position);
      const col = { TIGHT: 0x6fd08c, GOOD: 0xb9d86a, LOOSE: 0xf0a43a, LOST: 0xf05a4a }[this.convoy.status] || 0x9fb0a0;
      this.slotMarker.material.color.setHex(col);
      this.slotMarker.visible = this.convoy.started;
      this.slotMarker.material.opacity = THREE.MathUtils.clamp((this.convoy.slotDist - 1.5) / 4, 0, 0.5);
    }
    this.updateCamera(dt);
    this.map.update(dt, this.t, b.pos, this.camera);
    audio.vol = +this.c.volume; audio.update(b.rpm, Math.min(1.5, Math.abs(b.thrustAcc) / 9.81) * (b.crashed ? 0 : 1));
    this.composer.render();
    this.hud(dt, st);
  }

  // invisible cushion around each convoy heli: you get eased away and can never touch them
  cushion(b, dt) {
    const R = 1.4; let near = Infinity;
    for (const h of this.convoy.helis) {
      const d = _cv.copy(b.pos).sub(h.pos); const dist = d.length(); near = Math.min(near, dist);
      if (dist >= R) continue;
      const n = dist > 1e-3 ? d.divideScalar(dist) : _cv.set(0, 1, 0);
      const vRel = _cv2.copy(b.vel).sub(h.vel); const vn = vRel.dot(n);
      if (vn < 0) b.vel.addScaledVector(n, -vn);                 // cancel closing speed
      b.vel.addScaledVector(n, (R - dist) * 9 * dt);              // gentle push apart
      b.pos.addScaledVector(n, Math.min(0.04, (R - dist) * 0.25)); // never overlap
    }
    this.cushionOn = near < R;
  }
  updateMission(dt, b) {
    const cv = this.convoy; if (!cv) return;
    if (this.mStart == null) {
      const air = !b.onGround && b.pos.y > this.world.groundAt(b.pos.x, b.pos.z, b.pos.y) + 0.6;
      if ((this.mission === 'follow' && cv.started) || (this.mission === 'lead' && air)) { this.mStart = this.t; music.setVolume(+this.c.musicVol); music.play(); }
    }
    const m = this.missionState();
    if (m && this.mission === 'lead' && cv.phase === 'route' && m.timeLeft < 45) cv.phase = 'rtb';
    const onPad = b.onGround && !b.crashed && Math.hypot(b.pos.x - cv.pad.x, b.pos.z - cv.pad.z) < 3.5 && b.vel.length() < 0.6;
    cv.playerOnPad = onPad && cv.phase !== 'route';
    if (cv.playerOnPad && this.playerDownAt == null) this.playerDownAt = this.t;
    if (!onPad && cv.phase !== 'down') this.playerDownAt = null;
    cv.update(dt, b, b.rpm, m);
    this.padMarker.visible = !!m && (cv.phase !== 'route' || m.timeLeft < 40);
    this.padMarker.position.set(cv.pad.x, cv.pad.y + 0.015, cv.pad.z);
    if (!this.done && cv.phase === 'down' && cv.playerOnPad) { this.done = true; this.showResults(); }
  }
  songLine() {
    const m = this.missionState(); const fmt = (x) => { x = Math.max(0, Math.round(x)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
    if (!m) return `♪ ${music.loaded ? music.name.slice(0, 18) : 'Mission'} ${fmt(this.missionLen)}`;
    return `♪ ${fmt(m.timeLeft)} left`;
  }
  showResults() {
    const cv = this.convoy; const f = this.mission === 'follow';
    const together = this.playerDownAt != null && cv.aiDownAt != null && Math.abs(this.playerDownAt - cv.aiDownAt) <= 12;
    const form = f ? Math.round(cv.score) : 0; const pad = 200; const tog = (together || !f) ? 300 : 0;
    const pct = f && cv.totalTime ? Math.round(cv.inPosTime / cv.totalTime * 100) : null;
    $('resTitle').textContent = (together || !f) ? 'Convoy home: landed together' : 'Convoy home';
    $('resBody').innerHTML = [
      f ? `<div><span>Formation score</span><b>${form}</b></div>` : '',
      pct != null ? `<div><span>Time in formation</span><b>${pct}%</b></div>` : '',
      `<div><span>Landed on the pad</span><b>+${pad}</b></div>`,
      `<div><span>Landed with the convoy</span><b>${tog ? '+' + tog : 'missed'}</b></div>`,
      `<div class="tot"><span>Total</span><b>${form + pad + tog}</b></div>`,
    ].join('');
    $('results').classList.remove('hidden');
  }
  heading() {
    const b = this.body; const f = b.fwd(); let hx, hz;
    if (Math.abs(f.y) < 0.75) { hx = f.x; hz = f.z; } else { const r = b.right(); hx = r.z; hz = -r.x; }
    return Math.atan2(-hx, -hz);
  }
  placeCameraInstant() { this.camYaw = this.heading(); this.updateCamera(0, true); }
  updateCamera(dt, instant = false) {
    const cam = this.camera, b = this.body;
    if (this.camMode === 'debug') return;
    if (this.camMode === 'chase') {
      const target = this.heading();
      let d = target - this.camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.camYaw += instant ? d : d * (1 - Math.exp(-dt * 5));
      // rigidly attached to the heli (no positional lag = no jitter); only heading/roll are smoothed
      const back = new V3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
      const want = b.pos.clone().addScaledVector(back, +this.c.camDist).add(new V3(0, +this.c.camHeight, 0));
      const pivot = b.pos.clone().add(new V3(0, 0.08, 0));
      const t = this.world.segmentBlocked(pivot, want, 12, 2.0); // only walls/containers, not fences or bales
      if (instant) this.camK = t; else this.camK += (t - this.camK) * (1 - Math.exp(-dt * (t < this.camK ? 25 : 3)));
      want.lerpVectors(pivot, want, Math.max(0.2, this.camK));
      const ty = this.world.terrainAt(want.x, want.z) + 0.12; if (want.y < ty) want.y = ty;
      this.camPos.copy(want);
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      const look = b.pos.clone().addScaledVector(back, -6).add(new V3(0, +this.c.camHeight * 0.9, 0));
      cam.lookAt(look);
      const rollT = THREE.MathUtils.clamp(b.right().y, -0.8, 0.8) * 0.18;
      this.camRoll = instant ? rollT : this.camRoll + (rollT - this.camRoll) * (1 - Math.exp(-dt * 4));
      cam.rotateZ(this.camRoll);
      cam.fov = +this.c.fov;
    } else if (this.camMode === 'cockpit') {
      cam.position.copy(b.pos).add(new V3(0, 0.035, -0.24).applyQuaternion(b.q));
      const tilt = this.c.flight === 'air' ? THREE.MathUtils.degToRad(+this.c.uptilt) : -0.12;
      cam.quaternion.copy(b.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)));
      cam.fov = Math.max(+this.c.fov, 95);
    } else {
      cam.position.copy(this.pilotPos); cam.up.set(0, 1, 0); cam.lookAt(b.pos);
      const dist = this.pilotPos.distanceTo(b.pos);
      cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(1.8 / dist)), 12, 75);
    }
    cam.updateProjectionMatrix();
  }

  hud(dt, st) {
    const b = this.body;
    // sticks every frame (mode 2: left = yaw/throttle, right = roll/pitch)
    const thrV = st.spring ? ((st.climb || 0) + 1) / 2 : st.thr;
    $('stickL').style.left = (50 + st.yaw * 42) + '%'; $('stickL').style.top = (50 - (thrV * 2 - 1) * 42) + '%';
    $('stickR').style.left = (50 + st.roll * 42) + '%'; $('stickR').style.top = (50 - st.pitch * 42) + '%';
    $('thrBar').style.height = (thrV * 100) + '%';
    this.hudT -= dt; if (this.hudT > 0) return; this.hudT = 0.08;
    const gy = Math.max(this.world.groundAt(b.pos.x, b.pos.z, b.pos.y), this.map.waterLevel ?? -1e9);
    $('hudAlt').textContent = Math.max(0, b.pos.y - GEAR_CLEAR - gy).toFixed(1);
    $('hudSpd').textContent = (b.vel.length() * 3.6).toFixed(0);
    $('hudRpm').textContent = Math.round(b.rpm * 100) + '%';
    const arm = $('hudArm'); arm.textContent = b.armed ? 'ARMED' : 'DISARMED'; arm.className = 'armed ' + (b.armed ? 'on' : 'off');
    const mapName = MAP_NAMES[this.c.map] || 'Farm';
    $('hudTL').innerHTML = `<span class="k">Map</span> ${mapName}<br><span class="k">Mode</span> ${this.c.flight === 'air' ? 'Air (acro)' : 'Gyro'}<br><span class="k">Input</span> ${st.source === 'phone' ? 'Phone (linked)' : st.source === 'touch' ? 'Phone' : st.source === 'gamepad' ? (st.spring ? 'Gamepad' : 'Radio') : 'Keyboard'}`;
    let status = '', meta = '', color = '#fff';
    const cv = this.convoy;
    if (cv && this.mission === 'follow') {
      status = cv.status; color = { TIGHT: '#6fd08c', GOOD: '#b9d86a', LOOSE: '#f0a43a', LOST: '#f05a4a' }[cv.status] || '#eef0e8';
      meta = cv.started ? `Gap ${cv.slotDist.toFixed(1)} m · In formation ${cv.totalTime ? Math.round(cv.inPosTime / cv.totalTime * 100) : 0}%` : 'Arm and lift off: the convoy launches with you';
      $('hudTR').innerHTML = `Score <b>${Math.round(cv.score)}</b><br>${this.songLine()}<br>Convoy ${cv.count}`;
    } else if (cv) {
      status = 'LEAD'; color = '#d7b23a'; meta = `${cv.count} escort${cv.count > 1 ? 's' : ''} on your six`;
      $('hudTR').innerHTML = `Escorts ${cv.count}<br>${this.songLine()}<br>Nearest ${cv.nearestDist(b.pos).toFixed(1)} m`;
    } else { status = 'FREE FLIGHT'; color = '#eef0e8'; $('hudTR').innerHTML = ''; }
    const ms = this.missionState();
    if (cv && ms && !this.done) {
      if (cv.phase === 'landing' || cv.phase === 'down' || (this.mission === 'follow' && ms.timeLeft < 25)) meta = cv.playerOnPad ? 'On the pad. Hold it there' : 'RTB: follow them down and land on the H pad';
      if (cv.phase === 'rtb') { status = 'RTB'; color = '#d7b23a'; meta = cv.playerOnPad ? 'On the pad: escorts landing beside you' : 'Return to base and land on the H pad'; }
    }
    $('hudStatus').textContent = status; $('hudStatus').style.color = color; $('hudMeta').textContent = meta;
    let msg = '';
    if (st.linkLost) msg = 'PHONE SIGNAL LOST<small>hovering until it reconnects</small>';
    else if (b.crashed) msg = `CRASHED<small>${b.crashReason}</small>`;
    else if (this.freezeT > 0) msg = `GET READY<small>back in formation in ${Math.ceil(this.freezeT)}</small>`;
    else if (this.armBlockedMsg > 0) { msg = st.spring ? 'CENTRE LEFT STICK<small>to arm</small>' : 'LOWER THROTTLE<small>to arm</small>'; this.armBlockedMsg -= 0.08; }
    else if (!b.armed && b.onGround) msg = st.armSwitch ? 'FLIP ARM SWITCH<small>to spool up</small>' : (st.source === 'phone' ? 'TAP ARM ON THE PHONE<small>then push left stick up to lift off</small>' : st.source === 'touch' ? 'TAP ARM<small>then push left stick up to lift off</small>' : st.spring ? 'CENTRE LEFT STICK<small>to arm</small>' : st.source === 'gamepad' ? 'LOWER THROTTLE<small>to arm</small>' : 'PRESS SPACE<small>to arm · W/S throttle</small>');
    else if (b.armed && b.rpm < 0.98 && b.onGround) msg = `SPOOLING UP<small>${Math.round(b.rpm * 100)}%</small>`;
    $('centerMsg').innerHTML = msg;
    // edge arrow towards the slot / escorts
    const arrow = $('edgeArrow');
    if (cv && this.mission === 'follow' && cv.slotDist > 10 && !b.crashed) {
      const p = cv.slot.clone().project(this.camera);
      const behind = p.z > 1;
      let x = p.x, y = p.y; if (behind) { x = -x; y = -y; }
      const onScreen = !behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.9;
      if (!onScreen) {
        const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 1e-3); x *= k; y *= k;
        arrow.classList.remove('hidden');
        arrow.style.left = ((x + 1) / 2 * innerWidth - 12) + 'px'; arrow.style.top = ((1 - y) / 2 * innerHeight - 12) + 'px';
        arrow.style.transform = `rotate(${Math.atan2(x, y)}rad)`;
      } else arrow.classList.add('hidden');
    } else arrow.classList.add('hidden');
  }
}

// ---------------- UI wiring
function syncSeg() {
  document.querySelectorAll('.seg[data-key]').forEach((seg) => {
    const k = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(cfg[k]) === b.dataset.v));
    if (k === 'count') seg.closest('.row').style.opacity = cfg.mission === 'free' ? 0.4 : 1;
  });
}
document.querySelectorAll('.seg[data-key]').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; cfg[seg.dataset.key] = b.dataset.v; saveCfg(); syncSeg();
}));
const sliderEls = [];
function buildSliders(el, list) {
  for (const [k, name, min, max, step] of list) {
    const w = document.createElement('div');
    w.innerHTML = `<label><span>${name}</span><span>${cfg[k]}</span></label><input type="range" min="${min}" max="${max}" step="${step}" value="${cfg[k]}">`;
    w.querySelector('input').oninput = (e) => {
      cfg[k] = +e.target.value; saveCfg(); if (game) game.c[k] = cfg[k];
      if (k === 'musicVol') music.setVolume(cfg[k]); if (k === 'missionMin') musicUI();
      for (const s of sliderEls) if (s.k === k) { s.inp.value = cfg[k]; s.lab.textContent = cfg[k]; }
    };
    sliderEls.push({ k, inp: w.querySelector('input'), lab: w.querySelector('label span:last-child') });
    el.appendChild(w);
  }
}
buildSliders($('inputSliders'), INPUT_SLIDERS); buildSliders($('sliders'), SLIDERS); buildSliders($('pauseSliders'), [['musicVol', 'Music volume (M to mute)', 0, 1, 0.05], ...INPUT_SLIDERS]); buildSliders($('musicSliders'), [['musicVol', 'Music volume (M to mute)', 0, 1, 0.05]]);
syncSeg();

const setup = initSetup(input, () => { if (game) { $('pause').classList.remove('hidden'); } else $('menu').classList.remove('hidden'); });
$('btnSetup').onclick = () => { $('menu').classList.add('hidden'); setup.open(); };
$('btnPauseSetup').onclick = () => { $('pause').classList.add('hidden'); setup.open(); };

const touch = initTouch(input, {
  onCam: () => { if (game) { const order = ['chase', 'cockpit', 'pilot']; game.camMode = order[(order.indexOf(game.camMode) + 1) % 3]; } },
  onPause: () => setPaused(true),
});
const wantTouch = () => cfg.touch === 'on' || (cfg.touch === 'auto' && COARSE);
function startGame() {
  $('loadMsg').textContent = 'Building world…';
  setTimeout(() => {
    try {
      if (game) { game.dispose(); game = null; }
      music.stop();
      game = new Game({ ...cfg });
      $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('loadMsg').textContent = '';
      touch.show(wantTouch());
      audio.start();
    } catch (err) { console.error(err); $('loadMsg').textContent = 'Error: ' + err.message; }
  }, 30);
}
$('btnFly').onclick = startGame;
function setPaused(p) {
  if (!game) return; game.paused = p; $('pause').classList.toggle('hidden', !p);
  if (p) { audio.mute(); music.pause(); } else music.resume();
}
function toMenu() { setPaused(false); music.stop(); game.dispose(); game = null; audio.mute(); touch.show(false); $('results').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); }
$('btnResume').onclick = () => setPaused(false);
$('btnRestart').onclick = () => { game.restart(); setPaused(false); };
$('btnQuit').onclick = toMenu;
$('btnAgain').onclick = () => { game.restart(); };
$('btnResMenu').onclick = toMenu;
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && $('setup').classList.contains('hidden')) setPaused(!game.paused);
  if (e.code === 'KeyC' && game) { const order = ['chase', 'cockpit', 'pilot']; game.camMode = order[(order.indexOf(game.camMode) + 1) % 3]; }
  if (e.code === 'KeyM') { cfg.musicVol = cfg.musicVol > 0 ? 0 : 0.6; music.setVolume(cfg.musicVol); saveCfg(); for (const s of sliderEls) if (s.k === 'musicVol') { s.inp.value = cfg.musicVol; s.lab.textContent = cfg.musicVol; } }
});
addEventListener('resize', () => game?.resize());

// phone controller (laptop side)
function phoneUI(s) {
  const txt = { connecting: 'Connecting…', waiting: 'Waiting for the phone…', connected: 'Phone connected ✓', unavailable: 'Couldn’t reach the pairing service. Check the internet and click New code.', taken: 'That code is busy. Click New code.', off: '' }[s] || s;
  $('phoneStatus').textContent = txt; $('phoneDot').classList.toggle('ok', s === 'connected');
  $('padDot').classList.toggle('ok', s === 'connected' || !!input.pad());
  if (s === 'connected') $('padText').textContent = 'Phone controller connected';
}
link.onstatus = phoneUI;
link.onevent = (k) => {
  if (k === 'fly' && !game) startGame();
  if (!game) return;
  if (k === 'reset') game.restart();
  if (k === 'cam') { const order = ['chase', 'cockpit', 'pilot']; game.camMode = order[(order.indexOf(game.camMode) + 1) % 3]; }
  if (k === 'pause') setPaused(!game.paused);
};
function loadQR() {
  const srcs = ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'];
  const tryLoad = (i) => new Promise((res) => {
    if (typeof window.qrcode === 'function') return res(true);
    if (i >= srcs.length) return res(false);
    const sc = document.createElement('script'); sc.src = srcs[i];
    sc.onload = () => res(typeof window.qrcode === 'function' ? true : tryLoad(i + 1)); sc.onerror = () => res(tryLoad(i + 1));
    document.head.appendChild(sc);
  });
  return tryLoad(0);
}
$('btnPhone').onclick = async () => {
  const code = newCode(); const url = `${SITE_URL}#pad-${code}`;
  $('phoneBox').classList.remove('hidden'); $('phoneCode').textContent = code; $('phoneLink').textContent = url;
  $('btnPhone').textContent = 'New code';
  const box = $('qr'); box.innerHTML = ''; box.classList.remove('hidden');
  let ok = false;
  if (await loadQR()) {
    try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); ok = true; } catch (e) { ok = false; }
  }
  if (!ok) box.classList.add('hidden');
  $('btnCopyLink').onclick = () => { navigator.clipboard?.writeText(url).then(() => { $('btnCopyLink').textContent = 'Copied ✓'; }, () => {}); };
  link.host(code);
};

// soundtrack picker
function musicUI() {
  $('musicName').textContent = music.loaded ? `${music.name} (${Math.floor(music.duration / 60)}:${String(Math.round(music.duration % 60)).padStart(2, '0')}) · convoy lasts the whole song` : `No song loaded · convoy lasts ${cfg.missionMin} min`;
  $('btnMusicClear').classList.toggle('hidden', !music.loaded);
}
music.onchange = musicUI; musicUI();
$('btnMusic').onclick = () => $('musicFile').click();
$('musicFile').onchange = async (e) => { const f = e.target.files[0]; if (f) { $('musicName').textContent = 'Loading…'; await music.load(f); } e.target.value = ''; };
$('btnMusicClear').onclick = () => music.clear();
$('btnFull').onclick = () => { const d = document.documentElement; (d.requestFullscreen?.() || d.webkitRequestFullscreen?.())?.catch?.(() => {}); };

// controller status on menu
function padStatus() {
  const p = input.pad();
  $('padDot').classList.toggle('ok', !!p);
  $('padText').textContent = p ? `Controller: ${p.id}` : (COARSE ? 'Phone detected: on-screen sticks appear when you fly.' : 'No controller detected. Pair “ExpressLRS Joystick”, then move a stick.');
}
addEventListener('gamepadconnected', padStatus); addEventListener('gamepaddisconnected', padStatus);

// phone opened with #pad-<code>: become the controller instead of the sim
const padMatch = /^#pad(?:-([a-z0-9]{4,6}))?$/.exec(location.hash);
if (padMatch) runPadPage(padMatch[1] || '', input, touch);
setInterval(() => { if (!game && link.status === 'connected') link.tell({ flying: false }); }, 1000);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game) game.update(dt); else if (!padMatch && link.status !== 'connected') padStatus();
}
requestAnimationFrame(frame);
window.__sim = { get game() { return game; }, input, cfg, startGame, music };
