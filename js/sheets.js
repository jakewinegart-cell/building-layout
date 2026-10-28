// ============================================================================
// sheets.js — plan sheets for the completion report, drawn as SVG straight from the model.
// Plan coords are ft (x east, y south), so the SVG viewBox is in ft too.
// A1 dimensioned plan · S1 foundation/pier plan · S2 floor framing · S3 wall framing
// elevations · S4 roof framing (+ section). 3D views (A2) come from view3d.snapshot().
// Nothing here is engineered — every sheet carries "NOT FOR CONSTRUCTION".
// ============================================================================
import { LUMBER, LUMBER_T_IN, pierDepthIn, pierShapeOf, pierShapeLabel, precastFrostWarning, FOUNDATION_TYPES, isPierType } from './config.js';
import { getLayer } from './model.js';
import { dist, lerp, bbox, inwardNormal, offsetPolygon, fmtFtIn, signedArea } from './geom.js';
import { studLayout } from './homeplan-derived.js';

const IN = 1 / 12;
const r3 = (x) => Math.round(x * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = (p) => `${r3(p[0])},${r3(p[1])}`;
const add = (a, n, k) => [a[0] + n[0] * k, a[1] + n[1] * k];
const poly = (pts, attrs) => `<polygon points="${pts.map(P).join(' ')}" ${attrs}/>`;
const line = (a, b, attrs) => `<line x1="${r3(a[0])}" y1="${r3(a[1])}" x2="${r3(b[0])}" y2="${r3(b[1])}" ${attrs}/>`;
function text(p, s, { size = 1.1, anchor = 'middle', rot = 0, weight = 400, fill = '#1d2733', cls = '' } = {}) {
  const tr = rot ? ` transform="rotate(${r3(rot)} ${r3(p[0])} ${r3(p[1])})"` : '';
  return `<text x="${r3(p[0])}" y="${r3(p[1])}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="middle" font-weight="${weight}" fill="${fill}"${cls ? ` class="${cls}"` : ''}${tr}>${esc(s)}</text>`;
}
function readableAngle(a, b) {
  let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (ang > 90.01) ang -= 180; if (ang <= -90.01) ang += 180;
  return ang;
}
/** Dimension a→b, drawn offset `off` ft along unit normal n. */
function dim(a, b, n, off, label, { size = 1.0, color = '#33475b', ext = true } = {}) {
  const A = add(a, n, off), B = add(b, n, off);
  const L = dist(a, b) || 1; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const tick = (p) => line(add(add(p, u, -0.35), n, -0.35), add(add(p, u, 0.35), n, 0.35), `stroke="${color}" stroke-width="0.09"`);
  let s = '';
  if (ext) s += line(add(a, n, Math.sign(off) * 0.4), add(a, n, off + Math.sign(off) * 0.5), `stroke="${color}" stroke-width="0.05"`) + line(add(b, n, Math.sign(off) * 0.4), add(b, n, off + Math.sign(off) * 0.5), `stroke="${color}" stroke-width="0.05"`);
  s += line(A, B, `stroke="${color}" stroke-width="0.06"`) + tick(A) + tick(B);
  const mid = add(lerp(A, B, 0.5), n, Math.sign(off || 1) * size * 0.75);
  s += text(mid, label == null ? fmtFtIn(L) : label, { size, rot: readableAngle(A, B), fill: color, weight: 600 });
  return `<g class="dim">${s}</g>`;
}
const outN = (fp, i) => { const n = inwardNormal(fp, i); return [-n[0], -n[1]]; };
function wrap(b, body, { mg = 6, title = '', cls = 'plan' } = {}) {
  const x = b.minX - mg, y = b.minY - mg, w = b.maxX - b.minX + mg * 2, h = b.maxY - b.minY + mg * 2;
  return `<svg class="sheet-svg ${cls}" viewBox="${r3(x)} ${r3(y)} ${r3(w)} ${r3(h)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">${body}</svg>`;
}
function northArrow(b, mg) {
  const c = [b.maxX + mg * 0.55, b.minY - mg * 0.45];
  return `<g class="north">${poly([[c[0], c[1] - 1.4], [c[0] + 0.7, c[1] + 0.8], [c[0], c[1] + 0.3], [c[0] - 0.7, c[1] + 0.8]], 'fill="#1d2733"')}${text([c[0], c[1] + 1.9], 'N', { size: 1.1, weight: 700 })}</g>`;
}
function wallsOf(m) { return getLayer(m, 'walls').objects.filter((o) => o.type === 'wall'); }
function opsOf(m) { return getLayer(m, 'walls').objects.filter((o) => o.type === 'opening'); }
/** Side name for footprint edge i, from its outward normal. */
export function sideName(fp, i) {
  const n = outN(fp, i);
  if (Math.abs(n[1]) >= Math.abs(n[0])) return n[1] < 0 ? 'North' : 'South';
  return n[0] > 0 ? 'East' : 'West';
}
function wallPoly(a, b, t, ext = 0) {
  const L = dist(a, b) || 1; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; const n = [-u[1], u[0]];
  const A = add(a, u, -ext), B = add(b, u, ext);
  return [add(A, n, t / 2), add(B, n, t / 2), add(B, n, -t / 2), add(A, n, -t / 2)];
}
function openingTags(m) {
  let d = 0, w = 0;
  return opsOf(m).map((o) => ({ o, tag: o.props.kind === 'door' ? `D${++d}` : `W${++w}` }));
}

// ---------------------------------------------------------------- A1 dimensioned plan
export function sheetPlan(m) {
  const fp = m.footprint; const b = bbox(fp); const mg = 7;
  const wp = getLayer(m, 'walls').params; const tExt = LUMBER[wp.extSize] * IN;
  const inner = offsetPolygon(fp, tExt);
  let s = `<path d="M${fp.map(P).join(' L')} Z M${inner.slice().reverse().map(P).join(' L')} Z" fill="#cfc6b6" stroke="#1d2733" stroke-width="0.12" fill-rule="evenodd"/>`;
  wallsOf(m).filter((w) => !w.props.exterior).forEach((w) => { s += poly(wallPoly(w.geometry.a, w.geometry.b, w.props.thicknessIn * IN), 'fill="#e2dccf" stroke="#1d2733" stroke-width="0.08"'); });
  const tags = openingTags(m);
  tags.forEach(({ o, tag }) => {
    const w = wallsOf(m).find((x) => x.id === o.geometry.wallId); if (!w) return;
    const { a, b: bb } = w.geometry; const L = dist(a, bb); const half = (o.props.widthIn * IN) / 2; const t = w.props.thicknessIn * IN;
    const p0 = lerp(a, bb, (o.geometry.t - half) / L), p1 = lerp(a, bb, (o.geometry.t + half) / L), c = lerp(a, bb, o.geometry.t / L);
    s += poly(wallPoly(p0, p1, t + 0.06), 'fill="#fff" stroke="none"');
    const u = [(bb[0] - a[0]) / L, (bb[1] - a[1]) / L]; let n = [-u[1], u[0]];
    const toIn = (() => { const cx = lerp(fp[0], fp[0], 0); const ctr = [b.cx, b.cy]; return ((ctr[0] - c[0]) * n[0] + (ctr[1] - c[1]) * n[1]) > 0; })();
    if (!toIn) n = [-n[0], -n[1]];
    if (o.props.kind === 'window') {
      [-t / 2, 0, t / 2].forEach((k) => { s += line(add(p0, n, k), add(p1, n, k), 'stroke="#2a6fb0" stroke-width="0.07"'); });
      s += line(add(p0, n, -t / 2), add(p0, n, t / 2), 'stroke="#1d2733" stroke-width="0.08"') + line(add(p1, n, -t / 2), add(p1, n, t / 2), 'stroke="#1d2733" stroke-width="0.08"');
    } else {
      const sw = (o.props.swing || 'in') === 'out' ? -1 : 1; const W = 2 * half; const nn = [n[0] * sw, n[1] * sw];
      const hinge = add(p0, nn, (t / 2)); const leaf = add(hinge, nn, W); const end = add(p1, nn, t / 2);
      s += line(hinge, leaf, 'stroke="#1d2733" stroke-width="0.08"');
      const sweep = ((u[0] * nn[1] - u[1] * nn[0]) > 0) ? 0 : 1;
      s += `<path d="M${P(leaf)} A${r3(W)},${r3(W)} 0 0 ${sweep} ${P(end)}" fill="none" stroke="#1d2733" stroke-width="0.05" stroke-dasharray="0.3 0.2"/>`;
    }
    s += `<g class="otag">${`<circle cx="${r3(add(c, n, t + 1.4)[0])}" cy="${r3(add(c, n, t + 1.4)[1])}" r="0.95" fill="#fff" stroke="#1d2733" stroke-width="0.06"/>`}${text(add(c, n, t + 1.4), tag, { size: 0.8, weight: 700 })}</g>`;
  });
  // overall + per-edge dims (outside face of framing)
  fp.forEach((a, i) => { const bb = fp[(i + 1) % fp.length]; s += dim(a, bb, outN(fp, i), 3); });
  // opening locations: chain dims along each exterior wall (outside face), corner → opening edges → corner
  fp.forEach((a, i) => {
    const bb = fp[(i + 1) % fp.length]; const L = dist(a, bb); const n = outN(fp, i);
    const w = wallsOf(m).find((x) => x.props.exterior && x.geometry.edge === i); if (!w) return;
    const wa = w.geometry.a, wb = w.geometry.b, wl = dist(wa, wb);
    const mine = opsOf(m).filter((o) => o.geometry.wallId === w.id);
    if (!mine.length) return;
    const ts = [0, L];
    mine.forEach((o) => { const c = lerp(wa, wb, o.geometry.t / wl); const tt = (c[0] - a[0]) * (bb[0] - a[0]) / L + (c[1] - a[1]) * (bb[1] - a[1]) / L; const h = (o.props.widthIn * IN) / 2; ts.push(tt - h, tt + h); });
    ts.sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) { const pa = lerp(a, bb, ts[k] / L), pb = lerp(a, bb, ts[k + 1] / L); if (ts[k + 1] - ts[k] > 0.05) s += dim(pa, pb, n, 1.5, fmtFtIn(ts[k + 1] - ts[k]), { size: 0.75, color: '#5b6b7b' }); }
  });
  // corner numbers
  fp.forEach((p, i) => { const c = add(p, [Math.sign(p[0] - b.cx) || 1, Math.sign(p[1] - b.cy) || 1], 0.9); s += text(c, String(i + 1), { size: 0.75, fill: '#8a5a00', weight: 700 }); });
  const area = Math.abs(signedArea(fp));
  s += text([b.cx, b.cy - 0.9], `${Math.round(area)} sq ft`, { size: 1.6, weight: 700 }) + text([b.cx, b.cy + 0.9], 'outside face of framing', { size: 0.85, fill: '#5b6b7b' });
  s += northArrow(b, mg);
  const notes = [
    `Footprint ${fmtFtIn(b.w)} × ${fmtFtIn(b.h)} (outside face of framing), ${Math.round(area)} sq ft.`,
    `Exterior walls ${wp.extSize} @ ${wp.studOcIn} in o.c., interior ${wp.intSize}; plate height ${fmtFtIn(wp.plateHeightFt)}.`,
    ...tags.map(({ o, tag }) => `${tag}: ${o.props.kind} ${o.props.widthIn}×${o.props.heightIn} in${o.props.kind === 'window' ? `, sill ${o.props.sillIn} in` : ''}; RO ${o.props.widthIn + 2}×${o.props.heightIn + (o.props.kind === 'door' ? 2.5 : 2)} in; header ${o.props.header || '—'} (EXAMPLE).`),
    'Dimensions to outside face of framing / opening edges. Numbers at the corners match the wall elevations.',
  ];
  return { id: 'A1', title: 'Dimensioned floor plan', svg: wrap(b, s, { mg, title: 'A1 Dimensioned floor plan' }), notes };
}

