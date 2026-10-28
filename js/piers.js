// Piers / Sonotubes v2: snapping, live dimensions, manual vs auto, delete / duplicate /
// reset. Pure model helpers shared by Plan, 3D and the pier panel. All coords in ft.
import { PIERS, DEFAULTS, pierDepthIn } from './config.js';
import { getLayer, uid } from './model.js';
import { dist, distToSeg, lerp, bbox } from './geom.js';
import { pierSlotKey } from './homeplan-derived.js';

const IN = 1 / 12;
export { pierSlotKey };

/** Wall centerlines (every wall: exterior, interior, bearing or not). */
export function wallLines(m) {
  return getLayer(m, 'walls').objects.filter((o) => o.type === 'wall')
    .map((o) => ({ id: o.id, a: o.geometry.a, b: o.geometry.b, bearing: !!(o.props.exterior || o.props.bearing), exterior: !!o.props.exterior }));
}

export function nearestWall(m, p) {
  let best = null;
  wallLines(m).forEach((l) => {
    const r = distToSeg(p, l.a, l.b);
    if (!best || r.d < best.d) best = { ...l, d: r.d, t: r.t, foot: lerp(l.a, l.b, r.t), len: dist(l.a, l.b) };
  });
  return best;
}

/**
 * Snap a pier center: wall corners/ends first, then onto a wall line (distance along
 * the wall snapped to the grid, measured from the wall's start corner), else the grid.
 * @returns {{c:[x,y], snap:'corner'|'wall'|'grid', wallId:string|null}}
 */
export function snapPier(m, p, tolFt) {
  const g = (m.snapIn || 6) * IN;
  const lines = wallLines(m);
  let best = null, bd = tolFt;
  lines.forEach((l) => [l.a, l.b].forEach((q) => { const d = dist(q, p); if (d < bd) { bd = d; best = { q, l }; } }));
  if (best) return { c: [best.q[0], best.q[1]], snap: 'corner', wallId: best.l.id };
  let bl = null; bd = tolFt;
  lines.forEach((l) => { const r = distToSeg(p, l.a, l.b); if (r.d < bd) { bd = r.d; bl = { l, t: r.t }; } });
  if (bl) {
    const L = dist(bl.l.a, bl.l.b) || 1;
    const s = Math.max(0, Math.min(L, Math.round((bl.t * L) / g) * g));
    return { c: lerp(bl.l.a, bl.l.b, s / L), snap: 'wall', wallId: bl.l.id };
  }
  return { c: [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], snap: 'grid', wallId: null };
}

export const pierLayer = (m) => getLayer(m, 'foundation');
export const allPiers = (m) => pierLayer(m).objects.filter((o) => o.type === 'pier');
export const isManual = (o) => !o.derivedFrom;

/**
 * Live dimensions for a pier at c: distances along its wall line to both ends (corners),
 * the perpendicular offset if it is off the line, and o.c. distances to the 2 nearest piers.
 */
export function pierDims(m, c, selfId) {
  const w = nearestWall(m, c);
  const out = { wall: null, ends: [], neighbors: [] };
  if (w) {
    out.wall = { id: w.id, foot: w.foot, d: w.d, exterior: w.exterior };
    if (w.d < 3) out.ends = [{ p: w.a, d: dist(w.foot, w.a) }, { p: w.b, d: dist(w.foot, w.b) }].filter((e) => e.d > 0.02);
  }
  out.neighbors = allPiers(m).filter((o) => o.id !== selfId).map((o) => ({ id: o.id, p: o.geometry.c, d: dist(o.geometry.c, c) }))
    .filter((n) => n.d > 0.01).sort((a, b) => a.d - b.d).slice(0, 2);
  return out;
}

/** Defaults a manual pier follows while its top/depth are blank (null). */
export function pierDefaults(m) {
  const f = pierLayer(m).params;
  const topZ = (f.topAboveGradeIn[f.type] != null ? f.topAboveGradeIn[f.type] : 8);
  const topIn = f.type === 'piers' ? topZ - f.gradeBeamDepthIn : topZ;
  const frost = f.frostDepthIn != null && f.frostDepthIn !== '' ? Number(f.frostDepthIn) : null;
  return { topIn, depthIn: pierDepthIn(f), frostEntered: frost != null };
}

function onWallId(m, c) { const w = nearestWall(m, c); return w && w.d < 0.05 ? w.id : null; }

