// Procedural RC-scale Black Hawk style helicopter.
// Designed in full-scale metres, then scaled to RC size (~0.62 m long).
import * as THREE from 'three';
import { makeCanvas, toTex, noise2, glowTex } from './textures.js';

export const SCALE = 0.04;
export const GEAR_CLEAR = 0.07;        // CG height above wheels (RC metres)
export const ROTOR_R = 8.2 * SCALE;    // ~0.33 m

const Z0 = -7.65, Z1 = 7.6;
const FUSE = [
  // z, width, height, yCenter, superellipse n
  [-7.65, 0.25, 0.35, 1.15, 2.2],
  [-7.45, 1.0, 1.0, 1.18, 2.4],
  [-7.1, 1.6, 1.55, 1.3, 2.6],
  [-6.5, 2.05, 2.1, 1.45, 3.0],
  [-5.6, 2.3, 2.5, 1.58, 3.4],
  [-4.6, 2.38, 2.62, 1.62, 3.6],
  [-1.0, 2.4, 2.66, 1.63, 3.6],
  [0.6, 2.32, 2.5, 1.68, 3.4],
  [1.6, 1.95, 2.0, 1.85, 3.0],
  [2.5, 1.35, 1.45, 2.05, 2.6],
  [3.6, 0.95, 1.05, 2.15, 2.4],
  [5.4, 0.7, 0.78, 2.25, 2.3],
  [7.2, 0.5, 0.6, 2.35, 2.2],
  [7.6, 0.3, 0.45, 2.4, 2.0],
];
const COWL = [
  [-4.5, 1.1, 0.3, 2.95, 2.5],
  [-4.1, 1.75, 0.85, 3.1, 3],
  [-3.0, 2.0, 1.1, 3.25, 3.4],
  [0.4, 2.0, 1.15, 3.25, 3.4],
  [1.2, 1.5, 0.9, 3.15, 3],
  [1.8, 0.7, 0.35, 3.0, 2.5],
];

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function loft(sections, segs = 56, sub = 6) {
  const rings = [];
  const N = sections.length;
  for (let i = 0; i < N - 1; i++) {
    const s0 = sections[Math.max(0, i - 1)], s1 = sections[i], s2 = sections[i + 1], s3 = sections[Math.min(N - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      rings.push(s1.map((_, j) => j === 0 ? s1[0] + (s2[0] - s1[0]) * t : cr(s0[j], s1[j], s2[j], s3[j], t)));
    }
  }
  rings.push(sections[N - 1]);
  const z0 = sections[0][0], z1 = sections[N - 1][0];
  const pos = [], uv = [], idx = [];
  const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (const [z, w, h, yc, n] of rings) {
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const x = (w / 2) * sp(Math.sin(th), 2 / n);
      const y = yc - (h / 2) * sp(Math.cos(th), 2 / n);
      pos.push(x, y, z); uv.push((z - z0) / (z1 - z0), j / segs);
    }
  }
  const R = rings.length;
  for (let r = 0; r < R - 1; r++) for (let j = 0; j < segs; j++) {
    const a = r * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // caps
  const capFor = (ri, flip) => {
    const [z, , , yc] = rings[ri];
    const c = pos.length / 3; pos.push(0, yc, z); uv.push(ri === 0 ? 0 : 1, 0.5);
    for (let j = 0; j < segs; j++) {
      const a = ri * (segs + 1) + j;
      flip ? idx.push(c, a + 1, a) : idx.push(c, a, a + 1);
    }
  };
  capFor(0, false); capFor(R - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- fuselage paint ----------
let fuseMaps = null;
function fuselageMaps(base) {
  if (fuseMaps && fuseMaps.base === base) return fuseMaps;
  const W = 2048, H = 1024;
  const [c, g] = makeCanvas(W, H);
  const [rc, rg] = makeCanvas(W, H);
  const U = (z) => ((z - Z0) / (Z1 - Z0)) * W;
  const V = (v) => (1 - v) * H; // texture flipY
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(165,165,165)'; rg.fillRect(0, 0, W, H);
  // subtle mottling
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const n = (noise2(x / 90, y / 45, 7) - 0.5) * 14 + (noise2(x / 3, y / 3, 8) - 0.5) * 6;
    const i = (y * W + x) * 4; d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const rect = (z0, z1, v0, v1, col, rough = 20, radius = 8) => {
    const x = U(z0), w = U(z1) - x, y = V(v1), h = V(v0) - y;
    for (const [ctx, fill] of [[g, col], [rg, `rgb(${rough},${rough},${rough})`]]) {
      ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
    }
  };
  const glass = '#12171c';
  const both = (z0, z1, v0, v1, col = glass, rough = 18) => { rect(z0, z1, v0, v1, col, rough); rect(z0, z1, 1 - v1, 1 - v0, col, rough); };
  // panel lines
  g.strokeStyle = 'rgba(25,28,22,0.55)'; g.lineWidth = 2;
  for (const z of [-4.6, -1.05, 0.6, 2.5, 3.6, 5.4]) { g.beginPath(); g.moveTo(U(z), 0); g.lineTo(U(z), H); g.stroke(); }
  for (const v of [0.18, 0.82]) { g.beginPath(); g.moveTo(U(-6.8), V(v)); g.lineTo(U(1.6), V(v)); g.stroke(); }
  // cabin door outlines
  g.lineWidth = 3;
  for (const [v0, v1] of [[0.12, 0.41], [0.59, 0.88]]) g.strokeRect(U(-4.35), V(v1), U(-1.2) - U(-4.35), V(v0) - V(v1));
  // windshield (top front)
  rect(-6.9, -5.7, 0.39, 0.61, glass, 12, 14);
  g.fillStyle = base; g.fillRect(U(-6.9), V(0.503), U(-5.7) - U(-6.9), 6); // centre post
  // cockpit side windows + lower door windows
  both(-6.25, -4.75, 0.29, 0.385);
  both(-5.85, -4.95, 0.205, 0.275);
  // chin windows
  both(-7.25, -6.75, 0.09, 0.2);
  // gunner + cabin door windows
  both(-4.45, -3.95, 0.3, 0.385);
  both(-3.75, -2.85, 0.3, 0.385);
  both(-0.65, -0.05, 0.31, 0.37);
  // U.S. ARMY on boom (right side mirrored horizontally, left side flipped vertically)
  const text = (v, flipX, flipY) => {
    g.save(); g.translate(U(4.5), V(v)); g.scale(flipX ? -0.4 : 0.4, flipY ? -1 : 1);
    g.fillStyle = 'rgba(20,22,18,0.85)'; g.font = 'bold 70px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('U.S. ARMY', 0, 0); g.restore();
  };
  text(0.28, true, false); text(0.72, false, true);
  const map = toTex(c, { aniso: 8 }); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const rough = toTex(rc, { srgb: false }); rough.wrapS = rough.wrapT = THREE.ClampToEdgeWrapping;
  fuseMaps = { base, map, rough };
  return fuseMaps;
}

function decalTex(draw, size = 256) {
  const [c, g] = makeCanvas(size, size); draw(g, size);
  const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
const starTex = () => decalTex((g, S) => {
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(40,44,36,0.9)'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(150,155,140,0.95)'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(40,44,36,0.95)'; g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? S * 0.16 : S * 0.4, a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
  }
  g.fill();
});
const numTex = (n) => decalTex((g, S) => {
  g.clearRect(0, 0, S, S); g.fillStyle = 'rgba(25,27,22,0.95)';
  g.font = `bold ${S * 0.62}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n, S / 2, S / 2);
});
let discTexC = null;
function rotorDiscTex() {
  if (discTexC) return discTexC;
  const S = 512; const [c, g] = makeCanvas(S, S); const R = S / 2;
  const gr = g.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0, 'rgba(30,30,30,0)'); gr.addColorStop(0.08, 'rgba(30,30,30,0.0)');
  gr.addColorStop(0.15, 'rgba(35,35,35,0.28)'); gr.addColorStop(0.86, 'rgba(45,45,45,0.16)');
  gr.addColorStop(0.9, 'rgba(240,200,40,0.22)'); gr.addColorStop(0.97, 'rgba(240,200,40,0.2)'); gr.addColorStop(1, 'rgba(240,200,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  discTexC = toTex(c); return discTexC;
}

function mat(color, rough = 0.6, metal = 0.1) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }
function glowMat(color, k = 6) {
  const m = new THREE.MeshBasicMaterial({ color }); m.color.multiplyScalar(k); return m;
}

export function buildBlackHawk({ tailNumber = '55', base = '#5e6252', tint = null } = {}) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(SCALE);
  model.position.y = -1.75 * SCALE; // wheels bottom at -GEAR_CLEAR approx
  root.add(model);

  const maps = fuselageMaps(base);
  const bodyMat = new THREE.MeshStandardMaterial({ map: maps.map, roughnessMap: maps.rough, roughness: 1, metalness: 0.05 });
  if (tint) bodyMat.color.set(tint);
  const plain = mat(base, 0.62, 0.05);
  if (tint) plain.color.multiply(new THREE.Color(tint));
  const dark = mat('#1d1f1c', 0.5, 0.4);
  const metal = mat('#3a3c3a', 0.35, 0.7);
  const rubber = mat('#151515', 0.85, 0);

  const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; model.add(o); return o; };

  add(loft(FUSE, 64, 6), bodyMat);
  add(loft(COWL, 40, 4), plain);

  // engines
  for (const s of [-1, 1]) {
    const eng = add(new THREE.CylinderGeometry(0.42, 0.4, 3.2, 20).rotateX(Math.PI / 2), plain, s * 1.05, 3.28, -0.7);
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20).rotateX(Math.PI / 2), dark, s * 1.05, 3.28, -2.32);
    add(new THREE.TorusGeometry(0.36, 0.06, 8, 20), metal, s * 1.05, 3.28, -2.3);
    const ex = add(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 14).rotateX(Math.PI / 2), dark, s * 1.25, 3.3, 1.2);
    ex.rotation.y = s * 0.55;
    void eng;
  }
  // stub wings with rocket pods
  for (const s of [-1, 1]) {
    const w = add(new THREE.BoxGeometry(1.8, 0.12, 0.85), plain, s * 2.0, 2.62, -2.2); w.rotation.z = s * -0.18;
    add(new THREE.BoxGeometry(0.15, 0.5, 0.5), dark, s * 2.55, 2.25, -2.2);
    add(new THREE.CylinderGeometry(0.3, 0.3, 1.7, 14).rotateX(Math.PI / 2), plain, s * 2.55, 1.85, -2.2);
    add(new THREE.CircleGeometry(0.27, 14), dark, s * 2.55, 1.85, -3.06).rotation.y = Math.PI;
  }
  // door guns (M134-style rotary guns on pintle mounts at the cabin doors)
  const gunMetal = mat('#1b1c1b', 0.45, 0.6);
  for (const sd of [-1, 1]) {
    const gx = sd * 1.32, gy = 2.05, gz = -3.25;
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), metal, gx, gy - 0.3, gz);             // pintle post
    add(new THREE.BoxGeometry(0.22, 0.2, 0.55), gunMetal, gx, gy, gz + 0.05);                  // receiver
    const cl = new THREE.Group(); cl.position.set(gx, gy, gz - 0.5); model.add(cl);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 6).rotateX(Math.PI / 2), gunMetal);
      b.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.2); cl.add(b);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.02, 6, 14), gunMetal); ring.position.z = -0.55; cl.add(ring);
    cl.rotation.y = sd * 0.25;
    add(new THREE.BoxGeometry(0.12, 0.16, 0.22), gunMetal, gx - sd * 0.05, gy - 0.12, gz + 0.38); // grips
  }
  // mast + hub
  const RZ = -1.55, RY = 4.55;
  add(new THREE.CylinderGeometry(0.2, 0.28, 0.9, 12), metal, 0, 4.0, RZ);
  add(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20), metal, 0, 4.15, RZ); // swashplate

  // main rotor
  const rotor = new THREE.Group(); rotor.position.set(0, RY, RZ); model.add(rotor);
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#2b2d2b', roughness: 0.55, metalness: 0.2, transparent: true });
  const tipMat = new THREE.MeshStandardMaterial({ color: '#e0b52a', roughness: 0.5, transparent: true });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.4, 16), metal); rotor.add(hub);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.y = (i * Math.PI) / 2; rotor.add(arm);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.3).translate(0.75, 0, 0), metal); arm.add(grip);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.09, 0.53).translate(4.6, 0, 0), bladeMat); arm.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.53).translate(8.38, 0, 0), tipMat); arm.add(tip);
    blade.castShadow = tip.castShadow = true;
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(8.65, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: rotorDiscTex(), transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
  disc.position.set(0, RY, RZ); disc.renderOrder = 2; model.add(disc);

  // tail pylon
  const sh = new THREE.Shape();
  sh.moveTo(6.4, 2.05); sh.lineTo(7.7, 2.15); sh.lineTo(8.45, 4.55); sh.lineTo(7.85, 4.75); sh.lineTo(7.2, 3.1); sh.lineTo(6.4, 2.6); sh.closePath();
  const pyl = new THREE.ExtrudeGeometry(sh, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  pyl.translate(0, 0, -0.17); pyl.rotateY(-Math.PI / 2);
  add(pyl, plain);
  // stabilator
  add(new THREE.BoxGeometry(4.4, 0.08, 0.95), plain, 0, 2.3, 7.85);
  // tail rotor (right side, canted)
  const tailRotor = new THREE.Group(); tailRotor.position.set(0.42, 4.15, 8.05); tailRotor.rotation.z = -0.35; model.add(tailRotor);
  const trSpin = new THREE.Group(); tailRotor.add(trSpin);
  trSpin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10).rotateZ(Math.PI / 2), metal));
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.25).translate(0, 0.9, 0), bladeMat);
    b.rotation.x = (i * Math.PI) / 2; trSpin.add(b);
  }
  const trDisc = new THREE.Mesh(new THREE.CircleGeometry(1.75, 32).rotateY(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  tailRotor.add(trDisc);

  // landing gear
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.38, 0.38, 0.24, 20).rotateZ(Math.PI / 2), rubber, s * 1.5, 0.38, -4.3);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 12).rotateZ(Math.PI / 2), metal, s * 1.5, 0.38, -4.3);
    const strut = add(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 8), metal, s * 1.3, 0.72, -4.3); strut.rotation.z = s * 0.55;
    const drag = add(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8), metal, s * 1.35, 0.55, -4.85); drag.rotation.x = 1.1;
  }
  add(new THREE.CylinderGeometry(0.25, 0.25, 0.16, 16).rotateZ(Math.PI / 2), rubber, 0, 0.25, 6.6);
  const tstrut = add(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), metal, 0, 1.05, 6.35); tstrut.rotation.x = 0.35;

  // decals
  const decal = (tex, w, pos, normal) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.copy(pos); m.lookAt(pos.clone().add(normal)); model.add(m); return m;
  };
  decal(starTex(), 0.95, new THREE.Vector3(0, 3.77, -3.55), new THREE.Vector3(0, 1, -0.35));
  decal(numTex(tailNumber), 0.7, new THREE.Vector3(0, 1.62, -7.33), new THREE.Vector3(0, 0.25, -1));
  for (const s of [-1, 1]) decal(numTex(tailNumber), 0.8, new THREE.Vector3(s * 0.28, 3.2, 7.55), new THREE.Vector3(s, 0, 0));

  // lights
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glowMat(0xff2020, 8)); beacon.position.set(0, 3.88, 0.6); model.add(beacon);
  const nav = [[0x20ff40, 1], [0xff2020, -1]].map(([c, s]) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat(c, 6)); l.position.set(s * 1.45, 3.3, -2.25); model.add(l); return l; });
  const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat(0xffffff, 6)); tailLight.position.set(0, 2.45, 7.62); model.add(tailLight);
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff3030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  beaconGlow.scale.setScalar(1.6); beacon.add(beaconGlow); beaconGlow.scale.setScalar(12);

  // blob shadow (world space, managed by owner)
  let spin = 0, tspin = 0, t = 0;
  root.userData = {
    rotor, disc, trSpin, trDisc, beacon, beaconGlow, bladeMat, tipMat,
    animate(dt, rpm) {
      t += dt;
      spin += dt * rpm * Math.PI * 2 * 6.3;
      tspin += dt * rpm * Math.PI * 2 * 17;
      rotor.rotation.y = -spin;
      trSpin.rotation.x = tspin;
      const blur = THREE.MathUtils.smoothstep(rpm, 0.25, 0.75);
      disc.material.opacity = blur;
      bladeMat.opacity = tipMat.opacity = 1 - blur * 0.94;
      bladeMat.depthWrite = tipMat.depthWrite = blur < 0.5;
      trDisc.material.opacity = blur * 0.35;
      const on = (t % 1.1) < 0.12;
      beacon.visible = true; beaconGlow.material.opacity = on ? 1 : 0;
      beacon.material.color.setHex(on ? 0xff2020 : 0x441010); if (on) beacon.material.color.multiplyScalar(8);
    },
  };
  root.traverse((o) => { if (o.isMesh && o !== disc && o !== trDisc && !o.material.transparent) { o.castShadow = true; } });
  return root;
}