// ---------------------------------------------------------------- S1 foundation / pier plan
export function sheetFoundation(m) {
  const fp = m.footprint; const b = bbox(fp); const mg = 7;
  const fnd = getLayer(m, 'foundation'); const f = fnd.params;
  let s = poly(fp, 'fill="none" stroke="#7a8794" stroke-width="0.08" stroke-dasharray="0.6 0.3"');
  fnd.objects.forEach((o) => {
    if (o.type === 'area' && o.props.role === 'slab') s += poly(o.geometry.pts, 'fill="#e6e8ea" stroke="#8b8f94" stroke-width="0.06"');
  });
  fnd.objects.forEach((o) => {
    if (o.type === 'footing' && o.props.role !== 'stem') s += poly(wallPoly(o.geometry.a, o.geometry.b, o.props.widthIn * IN, o.props.widthIn * IN / 2), 'fill="#d6d9dc" stroke="#8b8f94" stroke-width="0.05"');
  });
  fnd.objects.forEach((o) => {
    if ((o.type === 'beam' && o.props.role === 'gradeBeam') || (o.type === 'footing' && o.props.role === 'stem')) s += poly(wallPoly(o.geometry.a, o.geometry.b, o.props.widthIn * IN, o.props.widthIn * IN / 2), 'fill="#b9bec4" stroke="#5f666d" stroke-width="0.06"');
  });
  const piers = fnd.objects.filter((o) => o.type === 'pier');
  piers.forEach((o, i) => {
    const c = o.geometry.c; const sh = pierShapeOf(o, f); const r = sh.halfFt;
    const pf = o.props.flags ? '#f2b8a6' : sh.shape === 'precast' ? '#d9cdb8' : '#8b8f94';
    s += sh.shape === 'round' ? `<circle cx="${r3(c[0])}" cy="${r3(c[1])}" r="${r3(r)}" fill="${pf}" stroke="#1d2733" stroke-width="0.06"/>`
      : `<rect x="${r3(c[0] - r)}" y="${r3(c[1] - r)}" width="${r3(2 * r)}" height="${r3(2 * r)}" fill="${pf}" stroke="#1d2733" stroke-width="0.06"${sh.shape === 'precast' ? ' stroke-dasharray="0.15 0.08"' : ''}/>`;
    s += line([c[0] - r - 0.25, c[1]], [c[0] + r + 0.25, c[1]], 'stroke="#1d2733" stroke-width="0.03"') + line([c[0], c[1] - r - 0.25], [c[0], c[1] + r + 0.25], 'stroke="#1d2733" stroke-width="0.03"');
    s += text([c[0] + 0.9, c[1] - 0.9], `P${i + 1}`, { size: 0.6, anchor: 'start', fill: '#33475b', weight: 700 });
  });
  // chain dims of pier centers along each footprint edge
  fp.forEach((a, i) => {
    const bb = fp[(i + 1) % fp.length]; const L = dist(a, bb); const n = outN(fp, i); const u = [(bb[0] - a[0]) / L, (bb[1] - a[1]) / L];
    const on = piers.map((o) => { const d = [o.geometry.c[0] - a[0], o.geometry.c[1] - a[1]]; return { t: d[0] * u[0] + d[1] * u[1], off: -(d[0] * n[0] + d[1] * n[1]) }; }).filter((q) => q.off >= -0.2 && q.off < 1.6 && q.t > -1 && q.t < L + 1);
    if (!on.length) { s += dim(a, bb, n, 3); return; }
    const ts = [0, ...on.map((q) => Math.max(0, Math.min(L, q.t))), L].sort((x, y) => x - y).filter((t, k, arr) => k === 0 || t - arr[k - 1] > 0.05);
    for (let k = 0; k < ts.length - 1; k++) s += dim(lerp(a, bb, ts[k] / L), lerp(a, bb, ts[k + 1] / L), n, 1.8, fmtFtIn(ts[k + 1] - ts[k]), { size: 0.7, color: '#5b6b7b' });
    s += dim(a, bb, n, 4);
  });
  s += northArrow(b, mg);
  const top = (fnd.zTop || 0) / IN;
  const frost = f.frostDepthIn != null && f.frostDepthIn !== '' ? `${pierDepthIn(f)} in (frost ${f.frostDepthIn} in)` : `${f.placeholderFrostIn} in — conservative PLACEHOLDER (frost depth unknown), enter your frost depth`;
  const ftl = (FOUNDATION_TYPES.find((t) => t[0] === f.type) || [f.type, f.type])[1];
  const notes = [`Foundation type: ${ftl}. Bottom of footings/piers: ${frost} below grade.`, `Top of foundation ${r3(top)} in above grade.`];
  if (isPierType(f.type)) {
    const groups = {}; piers.forEach((p) => { const k = pierShapeLabel(p, f); groups[k] = (groups[k] || 0) + 1; });
    const kinds = Object.entries(groups).map(([k, n]) => `${n} × ${k}`).join(', ');
    if (f.type === 'piers') notes.push(`${piers.length} piers (${kinds}), #4 vertical bars each (EXAMPLE); ${f.gradeBeamWidthIn}×${f.gradeBeamDepthIn} in grade beam on all bearing lines with 4 × #4 continuous.`);
    else notes.push(`PIERS ONLY — ${piers.length} individual piers (${kinds}). No grade beam, no footing, no continuous concrete. The sill/floor beam spans pier to pier (size it for that span).`);
    const pre = piers.filter((p) => pierShapeOf(p, f).shape === 'precast').length;
    if (pre) notes.push(`⚠ ${pre} precast block(s) (dashed squares): ${precastFrostWarning(f)}`);
    const sqn = piers.filter((p) => pierShapeOf(p, f).shape === 'square').length;
    if (sqn) notes.push(`Square formed piers (solid squares): depth max(frost + margin, 12 in) = ${pierDepthIn(f)} in below grade.`);
    notes.push(`Pier spacing ${f.pierSpacingMode === 'exact' ? 'exactly' : 'at most'} ${f.pierSpacingIn} in on center. Dimensions are to pier centers.`);
    const manual = piers.filter((p) => !p.derivedFrom).length; if (manual) notes.push(`${manual} pier(s) placed or edited by hand.`);
    const fl = piers.filter((p) => p.props.flags); if (fl.length) notes.push(`FLAGGED: ${fl.length} pier(s) off a wall line / outside the footprint (shown pink).`);
  } else notes.push(`Footings ${f.footingWidthIn} in wide${f.type !== 'slab' ? `, stem walls ${f.stemWallIn} in` : ''}. Dimensions to outside face of framing.`);
  notes.push('Pier, footing and beam sizes are typical values, NOT engineered. Confirm with your building department or an engineer.');
  return { id: 'S1', title: 'Foundation / pier plan', svg: wrap(b, s, { mg, title: 'S1 Foundation plan' }), notes };
}

