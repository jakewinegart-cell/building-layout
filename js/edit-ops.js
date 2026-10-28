// ============================================================================
// edit-ops.js — the editing operations shared by Plan (2D) and 3D. Both views turn a
// pointer into a plan-world point [x, y] (ft) and call these, so snapping and the
// resulting geometry are identical no matter which view you drag in.
//   Drag kinds: 'pier' | 'vertex' (footprint corner) | 'edge' (exterior wall / footprint
//   edge) | 'opening' (door/window slides along its wall) | 'move' (interior wall).
// ============================================================================
import { LUMBER, PIERS } from './config.js';
import { getLayer, uid } from './model.js';
import { dist, lerp, inwardNormal, distToSeg } from './geom.js';
import { snapPier, movePier } from './piers.js';

const IN = 1 / 12;

/** Snap a plan point: to footprint corners / wall endpoints within tolFt, else to the grid. */
export function snapPoint(m, p, tolFt, opts = {}) {
  const cands = m.footprint.slice();
  getLayer(m, 'walls').objects.forEach((o) => { if (o.type === 'wall') cands.push(o.geometry.a, o.geometry.b); });
  if (!opts.noPoints) {
    let best = null, bd = tolFt;
    cands.forEach((c) => { const d = dist(c, p); if (d < bd) { bd = d; best = c; } });
    if (best) return [best[0], best[1], true];
  }
  const g = m.snapIn * IN;
  return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g, false];
}

export function wallOf(m, id) { return getLayer(m, 'walls').objects.find((w) => w.id === id); }

export function openingPts(m, o) {
  const w = wallOf(m, o.geometry.wallId); if (!w) return null;
  const { a, b } = w.geometry; const L = dist(a, b);
  const half = (o.props.widthIn * IN) / 2;
  return { w, p0: lerp(a, b, (o.geometry.t - half) / L), p1: lerp(a, b, (o.geometry.t + half) / L), c: lerp(a, b, o.geometry.t / L), L, a, b };
}

/** Start a drag. w = plan point under the pointer. Returns the drag record (or null). */
export function beginDrag(m, kind, w, extra = {}) {
  const d = Object.assign({ kind, w0: w.slice(), moved: false }, extra);
  if (kind === 'pier') d.c0 = d.obj.geometry.c.slice();
  if (kind === 'vertex' || kind === 'edge') d.start = m.footprint.map((p) => p.slice());
  if (kind === 'move') { d.a0 = d.obj.geometry.a.slice(); d.b0 = d.obj.geometry.b.slice(); }
  return d;
}

/**
 * Apply a drag to the model for pointer at plan point w. tolFt = point-snap tolerance in ft
 * (each view converts its pixel tolerance). Returns the regen source to preview with
 * ('foundation' | 'footprint' | 'walls' | layerId) and leaves snap info on the drag record.
 */
export function applyDrag(m, d, w, tolFt) {
  d.moved = true;
  if (d.kind === 'pier') {
    const raw = [d.c0[0] + w[0] - d.w0[0], d.c0[1] + w[1] - d.w0[1]];
    const sn = snapPier(m, raw, tolFt);
    movePier(m, d.obj, sn.c);          // first move converts an auto pier to manual
    d.snap = sn.snap; d.at = sn.c;
    return 'foundation';
  }
  if (d.kind === 'vertex') {
    const s = snapPoint(m, w, tolFt, { noPoints: true });
    m.footprint = d.start.map((p) => p.slice()); m.footprint[d.i] = [s[0], s[1]];
    d.at = [s[0], s[1]];
    return 'footprint';
  }
  if (d.kind === 'edge') {
    const fp = d.start; const i = d.i; const j = (i + 1) % fp.length;
    const n = inwardNormal(fp, i);
    const g = m.snapIn * IN;
    let k = (w[0] - d.w0[0]) * n[0] + (w[1] - d.w0[1]) * n[1];
    k = Math.round(k / g) * g;
    m.footprint = fp.map((p) => p.slice());
    m.footprint[i] = [fp[i][0] + n[0] * k, fp[i][1] + n[1] * k];
    m.footprint[j] = [fp[j][0] + n[0] * k, fp[j][1] + n[1] * k];
    d.offset = k;
    return 'walls';
  }
  if (d.kind === 'opening') {
    const q = openingPts(m, d.obj);
    if (q) { const { t } = distToSeg(w, q.a, q.b); const g = m.snapIn * IN; d.obj.geometry.t = Math.round((t * q.L) / g) * g; }
    return 'walls';
  }
  if (d.kind === 'move') {
    const s = snapPoint(m, [d.a0[0] + w[0] - d.w0[0], d.a0[1] + w[1] - d.w0[1]], tolFt, { noPoints: true });
    const dx = s[0] - d.a0[0], dy = s[1] - d.a0[1];
    d.obj.geometry.a = [d.a0[0] + dx, d.a0[1] + dy]; d.obj.geometry.b = [d.b0[0] + dx, d.b0[1] + dy];
    return d.layerId || 'walls';
  }
  return null;
}

/** Regen source to commit with when a drag ends. */
export function commitSource(d) {
  return { pier: 'foundation', vertex: 'footprint', edge: 'walls', opening: 'walls', move: d.layerId || 'walls' }[d.kind];
}

/** Ortho-lock a segment draft {a,b} within ~8° of horizontal/vertical. */
export function orthoSeg(d) {
  const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
  const ang = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
  if (ang < 0.14 || ang > Math.PI / 2 - 0.14) { if (Math.abs(dx) > Math.abs(dy)) d.b = [d.b[0], d.a[1]]; else d.b = [d.a[0], d.b[1]]; }
}

/** Add an interior wall a→b on the walls layer. Returns the new object. */
export function addInteriorWall(m, a, b) {
  const l = getLayer(m, 'walls');
  const o = { id: uid('w'), type: 'wall', geometry: { a: [a[0], a[1]], b: [b[0], b[1]] }, props: { exterior: false, bearing: false, size: l.params.intSize, thicknessIn: LUMBER[l.params.intSize], studOcIn: l.params.studOcIn } };
  l.objects.push(o);
  return o;
}

/** Place a door/window on the wall nearest w (within tolFt). Returns the opening or null. */
export function placeOpeningAt(m, w, kind, defaults, tolFt, wallId = null) {
  const wl = getLayer(m, 'walls');
  let best = null, bd = tolFt;
  wl.objects.forEach((o) => {
    if (o.type !== 'wall') return;
    const r = distToSeg(w, o.geometry.a, o.geometry.b);
    if (wallId && o.id === wallId) { best = { o, t: r.t }; bd = -1; return; }
    if (bd >= 0 && r.d < bd) { bd = r.d; best = { o, t: r.t }; }
  });
  if (!best) return null;
  const L = dist(best.o.geometry.a, best.o.geometry.b);
  const g = m.snapIn * IN;
  const o = { id: uid('op'), type: 'opening', geometry: { wallId: best.o.id, t: Math.round((best.t * L) / g) * g }, props: Object.assign({ kind }, defaults[kind]) };
  wl.objects.push(o);
  return o;
}

export { PIERS };
