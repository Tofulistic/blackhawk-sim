// Extra maps: Desert FOB, Forest River, Beach Sunrise
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { makeSky } from './sky.js';
import * as T from './textures.js';
import { std, instanced, sunShadow, glowSprite } from './maps.js';

const V3 = THREE.Vector3;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _su = new V3(), _sv = new V3(), _sf = new V3(), _wy = new V3(0, 1, 0);

// ---------- shared helpers
function setupSun(g, sunDir, color, intensity, hi) {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.position.copy(sunDir).multiplyScalar(120); g.add(sun); g.add(sun.target);
  if (hi) sunShadow(sun, 30, 2048);
  return (focus) => {
    const tx = 60 / 2048, su = _su.crossVectors(sunDir, _wy).normalize(), sv = _sv.crossVectors(su, sunDir);
    const fa = Math.round(focus.dot(su) / tx) * tx, fb = Math.round(focus.dot(sv) / tx) * tx, fc = focus.dot(sunDir);
    _sf.copy(su).multiplyScalar(fa).addScaledVector(sv, fb).addScaledVector(sunDir, fc);
    sun.position.copy(_sf).addScaledVector(sunDir, 120); sun.target.position.copy(_sf); sun.target.updateMatrixWorld();
  };
}
function terrainMesh(g, H, { size = 900, segs = 220, cx = 0, cz = 0, colorFn, tex, rep = 90 }) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
  const p = geo.attributes.position; const col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx, z = p.getZ(i) + cz; const h = H(x, z);
    p.setXYZ(i, x, h, z);
    const slope = Math.abs(H(x + 1, z) - H(x - 1, z)) + Math.abs(H(x, z + 1) - H(x, z - 1));
    const c = colorFn(x, z, h, slope); col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const t = tex; t.repeat.set(rep, rep);
  const m = new THREE.Mesh(geo, std({ map: t, vertexColors: true, roughness: 1 }));
  m.receiveShadow = true; g.add(m); return m;
}
// One water surface (no stacked planes = no flicker). High: reflective animated water; Low: simple opaque water.
function makeWater(g, { w, h, x = 0, z = 0, level = 0, color, hi, sunDir, distortion = 2.2, size = 1.6 }) {
  const nrm = T.waterNormalTex();
  if (hi) {
    const water = new Water(new THREE.PlaneGeometry(w, h), {
      textureWidth: 512, textureHeight: 512, waterNormals: nrm, sunDirection: (sunDir || new V3(0.3, 0.6, 0.2)).clone().normalize(),
      sunColor: 0xffe2b8, waterColor: new THREE.Color(color).getHex(), distortionScale: distortion, fog: true,
    });
    water.rotation.x = -Math.PI / 2; water.position.set(x, level, z); water.material.uniforms.size.value = size;
    g.add(water);
    return { refl: water, update(t) { water.material.uniforms.time.value = t * 0.5; } };
  }
  nrm.repeat.set(w / 7, h / 7);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), std({ color, roughness: 0.12, metalness: 0.2, normalMap: nrm, normalScale: new THREE.Vector2(0.18, 0.18) }));
  m.position.set(x, level, z); m.receiveShadow = true; g.add(m);
  return { refl: null, update(t) { nrm.offset.set(t * 0.012, t * 0.007); } };
}
function addBox(g, world, w, h, d, x, y, z, mat, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true; g.add(m);
  if (collide) world.addBox(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2);
  return m;
}
function routeFrom(points, H) { // points: [x, heightAboveGround, z] or [x, {abs:y}, z]
  return new THREE.CatmullRomCurve3(points.map(([x, h, z]) => new V3(x, typeof h === 'object' ? h.abs : H(x, z) + h, z)), true, 'centripetal');
}
function nearRouteFn(curve, n = 600) {
  const pts = curve.getSpacedPoints(n);
  return (x, z, r) => { const r2 = r * r; for (const p of pts) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) return true; return false; };
}
function rockGeo(r, h, seed) {
  const geo = new THREE.CylinderGeometry(r * 0.8, r, h, 10, 6); const p = geo.attributes.position; const rr = T.rng(seed);
  const off = Array.from({ length: 10 }, () => 0.85 + rr() * 0.3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(z, x);
    const k = off[Math.floor(((a + Math.PI) / (Math.PI * 2)) * 10) % 10] * (1 + 0.08 * Math.sin(y * 0.9 + a * 3));
    p.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals(); return geo;
}

// ===================================================== DESERT FOB
export function buildDesert({ scene, world, quality, renderer }) {
  const hi = quality === 'high';
  const g = new THREE.Group(); scene.add(g);
  const H = (x, z) => {
    const r = Math.max(Math.abs(x), Math.abs(z)); const k = ss(68, 140, r); if (k <= 0) return 0;
    const d = 2.6 * Math.sin(x * 0.045 + 1.3) * Math.sin(z * 0.038 + 0.4) + 1.5 * Math.sin(x * 0.09 + z * 0.05) + 0.8 * Math.sin(z * 0.13 - x * 0.07) + 2.6;
    return k * d * 1.5;
  };
  world.terrain = H;
  const sunDir = new V3(-0.6, 0.25, 0.75).normalize();
  const sky = makeSky({ sunDir, zenith: '#4f86c0', horizon: '#f2cf9c', horizonAway: '#c9d5df', sunColor: '#ffe0aa', cloudLit: '#fff0dc', cloudDark: '#a7b3c3', groundCol: '#b89565', cover: 0.28, sunSize: 0.025 });
  g.add(sky);
  scene.fog = new THREE.FogExp2('#e6cda4', 0.0032);
  renderer.toneMappingExposure = 0.78;
  g.add(new THREE.HemisphereLight('#cfe0f5', '#b08a5a', 1.0));
  const sunUpd = setupSun(g, sunDir, '#ffe3b8', 3.2, hi);

  const sand = T.sandTex();
  terrainMesh(g, H, { size: 1000, segs: 220, tex: sand, rep: 110, colorFn: (x, z, h, sl) => new THREE.Color(0.98, 0.9, 0.78).multiplyScalar(0.82 + Math.min(0.25, h * 0.03) - sl * 0.05) });
  // gravel pad inside the base
  const grav = T.concreteTex(201); grav.repeat.set(5, 5);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(124, 124).rotateX(-Math.PI / 2), std({ map: grav, color: '#d8c2a0', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
  pad.position.y = 0.02; pad.receiveShadow = true; g.add(pad);

  // HESCO walls
  const hes = T.hescoTex();
  const hescoMat = (len) => { const t = hes.clone(); t.needsUpdate = true; t.repeat.set(len / 1.1, 2); return std({ map: t, roughness: 1 }); };
  const hesco = (x0, z0, x1, z1, h = 2.2) => {
    const lx = Math.abs(x1 - x0) || 1.1, lz = Math.abs(z1 - z0) || 1.1;
    addBox(g, world, lx, h, lz, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, hescoMat(Math.max(lx, lz)));
  };
  hesco(-60, -60, 60, -60); hesco(-60, 60, 60, 60);
  hesco(60, -60, 60, -6); hesco(60, 6, 60, 60);
  hesco(-60, -60, -60, -46); hesco(-60, -34, -60, 60);
  hesco(-60, -20, -8, -20); hesco(12, 15, 60, 15);

  // helipads
  const hp = T.helipadTex();
  for (const x of [-35, -15, 5, 25]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), std({ map: hp, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }));
    m.position.set(x, 0.04, -40); m.receiveShadow = true; g.add(m);
  }
  // tents
  const canvasMat = std({ color: '#b9a682', roughness: 1 });
  const tent = (x, z, w, l) => {
    addBox(g, world, w, 2.2, l, x, 1.1, z, canvasMat);
    const sh = new THREE.Shape(); sh.moveTo(-w / 2 - 0.2, 0); sh.lineTo(w / 2 + 0.2, 0); sh.lineTo(0, 1.6); sh.closePath();
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: l + 0.4, bevelEnabled: false }).translate(0, 2.2, -l / 2 - 0.2), canvasMat);
    roof.position.set(x, 0, z); roof.castShadow = roof.receiveShadow = true; g.add(roof);
    world.addBox(x - w / 4, 2.2, z - l / 2, x + w / 4, 3.6, z + l / 2);
  };
  tent(-38, 30, 6, 12); tent(-24, 30, 6, 12); tent(-38, 46, 6, 12); tent(-24, 46, 6, 12); tent(-46, 0, 6, 10);
  // containers
  const corr = T.corrugatedTex();
  const cgeo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
  const conts = [];
  const cont = (x, z, rot, n, color) => { for (let k = 0; k < n; k++) conts.push({ x, y: 1.3 + k * 2.6, z, ry: rot ? Math.PI / 2 : 0, color }); const hx = rot ? 1.22 : 6.1, hz = rot ? 6.1 : 1.22; world.addBox(x - hx, 0, z - hz, x + hx, n * 2.6, z + hz); };
  cont(20, 26, false, 2, '#b59a6b'); cont(20, 29, false, 1, '#6d6a4f'); cont(20, 40, false, 1, '#8a7a58'); cont(-5, 30, true, 1, '#6d6a4f');
  g.add(instanced(cgeo, std({ map: corr, bumpMap: corr, bumpScale: 2, roughness: 0.6, metalness: 0.3 }), conts));
  // guard towers
  const wood = std({ color: '#7a6a52', roughness: 0.9 });
  for (const [x, z] of [[-55, -55], [55, -55], [55, 55], [-55, 55]]) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(g, world, 0.3, 7, 0.3, x + dx * 1.3, 3.5, z + dz * 1.3, wood);
    addBox(g, world, 3.6, 2.2, 3.6, x, 8.1, z, canvasMat); addBox(g, world, 4.2, 0.3, 4.2, x, 9.4, z, wood);
  }
  // comm mast
  const steel = std({ color: '#8a8d90', roughness: 0.5, metalness: 0.7 });
  const mast = new THREE.Group(); mast.position.set(38, 0, 40); g.add(mast);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 26, 6), steel); l.position.set(sx * 0.6, 13, sz * 0.6); mast.add(l); }
  for (let y = 1.5; y < 26; y += 2) for (const r of [0, Math.PI / 2]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.04), steel); m.position.y = y; m.rotation.y = r; mast.add(m); }
  const red = glowSprite(0xff3030, 1.6); red.position.set(0, 26.3, 0); mast.add(red);
  world.addBox(37, 0, 39, 39, 27, 41);
  // trucks
  const olive = std({ color: '#5e6146', roughness: 0.7, metalness: 0.2 }); const tire = std({ color: '#1a1a1a', roughness: 0.9 });
  const truck = (x, z, ry) => {
    const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = ry; g.add(t);
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.4, 4.6), olive); b.position.y = 1.4; t.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.8), olive); c.position.set(0, 2.6, -1.2); t.add(c);
    for (const [wx, wz] of [[-1.1, -1.5], [1.1, -1.5], [-1.1, 1.5], [1.1, 1.5]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 14).rotateZ(Math.PI / 2), tire); w.position.set(wx, 0.5, wz); t.add(w); }
    t.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    const hx = Math.abs(Math.cos(ry)) * 1.2 + Math.abs(Math.sin(ry)) * 2.4, hz = Math.abs(Math.sin(ry)) * 1.2 + Math.abs(Math.cos(ry)) * 2.4;
    world.addBox(x - hx, 0, z - hz, x + hx, 3.2, z + hz);
  };
  truck(-8, 5, 0.3); truck(-2, 6, 0.1); truck(30, -5, Math.PI / 2); truck(-30, -10, -0.4);
  // sandbags
  const bagMat = std({ color: '#a8916a', roughness: 1 });
  for (const [x, z, l, ry] of [[-50, -30, 6, 0], [44, -50, 5, Math.PI / 2], [0, 50, 8, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(l, 0.9, 0.7), bagMat); m.position.set(x, 0.45, z); m.rotation.y = ry; m.castShadow = true; g.add(m);
    const hx = ry ? 0.35 : l / 2, hz = ry ? l / 2 : 0.35; world.addBox(x - hx, 0, z - hz, x + hx, 0.9, z + hz);
  }

  const route = routeFrom([
    [-45, 3, -40], [-10, 3, -40], [25, 3, -42], [46, 3, -30], [48, 3, -6], [62, 3, 0], [85, 4, 8], [106, 4, 34], [112, 4, 74],
    [84, 4, 108], [38, 4, 124], [-14, 4, 112], [-58, 4, 122], [-100, 4, 92], [-122, 4, 46], [-116, 4, 0], [-98, 4, -38],
    [-76, 3, -40], [-62, 3, -40],
  ], H);
  const nearR = nearRouteFn(route);
  // mesas
  const rockMat = std({ map: T.rockTex(), roughness: 0.95 });
  const mesas = [[88, 58, 10, 22], [140, 30, 14, 30], [70, 140, 9, 18], [10, 150, 12, 26], [-40, 92, 8, 16], [-80, 150, 13, 28], [-150, 70, 12, 24], [-95, 40, 8, 14], [-150, -30, 14, 30], [-60, -110, 10, 20], [40, -120, 12, 26], [130, -70, 15, 32], [-128, -88, 9, 18]];
  mesas.forEach(([x, z, r, h], i) => {
    if (nearR(x, z, r + 6)) return;
    const base = H(x, z) - 1.5;
    const m = new THREE.Mesh(rockGeo(r, h, 300 + i), rockMat); m.position.set(x, base + h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m);
    world.addBox(x - r * 0.82, base, z - r * 0.82, x + r * 0.82, base + h, z + r * 0.82);
  });
  // scattered shrubs
  const shrubs = []; const rr = T.rng(4);
  for (let i = 0; i < 260; i++) { const x = (rr() - 0.5) * 500, z = (rr() - 0.5) * 500; if (Math.max(Math.abs(x), Math.abs(z)) < 64) continue; const s = 0.4 + rr() * 0.6; shrubs.push({ x, y: H(x, z) + s * 0.3, z, s, sy: s * 0.6, color: new THREE.Color().setHSL(0.17 + rr() * 0.05, 0.25, 0.28) }); }
  g.add(instanced(new THREE.IcosahedronGeometry(1, 1), std({ color: '#ffffff', roughness: 1 }), shrubs));

  const sunGlow = glowSprite(0xffe2b0, 120, 0.45); g.add(sunGlow);
  return {
    name: 'desert', route, sky,
    update(dt, t, focus, cam) { sky.position.copy(cam.position); sky.userData.uniforms.time.value = t; sunUpd(focus); sunGlow.position.copy(cam.position).addScaledVector(sunDir, 800); },
  };
}