// ---------------------------------------------------------------- S2 floor framing
export function sheetFloor(m) {
  const fp = m.footprint; const b = bbox(fp); const mg = 6;
  const fl = getLayer(m, 'floor'); const p = fl.params;
  let s = poly(fp, 'fill="#fbf6ee" stroke="#1d2733" stroke-width="0.08"');
  const objs = fl.objects;
  const notes = [];
  if (!objs.some((o) => o.type === 'joist')) {
    s += text([b.cx, b.cy], 'Slab on grade — no floor framing', { size: 1.4, weight: 700 });
    notes.push('Slab on grade: no floor framing.');
    return { id: 'S2', title: 'Floor framing plan', svg: wrap(b, s, { mg, title: 'S2 Floor framing' }), notes };
  }
  objs.filter((o) => o.props.role === 'sill').forEach((o) => { s += poly(wallPoly(o.geometry.a, o.geometry.b, o.props.widthIn * IN, o.props.widthIn * IN / 2), 'fill="#9fbf8f" stroke="#5d7a50" stroke-width="0.03"'); });
  objs.filter((o) => o.props.role === 'rim').forEach((o) => { s += poly(wallPoly(o.geometry.a, o.geometry.b, LUMBER_T_IN * IN, LUMBER_T_IN * IN / 2), 'fill="#c08a4a" stroke="#7a5426" stroke-width="0.03"'); });
  const joists = objs.filter((o) => o.type === 'joist' && o.props.role !== 'rim');
  joists.forEach((o) => { s += poly(wallPoly(o.geometry.a, o.geometry.b, LUMBER_T_IN * IN), 'fill="#d9a45b" stroke="#7a5426" stroke-width="0.025"'); });
  const girders = objs.filter((o) => o.props.role === 'girder');
  girders.forEach((o) => {
    s += poly(wallPoly(o.geometry.a, o.geometry.b, 3 * LUMBER_T_IN * IN), 'fill="#e8a39a" stroke="#b03a2e" stroke-width="0.08" stroke-dasharray="0.5 0.25"');
    const c = lerp(o.geometry.a, o.geometry.b, 0.25);
    s += text([c[0], c[1] - 1.0], '3-ply GIRDER — FLAGGED, size by engineer', { size: 0.8, weight: 700, fill: '#b03a2e' });
    joists.forEach((j) => { /* hanger marks */ const g = o.geometry; const hit = segX(j.geometry.a, j.geometry.b, g.a, g.b); if (hit) s += `<rect x="${r3(hit[0] - 0.3)}" y="${r3(hit[1] - 0.3)}" width="0.6" height="0.6" fill="none" stroke="#1d2733" stroke-width="0.05"/>`; });
  });
  // joist label + span arrow on a joist near the 3/4 point
  const comp = p.computed || {};
  if (joists.length) {
    const j = joists[Math.floor(joists.length * 0.7)];
    const a = j.geometry.a, bb = j.geometry.b; const L = dist(a, bb); const u = [(bb[0] - a[0]) / L, (bb[1] - a[1]) / L]; const n = [-u[1], u[0]];
    s += dim(a, bb, n, 1.2, `span ${fmtFtIn(comp.spanFt || L)}`, { size: 0.75, color: '#7a5426', ext: false });
    const mid = lerp(a, bb, 0.5);
    s += `<rect x="${r3(mid[0] - 7.5)}" y="${r3(mid[1] - 0.8)}" width="15" height="1.6" rx="0.3" fill="#fff" stroke="#7a5426" stroke-width="0.05" transform="rotate(${r3(readableAngle(a, bb))} ${r3(mid[0])} ${r3(mid[1])})"/>`;
    s += text(mid, `${p.joistSize} joists @ ${p.joistOcIn} in o.c.`, { size: 0.85, rot: readableAngle(a, bb), weight: 700, fill: '#7a5426' });
  }
  fp.forEach((a, i) => { s += dim(a, fp[(i + 1) % fp.length], outN(fp, i), 2.5); });
  s += northArrow(b, mg);
  notes.push(`${p.sillSize} pressure-treated sill on sill gasket; ${p.joistSize} rim joist.`);
  notes.push(`${joists.length} joist pieces, ${p.joistSize} @ ${p.joistOcIn} in o.c., running ${comp.runAxis === 'x' ? 'east–west' : 'north–south'} (span ${fmtFtIn(comp.spanFt || 0)}).`);
  if (girders.length) notes.push(`Joist span over ${p.beamFlagSpanFt} ft: 3-ply mid girder drawn with joist hangers (□) at every crossing. FLAGGED — the girder and its support are NOT sized; get an engineer.`);
  notes.push(`Subfloor: ${p.subfloor}, glued and screwed. Joist sizes come from the model settings — NOT checked against span tables.`);
  return { id: 'S2', title: 'Floor framing plan', svg: wrap(b, s, { mg, title: 'S2 Floor framing' }), notes };
}
function segX(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]); if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= -0.01 && t <= 1.01 && v >= -0.01 && v <= 1.01 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
}

