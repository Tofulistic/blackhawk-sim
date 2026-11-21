import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { makeSky } from './sky.js';
import * as T from './textures.js';

const V3 = THREE.Vector3;
const _su = new THREE.Vector3(), _sv = new THREE.Vector3(), _sf = new THREE.Vector3(), _wy = new THREE.Vector3(0, 1, 0);
export const std = (o) => new THREE.MeshStandardMaterial(o);

export function instanced(geo, mat, list, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), e = new THREE.Euler();
  list.forEach((it, i) => {
    q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0));
    s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    m.compose(new V3(it.x, it.y, it.z), q, s); im.setMatrixAt(i, m);
    if (it.color) im.setColorAt(i, new THREE.Color(it.color));
  });
  im.castShadow = cast; im.receiveShadow = receive;
  return im;
}

export function sunShadow(light, size = 32, res = 2048) {
  light.castShadow = true;
  light.shadow.mapSize.set(res, res);
  const c = light.shadow.camera; c.left = -size; c.right = size; c.top = size; c.bottom = -size; c.near = 1; c.far = 300;
  light.shadow.bias = -0.0004; light.shadow.normalBias = 0.02;
}

export function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(size); return s;
}

// ===================================================== FARM (sunset)
export function buildFarm({ scene, world, quality, renderer }) {
  const hi = quality === 'high';
  const g = new THREE.Group(); scene.add(g);
  const sunDir = new V3(0.18, 0.055, 1).normalize();
  const sky = makeSky({
    sunDir, zenith: '#4f7fb5', horizon: '#ffb36e', horizonAway: '#d79c94', sunColor: '#ffc27a',
    cloudLit: '#ffb48a', cloudDark: '#5d6385', groundCol: '#3a3626', cover: 0.62, sunSize: 0.03, sunGlow: 1.1,
  });
  g.add(sky);
  scene.fog = new THREE.FogExp2('#d9a283', 0.0028);
  renderer.toneMappingExposure = 0.85;

  const hemi = new THREE.HemisphereLight('#a8bddc', '#6e5a3a', 1.0); g.add(hemi);
  const sun = new THREE.DirectionalLight('#ffc48a', 3.0);
  sun.position.copy(sunDir).multiplyScalar(120); g.add(sun); g.add(sun.target);
  if (hi) sunShadow(sun, 30, 2048);

  // ground: big plane with low-freq vertex colour variation
  const ground = new THREE.PlaneGeometry(1800, 1800, 180, 180).rotateX(-Math.PI / 2);
  const col = []; const p = ground.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const n = T.fbm(x / 120 + 50, z / 120 + 50, 4, 5);
    const n2 = T.fbm(x / 35, z / 35, 3, 6);
    const green = Math.max(0, Math.min(1, (n - 0.42) * 3));
    const c = new THREE.Color().setRGB(1, 0.96, 0.85).lerp(new THREE.Color(0.62, 0.8, 0.5), green * 0.8).multiplyScalar(0.82 + n2 * 0.3);
    col.push(c.r, c.g, c.b);
  }
  ground.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const field = T.fieldTex(); field.repeat.set(130, 130);
  const gm = new THREE.Mesh(ground, std({ map: field, vertexColors: true, roughness: 1 }));
  gm.receiveShadow = true; g.add(gm);

  const grassT = T.grassTex(); const dirtT = T.dirtTex();
  const strip = (w, l, x, z, ry, tex, rep, y = 0.03) => {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rep[0], rep[1]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), std({ map: t, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 - y * 30 }));
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m); return m;
  };
  strip(14, 340, 0, 0, 0, grassT, [3, 70], 0.02);           // grass verge along road
  strip(4.2, 340, 0, 0, 0, dirtT, [1, 80], 0.04);           // main dirt road
  strip(60, 14, -30, 40, 0, grassT, [12, 3], 0.02);
  strip(60, 4, -30, 40, 0, dirtT, [14, 1], 0.04);            // cross road to barn
  strip(70, 60, -40, 60, 0, grassT, [14, 12], 0.025);        // farmyard lawn

  // ---- gate arch
  const wood = std({ color: '#5a3f2a', roughness: 0.9 });
  const box = (w, h, d, x, y, z, mat, collide = true, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true; g.add(m);
    if (collide) {
      const hw = ry ? d / 2 : w / 2, hd = ry ? w / 2 : d / 2;
      world.addBox(x - hw, y - h / 2, z - hd, x + hw, y + h / 2, z + hd);
    }
    return m;
  };
  box(0.45, 5.2, 0.45, -3.4, 2.6, -105, wood); box(0.45, 5.2, 0.45, 3.4, 2.6, -105, wood);
  box(8.6, 0.5, 0.5, 0, 4.9, -105, wood);
  // ranch fence from gate
  const fenceItems = [], railItems = [];
  const white = std({ color: '#eeeeea', roughness: 0.7 });
  const fenceLine = (x0, z0, x1, z1, h = 1.35) => {
    const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.ceil(L / 2.4); const ry = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) { const t = i / n; fenceItems.push({ x: x0 + (x1 - x0) * t, y: h / 2, z: z0 + (z1 - z0) * t, sy: h }); }
    for (const yy of [0.45, 0.85, 1.25]) railItems.push({ x: (x0 + x1) / 2, y: yy * (h / 1.35), z: (z0 + z1) / 2, sz: L, ry });
    const pad = 0.12;
    world.addBox(Math.min(x0, x1) - pad, 0, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, h, Math.max(z0, z1) + pad);
  };
  fenceLine(3.6, -100, 3.6, 30); fenceLine(-3.6, -100, -3.6, -40);
  fenceLine(-45, -105, -3.7, -105); fenceLine(3.7, -105, 45, -105);
  fenceLine(-60, 33, -4, 33); fenceLine(-20, 47, -6, 47);
  g.add(instanced(new THREE.BoxGeometry(0.14, 1, 0.14), white, fenceItems));
  g.add(instanced(new THREE.BoxGeometry(0.06, 0.12, 1), white, railItems));

  // ---- barn
  const barnT = T.barnTex(); barnT.repeat.set(4, 1);
  const barnMat = std({ map: barnT, roughness: 0.85 });
  const trim = std({ color: '#f2f0ea', roughness: 0.7 });
  const roofT = T.roofTex(); roofT.repeat.set(6, 3);
  const roofMat = std({ map: roofT, roughness: 0.45, metalness: 0.55 });
  const barn = (cx, cz, W, L, H, R, rot = 0) => {
    const b = new THREE.Group(); b.position.set(cx, 0, cz); b.rotation.y = rot; g.add(b);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), barnMat); walls.position.y = H / 2; b.add(walls);
    const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(0, R); sh.closePath();
    const gable = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false }); gable.translate(0, H, -L / 2);
    b.add(new THREE.Mesh(gable, barnMat));
    const slope = Math.hypot(W / 2 + 0.6, R); const ang = Math.atan2(R, W / 2);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.18, L + 1.2), roofMat);
      r.position.set(s * (W / 4 + 0.15), H + R / 2 + 0.1, 0); r.rotation.z = -s * ang; b.add(r);
    }
    // white X doors on gable ends
    for (const s of [-1, 1]) {
      const dz = s * (L / 2 + 0.05);
      const frame = new THREE.Group(); frame.position.set(0, 0, dz); b.add(frame);
      const dw = W * 0.42, dh = H * 0.72;
      const bar = (w, h, x, y, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), trim); m.position.set(x, y, 0); m.rotation.z = rz; frame.add(m); };
      bar(dw, 0.25, 0, dh); bar(dw, 0.25, 0, 0.15); bar(0.25, dh, -dw / 2, dh / 2); bar(0.25, dh, dw / 2, dh / 2); bar(0.25, dh, 0, dh / 2);
      const diag = Math.hypot(dw / 2, dh); const a = Math.atan2(dw / 2, dh);
      for (const xs of [-1, 1]) { bar(0.22, diag, xs * dw / 4, dh / 2, a); bar(0.22, diag, xs * dw / 4, dh / 2, -a); }
      bar(W * 0.25, W * 0.18, 0, H + R * 0.35); // hay loft door
    }
    b.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    const hw = rot ? L / 2 : W / 2, hl = rot ? W / 2 : L / 2;
    world.addBox(cx - hw, 0, cz - hl, cx + hw, H, cz + hl);
    world.addBox(cx - hw * 0.6, H, cz - hl * (rot ? 0.6 : 1), cx + hw * 0.6, H + R * 0.8, cz + hl * (rot ? 0.6 : 1));
    return b;
  };
  barn(-30, 55, 14, 20, 6, 4.2);
  barn(-62, 18, 9, 12, 4, 2.6, Math.PI / 2);

  // silo
  const siloMat = std({ color: '#b9c0c4', roughness: 0.35, metalness: 0.75 });
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 14, 28), siloMat); silo.position.set(-46, 7, 26); g.add(silo);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.05, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), siloMat); dome.position.set(-46, 14, 26); g.add(dome);
  silo.castShadow = dome.castShadow = true; world.addBox(-49, 0, 23, -43, 17, 29);
  // farmhouse
  const house = std({ color: '#ece6da', roughness: 0.8 });
  box(10, 5, 8, -62, 2.5, 78, house);
  const hr = new THREE.Mesh(new THREE.ConeGeometry(7.5, 3.2, 4, 1), std({ color: '#4a4f57', roughness: 0.7 })); hr.position.set(-62, 6.6, 78); hr.rotation.y = Math.PI / 4; hr.scale.set(1, 1, 0.75); hr.castShadow = true; g.add(hr);
  world.addBox(-67.5, 5, 74, -56.5, 8.2, 82);

  // windmill
  const wm = new THREE.Group(); wm.position.set(46, 0, 96); g.add(wm);
  const steel = std({ color: '#7c7f80', roughness: 0.5, metalness: 0.7 });
  const H = 13;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, H * 1.01, 6), steel);
    leg.position.set(sx * 0.9, H / 2, sz * 0.9); leg.rotation.z = -sx * 0.12; leg.rotation.x = sz * 0.12; wm.add(leg);
  }
  for (let y = 2; y < H; y += 2.2) {
    const w = 1.8 * (1 - y / H * 0.85) + 0.3;
    for (const r of [0, Math.PI / 2]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.05, 0.05), steel); m.position.y = y; m.rotation.y = r; wm.add(m); }
  }
  const fan = new THREE.Group(); fan.position.set(0, H + 0.4, -0.5); wm.add(fan);
  for (let i = 0; i < 16; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 0.03).translate(0, 1.4, 0), steel); bl.rotation.z = i * Math.PI / 8; bl.rotation.y = 0.3; fan.add(bl); }
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 2.6), steel); vane.position.set(0, H + 0.4, 1.6); wm.add(vane);
  wm.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  world.addBox(44.6, 0, 94.6, 47.4, H + 3, 97.4);

  // tractor
  const red = std({ color: '#a3211b', roughness: 0.5, metalness: 0.3 });
  box(3.2, 1.5, 1.8, 48, 1.4, 66, red); box(1.4, 1.4, 1.5, 47.6, 2.7, 66, std({ color: '#222', roughness: 0.2, metalness: 0.4 }));
  for (const [x, r] of [[46.6, 0.85], [49.4, 0.5]]) for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.45, 16).rotateX(Math.PI / 2), std({ color: '#1a1a1a', roughness: 0.9 }));
    w.position.set(x, r, 66 + s * 1.05); w.castShadow = true; g.add(w);
  }

  // route (for convoy) – also used to keep bales off the path
  const route = [
    [0, 3, -150], [0, 3, -128], [0, 3.2, -105], [0, 3.2, -75], [6, 3, -48], [20, 2.6, -32], [40, 2.8, -15],
    [52, 3.4, 10], [46, 3.6, 44], [36, 4, 70], [22, 4.3, 104], [2, 3.8, 104], [-16, 3.4, 76], [-16, 3, 52],
    [-24, 3, 39], [-38, 3, 22], [-62, 3, 4], [-60, 2.6, -18], [-44, 2.6, -40], [-22, 3, -60], [-18, 3, -92],
    [-22, 3, -130], [-13, 3, -160], [-2, 3, -166],
  ].map((a) => new V3(...a));
  const curve = new THREE.CatmullRomCurve3(route, true, 'centripetal');
  const samples = curve.getSpacedPoints(400);
  const nearRoute = (x, z, r) => samples.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);

  // hay bales
  const r = T.rng(7); const bales = [];
  const baleR = 0.78, baleL = 1.25;
  while (bales.length < 70) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (9 + r() * 85), z = -95 + r() * 150;
    if (nearRoute(x, z, 6) || Math.abs(x) < 8) continue;
    if (x < -20 && z > 5) continue; // farmyard
    if (bales.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 9)) continue;
    const ry = r() * Math.PI;
    bales.push({ x, y: baleR, z, ry });
    const ex = Math.abs(Math.cos(ry)) * baleL / 2 + Math.abs(Math.sin(ry)) * baleR;
    const ez = Math.abs(Math.sin(ry)) * baleL / 2 + Math.abs(Math.cos(ry)) * baleR;
    world.addBox(x - ex, 0, z - ez, x + ex, baleR * 2, z + ez);
  }
  const baleGeo = new THREE.CylinderGeometry(baleR, baleR, baleL, 24, 1).rotateZ(Math.PI / 2);
  const straw = T.strawTex(); straw.repeat.set(1, 1);
  const baleMats = [std({ map: straw, roughness: 1 }), std({ map: T.baleEndTex(), roughness: 1 }), std({ map: T.baleEndTex(), roughness: 1 })];
  const baleMesh = instanced(baleGeo, baleMats, bales.map((b) => ({ ...b })));
  g.add(baleMesh);

  // trees: distant tree lines
  const trees = []; const tr = T.rng(17);
  const treeAt = (x, z, s) => trees.push({ x, y: s * 0.75, z, s, sy: s * (0.8 + tr() * 0.4), color: new THREE.Color().setHSL(0.24 + tr() * 0.05, 0.35, 0.12 + tr() * 0.06) });
  for (let i = 0; i < 520; i++) { const a = tr() * Math.PI * 2, rad = 230 + tr() * 90; treeAt(Math.cos(a) * rad, Math.sin(a) * rad, 6 + tr() * 6); }
  for (let x = -170; x < 170; x += 3 + tr() * 3) treeAt(x, 160 + tr() * 8, 4 + tr() * 3);
  for (let z = -170; z < 160; z += 3 + tr() * 4) { treeAt(-150 - tr() * 6, z, 4 + tr() * 3); treeAt(150 + tr() * 6, z, 4 + tr() * 3); }
  for (let i = 0; i < 14; i++) treeAt(-75 + tr() * 30, 62 + tr() * 40, 4 + tr() * 2.5);
  const blobs = [];
  for (const t of trees) for (let k = 0; k < 3; k++) {
    const a = tr() * 6.28, d = t.s * 0.45;
    blobs.push({ x: t.x + Math.cos(a) * d * (k ? 1 : 0), y: t.y * (k ? 0.85 : 1.15), z: t.z + Math.sin(a) * d * (k ? 1 : 0), s: t.s * (k ? 0.7 : 0.85), sy: t.sy * (k ? 0.7 : 0.9), color: t.color });
  }
  const treeMesh = instanced(new THREE.IcosahedronGeometry(1, 2), std({ color: '#ffffff', roughness: 1 }), blobs, { cast: true });
  g.add(treeMesh);
  for (const t of trees) if (Math.hypot(t.x, t.z) < 200) world.addBox(t.x - t.s * 0.8, 0, t.z - t.s * 0.8, t.x + t.s * 0.8, t.s * 1.6, t.z + t.s * 0.8);

  // grass tufts near the route for speed sensation
  if (hi) {
    const tufts = []; const gr = T.rng(99);
    for (let i = 0; i < 14000; i++) {
      const x = (gr() - 0.5) * 260, z = (gr() - 0.5) * 340;
      if (Math.abs(x) < 2.3) continue;
      const s = 0.6 + gr() * 0.9;
      tufts.push({ x, y: 0.07 * s, z, s, ry: gr() * 6, color: new THREE.Color().setHSL(0.12 + gr() * 0.06, 0.45, 0.16 + gr() * 0.1) });
    }
    g.add(instanced(new THREE.ConeGeometry(0.05, 0.15, 3), std({ color: '#ffffff', roughness: 1 }), tufts, { cast: false }));
  }

  // lens flare-ish glow at the sun
  const sunGlow = glowSprite(0xffc890, 160, 0.6); g.add(sunGlow);

  return {
    name: 'farm', route: curve, sky, sunDir, sun, envFrom: sky,
    update(dt, t, focus, cam) {
      sky.position.copy(cam.position); sky.userData.uniforms.time.value = t;
      fan.rotation.z += dt * 2.2;
      // snap the shadow camera to whole shadow-map texels so shadows don't shimmer as you fly
      const tx = 60 / 2048, su = _su.crossVectors(sunDir, _wy).normalize(), sv = _sv.crossVectors(su, sunDir);
      const fa = Math.round(focus.dot(su) / tx) * tx, fb = Math.round(focus.dot(sv) / tx) * tx, fc = focus.dot(sunDir);
      _sf.copy(su).multiplyScalar(fa).addScaledVector(sv, fb).addScaledVector(sunDir, fc);
      sun.position.copy(_sf).addScaledVector(sunDir, 120); sun.target.position.copy(_sf); sun.target.updateMatrixWorld();
      sunGlow.position.copy(cam.position).addScaledVector(sunDir, 800);
    },
  };
}

