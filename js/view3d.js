// 3D view: same model as Plan. Layers stack by real elevation (grade = 0); exploded view
// spreads them apart; show/hide/ghost/isolate shared with Plan; click a member → selects
// the same object in Plan.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VIEW3D, LUMBER, LUMBER_T_IN } from './config.js';
import { stackOrder, layerDisplay, getLayer } from './model.js';
import { bbox, dist, lerp } from './geom.js';
import { lumberAlong, studLayout } from './homeplan-derived.js';
import { snapPier, dropPier, isManual, pierDims, originOf } from './piers.js';
import { findObject } from './model.js';
import { fmtFtIn, inwardNormal, distToSeg, intersectLines } from './geom.js';
import { PIERS } from './config.js';
import { beginDrag, applyDrag, commitSource, snapPoint, orthoSeg, addInteriorWall, placeOpeningAt, openingPts } from './edit-ops.js';

const IN = 1 / 12;

export function createView3D(container, app) {
  let renderer, scene, camera, controls, root, ready = false, raf = 0, needs = true;
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = null;
  let opts = { sheathing: false };
  let addMode = null;     // null | 'pier' | 'wall' | 'door' | 'window' — 3D add tools
  let edit = null;        // active 3D edit: { op (edit-ops drag), planeY, pointerId, sx, sy, started } or a wall draft
  let ov = null, ovx = null;   // 2D overlay canvas for handles' hints + live dimensions
  let handles = null;     // THREE.Group of handle sprites (not pickable by the mesh raycast)
  let handleList = [];    // [{ kind:'move'|'corner', i, pos:Vector3, sprite }]
  let lastDims = [];      // labels drawn on the overlay last frame (for tests)
  let ghostAbove = null;  // layer id: while dragging, layers stacked above it fade out of the way
  let rebuildQueued = false;

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
    handles = new THREE.Group(); scene.add(handles);
    ov = document.createElement('canvas'); ov.className = 'ov3d';
    ov.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
    container.style.position = container.style.position || 'absolute';
    container.appendChild(ov); ovx = ov.getContext('2d');
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    // Capture phase on the container runs BEFORE OrbitControls' listener on the canvas, so a
    // press on the selected item / a handle / in an add tool becomes an edit and never orbits.
    container.addEventListener('pointerdown', onEditDown, true);
    container.addEventListener('pointermove', onEditMove, true);
    container.addEventListener('pointerup', onEditUp, true);
    container.addEventListener('pointercancel', onEditUp, true);
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

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!container.offsetParent) return;
    if (rebuildQueued) { rebuildQueued = false; build(); }
    controls.update();
    if (needs) { renderer.render(scene, camera); drawOverlay(); needs = false; }
  }
  const queueBuild = () => { rebuildQueued = true; needs = true; };

  function resize() {
    if (!ready) return;
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix(); needs = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); ov.style.width = w + 'px'; ov.style.height = h + 'px';
  }

  function setAddMode(mode) {
    addMode = mode || null;
    if (renderer) renderer.domElement.style.cursor = addMode ? 'crosshair' : '';
    if (ready) { buildHandles(false); needs = true; }
  }

  // ---------- picking
  function setRay(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
  }
  /** Mesh hits under the pointer, nearest first, skipping X-rayed / out-of-the-way layers. */
  function meshHits() {
    const live = root.children.filter((g) => !g.userData.xray);
    return ray.intersectObjects(live, true).filter((h) => h.object.userData && h.object.userData.objectId && h.object.visible);
  }
  /** Best hit: nearest, but if it is on a faded layer and the active layer is hit behind it, take
   *  the active one (auto-ghost: faded layers in the way don't block taps). */
  function bestHit(hits) {
    if (!hits.length) return null;
    const m = app.getModel();
    const first = hits[0];
    if (first.object.userData.layerId === m.activeLayerId) return first;
    const firstAlpha = first.object.material && first.object.material.opacity;
    const act = hits.find((h) => h.object.userData.layerId === m.activeLayerId);
    // X-ray on: taps go through the see-through layers to the active one. Otherwise the nearest member wins
    // (so a ghosted ridge is still tappable, as in v1).
    if (act && firstAlpha < 1 && m.xray) return act;
    return first;
  }
  function layerY(layerId) {
    const g = root.children.find((c) => c.userData.layerId === layerId);
    if (g) return g.position.y;
    const m = app.getModel();
    const idx = stackOrder(m).filter((l) => !l.stub).findIndex((l) => l.id === layerId);
    return m.exploded ? Math.max(0, idx) * VIEW3D.explodeGapFt : 0;
  }
  function planeHit(y) {
    const at = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), at)) return null;
    return [at.x, at.z];
  }
  /** screen px per plan ft near plan point w at height y (to turn pixel snap tolerances into ft) */
  function pxPerFt(w, y) {
    const a = toScreen(w, y), b = toScreen([w[0] + 1, w[1]], y), c = toScreen([w[0], w[1] + 1], y);
    return Math.max(1, (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - a[0], c[1] - a[1])) / 2);
  }
  /** plan point + elevation → overlay (container css) px */
  function toScreen(p, y) {
    const v = new THREE.Vector3(p[0], y, p[1]).project(camera);
    const w = container.clientWidth, h = container.clientHeight;
    return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z];
  }
  const evPt = (e) => { const r = container.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function pick(e) {
    setRay(e);
    const m = app.getModel();
    const hits = meshHits();
    if (addMode === 'pier') {
      const ph = hits.find((h) => h.object.userData.layerId === 'foundation' && h.object.userData.objectType === 'pier');
      if (ph) { app.select({ layerId: 'foundation', objectId: ph.object.userData.objectId }, true); return; }
      const f = m.layers.find((l) => l.id === 'foundation');
      if (f.locked) { app.toast('Foundation is locked'); return; }
      const at = planeHit(layerY('foundation'));
      if (!at) return;
      const sn = snapPier(m, at, 1.0);
      const o = dropPier(m, sn.c);
      app.select({ layerId: 'foundation', objectId: o.id }, true);
      app.commit('foundation');
      app.toast(`Sonotube dropped${sn.snap === 'grid' ? '' : ' on the wall line'} — drag it to adjust`);
      return;
    }
    if (addMode === 'door' || addMode === 'window') {
      const wl = getLayer(m, 'walls');
      if (wl.locked) { app.toast('Walls layer is locked'); return; }
      const wh = hits.find((h) => h.object.userData.layerId === 'walls');
      let wallId = null, at = null;
      if (wh) {
        const o = findObject(m, { layerId: 'walls', objectId: wh.object.userData.objectId });
        wallId = o ? (o.type === 'opening' ? o.geometry.wallId : o.id) : null;
        at = [wh.point.x, wh.point.z];
      } else at = planeHit(layerY('walls') + wl.zBase);
      const o = at && placeOpeningAt(m, at, addMode, app.defaults.openings, 1.5, wallId);
      if (!o) { app.toast(`Tap a wall to place the ${addMode}`); return; }
      app.select({ layerId: 'walls', objectId: o.id }, true);
      app.commit('walls');
      app.toast(`${addMode === 'door' ? 'Door' : 'Window'} added — drag its ✥ handle to slide it along the wall`);
      return;
    }
    const h = bestHit(hits);
    if (h) app.select({ layerId: h.object.userData.layerId, objectId: h.object.userData.objectId }, h.object.userData.objectType === 'pier');
    else app.select(null);
  }

  // ---------- 3D editing (drag selected item / handles, add-wall draft)
  /** What dragging the current selection does, or null if it can't be dragged. */
  function dragSpec(m) {
    const sel = m.selection; if (!sel) return null;
    const o = findObject(m, sel); if (!o) return null;
    const l = getLayer(m, sel.layerId); if (!l || l.locked || !layerDisplay(m, l).shown) return null;
    if (o.type === 'pier') return { kind: 'pier', obj: o, layerId: 'foundation', y: layerY('foundation') + o.z + o.height };
    if (sel.layerId !== 'walls') return null;
    const y = layerY('walls') + l.zBase;
    if (o.type === 'opening') return { kind: 'opening', obj: o, layerId: 'walls', y };
    if (o.type === 'wall' && o.props.exterior) return { kind: 'edge', i: o.geometry.edge, obj: o, layerId: 'walls', y };
    if (o.type === 'wall') return { kind: 'move', obj: o, layerId: 'walls', y };
    return null;
  }
  function handleAt(sp) {
    let best = null, bd = 30;
    handleList.forEach((h) => { const s = toScreen([h.pos.x, h.pos.z], h.pos.y); const d = Math.hypot(s[0] - sp[0], s[1] - sp[1]); if (d < bd) { bd = d; best = h; } });
    return best;
  }
  function onEditDown(e) {
    if (!ready) return;
    if (edit) { // a second finger: finish the edit and let the next gesture orbit
      if (e.pointerId !== edit.pointerId) { finishEdit(true); }
      return;
    }
    if (e.button === 1 || e.button === 2) return;
    const m = app.getModel();
    const sp = evPt(e);
    setRay(e);
    if (addMode === 'wall') {
      const wl = getLayer(m, 'walls');
      if (wl.locked) { app.toast('Walls layer is locked'); return; }
      const y = layerY('walls') + wl.zBase;
      const w = planeHit(y); if (!w) return;
      const s = snapPoint(m, w, 14 / pxPerFt(w, y));
      edit = { draft: { a: [s[0], s[1]], b: [s[0], s[1]] }, y, pointerId: e.pointerId, sx: sp[0], sy: sp[1], started: false };
      stopForEdit(e); return;
    }
    if (addMode) return; // pier / door / window: a tap places (handled on pointerup), a drag orbits
    // handles first (corner handles for the footprint, the selection's move handle)
    const hd = handleAt(sp);
    let spec = null;
    if (hd && hd.kind === 'corner') {
      const wl = getLayer(m, 'walls');
      spec = { kind: 'vertex', i: hd.i, layerId: 'walls', y: layerY('walls') + wl.zBase };
    } else {
      const ds = dragSpec(m);
      if (ds) {
        if (hd && hd.kind === 'move') spec = ds;
        else {
          const h = bestHit(meshHits());
          if (h && h.object.userData.objectId === m.selection.objectId && h.object.userData.layerId === m.selection.layerId) spec = ds;
        }
      }
    }
    if (!spec) return;  // empty space / unselected item: OrbitControls orbits, a tap selects
    const w = planeHit(spec.y); if (!w) return;
    const op = beginDrag(m, spec.kind, w, { obj: spec.obj, i: spec.i, layerId: spec.layerId });
    edit = { op, y: spec.y, pointerId: e.pointerId, sx: sp[0], sy: sp[1], started: false, viaHandle: !!hd, layerId: spec.layerId };
    stopForEdit(e);
  }
  function stopForEdit(e) {
    e.stopPropagation(); e.preventDefault();
    try { container.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
  }
  function onEditMove(e) {
    if (!edit || e.pointerId !== edit.pointerId) return;
    e.stopPropagation();
    const sp = evPt(e);
    if (!edit.started && Math.hypot(sp[0] - edit.sx, sp[1] - edit.sy) < 5) return;
    const m = app.getModel();
    setRay(e);
    const w = planeHit(edit.y); if (!w) return;
    if (!edit.started) { edit.started = true; app.onPierDrag && app.onPierDrag(true); ghostAbove = edit.layerId || 'walls'; }
    if (edit.draft) {
      const s = snapPoint(m, w, 14 / pxPerFt(w, edit.y));
      edit.draft.b = [s[0], s[1]]; edit.draft.snapped = s[2]; orthoSeg(edit.draft);
      needs = true; return;
    }
    const k = pxPerFt(w, edit.y);
    const tol = (edit.op.kind === 'pier' ? (e.pointerType === 'mouse' ? PIERS.snapPx : PIERS.snapPxTouch) : 14) / k;
    const src = applyDrag(m, edit.op, w, tol);   // same op + snapping as Plan (edit-ops.js)
    if (src && edit.op.kind !== 'pier') app.preview(src);
    queueBuild();
  }
  function onEditUp(e) {
    if (!edit || e.pointerId !== edit.pointerId) return;
    e.stopPropagation();
    finishEdit(e.type !== 'pointercancel');
  }
  function finishEdit(apply) {
    const ed = edit; edit = null; ghostAbove = null;
    app.onPierDrag && app.onPierDrag(false);
    const m = app.getModel();
    if (ed.draft) {
      if (apply && ed.started && dist(ed.draft.a, ed.draft.b) >= 1) {
        const o = addInteriorWall(m, ed.draft.a, ed.draft.b);
        app.select({ layerId: 'walls', objectId: o.id }, true); app.commit('walls');
        app.toast(`Interior wall added (${fmtFtIn(dist(ed.draft.a, ed.draft.b))}) — edit it below`);
      } else if (apply) app.toast('Drag along the floor to draw a wall');
      needs = true; return;
    }
    if (ed.started) {
      if (ed.op.kind === 'pier') app.select({ layerId: 'foundation', objectId: ed.op.obj.id }, true);
      app.commit(commitSource(ed.op));
    } else if (ed.op.kind === 'vertex') {
      const c = m.footprint[ed.op.i]; const o = originOf(m);
      app.toast(`Corner ${ed.op.i + 1}: X ${fmtFtIn(c[0] - o[0])} · Y ${fmtFtIn(c[1] - o[1])} — drag to move it`);
    }
    build();
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
  function build(mode = {}) {
    if (!ready) return;
    const m = app.getModel();
    const report = !!mode.report;
    while (root.children.length) { const c = root.children.pop(); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const order = stackOrder(m).filter((l) => !l.stub);
    // X-ray: layers stacked above the active one go see-through and stop catching taps.
    // While dragging, layers above the dragged item's layer do the same (auto-ghost).
    const actIdx = order.findIndex((l) => l.id === m.activeLayerId);
    const dragIdx = ghostAbove ? order.findIndex((l) => l.id === ghostAbove) : -1;
    order.forEach((l, idx) => {
      const d = report ? { shown: l.visible !== false || l.id === 'site', alpha: 1 } : layerDisplay(m, l);
      if (!d.shown) return;
      if (report && mode.only && !mode.only.includes(l.id)) return;
      const g = new THREE.Group();
      g.userData.layerId = l.id;
      g.position.y = m.exploded ? idx * VIEW3D.explodeGapFt : 0;
      let alpha = d.alpha;
      const xr = !report && ((m.xray && actIdx >= 0 && idx > actIdx) || (dragIdx >= 0 && idx > dragIdx));
      if (xr) { alpha = Math.min(alpha, 0.12); g.userData.xray = true; }
      const ctx = { l, alpha, g, m };
      if (l.kind === 'site') buildSite(ctx);
      else if (l.kind === 'foundation') buildFoundation(ctx);
      else if (l.kind === 'floor') buildFloor(ctx);
      else if (l.kind === 'walls') buildWalls(ctx);
      else if (l.kind === 'roof') buildRoof(ctx);
      else if (l.kind === 'custom') buildCustom(ctx);
      g.traverse((o) => { if (o.isMesh) { o.userData.layerId = l.id; if (!report && m.selection && o.userData.objectId === m.selection.objectId && m.selection.layerId === l.id) o.material = SEL_MAT; } });
      if (m.exploded && !report) {
        const lab = label(`${l.name}`, l.color);
        const b = bbox(m.footprint);
        lab.position.set(b.minX - 6, (l.zBase + l.zTop) / 2, b.maxY + 2);
        g.add(lab);
      }
      root.add(g);
    });
    buildHandles(report);
    needs = true;
  }

  // ---------- handles: ✥ move handle over the selection; ◇ corner handles for the footprint
  const handleTex = {};
  function handleSprite(kind) {
    if (!handleTex[kind]) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2);
      x.fillStyle = kind === 'move' ? '#ff6a00' : '#ffffff'; x.fill();
      x.lineWidth = 8; x.strokeStyle = kind === 'move' ? '#ffffff' : '#1d4f7a'; x.stroke();
      if (kind === 'move') {
        x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineWidth = 9; x.lineCap = 'round';
        x.beginPath(); x.moveTo(64, 28); x.lineTo(64, 100); x.moveTo(28, 64); x.lineTo(100, 64); x.stroke();
        [[64, 18, 0], [110, 64, 1], [64, 110, 2], [18, 64, 3]].forEach(([px, py, r]) => { x.save(); x.translate(px, py); x.rotate(r * Math.PI / 2); x.beginPath(); x.moveTo(0, -4); x.lineTo(15, 16); x.lineTo(-15, 16); x.closePath(); x.fill(); x.restore(); });
      } else { x.fillStyle = '#1d4f7a'; x.beginPath(); x.arc(64, 64, 20, 0, Math.PI * 2); x.fill(); }
      handleTex[kind] = new THREE.CanvasTexture(c);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: handleTex[kind], depthTest: false, transparent: true }));
    s.renderOrder = 1000; s.material.sizeAttenuation = false;
    const k = kind === 'move' ? 0.085 : 0.055; s.scale.set(k, k, 1);
    return s;
  }
  function buildHandles(report) {
    while (handles.children.length) handles.remove(handles.children[0]);
    handleList = [];
    if (report) return;
    const m = app.getModel();
    const wl = getLayer(m, 'walls');
    const wy = layerY('walls') + wl.zBase;
    const sel = m.selection; const so = sel && findObject(m, sel);
    const wallsOk = !wl.locked && layerDisplay(m, wl).shown;
    // footprint corners: shown when Walls is active (as in Plan) or an exterior wall is selected
    if (wallsOk && !addMode && (m.activeLayerId === 'walls' || (so && so.type === 'wall' && so.props.exterior))) {
      m.footprint.forEach((p, i) => { const sp = handleSprite('corner'); sp.position.set(p[0], wy, p[1]); handles.add(sp); handleList.push({ kind: 'corner', i, pos: sp.position, sprite: sp }); });
    }
    const ds = !addMode && dragSpec(m);
    if (ds) {
      let c;
      if (ds.kind === 'pier') c = [ds.obj.geometry.c[0], ds.y + 1.4, ds.obj.geometry.c[1]];
      else if (ds.kind === 'opening') { const q = openingPts(m, ds.obj); c = q ? [q.c[0], wy + (ds.obj.props.sillIn + ds.obj.props.heightIn) * IN + 1.2, q.c[1]] : null; }
      else { const a = ds.obj.geometry.a, b = ds.obj.geometry.b; c = [(a[0] + b[0]) / 2, wy + wl.params.plateHeightFt + 1.4, (a[1] + b[1]) / 2]; }
      if (c) {
        const sp = handleSprite('move'); sp.position.set(...c); handles.add(sp); handleList.push({ kind: 'move', pos: sp.position, sprite: sp, of: ds.kind });
        // a thin stem from the handle down to the item so it reads as "this one"
        const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(c[0], c[1], c[2]), new THREE.Vector3(c[0], ds.y, c[2])]), new THREE.LineBasicMaterial({ color: '#ff6a00', depthTest: false }));
        stem.renderOrder = 999; handles.add(stem);
      }
    }
  }

  // ---------- overlay: live dimensions while dragging (same numbers as Plan)
  function chip(x, y, str, bg, size = 12) {
    ovx.font = `700 ${size}px system-ui, sans-serif`;
    const w = ovx.measureText(str).width + 10, h = size + 8;
    ovx.fillStyle = bg; ovx.beginPath(); ovx.roundRect ? ovx.roundRect(x - w / 2, y - h / 2, w, h, 6) : ovx.rect(x - w / 2, y - h / 2, w, h); ovx.fill();
    ovx.fillStyle = '#fff'; ovx.textAlign = 'center'; ovx.textBaseline = 'middle'; ovx.fillText(str, x, y + 0.5);
    lastDims.push(str);
  }
  function dimLine(a, b, y, str, color, dashed = false, offPx = 0) {
    let [x1, y1] = toScreen(a, y), [x2, y2] = toScreen(b, y);
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / L * offPx, ny = (x2 - x1) / L * offPx; x1 += nx; y1 += ny; x2 += nx; y2 += ny;
    ovx.save(); ovx.strokeStyle = color; ovx.lineWidth = 1.6; ovx.setLineDash(dashed ? [5, 4] : []);
    ovx.beginPath(); ovx.moveTo(x1, y1); ovx.lineTo(x2, y2); ovx.stroke(); ovx.setLineDash([]);
    if (!dashed) { const ang = Math.atan2(y2 - y1, x2 - x1); [[x1, y1], [x2, y2]].forEach(([x, yy]) => { ovx.save(); ovx.translate(x, yy); ovx.rotate(ang - Math.PI / 4); ovx.fillStyle = color; ovx.fillRect(-5, -0.9, 10, 1.8); ovx.restore(); }); }
    ovx.restore();
    if (str && L > 16) chip((x1 + x2) / 2, (y1 + y2) / 2, str, color);
  }
  function drawOverlay() {
    if (!ovx) return;
    const dpr = ov.width / Math.max(1, container.clientWidth);
    ovx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ovx.clearRect(0, 0, ov.width, ov.height);
    lastDims = [];
    const W = container.clientWidth, H = container.clientHeight;
    if (!edit || !edit.started) {
      if (addMode) chip(W / 2, H - 22, { pier: 'Tap the ground to drop a Sonotube', wall: 'Drag along the floor to draw a wall', door: 'Tap a wall to add a door', window: 'Tap a wall to add a window' }[addMode], 'rgba(43,42,39,.88)', 13);
      return;
    }
    const m = app.getModel();
    const WALL = '#1d4f7a', NB = '#7b3fa0', ACC = '#ff6a00';
    const y = edit.y;
    if (edit.draft) {
      dimLine(edit.draft.a, edit.draft.b, y, fmtFtIn(dist(edit.draft.a, edit.draft.b)), ACC);
      chip(W / 2, H - 22, `New wall ${fmtFtIn(dist(edit.draft.a, edit.draft.b))}${edit.draft.snapped ? ' · snapped' : ''}`, 'rgba(29,79,122,.92)', 13);
      return;
    }
    const op = edit.op;
    if (op.kind === 'pier') {
      const c = op.obj.geometry.c; const d = pierDims(m, c, op.obj.id);
      const base = d.wall && d.wall.d > 0.04 ? d.wall.foot : c;
      if (d.wall && d.wall.d > 0.04) dimLine(c, d.wall.foot, y, `${fmtFtIn(d.wall.d)} to wall`, WALL);
      d.ends.forEach((en) => dimLine(base, en.p, y, fmtFtIn(en.d), WALL, false, -14));
      d.neighbors.forEach((n) => dimLine(c, n.p, y, `${fmtFtIn(n.d)} o.c.`, NB, true, 0));
      const s = toScreen(c, y);
      chip(s[0], s[1] + 26, op.snap === 'corner' ? 'corner' : op.snap === 'wall' ? 'on wall' : 'grid', op.snap === 'grid' ? '#555' : ACC, 10);
      const o = originOf(m);
      chip(W / 2, H - 22, `X ${fmtFtIn(c[0] - o[0])} · Y ${fmtFtIn(c[1] - o[1])}  (from W / N face)`, 'rgba(29,79,122,.92)', 13);
      return;
    }
    if (op.kind === 'vertex' || op.kind === 'edge') {
      const fp = m.footprint;
      fp.forEach((a, i) => {
        const b = fp[(i + 1) % fp.length]; const n = inwardNormal(fp, i);
        const hot = (op.kind === 'edge' && (i === op.i || i === (op.i + fp.length - 1) % fp.length || i === (op.i + 1) % fp.length)) || (op.kind === 'vertex' && (i === op.i || i === (op.i + fp.length - 1) % fp.length));
        const off = 2.5;
        dimLine([a[0] - n[0] * off, a[1] - n[1] * off], [b[0] - n[0] * off, b[1] - n[1] * off], y, fmtFtIn(dist(a, b)), hot ? ACC : WALL);
      });
      if (op.kind === 'edge') chip(W / 2, H - 22, `Wall moved ${op.offset >= 0 ? 'in' : 'out'} ${fmtFtIn(Math.abs(op.offset || 0))}`, 'rgba(29,79,122,.92)', 13);
      else { const c = fp[op.i], o = originOf(m); chip(W / 2, H - 22, `Corner X ${fmtFtIn(c[0] - o[0])} · Y ${fmtFtIn(c[1] - o[1])}`, 'rgba(29,79,122,.92)', 13); }
      return;
    }
    if (op.kind === 'opening') {
      const q = openingPts(m, op.obj); if (!q) return;
      dimLine(q.a, q.p0, y, fmtFtIn(dist(q.a, q.p0)), WALL, false, -14);
      dimLine(q.p1, q.b, y, fmtFtIn(dist(q.p1, q.b)), WALL, false, -14);
      chip(W / 2, H - 22, `${op.obj.props.kind} ${op.obj.props.widthIn}" · center ${fmtFtIn(op.obj.geometry.t)} from wall start`, 'rgba(29,79,122,.92)', 13);
      return;
    }
    if (op.kind === 'move') {
      const { a, b } = op.obj.geometry; const L = dist(a, b) || 1;
      dimLine(a, b, y, fmtFtIn(L), ACC, false, -16);
      // clear distance from the wall's midpoint to the exterior walls on both sides
      const mid = lerp(a, b, 0.5); const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      [1, -1].forEach((sgn) => {
        const far = [mid[0] + n[0] * sgn * 500, mid[1] + n[1] * sgn * 500];
        let best = null, bd = 1e9;
        m.footprint.forEach((p, i) => { const q2 = m.footprint[(i + 1) % m.footprint.length]; const X = segX(mid, far, p, q2); if (X) { const dd = dist(mid, X); if (dd < bd) { bd = dd; best = X; } } });
        if (best) dimLine(mid, best, y, fmtFtIn(bd), WALL);
      });
      chip(W / 2, H - 22, `Interior wall ${fmtFtIn(L)} — snapped to ${m.snapIn} in`, 'rgba(29,79,122,.92)', 13);
    }
  }
  function segX(p1, p2, p3, p4) {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    if (t < 1e-6 || t > 1 || u < -1e-6 || u > 1 + 1e-6) return null;
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
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
    const manualM = mat('#4f86c6', alpha), flagM = mat('#d0453a', alpha);
    l.objects.forEach((o) => {
      if (o.type === 'footing') {
        const w = o.props.widthIn * IN;
        g.add(tag(lumberAlong(THREE, o.geometry.a, o.geometry.b, w, o.z, o.z + o.height, o.props.role === 'stem' ? concrete : dark, null, w / 2), o));
      } else if (o.type === 'pier') {
        const r = (o.props.diaIn * IN) / 2;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, o.height, 18), o.props.flags && o.props.flags.length ? flagM : isManual(o) ? manualM : concrete);
        cyl.userData.objectType = 'pier';
        cyl.position.set(o.geometry.c[0], o.z + o.height / 2, o.geometry.c[1]);
        g.add(tag(cyl, o));
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.8, r * 1.8, 0.67, 18), dark);
        pad.position.set(o.geometry.c[0], o.z + 0.33, o.geometry.c[1]);
        pad.userData.objectType = 'pier';
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

  let presetAspect = null;
  function preset(name) {
    if (!ready) return;
    const m = app.getModel();
    const b = bbox(m.footprint);
    const R = Math.max(b.w, b.h, 12);
    const cy = m.exploded ? 14 : 6;
    const target = new THREE.Vector3(b.cx, cy, b.cy);
    const narrow = presetAspect ? presetAspect < 1 : container.clientWidth < container.clientHeight;
    const k = narrow ? 1.9 : 1.25;
    const pos = {
      front: [b.cx, cy + R * 0.25, b.cy + R * 1.5 * k],
      side: [b.cx + R * 1.5 * k, cy + R * 0.25, b.cy],
      top: [b.cx, R * 2.2 * k, b.cy + 0.01],
      aerial: [b.cx + R * 0.95 * k, cy + R * 0.85 * k, b.cy + R * 1.15 * k],
      back: [b.cx - R * 0.95 * k, cy + R * 0.75 * k, b.cy - R * 1.15 * k],
    }[name] || null;
    if (!pos) return;
    camera.position.set(...pos); controls.target.copy(target); controls.update(); needs = true;
  }

  return {
    show() { const ok = init(); if (ok) { resize(); build(); } return ok; },
    build, resize, preset,
    setDropMode(on) { setAddMode(on ? 'pier' : null); },
    getDropMode: () => addMode === 'pier',
    setAddMode, getAddMode: () => addMode,
    /** Render a view to a PNG data URL for the completion report (all layers solid, no handles). */
    snapshot(name, { w = 1000, h = 640, exploded = false, only = null } = {}) {
      if (!init()) return null;
      const m = app.getModel();
      const keep = { pos: camera.position.clone(), tgt: controls.target.clone(), aspect: camera.aspect, ex: m.exploded, pr: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()) };
      m.exploded = !!exploded;
      renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      build({ report: true, only });
      presetAspect = w / h; preset(name); presetAspect = null;
      if (only) { const b = bbox(m.footprint); controls.target.set(b.cx, 0, b.cy); camera.position.y *= 0.7; controls.update(); }
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      m.exploded = keep.ex;
      renderer.setPixelRatio(keep.pr); renderer.setSize(keep.size.x, keep.size.y, false);
      camera.aspect = keep.aspect; camera.updateProjectionMatrix();
      camera.position.copy(keep.pos); controls.target.copy(keep.tgt); controls.update();
      resize(); build();
      return url;
    },
    debug: {
      handles: () => handleList.map((h) => ({ kind: h.kind, i: h.i, of: h.of, screen: (() => { const s = toScreen([h.pos.x, h.pos.z], h.pos.y); const r = container.getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; })() })),
      editing: () => (edit ? { kind: edit.draft ? 'wall-draft' : edit.op.kind, started: edit.started } : null),
      dims: () => lastDims.slice(),
      /** page coords of plan point p at the walls' floor / a layer's elevation */
      planToPage(p, layerId = 'walls', dz = null) { const m = app.getModel(); const l = getLayer(m, layerId); const y = layerY(layerId) + (dz != null ? dz : (l.zBase || 0)); const s = toScreen(p, y); const r = container.getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; },
      xrayLayers: () => root.children.filter((g) => g.userData.xray).map((g) => g.userData.layerId),
      camera: () => camera.position.toArray(),
    },
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
    /** page coords of a world point (plan x, elevation, plan y) — for tests */
    worldToScreen(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
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