// ===================================================== FOREST RIVER (morning mist)
export function buildForest({ scene, world, quality, renderer }) {
  const hi = quality === 'high';
  const g = new THREE.Group(); scene.add(g);
  const RX = (z) => 18 * Math.sin(z * 0.012) + 8 * Math.sin(z * 0.031 + 1);
  const WATER = -0.7;
  const H = (x, z) => {
    const d = Math.abs(x - RX(z));
    let h = ss(60, 170, d) * 34 * (0.75 + 0.25 * Math.sin(z * 0.02 + x * 0.01));
    h += 0.6 * Math.sin(x * 0.15) * Math.sin(z * 0.13) * ss(25, 45, d);
    if (d < 10) h -= 1.9 * (1 - (d / 10) ** 2);
    return h;
  };
  world.terrain = H;
  const sunDir = new V3(0.72, 0.14, -0.4).normalize();
  const sky = makeSky({ sunDir, zenith: '#7aa4cc', horizon: '#f4d8b4', horizonAway: '#c6d4dc', sunColor: '#ffe6c2', cloudLit: '#fff2e2', cloudDark: '#9fb0c0', groundCol: '#4a5a40', cover: 0.35, sunSize: 0.028 });
  g.add(sky);
  scene.fog = new THREE.FogExp2('#cdd6d6', 0.0085);
  renderer.toneMappingExposure = 0.85;
  g.add(new THREE.HemisphereLight('#c5d8ea', '#4d5a3c', 1.05));
  const sunUpd = setupSun(g, sunDir, '#ffe2bc', 2.8, hi);

  terrainMesh(g, H, {
    size: 1000, segs: 240, tex: T.grassTex(), rep: 160,
    colorFn: (x, z, h, sl) => {
      const d = Math.abs(x - RX(z));
      const c = new THREE.Color(0.95, 1.0, 0.85);
      if (d < 11) c.lerp(new THREE.Color(0.62, 0.56, 0.46), ss(11, 7, d));
      if (h > 6) c.lerp(new THREE.Color(0.55, 0.62, 0.45), ss(6, 20, h));
      return c.multiplyScalar(0.9 - Math.min(0.3, sl * 0.05));
    },
  });
  const water = makeWater(g, { w: 700, h: 700, level: WATER, color: '#2f4a46', hi, sunDir, distortion: 1.2, size: 2.4 });

  // route: down the river, out and back through a forest trail
  const pts = [[-66, 3.2, 40], [-74, 3.2, -40], [-66, 3.2, -120], [-50, 3, -198], [RX(-214) - 8, 2.5, -218]];
  for (let z = -190; z <= 190; z += 20) pts.push([RX(z), { abs: WATER + 1.45 }, z]);
  pts.push([RX(212) - 14, 3, 218], [-58, 3.2, 200], [-72, 3.2, 120]);
  const route = routeFrom(pts, H);
  const nearR = nearRouteFn(route, 900);

  // bridge
  const plank = T.plankTex(); plank.repeat.set(6, 1);
  const deckMat = std({ map: plank, roughness: 0.85 }); const beam = std({ color: '#4f3d2c', roughness: 0.9 });
  const bx = RX(0);
  addBox(g, world, 28, 0.4, 3.6, bx, 2.6, 0, deckMat);
  for (const s of [-1, 1]) { addBox(g, world, 0.7, 2.6, 3.6, bx + s * 10.8, 1.1, 0, beam); addBox(g, world, 28, 0.12, 0.12, bx, 3.75, s * 1.7, beam); }
  for (let x = -13; x <= 13; x += 2.6) for (const s of [-1, 1]) addBox(g, world, 0.12, 1.0, 0.12, bx + x, 3.3, s * 1.7, beam, false);
  // fallen log across the river
  const lz = 92, lx = RX(lz);
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 26, 12).rotateZ(Math.PI / 2), std({ color: '#5a4632', roughness: 1 }));
  log.position.set(lx, 2.3, lz); log.rotation.y = 0.15; log.castShadow = true; g.add(log);
  world.addBox(lx - 13, 1.85, lz - 2.2, lx + 13, 2.8, lz + 2.2);
  // cabin
  const logMat = std({ map: T.barnTex(), color: '#c59a6e', roughness: 0.9 });
  addBox(g, world, 8, 3.4, 6, -34, H(-34, 30) + 1.7, 30, logMat);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.6, 4), std({ color: '#3d3a36', roughness: 0.8 })); roof.position.set(-34, H(-34, 30) + 4.7, 30); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.8); roof.castShadow = true; g.add(roof);
  world.addBox(-38.5, H(-34, 30) + 3.4, 26.5, -29.5, H(-34, 30) + 6, 33.5);

  // pines
  const trunks = [], crowns = []; const rr = T.rng(21);
  for (let i = 0; i < 3200; i++) {
    const x = (rr() - 0.5) * 460, z = (rr() - 0.5) * 560;
    const d = Math.abs(x - RX(z)); if (d < 13) continue;
    if (nearR(x, z, 7)) continue;
    if (Math.abs(z) < 6 && d < 18) continue;
    if (Math.hypot(x + 34, z - 30) < 12) continue;
    const h = 7 + rr() * 9; const y = H(x, z);
    const col = new THREE.Color().setHSL(0.3 + rr() * 0.06, 0.35, 0.14 + rr() * 0.06);
    trunks.push({ x, y: y + h * 0.2, z, sx: 1, sy: h * 0.4, sz: 1 });
    crowns.push({ x, y: y + h * 0.55, z, sx: h * 0.26, sy: h * 0.75, sz: h * 0.26, color: col });
    crowns.push({ x, y: y + h * 0.85, z, sx: h * 0.18, sy: h * 0.45, sz: h * 0.18, color: col });
    world.addBox(x - h * 0.16, y, z - h * 0.16, x + h * 0.16, y + h * 1.05, z + h * 0.16);
  }
  g.add(instanced(new THREE.CylinderGeometry(0.18, 0.25, 1, 6), std({ color: '#4a3826', roughness: 1 }), trunks));
  g.add(instanced(new THREE.ConeGeometry(1, 1, 8), std({ color: '#ffffff', roughness: 1 }), crowns));
  // river rocks
  const rocks = [];
  for (let i = 0; i < 70; i++) {
    const z = (rr() - 0.5) * 480; const side = rr() < 0.5 ? -1 : 1; const x = RX(z) + side * (7.5 + rr() * 4); const s = 0.5 + rr() * 1.1;
    if (nearR(x, z, s + 1.5)) continue;
    rocks.push({ x, y: H(x, z) + s * 0.3, z, s, sy: s * 0.7, ry: rr() * 6 });
    world.addBox(x - s * 0.8, H(x, z) - 1, z - s * 0.8, x + s * 0.8, H(x, z) + s, z + s * 0.8);
  }
  g.add(instanced(new THREE.IcosahedronGeometry(1, 1), std({ color: '#7c7c76', roughness: 0.9, flatShading: true }), rocks));

  return {
    name: 'forest', route, sky, reflector: water.refl, waterLevel: WATER,
    update(dt, t, focus, cam) { sky.position.copy(cam.position); sky.userData.uniforms.time.value = t; sunUpd(focus); water.update(t); },
  };
}