// ---------------------------------------------------------------- S3 wall framing elevations
/** One elevation per wall. Drawn looking at the wall from outside (exterior) / from the start end (interior); x = distance from the start corner. */
export function sheetWalls(m) {
  const wl = getLayer(m, 'walls'); const wp = wl.params; const H = wp.plateHeightFt; const pl = LUMBER_T_IN * IN;
  const ops = opsOf(m); const tags = new Map(openingTags(m).map((x) => [x.o.id, x.tag]));
  const fp = m.footprint;
  const out = [];
  wallsOf(m).forEach((w, wi) => {
    const len = dist(w.geometry.a, w.geometry.b); const t = w.props.thicknessIn * IN;
    const ext = w.props.exterior ? t / 2 : 0; const L2 = len + 2 * ext;
    // Drawn as seen from INSIDE the building: mirror when the wall's start corner would be on the viewer's right.
    let flip = false;
    if (w.props.exterior) {
      const n = outN(fp, w.geometry.edge); const right = [-n[1], n[0]];
      const u = [w.geometry.b[0] - w.geometry.a[0], w.geometry.b[1] - w.geometry.a[1]];
      flip = u[0] * right[0] + u[1] * right[1] < 0;
    }
    const myOps = ops.filter((o) => o.geometry.wallId === w.id).map((o) => ({ o, center: flip ? L2 - (o.geometry.t + ext) : o.geometry.t + ext, widthFt: o.props.widthIn * IN, sill: o.props.sillIn * IN, head: (o.props.sillIn + o.props.heightIn) * IN })).sort((p, q) => p.center - q.center);
    const Y = (z) => H - z; // svg y
    const nb = wp.bottomPlates || 1, nt = wp.topPlates || 2;
    let s = '';
    const rect = (x0, z0, x1, z1, fill, stroke = '#7a5426', sw = 0.03) => `<rect x="${r3(Math.min(x0, x1))}" y="${r3(Y(Math.max(z0, z1)))}" width="${r3(Math.abs(x1 - x0))}" height="${r3(Math.abs(z1 - z0))}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    for (let i = 0; i < nb; i++) s += rect(0, i * pl, L2, (i + 1) * pl, '#9fbf8f');
    for (let i = 0; i < nt; i++) s += rect(0, H - (i + 1) * pl, L2, H - i * pl, '#e3bb7f');
    const sBot = nb * pl, sTop = H - nt * pl;
    const lay = studLayout(L2, (w.props.studOcIn || 16) * IN, myOps);
    lay.studs.forEach((d) => { s += rect(d - pl / 2, sBot, d + pl / 2, sTop, '#efd3a3'); });
    lay.kings.forEach((d) => { s += rect(d - pl / 2, sBot, d + pl / 2, sTop, '#e3bb7f'); });
    myOps.forEach((op) => {
      const s0 = op.center - op.widthFt / 2, s1 = op.center + op.widthFt / 2;
      const hdIn = LUMBER[(op.o.props.header || '2-2x8').replace(/^\d-/, '').split(' ')[0]] || 7.25; const hd = hdIn * IN;
      const hz = op.head;
      s += rect(s0 - pl, sBot, s0, hz, '#e3bb7f') + rect(s1, sBot, s1 + pl, hz, '#e3bb7f');                      // jacks
      s += rect(s0 - pl, hz, s1 + pl, Math.min(sTop, hz + hd), '#c98f3c', '#7a5426', 0.05);                      // header
      // cripples above header
      for (let d = s0 + (16 * IN); d < s1 - 0.1; d += 16 * IN) if (hz + hd < sTop - 0.05) s += rect(d - pl / 2, hz + hd, d + pl / 2, sTop, '#efd3a3');
      if (op.sill > 0) {
        s += rect(s0, op.sill - pl, s1, op.sill, '#e3bb7f');                                                     // rough sill
        for (let d = s0 + pl / 2; d <= s1 - pl / 2 + 0.01; d += Math.min(16 * IN, Math.max(pl, (s1 - s0 - pl)))) s += rect(d - pl / 2, sBot, d + pl / 2, op.sill - pl, '#efd3a3');
      }
      s += `<rect x="${r3(s0)}" y="${r3(Y(hz))}" width="${r3(s1 - s0)}" height="${r3(hz - Math.max(op.sill, sBot))}" fill="${op.o.props.kind === 'window' ? 'rgba(156,199,230,.35)' : 'rgba(255,255,255,.6)'}" stroke="#2a6fb0" stroke-width="0.04" stroke-dasharray="0.25 0.15"/>`;
      const tg = tags.get(op.o.id) || '';
      s += text([op.center, Y((Math.max(op.sill, sBot) + hz) / 2)], tg, { size: 0.55, weight: 700, fill: '#2a6fb0' });
      s += text([op.center, Y(hz + hd / 2)], `${op.o.props.header} EX.`, { size: 0.32, fill: '#3b2a10' });
      // RO dims under the wall: chain from start
      s += dim([s0, Y(0)], [s1, Y(0)], [0, 1], 1.0, `${op.o.props.widthIn + 2}" RO`, { size: 0.38, color: '#2a6fb0' });
      s += dim([s1 + 0.05, Y(op.sill)], [s1 + 0.05, Y(hz)], [1, 0], 0.6, `${op.o.props.heightIn + (op.o.props.kind === 'door' ? 2.5 : 2)}"`, { size: 0.35, color: '#2a6fb0', ext: false });
    });
    // chain dims: start → opening edges → end
    const ts = [0, ...myOps.flatMap((op) => [op.center - op.widthFt / 2, op.center + op.widthFt / 2]), L2];
    if (myOps.length) for (let k = 0; k < ts.length - 1; k++) s += dim([ts[k], Y(0)], [ts[k + 1], Y(0)], [0, 1], 1.9, fmtFtIn(ts[k + 1] - ts[k]), { size: 0.4 });
    s += dim([0, Y(0)], [L2, Y(0)], [0, 1], myOps.length ? 2.8 : 1.2, fmtFtIn(L2), { size: 0.5 });
    s += dim([0, Y(0)], [0, Y(H)], [-1, 0], 0.9, fmtFtIn(H), { size: 0.45 });
    let name, ends;
    if (w.props.exterior) {
      const i = w.geometry.edge; name = `${sideName(fp, i)} wall (exterior, ${w.props.size})`; ends = [`corner ${i + 1}`, `corner ${((i + 1) % fp.length) + 1}`]; if (flip) ends.reverse();
    } else { name = `Interior wall ${wi + 1 - fp.length} (${w.props.size}${w.props.bearing ? ', bearing' : ''})`; ends = ['start', 'end']; }
    s += text([0, Y(H) - 0.55], ends[0], { size: 0.42, anchor: 'start', fill: '#8a5a00', weight: 700 }) + text([L2, Y(H) - 0.55], ends[1], { size: 0.42, anchor: 'end', fill: '#8a5a00', weight: 700 });
    const bx = { minX: 0, minY: 0, maxX: L2, maxY: H };
    const svg = `<svg class="sheet-svg elev" viewBox="${r3(-2)} ${r3(-1.4)} ${r3(L2 + 3.4)} ${r3(H + 5.2)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(name)}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">${s}</svg>`;
    void bx;
    out.push({ name, svg, studs: lay.studs.length + lay.kings.length + myOps.length * 2, lenFt: L2, ops: myOps.length });
  });
  const notes = [
    `${wp.extSize} exterior / ${wp.intSize} interior studs @ ${wp.studOcIn} in o.c.; ${wp.bottomPlates || 1} bottom plate, ${wp.topPlates || 2} top plates; plate height ${fmtFtIn(H)}.`,
    'Walls are drawn as seen from INSIDE the building; corner numbers match sheet A1. Exterior wall lengths include the corner overlap.',
    'Each opening: king + jack studs each side, header (EXAMPLE size — verify), cripples above, rough sill + cripples below windows. Dashed blue = rough opening.',
    'Corner/tee backing studs are in the material list but not drawn.',
  ];
  return { id: 'S3', title: 'Wall framing elevations', walls: out, notes };
}