export function makeManualPier(m, c, opts = {}) {
  const f = pierLayer(m).params;
  const dia = opts.diaIn || f.placeDiaIn || 12;
  return {
    id: uid('pier'), type: 'pier', geometry: { c: [c[0], c[1]] }, z: 0, height: 0,
    props: { diaIn: dia, manual: true, topIn: opts.topIn != null ? opts.topIn : (f.placeTopIn != null && f.placeTopIn !== '' ? Number(f.placeTopIn) : null),
      depthIn: opts.depthIn != null ? opts.depthIn : (f.placeDepthIn != null && f.placeDepthIn !== '' ? Number(f.placeDepthIn) : null),
      onWall: onWallId(m, c), label: `Sonotube Ø${dia} in` },
  };
}

/** Drop a new manual pier at a (snapped) point. Returns the object. */
export function dropPier(m, c, opts) {
  const o = makeManualPier(m, c, opts);
  pierLayer(m).objects.push(o);
  return o;
}

/** Editing an auto pier converts it to manual so regeneration keeps it. Mutates o; keeps selection on it. */
export function ensureManual(m, o) {
  if (isManual(o)) return o;
  const oldId = o.id;
  o.props = Object.assign({}, o.props, { manual: true, autoSlot: pierSlotKey(o.geometry.c), topIn: null, depthIn: null, onWall: o.derivedFrom || onWallId(m, o.geometry.c) });
  delete o.derivedFrom;
  o.id = uid('pier');
  if (m.selection && m.selection.objectId === oldId) m.selection = { layerId: 'foundation', objectId: o.id };
  return o;
}

export function movePier(m, o, c) { ensureManual(m, o); o.geometry.c = [c[0], c[1]]; o.props.onWall = onWallId(m, c); return o; }

export function deletePier(m, o) {
  const l = pierLayer(m);
  const slot = isManual(o) ? o.props.autoSlot : pierSlotKey(o.geometry.c);
  if (slot && !l.params.deletedAutoSlots.includes(slot)) l.params.deletedAutoSlots.push(slot);
  l.objects = l.objects.filter((x) => x !== o);
  if (m.selection && m.selection.objectId === o.id) m.selection = null;
}

export function duplicatePier(m, o) {
  const w = nearestWall(m, o.geometry.c);
  const off = PIERS.duplicateOffsetFt;
  let c;
  if (w && w.d < 0.05 && w.len > 0.1) {
    const ux = (w.b[0] - w.a[0]) / w.len, uy = (w.b[1] - w.a[1]) / w.len;
    const s = w.t * w.len;
    const dir = s + off <= w.len ? 1 : -1;  // stay on the wall
    c = [o.geometry.c[0] + ux * off * dir, o.geometry.c[1] + uy * off * dir];
  } else c = [o.geometry.c[0] + off, o.geometry.c[1]];
  const copy = makeManualPier(m, c, { diaIn: o.props.diaIn, topIn: o.props.topIn, depthIn: o.props.depthIn });
  pierLayer(m).objects.push(copy);
  return copy;
}

/** Remove a converted pier so its auto slot regenerates. Plain hand-placed piers have no auto slot. */
export function resetToAuto(m, o) {
  const l = pierLayer(m);
  l.objects = l.objects.filter((x) => x !== o);
  if (o.props.autoSlot) l.params.deletedAutoSlots = l.params.deletedAutoSlots.filter((k) => k !== o.props.autoSlot);
  if (m.selection && m.selection.objectId === o.id) m.selection = null;
}

/** Layer-level: revert every converted pier and restore deleted auto slots (hand-placed piers stay). */
export function restoreAutoLayout(m) {
  const l = pierLayer(m);
  const n = l.objects.filter((o) => o.type === 'pier' && isManual(o) && o.props.autoSlot).length + l.params.deletedAutoSlots.length;
  l.objects = l.objects.filter((o) => !(o.type === 'pier' && isManual(o) && o.props.autoSlot));
  l.params.deletedAutoSlots = [];
  return n;
}

/** X/Y shown to the user: from the footprint's west and north outside faces. */
export function originOf(m) { const b = bbox(m.footprint); return [b.minX, b.minY]; }

/** "6' 4-1/2"" style → ft. Accepts 6'4", 6' 4.5", 6-4, 76", 6.5 (ft), 6 4. */
export function parseFtIn(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (!t) return null;
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
  m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in)$/);
  if (m) return Number(m[1]) / 12;
  m = t.match(/^(-?\d+)[\s-]+(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) + Number(m[2]) / 12;
  m = t.match(/^(-?\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);
  return null;
}

export const DEFAULT_FOUNDATION = DEFAULTS.foundation;