// ===================================================== BEACH SUNRISE
export function buildBeach({ scene, world, quality, renderer }) {
  const hi = quality === 'high';
  const g = new THREE.Group(); scene.add(g);
  const SH = (z) => 6 * Math.sin(z * 0.02) + 3 * Math.sin(z * 0.057);
  const H = (x, z) => {
    const s = x - SH(z);
    if (s < 0) return 0.6 + ss(-35, -80, s) * (1.4 + 0.9 * Math.sin(z * 0.08) * Math.sin(x * 0.11));
    return Math.max(-7, 0.6 - s * 0.16);
  };
  world.terrain = H;
  const sunDir = new V3(1, 0.05, 0.22).normalize();
  const sky = makeSky({ sunDir, zenith: '#6a8ec2', horizon: '#ffa868', horizonAway: '#e3b2ac', sunColor: '#ffc07a', cloudLit: '#ffc29c', cloudDark: '#6d6f90', groundCol: '#2c4a5a', cover: 0.5, sunSize: 0.032, sunGlow: 1.15 });
  g.add(sky);
  scene.fog = new THREE.FogExp2('#e7b898', 0.0024);
  renderer.toneMappingExposure = 0.82;
  g.add(new THREE.HemisphereLight('#b2c6e6', '#a08060', 0.95));
  const sunUpd = setupSun(g, sunDir, '#ffc78f', 3.0, hi);

  terrainMesh(g, H, {
    size: 1000, segs: 220, tex: T.sandTex(), rep: 120,
    colorFn: (x, z, h) => {
      const s = x - SH(z); const c = new THREE.Color(1, 0.94, 0.84);
      if (s > -3) c.multiplyScalar(0.78); // wet sand
      if (s < -45) c.lerp(new THREE.Color(0.62, 0.72, 0.45), ss(-45, -70, s));
      return c;
    },
  });
  const water = makeWater(g, { w: 900, h: 1100, x: 400, z: 0, level: 0, color: '#123f52', hi, sunDir, distortion: 2.6, size: 1.4 });

  // pier
  const plank = T.plankTex(); plank.repeat.set(30, 1);
  const deckMat = std({ map: plank, roughness: 0.85 }); const post = std({ color: '#5b4835', roughness: 0.9 });
  addBox(g, world, 98, 0.35, 4.6, 43, 3.42, 0, deckMat, false);
  world.addBox(-6, 3.25, -2.3, 92, 4.7, 2.3);
  const pil = [];
  for (let x = 0; x <= 90; x += 6) for (const s of [-1, 1]) { pil.push({ x, y: -1.5, z: s * 1.95, sy: 9.5 }); world.addBox(x - 0.2, -7, s * 1.95 - 0.2, x + 0.2, 3.3, s * 1.95 + 0.2); }
  g.add(instanced(new THREE.CylinderGeometry(0.18, 0.2, 1, 8), post, pil));
  for (const s of [-1, 1]) addBox(g, world, 98, 0.1, 0.1, 43, 4.6, s * 2.2, post, false);
  addBox(g, world, 8, 3, 4.4, 87, 5.1, 0, std({ color: '#e8e2d4', roughness: 0.8 }), true);
  for (let x = 10; x < 80; x += 20) { const l = glowSprite(0xffe0b0, 0.8); l.position.set(x, 5.4, 2.2); g.add(l); addBox(g, world, 0.1, 1.8, 0.1, x, 4.5, 2.2, post, false); }

  const route = routeFrom([
    [-40, 2.0, 0], [-22, { abs: 2.2 }, 0], [0, { abs: 1.6 }, 0], [40, { abs: 1.6 }, 0], [80, { abs: 1.6 }, 0], [93, { abs: 1.7 }, 0], [104, { abs: 2.2 }, 0],
    [124, { abs: 4 }, 30], [112, { abs: 5 }, 66], [76, { abs: 5 }, 100], [24, 3.5, 122], [-22, 3, 112], [-38, 3, 62],
    [-42, 3, 14], [-40, 3, -40], [-30, 3, -100], [8, { abs: 3.5 }, -132], [40, { abs: 4 }, -110], [30, { abs: 3.5 }, -60], [-5, 3, -30], [-30, 2.6, -14],
  ], H);
  const nearR = nearRouteFn(route);

  // lifeguard towers
  const white = std({ color: '#f0ece2', roughness: 0.7 }); const redM = std({ color: '#c23b2a', roughness: 0.7 });
  for (const z of [-62, 58]) {
    const x = SH(z) - 12, y = H(x, z);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(g, world, 0.18, 3, 0.18, x + dx, y + 1.5, z + dz, white);
    addBox(g, world, 2.6, 1.8, 2.6, x, y + 3.9, z, redM); addBox(g, world, 3, 0.2, 3, x, y + 4.9, z, white);
  }
  // umbrellas
  const cols = ['#e05a3a', '#3a8fe0', '#f2c43a', '#3ab07a', '#ffffff'];
  const ur = T.rng(9);
  for (let i = 0; i < 18; i++) {
    const z = (ur() - 0.5) * 240, x = SH(z) - 8 - ur() * 14; if (nearR(x, z, 4) || Math.abs(z) < 8) continue;
    const y = H(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), white); pole.position.set(x, y + 1.2, z); g.add(pole);
    const can = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 10), std({ color: cols[i % cols.length], roughness: 0.8 })); can.position.set(x, y + 2.4, z); can.castShadow = true; g.add(can);
    world.addBox(x - 1.3, y, z - 1.3, x + 1.3, y + 2.65, z + 1.3);
  }
  // palms
  const trunkMat = std({ color: '#8b7356', roughness: 1 }); const frondMat = std({ color: '#3f6b2c', roughness: 0.9, side: THREE.DoubleSide });
  const pr = T.rng(12);
  for (let i = 0; i < 40; i++) {
    const z = (pr() - 0.5) * 320, x = SH(z) - 22 - pr() * 34; if (nearR(x, z, 6)) continue;
    const y = H(x, z), h = 7 + pr() * 4, lean = (pr() - 0.5) * 0.5;
    const palm = new THREE.Group(); palm.position.set(x, y, z); palm.rotation.z = lean; palm.rotation.y = pr() * 6; g.add(palm);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, h, 8), trunkMat); tr.position.y = h / 2; tr.castShadow = true; palm.add(tr);
    for (let k = 0; k < 8; k++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 3.6).translate(0, 1.8, 0), frondMat);
      f.position.y = h; f.rotation.y = (k / 8) * Math.PI * 2; f.rotation.x = 1.1 + pr() * 0.3; f.castShadow = true; palm.add(f);
    }
    const tx = x - Math.sin(lean) * h;
    world.addBox(Math.min(x, tx) - 0.4, y, z - 0.4, Math.max(x, tx) + 0.4, y + h - 0.5, z + 0.4);
    world.addBox(tx - 3, y + h - 1.2, z - 3, tx + 3, y + h + 0.6, z + 3);
  }
  // beach houses
  const hcols = ['#f3e6cf', '#cfe3e8', '#f0d4c4', '#e5ecd6'];
  for (let i = 0; i < 7; i++) {
    const z = -150 + i * 48, x = SH(z) - 80, y = H(x, z);
    addBox(g, world, 10, 5, 12, x, y + 2.5, z, std({ color: hcols[i % 4], roughness: 0.8 }));
    const r = new THREE.Mesh(new THREE.ConeGeometry(8.5, 3, 4), std({ color: '#8c5a44', roughness: 0.7 })); r.position.set(x, y + 6.5, z); r.rotation.y = Math.PI / 4; r.scale.set(0.85, 1, 1); r.castShadow = true; g.add(r);
    world.addBox(x - 5.5, y + 5, z - 6, x + 5.5, y + 8, z + 6);
  }
  // boats (bobbing)
  const boats = [];
  for (const [x, z, ry, c] of [[78, 52, 0.6, '#f2f2ee'], [140, -10, 1.8, '#2c4f7a'], [66, -48, -0.4, '#c8402e']]) {
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = ry; g.add(b);
    const sh = new THREE.Shape(); sh.moveTo(-1.4, 0); sh.lineTo(1.4, 0); sh.lineTo(1.6, 1.2); sh.lineTo(-1.6, 1.2); sh.closePath();
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 8, bevelEnabled: false }).translate(0, -0.4, -4), std({ color: c, roughness: 0.5 }));
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.6), white); cab.position.set(0, 1.5, 0.5);
    const mastB = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), white); mastB.position.set(0, 3.8, -1);
    [hull, cab, mastB].forEach((m) => { m.castShadow = true; b.add(m); });
    boats.push({ b, ph: x });
    world.addBox(x - 4.5, -1, z - 4.5, x + 4.5, 2.8, z + 4.5); world.addBox(x - 0.3, 2.8, z - 0.3, x + 0.3, 7, z + 0.3);
  }
  // breakwater rocks
  const rocks = []; const rk = T.rng(14);
  for (let i = 0; i < 40; i++) { const x = -5 + i * 2.2 + rk() * 1.5, z = -165 + rk() * 3, s = 1.2 + rk() * 1.3; rocks.push({ x, y: H(x, z) + s * 0.4, z, s, ry: rk() * 6 }); world.addBox(x - s, H(x, z) - 2, z - s, x + s, H(x, z) + s * 1.2, z + s); }
  g.add(instanced(new THREE.IcosahedronGeometry(1, 1), std({ color: '#6f6a64', roughness: 0.9, flatShading: true }), rocks));

  const sunGlow = glowSprite(0xffc890, 150, 0.6); g.add(sunGlow);
  return {
    name: 'beach', route, sky, reflector: water.refl, waterLevel: 0,
    update(dt, t, focus, cam) {
      sky.position.copy(cam.position); sky.userData.uniforms.time.value = t; sunUpd(focus); water.update(t);
      sunGlow.position.copy(cam.position).addScaledVector(sunDir, 800);
      for (const { b, ph } of boats) { b.position.y = Math.sin(t * 1.1 + ph) * 0.12; b.rotation.z = Math.sin(t * 0.9 + ph) * 0.04; }
    },
  };
}