// ---------------------------------------------------------------- S4 roof framing (+ section)
export function sheetRoof(m) {
  const fp = m.footprint; const b = bbox(fp);
  const roof = getLayer(m, 'roof'); const rp = roof.params; const comp = rp.computed || {};
  const outline = roof.objects.find((o) => o.props && o.props.role === 'outline');
  const ob = outline ? bbox(outline.geometry.pts) : b; const mg = 6;
  let s = '';
  if (outline) s += poly(outline.geometry.pts, 'fill="#f3efe8" stroke="#1d2733" stroke-width="0.1"');
  s += poly(fp, 'fill="none" stroke="#7a8794" stroke-width="0.07" stroke-dasharray="0.6 0.3"');
  roof.objects.filter((o) => o.type === 'rafter').forEach((o) => { s += line(o.geometry.a, o.geometry.b, 'stroke="#a8643a" stroke-width="0.14"'); });
  const ridge = roof.objects.find((o) => o.props && o.props.role === 'ridge');
  if (ridge) {
    s += line(ridge.geometry.a, ridge.geometry.b, 'stroke="#5a2d0c" stroke-width="0.3"');
    const c = lerp(ridge.geometry.a, ridge.geometry.b, 0.5);
    s += `<rect x="${r3(c[0] - 6)}" y="${r3(c[1] - 1.9)}" width="12" height="1.4" rx="0.3" fill="#fff" stroke="#5a2d0c" stroke-width="0.05" transform="rotate(${r3(readableAngle(ridge.geometry.a, ridge.geometry.b))} ${r3(c[0])} ${r3(c[1])})"/>`;
    s += text([c[0], c[1] - 1.2], `RIDGE ${({ '2x6': '2x8', '2x8': '2x10', '2x10': '2x12' }[rp.rafterSize] || '2x12')}`, { size: 0.8, weight: 700, fill: '#5a2d0c', rot: readableAngle(ridge.geometry.a, ridge.geometry.b) });
  }
  // rafter label on one side
  const raf = roof.objects.filter((o) => o.type === 'rafter');
  if (raf.length) {
    const r = raf[Math.floor(raf.length * 0.35) * 1 - (Math.floor(raf.length * 0.35) % 2)]; const mid = lerp(r.geometry.a, r.geometry.b, 0.5);
    s += `<rect x="${r3(mid[0] - 6.5)}" y="${r3(mid[1] - 0.8)}" width="13" height="1.6" rx="0.3" fill="#fff" stroke="#a8643a" stroke-width="0.05" transform="rotate(${r3(readableAngle(r.geometry.a, r.geometry.b))} ${r3(mid[0])} ${r3(mid[1])})"/>`;
    s += text(mid, `${rp.rafterSize} rafters @ ${rp.rafterOcIn} in o.c.`, { size: 0.8, weight: 700, fill: '#a8643a', rot: readableAngle(r.geometry.a, r.geometry.b) });
  }
  if (outline) { const pts = outline.geometry.pts; s += dim(pts[0], pts[1], [0, -1], 2.2, null, { size: 0.9 }); s += dim(pts[1], pts[2], [1, 0], 2.2, null, { size: 0.9 }); }
  const lab = roof.objects.find((o) => o.type === 'label');
  if (lab) s += text(lab.geometry.c, `${rp.pitch}:12 ↓`, { size: 1.0, weight: 700, fill: '#33475b', rot: comp.ridgeAlongX ? 0 : 90 });
  s += northArrow(ob, mg);
  const plan = wrap(ob, s, { mg, title: 'S4 Roof framing plan' });
  // ---- section across the ridge
  const span = comp.ridgeAlongX ? b.h : b.w; const oh = (rp.overhangIn || 0) * IN; const rise = comp.rise || (span / 2) * (rp.pitch / 12);
  const wH = getLayer(m, 'walls').params.plateHeightFt; const k = rp.pitch / 12;
  const X0 = 0, X1 = span; const yP = 0; // plate line at y=0, up is negative
  let q = '';
  q += `<rect x="${X0}" y="0" width="0.5" height="${wH * 0.5}" fill="#efd3a3" stroke="#7a5426" stroke-width="0.04"/><rect x="${r3(X1 - 0.5)}" y="0" width="0.5" height="${wH * 0.5}" fill="#efd3a3" stroke="#7a5426" stroke-width="0.04"/>`;
  q += line([X0 - oh, yP + oh * k], [span / 2, yP - rise], 'stroke="#a8643a" stroke-width="0.35"') + line([X1 + oh, yP + oh * k], [span / 2, yP - rise], 'stroke="#a8643a" stroke-width="0.35"');
  q += `<rect x="${r3(span / 2 - 0.12)}" y="${r3(yP - rise - 0.2)}" width="0.24" height="1.0" fill="#5a2d0c"/>`;
  q += line([X0, yP - 0.3], [X1, yP - 0.3], 'stroke="#7a8794" stroke-width="0.12" stroke-dasharray="0.5 0.3"');
  q += text([span / 2, yP - 0.9], 'rafter tie / ceiling joist (not in model)', { size: 0.6, fill: '#7a8794' });
  q += dim([X0, yP + wH * 0.5], [X1, yP + wH * 0.5], [0, 1], 1.0, `span ${fmtFtIn(span)}`, { size: 0.7 });
  q += dim([span / 2, yP], [span / 2, yP - rise], [1, 0], 3.5, `rise ${fmtFtIn(rise)}`, { size: 0.65, ext: false });
  if (oh) q += dim([X0 - oh, yP + oh * k], [X0, yP + oh * k], [0, 1], 1.2, `${rp.overhangIn}" OH`, { size: 0.55 });
  q += text([span * 0.22, yP - rise * 0.62], `${rp.pitch}:12`, { size: 0.8, weight: 700, rot: -Math.atan(k) * 180 / Math.PI });
  const section = `<svg class="sheet-svg sect" viewBox="${r3(-oh - 2)} ${r3(-rise - 2)} ${r3(span + 2 * oh + 4)} ${r3(rise + wH * 0.5 + 4.5)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Roof section" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">${q}</svg>`;
  const notes = [
    `Gable roof, ${rp.pitch}:12 pitch, ridge running ${comp.ridgeAlongX ? 'east–west' : 'north–south'}; ${rp.overhangIn} in overhang.`,
    `${raf.length} ${rp.rafterSize} rafters @ ${rp.rafterOcIn} in o.c. against a ridge board one size deeper; hurricane tie at every rafter.`,
    'Rafter ties / ceiling joists are required but NOT drawn in the model; the material list prices an example size. Gable-end framing is not generated.',
    'Rafter size comes from the model settings — NOT checked against span or snow-load tables.',
  ];
  return { id: 'S4', title: 'Roof framing plan', svg: plan, section, notes };
}

export function allSheets(m) {
  return { A1: sheetPlan(m), S1: sheetFoundation(m), S2: sheetFloor(m), S3: sheetWalls(m), S4: sheetRoof(m) };
}
