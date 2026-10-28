// Plan view (2D canvas): to scale, snap-to-grid, cut at 4 ft, automatic exterior dims,
// per-layer symbols (spec §2 "Plan view shows"), touch pan / pinch zoom.
import { PLAN, LUMBER, PIERS } from './config.js';
import { stackOrder, layerDisplay, getLayer, findObject, uid } from './model.js';
import { bbox, dist, distToSeg, offsetPolygon, inwardNormal, pointInPoly, fmtFtIn, lerp } from './geom.js';
import { snapPier, pierDims, dropPier, movePier, isManual, originOf } from './piers.js';
import { pierShapeOf } from './config.js';
import { applyDrag, beginDrag, snapPoint, openingPts as openingPtsShared } from './edit-ops.js';

const IN = 1 / 12;

export function createPlan(canvas, app) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 14, ox: 40, oy: 40 };
  let tool = 'select';
  let draft = null;          // in-progress drawing
  let drag = null;           // active drag op
  const pointers = new Map();
  let pinch = null;
  let hover = null;
  let cssW = 0, cssH = 0;

  const M = () => app.getModel();
  const toScreen = ([x, y]) => [x * view.scale + view.ox, y * view.scale + view.oy];
  const toWorld = (sx, sy) => [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];

  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = r.width; cssH = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function fit() {
    const m = M();
    const b = bbox(m.footprint);
    const pad = 9; // ft: room for dimension strings
    const isPhone = cssW < 500;
    const availH = cssH - (isPhone ? 60 : 30);
    view.scale = Math.max(2, Math.min((cssW - 20) / (b.w + pad * 2), availH / (b.h + pad * 2)));
    view.ox = cssW / 2 - b.cx * view.scale;
    view.oy = (isPhone ? 50 : 15) + availH / 2 - b.cy * view.scale;
    render();
  }

  // ---------- snapping
  function snap(p, opts = {}) {
    return snapPoint(M(), p, 14 / view.scale, opts);
  }
  function snapOld(p, opts = {}) {
    const m = M();
    const tol = 14 / view.scale;
    const cands = m.footprint.slice();
    getLayer(m, 'walls').objects.forEach((o) => { if (o.type === 'wall') cands.push(o.geometry.a, o.geometry.b); });
    if (!opts.noPoints) {
      let best = null, bd = tol;
      cands.forEach((c) => { const d = dist(c, p); if (d < bd) { bd = d; best = c; } });
      if (best) return [best[0], best[1], true];
    }
    const g = m.snapIn * IN;
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g, false];
  }

  // ---------- drawing primitives
  function line(a, b, w = 1, color = '#333', dash = null) {
    const [x1, y1] = toScreen(a), [x2, y2] = toScreen(b);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  function poly(pts, { fill, stroke, w = 1, dash, close = true } = {}) {
    if (!pts.length) return;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = toScreen(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (close) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
    if (stroke) { ctx.lineWidth = w; ctx.strokeStyle = stroke; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
  }
  function hatch(pts, color, spacingPx = 8) {
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = toScreen(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.clip();
    const b = bbox(pts.map(toScreen));
    ctx.strokeStyle = color; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let x = b.minX - b.h; x < b.maxX; x += spacingPx) { ctx.moveTo(x, b.maxY); ctx.lineTo(x + b.h, b.minY); }
    ctx.stroke(); ctx.restore();
  }
  function text(str, p, { color = '#222', size = 11, bg = 'rgba(255,255,255,.85)', rot = 0, weight = 600 } = {}) {
    const [x, y] = Array.isArray(p) && p.length === 2 && !p.screen ? toScreen(p) : p;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
    const w = ctx.measureText(str).width;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(-w / 2 - 3, -size / 2 - 2, w + 6, size + 4); }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str, 0, 0.5);
    ctx.restore();
  }
  function arrow(a, b, color, w = 1.5) {
    line(a, b, w, color);
    const [x1, y1] = toScreen(a), [x2, y2] = toScreen(b);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function wallRect(a, b, tFt) {
    const L = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / L * tFt / 2, ny = (b[0] - a[0]) / L * tFt / 2;
    return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
  }
  function doubleLine(a, b, tFt, color, w, dash) {
    const r = wallRect(a, b, tFt);
    line(r[0], r[1], w, color, dash); line(r[3], r[2], w, color, dash);
  }

  // ---------- render
  let lastOverlay = { selection: false, draft: false };
  function render() {
    const m = M();
    if (!m || !cssW) return;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#f7f5f0'; ctx.fillRect(0, 0, cssW, cssH);
    drawGrid(m);
    const insp = inspecting(); // $ inspect: no selection highlight, drafts, tool ghosts or pier dims (restored when it turns off)
    const sel = insp ? null : m.selection;
    lastOverlay = { selection: !!sel, draft: false };
    stackOrder(m).forEach((l) => {
      const d = layerDisplay(m, l);
      if (!d.shown) return;
      ctx.save(); ctx.globalAlpha = d.alpha;
      drawLayer(m, l, sel);
      ctx.restore();
    });
    const wallsD = layerDisplay(m, getLayer(m, 'walls'));
    if (wallsD.shown || m.isolateLayerId === null) drawDims(m);
    drawNorth(m);
    if (!insp) { drawDraft(m); lastOverlay.draft = !!draft || (tool !== 'select' && !!hover) || !!(drag && drag.kind === 'pier' && drag.moved); }
    drawInspectMark();
    if (m.isolateLayerId) text(`Isolated: ${getLayer(m, m.isolateLayerId).name}`, Object.assign([cssW / 2, cssH - 16], { screen: true }), { size: 11, bg: '#2b2b2b', color: '#fff' });
  }

  function drawGrid(m) {
    const g = m.snapIn * IN;
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(cssW, cssH);
    const drawStep = (step, color, w) => {
      if (step * view.scale < 6) return;
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { const sx = Math.round(x * view.scale + view.ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const sy = Math.round(y * view.scale + view.oy) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(cssW, sy); }
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    };
    drawStep(g, '#ebe7de', 1);
    drawStep(g < 1 ? 4 : g * 4, '#ddd7ca', 1);
  }

  // $ price inspect highlight (set by the inspector: a member segment, a pier circle or an area)
  let inspectMark = null;
  function drawInspectMark() {
    const k = inspectMark; if (!k) return;
    const G = '#1e9e5a';
    ctx.save();
    if (k.seg) { const [a, b] = k.seg; const [x1, y1] = toScreen(a), [x2, y2] = toScreen(b); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(30,158,90,.35)'; ctx.lineWidth = Math.max(10, (k.wFt || 0.3) * view.scale + 8); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.strokeStyle = G; ctx.lineWidth = Math.max(3, (k.wFt || 0.12) * view.scale); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    if (k.circle) { const [c, r] = k.circle; const [x, y] = toScreen(c); ctx.beginPath(); ctx.arc(x, y, Math.max(6, r * view.scale) + 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(30,158,90,.3)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = G; ctx.stroke(); }
    if (k.poly) { ctx.beginPath(); k.poly.forEach((p, i) => { const [x, y] = toScreen(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = 'rgba(30,158,90,.16)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = G; ctx.stroke(); }
    ctx.restore();
  }
  const inspecting = () => !!(app.isInspecting && app.isInspecting());
  function inspectAt(e) {
    const sp = evPt(e); const w = toWorld(sp[0], sp[1]);
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const hp = hitPier(w, 2); // a Sonotube under the cursor wins over the wall drawn above it
    const hit = hp ? { layerId: 'foundation', objectId: hp.id } : hitTest(w, touch ? 16 : 10);
    app.inspectHit && app.inspectHit(hit ? Object.assign({ view: 'plan', world: w, part: null }, hit) : null, e);
  }

  function isSel(sel, l, o) { return sel && sel.layerId === l.id && sel.objectId === o.id; }
  const SEL = '#ff6a00';

  function drawLayer(m, l, sel) {
    const c = l.color;
    if (l.kind === 'site') {
      l.objects.forEach((o) => {
        const s = isSel(sel, l, o);
        if (o.type === 'area' && o.props.role === 'lot') poly(o.geometry.pts, { stroke: s ? SEL : c, w: 2 });
        else if (o.type === 'area' && o.props.role === 'setback') { poly(o.geometry.pts, { stroke: s ? SEL : c, w: 1.2, dash: [8, 5] }); text('setback', lerp(o.geometry.pts[0], o.geometry.pts[1], 0.5), { color: c, size: 9 }); }
        else if (o.type === 'area') { poly(o.geometry.pts, { stroke: s ? SEL : '#666', w: 1.5, fill: 'rgba(120,120,120,.12)' }); hatch(o.geometry.pts, '#888'); text(o.props.label || 'Existing building', centroid(o.geometry.pts), { size: 10 }); }
        else if (o.type === 'line') { line(o.geometry.a, o.geometry.b, s ? 3 : 2, s ? SEL : (o.props.color || '#1f6fb2'), [10, 4, 2, 4]); text(o.props.label || 'Utility', lerp(o.geometry.a, o.geometry.b, 0.5), { size: 10, color: o.props.color || '#1f6fb2' }); }
      });
      return;
    }
    if (l.kind === 'foundation') {
      l.objects.forEach((o) => {
        const s = isSel(sel, l, o);
        const col = s ? SEL : '#5f6368';
        if (o.type === 'footing') {
          if (o.props.role === 'stem') doubleLine(o.geometry.a, o.geometry.b, o.props.widthIn * IN, col, s ? 2.2 : 1.3);
          else doubleLine(o.geometry.a, o.geometry.b, o.props.widthIn * IN, col, s ? 2 : 1, [6, 4]);
        } else if (o.type === 'pier') {
          const live = drag && drag.kind === 'pier' && drag.obj === o && drag.moved;
          const sh = pierShapeOf(o, l.params);
          if (!live) drawPier(o.geometry.c, o.props.diaIn, { sel: s, manual: isManual(o), flagged: !!(o.props.flags && o.props.flags.length), shape: sh.shape, halfFt: sh.halfFt });
        } else if (o.type === 'beam') doubleLine(o.geometry.a, o.geometry.b, o.props.widthIn * IN, col, s ? 2 : 1.1);
        else if (o.type === 'area' && o.props.role === 'slab') { poly(o.geometry.pts, { stroke: col, w: 1 }); hatch(o.geometry.pts, 'rgba(95,99,104,.45)', 10); }
      });
      return;
    }
    if (l.kind === 'floor') {
      let label = null;
      l.objects.forEach((o) => {
        const s = isSel(sel, l, o);
        if (o.type === 'joist' && o.props.role === 'rim') line(o.geometry.a, o.geometry.b, s ? 3 : 1.6, s ? SEL : c);
        else if (o.type === 'joist') { line(o.geometry.a, o.geometry.b, s ? 2.5 : 0.8, s ? SEL : c); label = label || o; }
        else if (o.type === 'beam' && o.props.role === 'girder') { line(o.geometry.a, o.geometry.b, s ? 6 : 4, s ? SEL : '#b3261e'); text('BEAM — flagged, size by engineer', lerp(o.geometry.a, o.geometry.b, 0.3), { size: 9, color: '#b3261e' }); }
        else if (o.type === 'beam' && o.props.role === 'sill') { /* under the rim; drawn by foundation lines */ }
      });
      if (label) {
        const ax = l.params.computed && l.params.computed.runAxis;
        const b = bbox(M().footprint);
        const p0 = [b.cx + b.w * 0.22, b.cy + b.h * 0.12];
        const p1 = ax === 'y' ? [p0[0], p0[1] + 6] : [p0[0] + 6, p0[1]];
        arrow(p0, p1, c, 2); arrow(p1, p0, c, 2);
        text(label.props.label, [p0[0], p0[1] - 1.3], { color: '#7a4f1c', size: 11 });
      }
      return;
    }
    if (l.kind === 'walls') {
      const t = LUMBER[l.params.extSize] * IN;
      const fp = M().footprint;
      const inner = offsetPolygon(fp, t);
      // exterior walls cut at 4 ft: poché ring
      ctx.beginPath();
      [fp, inner].forEach((pts) => pts.forEach((p, i) => { const [x, y] = toScreen(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); if (i === pts.length - 1) ctx.closePath(); }));
      ctx.fillStyle = '#3b3a36'; ctx.fill('evenodd');
      l.objects.forEach((o) => {
        if (o.type !== 'wall') return;
        const s = isSel(sel, l, o);
        if (!o.props.exterior) poly(wallRect(o.geometry.a, o.geometry.b, o.props.thicknessIn * IN), { fill: s ? SEL : (o.props.bearing ? '#5a3d1f' : '#6b6a64'), stroke: s ? SEL : '#3b3a36', w: 1 });
        else if (s) poly(wallRect(o.geometry.a, o.geometry.b, o.props.thicknessIn * IN), { fill: 'rgba(255,106,0,.75)' });
      });
      l.objects.forEach((o) => { if (o.type === 'opening') drawOpening(m, l, o, isSel(sel, l, o)); });
      return;
    }
    if (l.kind === 'roof') {
      // above the 4 ft cut → dashed
      l.objects.forEach((o) => {
        const s = isSel(sel, l, o);
        if (o.type === 'area' && o.props.role === 'outline') poly(o.geometry.pts, { stroke: s ? SEL : c, w: s ? 2.5 : 1.5, dash: [9, 6] });
        else if (o.type === 'beam' && o.props.role === 'ridge') line(o.geometry.a, o.geometry.b, s ? 3 : 1.8, s ? SEL : c, [14, 4, 3, 4]);
        else if (o.type === 'rafter' && s) line(o.geometry.a, o.geometry.b, 2.5, SEL, [5, 4]);
        else if (o.type === 'line' && o.props.role === 'eave') line(o.geometry.a, o.geometry.b, s ? 3 : 2.2, s ? SEL : c, [2, 0]);
        else if (o.type === 'label' && o.props.down) {
          // v4 shed: arrow points downslope (toward the low wall); high/low plate heights at the two edges
          const p = o.geometry.c; const v = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[o.props.down];
          arrow([p[0] - v[0] * 2.5, p[1] - v[1] * 2.5], [p[0] + v[0] * 2.5, p[1] + v[1] * 2.5], c, 1.5);
          text(o.props.text, [p[0] + (v[1] ? 2.2 : 0), p[1] + (v[1] ? 0 : 1.6)], { color: c, size: 12, weight: 700 });
          const sh = l.params.shed; const cc = l.params.computed || {};
          const out = l.objects.find((x) => x.props && x.props.role === 'outline');
          if (sh && out && cc.shed) {
            const bx = bboxPts(out.geometry.pts);
            const at = (side, inset) => ({ N: [p[0], bx.minY + inset], S: [p[0], bx.maxY - inset], W: [bx.minX + inset, p[1]], E: [bx.maxX - inset, p[1]] })[side];
            text(`HIGH ${fmtFtIn(sh.highPlateFt)}`, at(cc.highSide, 1.4), { color: c, size: 11, weight: 700 });
            text(`LOW ${fmtFtIn(sh.lowPlateFt)}`, at(cc.lowSide, 1.4), { color: c, size: 11, weight: 700 });
          }
        }
        else if (o.type === 'label') {
          const p = o.geometry.c;
          const a2 = o.props.arrow === 'y' ? [p[0], p[1] + 2.5] : [p[0] + 2.5, p[1]];
          arrow(a2, o.props.arrow === 'y' ? [p[0], p[1] - 2.5] : [p[0] - 2.5, p[1]], c, 1.5);
          text(o.props.text, [p[0] + (o.props.arrow === 'y' ? 2.2 : 0), p[1] + (o.props.arrow === 'y' ? 0 : 1.6)], { color: c, size: 12, weight: 700 });
        }
      });
      function bboxPts(P) { const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]); return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }; }
      // light rafter ticks so direction reads
      l.objects.filter((o) => o.type === 'rafter').forEach((o, i) => { if (i % 2 === 0) line(o.geometry.a, lerp(o.geometry.a, o.geometry.b, 0.12), 1, c, [3, 3]); });
      return;
    }
    if (l.kind === 'custom') {
      l.objects.forEach((o) => {
        const s = isSel(sel, l, o);
        if (o.type === 'line') { line(o.geometry.a, o.geometry.b, s ? 3.5 : 2.2, s ? SEL : c); if (o.props.label) text(o.props.label, lerp(o.geometry.a, o.geometry.b, 0.5), { color: c, size: 10 }); }
        else if (o.type === 'area') poly(o.geometry.pts, { fill: hexA(c, 0.18), stroke: s ? SEL : c, w: 1.5 });
        else if (o.type === 'label') text(o.props.text, o.geometry.c, { color: c, size: 12 });
      });
    }
  }

  // Sonotube symbol. auto = grey with a cross; manual = blue ring + blue diamond tag;
  // flagged = red dashed halo + "!". Selected = orange.
  const MAN = '#1d5fa8', FLAG = '#c0392b';
  function drawPier(c, diaIn, { sel = false, manual = false, flagged = false, shape = 'round', halfFt = null } = {}) {
    const [x, y] = toScreen(c); const r = Math.max(4, (halfFt != null ? halfFt : diaIn * IN / 2) * view.scale);
    const col = sel ? SEL : manual ? MAN : '#5f6368';
    const sq = shape === 'square' || shape === 'precast';
    const outline = (k) => { ctx.beginPath(); if (sq) ctx.rect(x - r - k, y - r - k, 2 * (r + k), 2 * (r + k)); else ctx.arc(x, y, r + k, 0, Math.PI * 2); };
    ctx.save();
    if (flagged) { outline(6); ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.strokeStyle = FLAG; ctx.stroke(); ctx.setLineDash([]); }
    if (sel) { outline(4); ctx.fillStyle = 'rgba(255,106,0,.18)'; ctx.fill(); }
    if (shape === 'precast') { outline(0); ctx.fillStyle = 'rgba(208,69,58,.18)'; ctx.fill(); }
    outline(0);
    ctx.fillStyle = sel ? 'rgba(255,106,0,.4)' : manual ? 'rgba(29,95,168,.28)' : 'rgba(140,143,148,.35)'; ctx.fill();
    ctx.lineWidth = sel ? 2.5 : manual ? 2.2 : 1.5; ctx.strokeStyle = col; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.lineWidth = 0.7; ctx.stroke();
    if (manual) { // diamond tag at upper right = manual (regeneration won't move it)
      const tx = x + r * 0.75 + 2, ty = y - r * 0.75 - 2, k = 4;
      ctx.beginPath(); ctx.moveTo(tx, ty - k); ctx.lineTo(tx + k, ty); ctx.lineTo(tx, ty + k); ctx.lineTo(tx - k, ty); ctx.closePath();
      ctx.fillStyle = sel ? SEL : MAN; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    if (flagged) text('!', Object.assign([x - r - 7, y - r - 5], { screen: true }), { color: '#fff', bg: FLAG, size: 11, weight: 800 });
    ctx.restore();
  }
  // dimension line between two plan points with a label (live pier dims)
  function dimSeg(a, b, label, color, offPx = 0) {
    let [x1, y1] = toScreen(a), [x2, y2] = toScreen(b);
    const L = Math.hypot(x2 - x1, y2 - y1) || 1; const nx = -(y2 - y1) / L * offPx, ny = (x2 - x1) / L * offPx;
    x1 += nx; y1 += ny; x2 += nx; y2 += ny;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    [[x1, y1], [x2, y2]].forEach(([x, y]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang - Math.PI / 4); ctx.fillRect(-5, -0.9, 10, 1.8); ctx.restore(); });
    let ta = ang; if (ta > Math.PI / 2 || ta < -Math.PI / 2) ta += Math.PI;
    if (L > 18) text(label, Object.assign([(x1 + x2) / 2, (y1 + y2) / 2], { screen: true }), { color: '#fff', bg: color, size: 12, rot: ta, weight: 700 });
    ctx.restore();
  }
  function drawPierDims(m, c, selfId) {
    const d = pierDims(m, c, selfId);
    const WALL = '#1d4f7a', NB = '#7b3fa0';
    const base = d.wall && d.wall.d > 0.04 ? d.wall.foot : c;
    if (d.wall && d.wall.d > 0.04) dimSeg(c, d.wall.foot, `${fmtFtIn(d.wall.d)} to wall`, WALL);
    d.ends.forEach((e) => dimSeg(base, e.p, `${fmtFtIn(e.d)}`, WALL, -16));
    d.neighbors.forEach((n) => {
      const [x1, y1] = toScreen(c), [x2, y2] = toScreen(n.p);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = NB; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
      // label sits beside the dashed line (opposite side to the wall-end dims) so it never covers the tube
      const Ls = Math.hypot(x2 - x1, y2 - y1);
      if (Ls > 30) { let ux = (x2 - x1) / Ls, uy = (y2 - y1) / Ls; if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0)) { ux = -ux; uy = -uy; } const off = -20, nx = -uy * off, ny = ux * off; const dd = Math.max(Ls / 2, 44); text(`${fmtFtIn(n.d)} o.c.`, Object.assign([x1 + (x2 - x1) / Ls * dd + nx, y1 + (y2 - y1) / Ls * dd + ny], { screen: true }), { color: '#fff', bg: NB, size: 12, weight: 700 }); }
    });
    const o = originOf(m);
    text(`X ${fmtFtIn(c[0] - o[0])} · Y ${fmtFtIn(c[1] - o[1])}  (from W / N face)`, Object.assign([cssW / 2, cssH - 30], { screen: true }), { color: '#fff', bg: 'rgba(29,79,122,.92)', size: 13, weight: 700 });
    return d;
  }
  function snapBadge(c, kind) {
    const [x, y] = toScreen(c);
    text(kind === 'corner' ? 'corner' : kind === 'wall' ? 'on wall' : 'grid', Object.assign([x, y + Math.max(14, 0.6 * view.scale) + 10], { screen: true }), { color: '#fff', bg: kind === 'grid' ? '#555' : '#ff6a00', size: 10, weight: 700 });
  }

  function wallOf(m, id) { return getLayer(m, 'walls').objects.find((w) => w.id === id); }
  function openingPts(m, o) {
    const w = wallOf(m, o.geometry.wallId); if (!w) return null;
    const { a, b } = w.geometry; const L = dist(a, b);
    const half = (o.props.widthIn * IN) / 2;
    return { w, p0: lerp(a, b, (o.geometry.t - half) / L), p1: lerp(a, b, (o.geometry.t + half) / L), c: lerp(a, b, o.geometry.t / L), L, a, b };
  }
  function drawOpening(m, l, o, s) {
    const q = openingPts(m, o); if (!q) return;
    const t = q.w.props.thicknessIn * IN;
    const r = wallRect(q.p0, q.p1, t * 1.02);
    poly(r, { fill: '#f7f5f0' });
    const col = s ? SEL : '#222';
    if (o.props.kind === 'window') {
      // window break: jambs + glass lines (sill below the 4 ft cut, head above)
      line(r[0], r[3], 1.2, col); line(r[1], r[2], 1.2, col);
      line(lerp(r[0], r[3], 0.35), lerp(r[1], r[2], 0.35), 1, col); line(lerp(r[0], r[3], 0.65), lerp(r[1], r[2], 0.65), 1, col);
    } else {
      // door swing: leaf + quarter arc, swinging inward
      const fp = M().footprint;
      let n = [-(q.b[1] - q.a[1]) / q.L, (q.b[0] - q.a[0]) / q.L];
      if (q.w.props.exterior) { const nn = inwardNormal(fp, q.w.geometry.edge); n = nn; }
      if (o.props.swing === 'out') n = [-n[0], -n[1]];
      const wft = o.props.widthIn * IN;
      const hinge = q.p0, tip = [hinge[0] + n[0] * wft, hinge[1] + n[1] * wft];
      line(hinge, tip, s ? 2.5 : 1.6, col);
      const [hx, hy] = toScreen(hinge);
      const a0 = Math.atan2(n[1], n[0]), a1 = Math.atan2(q.p1[1] - hinge[1], q.p1[0] - hinge[0]);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.beginPath(); ctx.arc(hx, hy, wft * view.scale, a0, a1, d < 0); ctx.lineWidth = 0.9; ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (s) text(`${o.props.kind} ${o.props.widthIn}" · hdr ${o.props.header} (EXAMPLE)`, [q.c[0], q.c[1]], { size: 10, color: SEL });
  }

  function drawDims(m) {
    const fp = m.footprint;
    const col = '#1d4f7a';
    const dimLine = (a, b, n, off, label) => {
      const A = [a[0] - n[0] * off, a[1] - n[1] * off], B = [b[0] - n[0] * off, b[1] - n[1] * off];
      line(A, B, 1, col);
      [a, b].forEach((p, i) => { const P = i ? B : A; line([p[0] - n[0] * 0.6, p[1] - n[1] * 0.6], [P[0] - n[0] * 0.5, P[1] - n[1] * 0.5], 0.7, col); const [x, y] = toScreen(P); ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(B[1] - A[1], B[0] - A[0]) - Math.PI / 4); ctx.fillStyle = col; ctx.fillRect(-4, -0.75, 8, 1.5); ctx.restore(); });
      const mid = lerp(A, B, 0.5);
      let ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      text(label, toScreenPt(mid), { color: col, size: 11, rot: ang });
    };
    fp.forEach((a, i) => {
      const b = fp[(i + 1) % fp.length];
      const n = inwardNormal(fp, i);
      dimLine(a, b, n, PLAN.dimOffsetFt, fmtFtIn(dist(a, b)));
    });
    if (fp.length > 4) {
      const bb = bbox(fp);
      dimLine([bb.minX, bb.minY], [bb.maxX, bb.minY], [0, 1], PLAN.dimOverallOffsetFt, `Overall ${fmtFtIn(bb.w)}`);
      dimLine([bb.minX, bb.maxY], [bb.minX, bb.minY], [1, 0], PLAN.dimOverallOffsetFt, `Overall ${fmtFtIn(bb.h)}`);
    }
  }
  function toScreenPt(p) { const s = toScreen(p); s.screen = true; return s; }

  function drawNorth(m) {
    const site = getLayer(m, 'site');
    if (!layerDisplay(m, site).shown) return;
    const x = cssW - 30, y = cssW < 500 ? 92 : 50;
    ctx.save(); ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(x, y - 16); ctx.lineTo(x + 8, y + 10); ctx.lineTo(x, y + 5); ctx.lineTo(x - 8, y + 10); ctx.closePath();
    ctx.fillStyle = '#2b2b2b'; ctx.fill();
    ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', x, y - 21);
    ctx.restore();
  }

  function drawDraft(m) {
    if (drag && drag.kind === 'pier' && drag.moved) {
      const o = drag.obj;
      ctx.save(); ctx.globalAlpha = 0.35; drawPier(drag.c0, o.props.diaIn, { manual: true }); ctx.restore(); // where it was
      drawPierDims(m, o.geometry.c, o.id);
      drawPier(o.geometry.c, o.props.diaIn, { sel: true, manual: true });
      if (drag.snap) snapBadge(o.geometry.c, drag.snap);
      return;
    }
    if (draft && draft.kind === 'pier') {
      drawPierDims(m, draft.c, null);
      drawPier(draft.c, draft.diaIn, { sel: true, manual: true });
      snapBadge(draft.c, draft.snap);
      return;
    }
    if (tool === 'pier' && hover && !draft) {
      ctx.save(); ctx.globalAlpha = 0.6; drawPier(hover, getLayer(m, 'foundation').params.placeDiaIn || 12, { manual: true }); ctx.restore();
      return;
    }
    if (!draft) {
      if (hover && (tool !== 'select')) { const [x, y] = toScreen(hover); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = hover[2] ? '#ff6a00' : '#1d4f7a'; ctx.fill(); }
      return;
    }
    if (draft.kind === 'rect') {
      const [a, b] = [draft.a, draft.b];
      const pts = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      poly(pts, { stroke: '#ff6a00', w: 2, fill: 'rgba(255,106,0,.08)' });
      text(`${fmtFtIn(Math.abs(b[0] - a[0]))} × ${fmtFtIn(Math.abs(b[1] - a[1]))}`, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { color: '#ff6a00', size: 13 });
    } else if (draft.kind === 'poly') {
      const pts = draft.pts.concat(hover ? [hover] : []);
      poly(pts, { stroke: '#ff6a00', w: 2, close: false });
      draft.pts.forEach((p, i) => { const [x, y] = toScreen(p); ctx.beginPath(); ctx.arc(x, y, i === 0 ? 7 : 4, 0, Math.PI * 2); ctx.fillStyle = i === 0 ? 'rgba(255,106,0,.4)' : '#ff6a00'; ctx.fill(); });
      if (hover && draft.pts.length) text(fmtFtIn(dist(draft.pts[draft.pts.length - 1], hover)), lerp(draft.pts[draft.pts.length - 1], hover, 0.5), { color: '#ff6a00' });
    } else if (draft.kind === 'seg') {
      line(draft.a, draft.b, 3, '#ff6a00');
      text(fmtFtIn(dist(draft.a, draft.b)), lerp(draft.a, draft.b, 0.5), { color: '#ff6a00' });
    }
  }

  // ---------- hit testing
  function hitTest(p, tolPx = 10) {
    const m = M();
    const tol = tolPx / view.scale;
    const order = stackOrder(m).filter((l) => layerDisplay(m, l).shown);
    // active layer first, then top-down
    const active = order.find((l) => l.id === m.activeLayerId);
    const rest = order.filter((l) => l !== active).reverse();
    for (const l of (active ? [active] : []).concat(rest)) {
      let best = null, bd = tol;
      for (const o of l.objects) {
        let d = Infinity;
        const g = o.geometry;
        if (o.type === 'opening') { const q = openingPts(m, o); if (q && distToSeg(p, q.a, q.b).d < (q.w.props.thicknessIn * IN) / 2 + tol && dist(q.c, p) <= (o.props.widthIn * IN) / 2 + tol * 0.3) d = -0.001; }
        else if (o.type === 'pier') d = Math.max(0, dist(g.c, p) - pierShapeOf(o, l.params).halfFt) - tol * 0.6; // piers win over the grade beam under them
        else if (g && g.a && g.b) { d = distToSeg(p, g.a, g.b).d; if (o.type === 'wall') d = Math.max(0, d - (o.props.thicknessIn * IN) / 2); }
        else if (o.type === 'label') d = dist(g.c, p) - 1;
        else if (o.type === 'area' && g.pts) {
          const edge = Math.min(...g.pts.map((a, i) => distToSeg(p, a, g.pts[(i + 1) % g.pts.length]).d));
          d = (o.props.role === 'subfloor' || o.props.role === 'slab') && pointInPoly(p, g.pts) ? tol * 0.95 : edge;
        }
        if (d < bd) { bd = d; best = o; }
      }
      if (best) return { layerId: l.id, objectId: best.id };
    }
    return null;
  }
  /** nearest pier within tolPx (foundation layer shown), for the pier tool */
  function hitPier(p, tolPx) {
    const m = M(); const l = getLayer(m, 'foundation');
    if (!layerDisplay(m, l).shown) return null;
    let best = null, bd = tolPx / view.scale;
    l.objects.forEach((o) => { if (o.type !== 'pier') return; const d = Math.max(0, dist(o.geometry.c, p) - pierShapeOf(o, l.params).halfFt); if (d < bd) { bd = d; best = o; } });
    return best;
  }
  function hitVertex(p) {
    const fp = M().footprint; const tol = 14 / view.scale;
    let best = -1, bd = tol;
    fp.forEach((v, i) => { const d = dist(v, p); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function hitEdge(p) {
    const fp = M().footprint; const tol = 10 / view.scale;
    const t = LUMBER[getLayer(M(), 'walls').params.extSize] * IN;
    let best = -1, bd = tol + t;
    fp.forEach((a, i) => { const d = distToSeg(p, a, fp[(i + 1) % fp.length]).d; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // ---------- pointer handling
  const evPt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function requireLayer(kindOk, msg) {
    const m = M();
    const l = getLayer(m, m.activeLayerId);
    if (!l || !kindOk(l)) { app.toast(msg); return null; }
    if (l.locked) { app.toast(`${l.name} is locked`); return null; }
    return l;
  }
  function wallsUnlocked() {
    const w = getLayer(M(), 'walls');
    if (w.locked) { app.toast('Walls layer is locked — unlock it to edit the footprint'); return false; }
    return true;
  }

  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    const sp = evPt(e);
    pointers.set(e.pointerId, sp);
    if (pointers.size === 2) {
      // second finger: cancel any single-finger op and start pinch/pan
      if (drag && drag.kind !== 'pan' && drag.commit === false) { /* noop */ }
      if (drag && drag.kind === 'pier') { app.onPierDrag && app.onPierDrag(false); if (drag.moved) app.commit('foundation'); }
      if (draft && draft.kind === 'pier') app.onPierDrag && app.onPierDrag(false);
      drag = null; if (draft && draft.kind !== 'poly') draft = null;
      const [p1, p2] = Array.from(pointers.values());
      pinch = { d0: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1, s0: view.scale, mid: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], ox: view.ox, oy: view.oy };
      render(); return;
    }
    if (pointers.size > 2) return;
    const w = toWorld(sp[0], sp[1]);
    const m = M();
    if (inspecting()) { drag = { kind: 'pan', sx: sp[0], sy: sp[1], ox: view.ox, oy: view.oy, tap: true, inspect: true }; return; } // $ inspect: pan or tap, never edit
    if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', sx: sp[0], sy: sp[1], ox: view.ox, oy: view.oy }; return; }

    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (tool === 'pier') {
      const fl = requireLayer((l) => l.kind === 'foundation', 'Make Foundation the active layer to place piers');
      if (!fl) return;
      const hp = hitPier(w, touch ? 14 : 8);
      if (hp) { // tap an existing tube = select it (drag moves it), not a new drop
        app.select({ layerId: 'foundation', objectId: hp.id }, true);
        drag = { kind: 'pier', obj: hp, w0: w, c0: hp.geometry.c.slice(), moved: false, sx: sp[0], sy: sp[1] };
        return;
      }
      const sn = snapPier(m, w, (touch ? PIERS.snapPxTouch : PIERS.snapPx) / view.scale);
      draft = { kind: 'pier', c: sn.c, snap: sn.snap, diaIn: fl.params.placeDiaIn || 12, touch };
      app.onPierDrag && app.onPierDrag(true);
      render(); return;
    }
    if (tool === 'select') {
      const wl = getLayer(m, 'walls');
      const wallsEditable = m.activeLayerId === 'walls' && !wl.locked && layerDisplay(m, wl).shown;
      if (wallsEditable) {
        const vi = hitVertex(w);
        if (vi >= 0) { drag = { kind: 'vertex', i: vi, start: m.footprint.map((p) => p.slice()), moved: false, sx: sp[0], sy: sp[1] }; return; }
      }
      const hit = hitTest(w, touch ? 16 : 10);
      if (hit) {
        const obj = findObject(m, hit);
        const lay = getLayer(m, hit.layerId);
        app.select(hit, obj && obj.type === 'pier');   // piers edit in the floating pier panel, not the sheet
        if (obj && obj.type === 'pier' && !lay.locked) {
          drag = { kind: 'pier', obj, w0: w, c0: obj.geometry.c.slice(), moved: false, sx: sp[0], sy: sp[1] };
        } else if (obj && !lay.locked && hit.layerId === 'walls' && obj.props.exterior && wallsEditable) {
          drag = { kind: 'edge', i: obj.geometry.edge, w0: w, start: m.footprint.map((p) => p.slice()), moved: false, sx: sp[0], sy: sp[1] };
        } else if (obj && !lay.locked && obj.type === 'opening') {
          drag = { kind: 'opening', obj, moved: false, sx: sp[0], sy: sp[1] };
        } else if (obj && !lay.locked && obj.type === 'wall' && !obj.props.exterior) {
          drag = { kind: 'move', obj, w0: w, a0: obj.geometry.a.slice(), b0: obj.geometry.b.slice(), layerId: lay.id, moved: false, sx: sp[0], sy: sp[1] };
        } else drag = { kind: 'pan', sx: sp[0], sy: sp[1], ox: view.ox, oy: view.oy, tap: false };
      } else {
        drag = { kind: 'pan', sx: sp[0], sy: sp[1], ox: view.ox, oy: view.oy, tap: true };
      }
      return;
    }
    const s = snap(w);
    if (tool === 'rect') { if (!wallsUnlocked()) return; draft = { kind: 'rect', a: s, b: s }; }
    else if (tool === 'poly') {
      if (!wallsUnlocked()) return;
      if (!draft) draft = { kind: 'poly', pts: [] };
      if (draft.pts.length >= 3 && dist(draft.pts[0], s) < 14 / view.scale) { finishPoly(); return; }
      draft.pts.push([s[0], s[1]]);
    } else if (tool === 'wall') {
      if (!requireLayer((l) => l.kind === 'walls', 'Make Walls the active layer to draw walls')) return;
      draft = { kind: 'seg', a: s, b: s, type: 'wall' };
    } else if (tool === 'line') {
      if (!requireLayer((l) => l.kind === 'custom' || l.kind === 'site', 'Lines go on Site or a custom layer — make one active')) return;
      draft = { kind: 'seg', a: s, b: s, type: 'line' };
    } else if (tool === 'door' || tool === 'window') {
      if (!requireLayer((l) => l.kind === 'walls', 'Make Walls the active layer to add openings')) return;
      placeOpening(w, tool);
    }
    render();
  }

  function onMove(e) {
    const sp = evPt(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);
    if (pinch && pointers.size >= 2) {
      const [p1, p2] = Array.from(pointers.values());
      const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
      const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const ns = Math.max(1.5, Math.min(200, pinch.s0 * d / pinch.d0));
      const wx = (pinch.mid[0] - pinch.ox) / pinch.s0, wy = (pinch.mid[1] - pinch.oy) / pinch.s0;
      view.scale = ns; view.ox = mid[0] - wx * ns; view.oy = mid[1] - wy * ns;
      render(); return;
    }
    const w = toWorld(sp[0], sp[1]);
    const m = M();
    if (!drag && inspecting()) { if (e.pointerType === 'mouse') inspectAt(e); return; }
    if (drag) {
      const moved = Math.hypot(sp[0] - (drag.sx || 0), sp[1] - (drag.sy || 0)) > 4;
      if (drag.kind === 'pan') { if (moved) drag.tap = false; view.ox = drag.ox + sp[0] - drag.sx; view.oy = drag.oy + sp[1] - drag.sy; render(); return; }
      if (!moved && !drag.moved) return;
      drag.moved = true;
      const tolFt = (drag.kind === 'pier' ? ((e.pointerType === 'touch') ? PIERS.snapPxTouch : PIERS.snapPx) : 14) / view.scale;
      if (drag.kind === 'pier' && !drag.started) { drag.started = true; app.onPierDrag && app.onPierDrag(true); }
      const src = applyDrag(m, drag, w, tolFt);   // shared with 3D (edit-ops.js)
      if (drag.kind === 'pier') { render(); return; }
      if (src) app.preview(src);
      return;
    }
    if (tool === 'pier') {
      const sn = snapPier(m, w, ((e.pointerType === 'touch') ? PIERS.snapPxTouch : PIERS.snapPx) / view.scale);
      if (draft && draft.kind === 'pier') { draft.c = sn.c; draft.snap = sn.snap; hover = null; }
      else if (e.pointerType === 'mouse') hover = sn.c;
      render(); return;
    }
    if (tool !== 'select') {
      hover = snap(w);
      if (draft && draft.kind === 'rect') draft.b = hover;
      if (draft && draft.kind === 'seg') { draft.b = hover; if (e.shiftKey || true) orthoSeg(draft); }
      render();
    }
  }
  function orthoSeg(d) {
    // gentle ortho lock: within ~8° of horizontal/vertical snaps square
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
    const ang = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
    if (ang < 0.14 || ang > Math.PI / 2 - 0.14) { if (Math.abs(dx) > Math.abs(dy)) d.b = [d.b[0], d.a[1]]; else d.b = [d.a[0], d.b[1]]; }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    const m = M();
    if (drag) {
      const d = drag; drag = null;
      if (d.kind === 'pan' && d.tap && d.inspect) { inspectAt(e); return; }
      if (d.kind === 'pan' && d.tap) app.select(null);
      if (d.kind === 'pier') {
        app.onPierDrag && app.onPierDrag(false);
        if (!d.moved) { render(); app.revealPier && app.revealPier(d.obj); return; }
        app.select({ layerId: 'foundation', objectId: d.obj.id }, true); app.commit('foundation'); return;
      }
      if (d.moved) {
        if (d.kind === 'vertex') app.commit('footprint');
        else if (d.kind === 'edge') app.commit('walls');
        else if (d.kind === 'opening' || d.kind === 'move') app.commit(d.kind === 'move' ? d.layerId : 'walls');
      }
      render(); return;
    }
    if (!draft) return;
    if (draft.kind === 'pier') {
      const d = draft; draft = null; app.onPierDrag && app.onPierDrag(false);
      const o = dropPier(m, d.c, { diaIn: d.diaIn });
      app.select({ layerId: 'foundation', objectId: o.id }, true);
      app.commit('foundation');
      app.revealPier && app.revealPier(o);
      app.toast(`Sonotube Ø${d.diaIn} in dropped${d.snap === 'grid' ? '' : ' on the wall line'} — drag it to adjust`);
      return;
    }
    if (draft.kind === 'rect') {
      const { a, b } = draft; draft = null;
      const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      if (w < 4 || h < 4) { app.toast('Drag a bigger rectangle (min 4 ft)'); render(); return; }
      const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
      setFootprint([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]);
    } else if (draft.kind === 'seg') {
      const d = draft; draft = null;
      if (dist(d.a, d.b) < 1) { render(); return; }
      const l = getLayer(m, m.activeLayerId);
      if (d.type === 'wall') {
        const o = { id: uid('w'), type: 'wall', geometry: { a: [d.a[0], d.a[1]], b: [d.b[0], d.b[1]] }, props: { exterior: false, bearing: false, size: l.params.intSize, thicknessIn: LUMBER[l.params.intSize], studOcIn: l.params.studOcIn } };
        l.objects.push(o); app.select({ layerId: l.id, objectId: o.id }, true); app.commit('walls');
      } else {
        const o = { id: uid('ln'), type: 'line', geometry: { a: [d.a[0], d.a[1]], b: [d.b[0], d.b[1]] }, props: { label: l.kind === 'site' ? 'Utility' : '' } };
        l.objects.push(o); app.select({ layerId: l.id, objectId: o.id }, true); app.commit(l.id);
      }
    }
    render();
  }

  function finishPoly() {
    if (!draft || draft.kind !== 'poly') return;
    const pts = draft.pts; draft = null;
    if (pts.length < 3) { app.toast('Footprint needs at least 3 corners'); render(); return; }
    setFootprint(pts);
  }
  function setFootprint(pts) {
    const m = M();
    m.footprint = pts.map((p) => [p[0], p[1]]);
    app.commit('footprint');
    app.toast('Footprint set — layers regenerated');
    setTool('select');
    fit();
  }
  function placeOpening(w, kind) {
    const m = M();
    const wl = getLayer(m, 'walls');
    let best = null, bd = 20 / view.scale + 0.5;
    wl.objects.forEach((o) => { if (o.type !== 'wall') return; const r = distToSeg(w, o.geometry.a, o.geometry.b); if (r.d < bd) { bd = r.d; best = { o, t: r.t }; } });
    if (!best) { app.toast('Tap on a wall to place the ' + kind); return; }
    const L = dist(best.o.geometry.a, best.o.geometry.b);
    const g = m.snapIn * IN;
    const def = (app.defaults.openings[kind]);
    const o = { id: uid('op'), type: 'opening', geometry: { wallId: best.o.id, t: Math.round((best.t * L) / g) * g }, props: Object.assign({ kind }, def) };
    wl.objects.push(o);
    app.select({ layerId: 'walls', objectId: o.id }, true);
    app.commit('walls');
  }

  function onWheel(e) {
    e.preventDefault();
    const sp = evPt(e);
    const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(1.5, Math.min(200, view.scale * k));
    const wx = (sp[0] - view.ox) / view.scale, wy = (sp[1] - view.oy) / view.scale;
    view.scale = ns; view.ox = sp[0] - wx * ns; view.oy = sp[1] - wy * ns;
    render();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; if (drag && drag.kind === 'pier') { app.onPierDrag && app.onPierDrag(false); if (drag.moved) app.commit('foundation'); } drag = null; if (draft && draft.kind === 'pier') { draft = null; app.onPierDrag && app.onPierDrag(false); } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', () => { if (tool === 'poly') finishPoly(); });
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { draft = null; render(); }
    if (e.key === 'Enter' && tool === 'poly') finishPoly();
  });

  function setTool(t) { tool = t; draft = null; hover = null; app.onTool && app.onTool(t); render(); }

  return {
    render, resize, fit, setTool, getTool: () => tool, finishPoly,
    /** pan so plan point c is visible above a bottom panel of insetPx */
    ensureVisible(c, insetPx = 0) {
      const [x, y] = toScreen(c); const top = 130, bot = cssH - insetPx - 30;
      if (bot <= top) return;
      if (y > bot) view.oy -= (y - bot); else if (y < top) view.oy += (top - y);
      if (x < 30) view.ox += 30 - x; else if (x > cssW - 30) view.ox -= x - (cssW - 30);
      render();
    },
    setInspectMark(k) { inspectMark = k || null; render(); },
    getInspectMark: () => inspectMark,
    debug: { view, toScreen, toWorld, overlay: () => Object.assign({}, lastOverlay) },
  };
}

function centroid(pts) { const b = bbox(pts); return [b.cx, b.cy]; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
