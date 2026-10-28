// 3D view: same model as Plan. Layers stack by real elevation (grade = 0); exploded view
// spreads them apart; show/hide/ghost/isolate shared with Plan; click a member → selects
// the same object in Plan.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VIEW3D, LUMBER, LUMBER_T_IN } from './config.js';
import { stackOrder, layerDisplay, getLayer } from './model.js';
import { bbox, dist, lerp } from './geom.js';
import { lumberAlong, studLayout } from './homeplan-derived.js';

const IN = 1 / 12;

export function createView3D(container, app) {
  let renderer, scene, camera, controls, root, ready = false, raf = 0, needs = true;
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = null;
  let opts = { sheathing: false };

  function init() {
    if (ready) return true;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      container.innerHTML = '<div class="nogl">3D needs WebGL, which this browser could not start.</div>';
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe8ee');
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => { needs = true; });
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a7f6a', 1.1));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.6); sun.position.set(40, 80, 50); scene.add(sun);
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.5); fill.position.set(-50, 30, -40); scene.add(fill);
    root = new THREE.Group(); scene.add(root);
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) { downAt = null; return; }
      downAt = null; pick(e);
    });
    ready = true;
    resize();
    preset('aerial');
    loop();
    return true;
  }

  function loop() { raf = requestAnimationFrame(loop); if (!container.offsetParent) return; controls.update(); if (needs) { renderer.render(scene, camera); needs = false; } }

  function resize() {
    if (!ready) return;
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix(); needs = true;
  }

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(root.children, true).filter((h) => h.object.userData && h.object.userData.objectId && h.object.visible);
    if (hits.length) app.select({ layerId: hits[0].object.userData.layerId, objectId: hits[0].object.userData.objectId });
    else app.select(null);
  }

  const mats = new Map();
  function mat(color, alpha, extra = {}) {
    const key = color + '|' + alpha + '|' + JSON.stringify(extra);
    if (mats.has(key)) return mats.get(key);
    const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0, transparent: alpha < 1, opacity: alpha, depthWrite: alpha >= 1 }, extra));
    mats.set(key, m); return m;
  }
  const SEL_MAT = new THREE.MeshStandardMaterial({ color: '#ff6a00', emissive: '#ff6a00', emissiveIntensity: 0.55 });

  // ---------- build scene from model
  function build() {
    if (!ready) return;
    const m = app.getModel();
    while (root.children.length) { const c = root.children.pop(); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const order = stackOrder(m).filter((l) => !l.stub);
    order.forEach((l, idx) => {
      const d = layerDisplay(m, l);
      if (!d.shown) return;
      const g = new THREE.Group();
      g.userData.layerId = l.id;
      g.position.y = m.exploded ? idx * VIEW3D.explodeGapFt : 0;
      const ctx = { l, alpha: d.alpha, g, m };
      if (l.kind === 'site') buildSite(ctx);
      else if (l.kind === 'foundation') buildFoundation(ctx);
      else if (l.kind === 'floor') buildFloor(ctx);
      else if (l.kind === 'walls') buildWalls(ctx);
      else if (l.kind === 'roof') buildRoof(ctx);
      else if (l.kind === 'custom') buildCustom(ctx);
      g.traverse((o) => { if (o.isMesh) { o.userData.layerId = l.id; if (m.selection && o.userData.objectId === m.selection.objectId && m.selection.layerId === l.id) o.material = SEL_MAT; } });
      if (m.exploded) {
        const lab = label(`${l.name}`, l.color);
        const b = bbox(m.footprint);
        lab.position.set(b.minX - 6, (l.zBase + l.zTop) / 2, b.maxY + 2);
        g.add(lab);
      }
      root.add(g);
    });
    needs = true;
  }

  function tag(mesh, o) { if (mesh) { mesh.userData.objectId = o.id; } return mesh; }

  function buildSite({ l, alpha, g, m }) {
    const lot = l.objects.find((o) => o.props.role === 'lot');
    if (lot) {
      const b = bbox(lot.geometry.pts);
      const slope = (l.params.grade.type === 'slope' ? l.params.grade.slopePct : 0) / 100;
      const geo = new THREE.BoxGeometry(b.w, 0.3, b.h);
      const ground = new THREE.Mesh(geo, mat('#9bb37f', alpha));
      ground.position.set(b.cx, -0.15, b.cy);
      // slope: tilt about the axis perpendicular to the downhill direction
      const dir = l.params.grade.downhill;
      const ang = Math.atan(slope);
      if (dir === 'S') ground.rotation.x = ang; else if (dir === 'N') ground.rotation.x = -ang;
      else if (dir === 'E') ground.rotation.z = -ang; else if (dir === 'W') ground.rotation.z = ang;
      g.add(tag(ground, lot));
    }
    l.objects.forEach((o) => {
      if (o.type === 'area' && (o.props.role === 'lot' || o.props.role === 'setback')) {
        const pts = o.geometry.pts.concat([o.geometry.pts[0]]).map((p) => new THREE.Vector3(p[0], 0.05, p[1]));
        const lm = o.props.role === 'lot' ? new THREE.LineBasicMaterial({ color: '#3d5f2f' }) : new THREE.LineDashedMaterial({ color: '#3d5f2f', dashSize: 2, gapSize: 1.2 });
        const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm); ln.computeLineDistances(); g.add(ln);
      } else if (o.type === 'area') {
        g.add(tag(slab(o.geometry.pts, 0, o.props.heightFt || 10, mat('#9a9a9a', alpha)), o));
      } else if (o.type === 'line') {
        g.add(tag(lumberAlong(THREE, o.geometry.a, o.geometry.b, 0.25, 0.02, 0.12, mat(o.props.color || '#1f6fb2', alpha)), o));
      }
    });
  }

  function buildFoundation({ l, alpha, g }) {
    const concrete = mat('#a4a6a8', alpha), dark = mat('#8c8f93', alpha);
    l.objects.forEach((o) => {
      if (o.type === 'footing') {
        const w = o.props.widthIn * IN;
        g.add(tag(lumberAlong(THREE, o.geometry.a, o.geometry.b, w, o.z, o.z + o.height, o.props.role === 'stem' ? concrete : dark, null, w / 2), o));
      } else if (o.type === 'pier') {
        const r = (o.props.diaIn * IN) / 2;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, o.height, 18), concrete);
        cyl.position.set(o.geometry.c[0], o.z + o.height / 2, o.geometry.c[1]);
        g.add(tag(cyl, o));
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.8, r * 1.8, 0.67, 18), dark);
        pad.position.set(o.geometry.c[0], o.z + 0.33, o.geometry.c[1]);
        g.add(tag(pad, o));
      } else if (o.type === 'beam') {
        const w = o.props.widthIn * IN;
        g.add(tag(lumberAlong(THREE, o.geometry.a, o.geometry.b, w, o.z, o.z + o.height, concrete, null, w / 2), o));
      } else if (o.type === 'area' && o.props.role === 'slab') {
        g.add(tag(slab(o.geometry.pts, o.z, o.height, concrete), o));
      }
    });
  }

  function buildFloor({ l, alpha, g }) {
    const wood = mat('#d4a66a', alpha), pt = mat('#8fa36b', alpha), flag = mat('#c0392b', alpha), sub = mat('#e0c08e', Math.min(alpha, 0.92));
    l.objects.forEach((o) => {
      if (o.type === 'joist' || o.type === 'beam') {
        const w = (o.props.widthIn || 1.5) * IN;
        const mm = o.props.role === 'sill' ? pt : o.props.flag ? flag : wood;
        g.add(tag(lumberAlong(THREE, o.geometry.a, o.geometry.b, w, o.z, o.z + o.height, mm, null, o.props.role === 'rim' || o.props.role === 'sill' ? w / 2 : 0), o));
      } else if (o.type === 'area' && o.props.role === 'subfloor' && l.params.showSubfloor) {
        g.add(tag(slab(o.geometry.pts, o.z, o.height, sub), o));
      }
    });
  }

  function buildWalls({ l, alpha, g, m }) {
    const solid = m.wallMode === 'solid';
    const wood = mat('#e3bb7f', alpha), wallMat = mat('#efe9dc', alpha), hdr = mat('#c98f3c', alpha), glass = mat('#9cc7e6', Math.min(alpha, 0.45));
    const walls = l.objects.filter((o) => o.type === 'wall');
    const ops = l.objects.filter((o) => o.type === 'opening');
    const z0 = l.zBase, H = l.params.plateHeightFt;
    const pl = LUMBER_T_IN * IN;
    walls.forEach((w) => {
      const { a, b } = w.geometry; const len = dist(a, b);
      const t = w.props.thicknessIn * IN;
      const ext = w.props.exterior ? t / 2 : 0;
      const A = lerp(a, b, -ext / len), B = lerp(a, b, 1 + ext / len), L2 = len + 2 * ext;
      const myOps = ops.filter((o) => o.geometry.wallId === w.id).map((o) => ({ o, center: o.geometry.t + ext, widthFt: o.props.widthIn * IN, sill: o.props.sillIn * IN, head: (o.props.sillIn + o.props.heightIn) * IN })).sort((p, q) => p.center - q.center);
      const P = (d) => lerp(A, B, d / L2);
      if (solid) {
        let cur = 0;
        myOps.forEach((op) => {
          const s0 = op.center - op.widthFt / 2, s1 = op.center + op.widthFt / 2;
          if (s0 > cur) g.add(tag(lumberAlong(THREE, P(cur), P(s0), t, z0, z0 + H, wallMat), w));
          if (op.sill > 0) g.add(tag(lumberAlong(THREE, P(s0), P(s1), t, z0, z0 + op.sill, wallMat), w));
          g.add(tag(lumberAlong(THREE, P(s0), P(s1), t, z0 + op.head, z0 + H, wallMat), w));
          cur = s1;
        });
        if (cur < L2) g.add(tag(lumberAlong(THREE, P(cur), P(L2), t, z0, z0 + H, wallMat), w));
      } else {
        // plates: single bottom, double top (spec §6)
        const nb = l.params.bottomPlates || 1, nt = l.params.topPlates || 2;
        for (let i = 0; i < nb; i++) g.add(tag(lumberAlong(THREE, A, B, t, z0 + i * pl, z0 + (i + 1) * pl, wood), w));
        for (let i = 0; i < nt; i++) g.add(tag(lumberAlong(THREE, A, B, t, z0 + H - (i + 1) * pl, z0 + H - i * pl, wood), w));
        const sBot = z0 + nb * pl, sTop = z0 + H - nt * pl;
        const lay = studLayout(L2, (w.props.studOcIn || 16) * IN, myOps);
        const stud = (d, zb, zt, mm = wood) => { const c = d; g.add(tag(lumberAlong(THREE, P(c - pl / 2), P(c + pl / 2), t, zb, zt, mm), w)); };
        lay.studs.forEach((d) => stud(d, sBot, sTop));
        lay.kings.forEach((d) => stud(d, sBot, sTop));
        myOps.forEach((op) => {
          const s0 = op.center - op.widthFt / 2, s1 = op.center + op.widthFt / 2;
          const hd = LUMBER[(op.o.props.header || '2-2x8').replace(/^\d-/, '').split(' ')[0]] * IN || 7.25 * IN;
          const hz = z0 + op.head;
          stud(s0 - pl / 2, sBot, hz); stud(s1 + pl / 2, sBot, hz);           // jacks
          g.add(tag(lumberAlong(THREE, P(s0 - pl), P(s1 + pl), t, hz, Math.min(sTop, hz + hd), hdr), op.o)); // header (EXAMPLE size)
          if (op.sill > 0) g.add(tag(lumberAlong(THREE, P(s0), P(s1), t, z0 + op.sill - pl, z0 + op.sill, wood), op.o));
        });
      }
      myOps.forEach((op) => {
        if (op.o.props.kind !== 'window') return;
        const s0 = op.center - op.widthFt / 2, s1 = op.center + op.widthFt / 2;
        g.add(tag(lumberAlong(THREE, P(s0), P(s1), 0.06, z0 + op.sill, z0 + op.head, glass), op.o));
      });
    });
  }

  function buildRoof({ l, alpha, g }) {
    const wood = mat('#c98c4d', alpha), ridgeM = mat('#a8692e', alpha), sheath = mat('#7c5a43', Math.min(alpha, 0.85), { side: THREE.DoubleSide });
    const rafters = l.objects.filter((o) => o.type === 'rafter');
    rafters.forEach((o) => {
      const { a, b } = o.geometry; const zA = o.props.zA, zB = o.props.zB;
      const d = LUMBER[o.props.size] * IN;
      const hz = dist(a, b), dz = zB - zA, len = Math.hypot(hz, dz);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, d, LUMBER_T_IN * IN), wood);
      mesh.position.set((a[0] + b[0]) / 2, (zA + zB) / 2 + d / 2, (a[1] + b[1]) / 2);
      mesh.rotation.order = 'YZX';
      mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      mesh.rotation.z = Math.atan2(dz, hz);
      g.add(tag(mesh, o));
    });
    const ridge = l.objects.find((o) => o.props && o.props.role === 'ridge');
    if (ridge) g.add(tag(lumberAlong(THREE, ridge.geometry.a, ridge.geometry.b, LUMBER_T_IN * IN, ridge.z, ridge.z + ridge.height, ridgeM), ridge));
    const outline = l.objects.find((o) => o.props && o.props.role === 'outline');
    if (outline && l.params.showSheathing && rafters.length) {
      const c = l.params.computed; const pts = outline.geometry.pts; const b = bbox(pts);
      const d = LUMBER[l.params.rafterSize] * IN + 0.06;
      const zE = rafters[0].props.zA + d, zR = rafters[0].props.zB + d;
      const quad = (q) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(q.flat(), 3)); geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals(); return new THREE.Mesh(geo, sheath); };
      if (c.ridgeAlongX) {
        g.add(tag(quad([[b.minX, zE, b.minY], [b.maxX, zE, b.minY], [b.maxX, zR, b.cy], [b.minX, zR, b.cy]]), outline));
        g.add(tag(quad([[b.minX, zE, b.maxY], [b.maxX, zE, b.maxY], [b.maxX, zR, b.cy], [b.minX, zR, b.cy]]), outline));
      } else {
        g.add(tag(quad([[b.minX, zE, b.minY], [b.minX, zE, b.maxY], [b.cx, zR, b.maxY], [b.cx, zR, b.minY]]), outline));
        g.add(tag(quad([[b.maxX, zE, b.minY], [b.maxX, zE, b.maxY], [b.cx, zR, b.maxY], [b.cx, zR, b.minY]]), outline));
      }
    }
  }

  function buildCustom({ l, alpha, g }) {
    const c = mat(l.color, Math.min(alpha, 0.9));
    l.objects.forEach((o) => {
      if (o.type === 'line') g.add(tag(lumberAlong(THREE, o.geometry.a, o.geometry.b, 0.35, l.zBase, Math.max(l.zTop, l.zBase + 0.2), c), o));
      else if (o.type === 'area') g.add(tag(slab(o.geometry.pts, l.zBase, Math.max(0.1, l.zTop - l.zBase), c), o));
    });
  }

  function slab(pts, zBot, h, material) {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.02, h), bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = zBot;
    return mesh;
  }

  function label(text, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.font = '700 40px system-ui, sans-serif';
    const w = Math.min(500, x.measureText(text).width + 40);
    x.fillStyle = 'rgba(30,30,30,.78)'; x.fillRect((512 - w) / 2, 14, w, 68);
    x.fillStyle = color; x.fillRect((512 - w) / 2, 14, 10, 68);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 49);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.scale.set(10, 1.9, 1); s.renderOrder = 10;
    return s;
  }

  function preset(name) {
    if (!ready) return;
    const m = app.getModel();
    const b = bbox(m.footprint);
    const R = Math.max(b.w, b.h, 12);
    const cy = m.exploded ? 14 : 6;
    const target = new THREE.Vector3(b.cx, cy, b.cy);
    const narrow = container.clientWidth < container.clientHeight;
    const k = narrow ? 1.9 : 1.25;
    const pos = {
      front: [b.cx, cy + R * 0.25, b.cy + R * 1.5 * k],
      side: [b.cx + R * 1.5 * k, cy + R * 0.25, b.cy],
      top: [b.cx, R * 2.2 * k, b.cy + 0.01],
      aerial: [b.cx + R * 0.95 * k, cy + R * 0.85 * k, b.cy + R * 1.15 * k],
    }[name] || null;
    if (!pos) return;
    camera.position.set(...pos); controls.target.copy(target); controls.update(); needs = true;
  }

  return {
    show() { const ok = init(); if (ok) { resize(); build(); } return ok; },
    build, resize, preset,
    isReady: () => ready,
    /** page coords of the first mesh tagged with objectId (for tests) */
    screenOf(objectId) {
      let hit = null;
      root.traverse((o) => { if (!hit && o.isMesh && o.userData.objectId === objectId) hit = o; });
      if (!hit) return null;
      const v = new THREE.Vector3(); hit.getWorldPosition(v); v.project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
    },
    stats() {
      const out = {};
      if (!ready) return out;
      root.children.forEach((g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); out[g.userData.layerId] = { meshes: n, y: g.position.y }; });
      return out;
    },
  };
}