// ===================================================== CONTAINER YARD (night, wet)
export function buildYard({ scene, world, quality, renderer }) {
  const hi = quality === 'high';
  const g = new THREE.Group(); scene.add(g);
  const sky = makeSky({
    sunDir: new V3(0, -1, 0), zenith: '#04060c', horizon: '#4a3020', horizonAway: '#1c1d26', sunColor: '#000000',
    cloudLit: '#4a3a32', cloudDark: '#0c0e13', groundCol: '#0a0a0c', cover: 0.62, sunGlow: 0, cloudBright: 0.55,
  });
  g.add(sky);
  scene.fog = new THREE.FogExp2('#17161a', 0.011);
  renderer.toneMappingExposure = 1.05;

  g.add(new THREE.HemisphereLight('#3a4560', '#1c1712', 0.9));
  const moon = new THREE.DirectionalLight('#8a9ac0', 0.25); moon.position.set(-60, 90, 30); g.add(moon);

  // ---- wet ground
  const conc = T.concreteTex(); conc.repeat.set(25, 25);
  const wet = T.wetTex(); wet.repeat.set(14, 14);
  let reflector = null;
  const groundGeo = new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2);
  if (hi) {
    reflector = new Reflector(new THREE.PlaneGeometry(600, 600), {
      clipBias: 0.003, textureWidth: Math.floor(innerWidth * 0.5), textureHeight: Math.floor(innerHeight * 0.5), color: 0x9a9a9a,
    });
    reflector.rotation.x = -Math.PI / 2; reflector.position.y = -0.001; g.add(reflector);
  }
  const concMat = std({ map: conc, roughnessMap: wet, roughness: 0.75, metalness: 0.0, transparent: hi, alphaMap: hi ? wet : null, opacity: 1 });
  const concrete = new THREE.Mesh(groundGeo, concMat); concrete.position.y = 0.004; concrete.receiveShadow = true; g.add(concrete);
  if (reflector) {
    const orig = reflector.onBeforeRender;
    reflector.onBeforeRender = function (...a) { concrete.visible = false; orig.apply(this, a); concrete.visible = true; };
  }

  // ---- containers
  const CL = 12.2, CH = 2.6, CW = 2.44;
  const cgeo = new THREE.BoxGeometry(CL, CH, CW);
  const uv = cgeo.attributes.uv; for (let i = 8; i < 24; i++) uv.setX(i, uv.getX(i) * (CL / CH));
  const corr = T.corrugatedTex();
  const cmat = std({ map: corr, bumpMap: corr, bumpScale: 2.5, roughness: 0.55, metalness: 0.35 });
  const palette = ['#7b2a22', '#8f3a26', '#6e2620', '#5f84a8', '#7da2c0', '#3b5f8d', '#64686c', '#2d5946', '#9a5a2a', '#a9aeb0'];
  const cr = T.rng(5); const cont = [];
  const pick = () => palette[Math.floor(cr() * palette.length)];
  const addStack = (x, z, n, rot = false) => {
    for (let k = 0; k < n; k++) cont.push({ x, y: CH / 2 + k * CH, z, ry: rot ? Math.PI / 2 : 0, color: pick() });
    const hx = rot ? CW / 2 : CL / 2, hz = rot ? CL / 2 : CW / 2;
    world.addBox(x - hx, 0, z - hz, x + hx, n * CH, z + hz);
  };
  const wall = (zc, nOuterLo, nOuterHi, sOuter, sInner) => {
    for (let i = 0; i < 8; i++) {
      const x = -60 + CL / 2 + i * 12.5;
      const hA = sOuter === 'alley' ? 2 + Math.floor(cr() * 2) : 1 + Math.floor(cr() * 3);
      const hB = sInner === 'alley' ? 2 + Math.floor(cr() * 2) : 1 + Math.floor(cr() * 3);
      addStack(x, zc - 1.27, hA); addStack(x, zc + 1.27, hB);
    }
  };
  wall(-40, 0, 0, 'out', 'alley');
  wall(-28.6, 0, 0, 'alley', 'alley');
  wall(-17.2, 0, 0, 'alley', 'out');
  // scattered singles / doubles in the open yard (like the video)
  addStack(-45, 12, 1); addStack(-20, 5, 1, true); addStack(5, 15, 2); addStack(25, -2, 1, true);
  addStack(-66, -5, 1, true); addStack(-8, 26, 1); addStack(-34, 24, 1, true);
  for (let i = 0; i < 4; i++) addStack(75, -36 + i * 12.5, 1 + (i % 2), true); // under the crane
  for (let i = 0; i < 6; i++) addStack(-100, -40 + i * 12.5, 2 + (i % 2), true);
  for (let i = 0; i < 6; i++) addStack(110, -60 + i * 12.5, 1 + ((i + 1) % 3), true);
  const cm = instanced(cgeo, cmat, cont); g.add(cm);

  // ---- gantry crane
  const yellow = std({ color: '#d99a1c', roughness: 0.5, metalness: 0.4 });
  const orange = std({ color: '#c8641c', roughness: 0.5, metalness: 0.4 });
  const box = (w, h, d, x, y, z, mat, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m);
    if (collide) world.addBox(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2);
    return m;
  };
  for (const x of [70, 92]) for (const z of [-50, 12]) box(1.4, 22, 1.4, x, 11, z, orange);
  for (const x of [70, 92]) box(1.6, 1.8, 64, x, 22.5, -19, orange);
  for (const z of [-50, 12]) box(24, 1.6, 1.6, 81, 22.5, z, orange);
  for (const x of [70, 92]) box(2.2, 1.2, 66, x, 0.6, -19, std({ map: T.hazardTex(), roughness: 0.6 }));
  box(4, 3, 4, 81, 20, -12, yellow); // trolley/cab

  // ---- warehouse
  const wtex = T.corrugatedTex(); wtex.repeat.set(10, 2);
  const wmat = std({ map: wtex, color: '#8d9298', roughness: 0.6, metalness: 0.4 });
  box(110, 11, 20, -15, 5.5, 88, wmat);
  for (let i = 0; i < 6; i++) {
    const x = -60 + i * 18;
    box(6, 5.5, 0.2, x, 2.75, 77.9, std({ color: '#3f4448', roughness: 0.5, metalness: 0.5 }), false);
    const lamp = glowSprite(0xffd7a0, 2.2); lamp.position.set(x, 6.4, 77.4); g.add(lamp);
  }
  box(40, 7, 14, -105, 3.5, 70, wmat);

  // ---- fence (chain link)
  const linkT = T.chainLinkTex(); linkT.repeat.set(120, 3);
  const linkMat = std({ map: linkT, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 });
  const fence = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.4), linkMat); m.position.set((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); g.add(m);
    world.addBox(Math.min(x0, x1) - 0.1, 0, Math.min(z0, z1) - 0.1, Math.max(x0, x1) + 0.1, 2.5, Math.max(z0, z1) + 0.1);
  };
  fence(-130, -100, 130, -100); fence(-130, 110, 130, 110); fence(-130, -100, -130, 110); fence(130, -100, 130, 110);

  // ---- pallets / barrels
  const wood = std({ color: '#6b5236', roughness: 0.9 });
  for (const [x, z] of [[-30, 14], [-29, 15.5], [12, 2], [33, 18], [-55, -10]]) box(1.2, 0.5, 1.0, x, 0.25, z, wood);
  const blue = std({ color: '#2a4f9a', roughness: 0.5, metalness: 0.3 });
  for (const [x, z] of [[-28, 12], [-27, 12.4], [14, 3], [34, 16]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), blue); b.position.set(x, 0.45, z); b.castShadow = true; g.add(b);
    world.addBox(x - 0.3, 0, z - 0.3, x + 0.3, 0.9, z + 0.3);
  }

  // ---- floodlights
  const poleMat = std({ color: '#7a7e82', roughness: 0.5, metalness: 0.8 });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e8f0ff').multiplyScalar(12) });
  const flood = (x, z, tx, tz, shadow) => {
    const H = 22;
    box(0.5, H, 0.5, x, H / 2, z, poleMat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 1.2), headMat); head.position.set(x, H + 0.3, z); g.add(head);
    const glow = glowSprite(0xe8f0ff, 9); glow.position.set(x, H + 0.3, z); g.add(glow);
    const glow2 = glowSprite(0x9fd0ff, 15, 0.22); glow2.position.copy(glow.position); g.add(glow2);
    const sl = new THREE.SpotLight('#dfe8ff', 3200, 0, 1.0, 0.6, 2);
    sl.position.set(x, H, z); sl.target.position.set(tx, 0, tz); g.add(sl); g.add(sl.target);
    if (shadow && hi) { sl.castShadow = true; sl.shadow.mapSize.set(1024, 1024); sl.shadow.camera.near = 2; sl.shadow.camera.far = 80; sl.shadow.bias = -0.0005; }
  };
  flood(-55, 30, -45, 20, true); flood(15, 28, 5, 10, true); flood(-20, -8, -20, -22, false); flood(40, -55, 30, -35, false);
  flood(-75, -45, -60, -30, false); flood(96, 35, 82, 15, false); flood(62, 72, 50, 55, false);

  // ---- sodium street lights
  const sodium = (x, z, light) => {
    box(0.25, 9, 0.25, x, 4.5, z, poleMat);
    const s = glowSprite(0xffa040, 3.5); s.position.set(x, 9.1, z); g.add(s);
    const s2 = glowSprite(0xff8a30, 12, 0.3); s2.position.set(x, 9.1, z); g.add(s2);
    if (light) { const pl = new THREE.PointLight('#ff9a3c', 240, 40, 2); pl.position.set(x, 8.8, z); g.add(pl); }
  };
  sodium(-60, 68, true); sodium(-10, 68, true); sodium(40, 68, true); sodium(118, -20, false); sodium(118, 30, false); sodium(-118, 0, false);
  // distant city lights beyond fence
  const lr = T.rng(33);
  for (let i = 0; i < 46; i++) {
    const a = lr() * Math.PI * 2, rad = 170 + lr() * 160;
    const s = glowSprite(lr() < 0.75 ? 0xffa850 : 0xcfe2ff, 3 + lr() * 4); s.position.set(Math.cos(a) * rad, 5 + lr() * 9, Math.sin(a) * rad); g.add(s);
  }
  // grass strips at fence lines
  const grassT = T.grassTex(); grassT.repeat.set(60, 1);
  for (const [x, z, w, l] of [[0, -96, 260, 6], [0, 106, 260, 6]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), std({ map: grassT, color: '#7a8a70', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, 0.02, z); m.receiveShadow = true; g.add(m);
  }

  const route = [
    [-80, 3, 45], [-30, 3.4, 48], [20, 3.4, 45], [46, 3, 24], [54, 3, -4], [53, 3, -17], [45, 3, -22.9], [34, 3, -22.9], [10, 3, -22.9], [-30, 3, -22.9],
    [-62, 3, -22.9], [-74, 3, -25.5], [-74, 3, -31.5], [-62, 3, -34.3], [-30, 3, -34.3], [10, 3, -34.3], [36, 3, -34.3], [48, 3, -35.5], [56, 3.2, -44], [62, 3.4, -60],
    [81, 4, -58], [81, 4, -30], [81, 4, 0], [80, 4, 28], [60, 3.6, 54], [10, 3.6, 60], [-50, 3.4, 60], [-90, 3, 56],
  ].map((a) => new V3(...a));
  const curve = new THREE.CatmullRomCurve3(route, true, 'centripetal');

  return {
    name: 'yard', route: curve, sky, envFrom: null, reflector,
    update(dt, t, focus, cam) { sky.position.copy(cam.position); sky.userData.uniforms.time.value = t; },
  };
}
