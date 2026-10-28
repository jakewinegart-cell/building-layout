// Regeneration engine (spec §6): footprint → exterior walls → foundation → floor → roof,
// plus elevation stacking. Any layer whose content changes because of an upstream
// edit gets a visible note ("Updated from walls").
import { LUMBER, LUMBER_T_IN, HEADER_EXAMPLE, PIERS, pierDepthIn, pierShapeOf, pierShapeLabel, precastFrostWarning, isPierType } from './config.js';
import { offsetPolygon, bbox, scanline, isAxisRect, dist, distToSeg, pointInPoly, fmtFtIn } from './geom.js';
import { piersAlongLines, pierSlotKey, gableGeometry, shedGeometry } from './homeplan-derived.js';
import { shedFrame, wallIdForSide, edgeSide, wallEdge, fmtPitch, r2 as rr2 } from './roof-calc.js';
import { getLayer } from './model.js';

const IN = 1 / 12;
const SOURCE_LABEL = { footprint: 'footprint', walls: 'walls', foundation: 'foundation', floor: 'floor framing', roof: 'roof', site: 'site' };

export function headerFor(widthIn) {
  return (HEADER_EXAMPLE.find((h) => widthIn <= h.maxIn) || HEADER_EXAMPLE[HEADER_EXAMPLE.length - 1]).size;
}

function sig(l) {
  return JSON.stringify([l.zBase.toFixed(3), l.zTop.toFixed(3), l.objects.map((o) => [o.type, o.geometry, o.z, o.height, o.props])]);
}

/** Wall centerline segments that carry load (exterior + interior marked bearing). */
export function bearingLines(walls) {
  return walls.objects.filter((o) => o.type === 'wall' && (o.props.exterior || o.props.bearing))
    .map((o) => ({ a: o.geometry.a, b: o.geometry.b, wallId: o.id }));
}

/**
 * @param source one of footprint|walls|foundation|floor|roof|site|init
 * @returns {string[]} names of layers that were regenerated (and got a note)
 */
export function regenerate(m, source) {
  const before = {};
  m.layers.forEach((l) => { before[l.id] = sig(l); });
  const site = getLayer(m, 'site'), fnd = getLayer(m, 'foundation'), floor = getLayer(m, 'floor');
  const walls = getLayer(m, 'walls'), roof = getLayer(m, 'roof');
  const fp = m.footprint;
  const fb = bbox(fp);
  const flags = { foundation: [], floor: [], walls: [], roof: [], site: [] };

  // ---- Site: lot + setbacks generated once (or when the footprint leaves the lot)
  const sp = site.params;
  const lot = sp.lot;
  const outside = !lot || fb.minX < lot.minX || fb.minY < lot.minY || fb.maxX > lot.maxX || fb.maxY > lot.maxY;
  if (outside) {
    const mg = sp.lotMarginFt;
    sp.lot = { minX: Math.floor(fb.minX - mg), minY: Math.floor(fb.minY - mg), maxX: Math.ceil(fb.maxX + mg), maxY: Math.ceil(fb.maxY + mg) + 10 };
  }
  site.objects = site.objects.filter((o) => !o.derivedFrom);
  const L = sp.lot, sb = sp.setbacksFt;
  site.objects.unshift(
    { id: 'site-lot', type: 'area', derivedFrom: 'site', geometry: { pts: [[L.minX, L.minY], [L.maxX, L.minY], [L.maxX, L.maxY], [L.minX, L.maxY]] }, props: { role: 'lot', label: 'Lot line' } },
    { id: 'site-setback', type: 'area', derivedFrom: 'site', geometry: { pts: [[L.minX + sb.side, L.minY + sb.rear], [L.maxX - sb.side, L.minY + sb.rear], [L.maxX - sb.side, L.maxY - sb.front], [L.minX + sb.side, L.maxY - sb.front]] }, props: { role: 'setback', label: 'Setback' } },
  );
  if (fb.minX < L.minX + sb.side || fb.maxX > L.maxX - sb.side || fb.minY < L.minY + sb.rear || fb.maxY > L.maxY - sb.front) flags.site.push('Footprint crosses a setback line.');
  site.zBase = 0; site.zTop = 0;

  // ---- Walls: exterior walls derived from the footprint (footprint = outside face of framing)
  const wp = walls.params;
  const extT = LUMBER[wp.extSize] * IN, intT = LUMBER[wp.intSize] * IN;
  const cl = offsetPolygon(fp, extT / 2);
  const oldExt = new Map(walls.objects.filter((o) => o.props && o.props.exterior).map((o) => [o.id, o]));
  const interior = walls.objects.filter((o) => o.type === 'wall' && !o.props.exterior);
  interior.forEach((w) => { w.props.thicknessIn = LUMBER[wp.intSize]; w.props.size = wp.intSize; });
  const ext = cl.map((a, i) => {
    const id = `w-ext-${i}`;
    const prev = oldExt.get(id);
    return {
      id, type: 'wall', derivedFrom: 'footprint',
      geometry: { a: a.slice(), b: cl[(i + 1) % cl.length].slice(), edge: i },
      props: Object.assign({ exterior: true, bearing: true }, prev ? { bearing: true } : {}, { size: wp.extSize, thicknessIn: LUMBER[wp.extSize], studOcIn: wp.studOcIn }),
    };
  });
  const wallById = new Map(ext.concat(interior).map((w) => [w.id, w]));
  const openings = walls.objects.filter((o) => o.type === 'opening' && wallById.has(o.geometry.wallId));
  const dropped = walls.objects.filter((o) => o.type === 'opening' && !wallById.has(o.geometry.wallId)).length;
  openings.forEach((o) => {
    const w = wallById.get(o.geometry.wallId);
    const len = dist(w.geometry.a, w.geometry.b);
    const half = (o.props.widthIn * IN) / 2;
    o.geometry.t = Math.max(Math.min(half + 0.3, len / 2), Math.min(len - half - 0.3, o.geometry.t));
    o.props.header = headerFor(o.props.widthIn);
    o.props.headerFlag = 'EXAMPLE header — verify';
  });
  const others = walls.objects.filter((o) => o.type !== 'wall' && o.type !== 'opening');
  walls.objects = ext.concat(interior, openings, others);
  if (dropped) flags.walls.push(`${dropped} opening(s) removed: their wall no longer exists.`);
  if (openings.length) flags.walls.push(`Headers flagged on ${openings.length} opening(s) — sizes are an EXAMPLE table, verify.`);

  // ---- Foundation
  const f = fnd.params;
  const type = f.type;
  const topZ = (f.topAboveGradeIn[type] != null ? f.topAboveGradeIn[type] : 8) * IN;
  const frostIn = f.frostDepthIn != null && f.frostDepthIn !== '' ? Number(f.frostDepthIn) : null;
  if (frostIn == null) flags.foundation.push(`Frost depth unknown — piers/footings drawn at a conservative ${f.placeholderFrostIn} in placeholder. Enter your ZIP or your local value.`);
  const footBot = -(pierDepthIn(f) * IN);
  const footTop = footBot + f.footingDepthIn * IN;
  const lines = bearingLines(walls);
  const fo = [];
  // Manual piers (dropped, or auto piers the user edited) survive every regeneration.
  const manual = fnd.objects.filter((o) => o.type === 'pier' && !o.derivedFrom);
  const skipSlots = new Set(f.deletedAutoSlots || []);
  manual.forEach((o) => { if (o.props.autoSlot) skipSlots.add(o.props.autoSlot); });
  // Pier elevation by shape: round/square go to the frost-rule depth; a precast block sits ON the surface.
  const pierZ = (o, topIn, depthIn) => {
    const sh = pierShapeOf(o, f);
    if (sh.shape === 'precast') { o.z = 0; o.height = sh.heightIn * IN; return; }
    o.z = -depthIn * IN; o.height = Math.max(1 * IN, (topIn + depthIn) * IN);
  };
  if (isPierType(type)) {
    const spFt = (Number(f.pierSpacingIn) || 72) * IN;
    const piers = piersAlongLines(lines, spFt, f.pierSpacingMode === 'exact' ? 'exact' : 'max');
    const gbBot = type === 'piers' ? topZ - f.gradeBeamDepthIn * IN : topZ;   // Piers only: the pier top carries the framing
    piers.forEach((p) => {
      const k = pierSlotKey(p.c);
      if (skipSlots.has(k)) return;
      if (manual.some((mp) => dist(mp.geometry.c, p.c) < PIERS.mergeFt)) return; // no tube on top of a manual one
      const o = { id: `pa_${k.replace('|', '_')}`, type: 'pier', derivedFrom: p.wallId, geometry: { c: p.c }, z: footBot, height: gbBot - footBot, props: { diaIn: f.pierDiaIn, auto: true } };
      pierZ(o, gbBot / IN, -footBot / IN);
      o.props.label = `${pierShapeLabel(o, f)} (auto)`;
      fo.push(o);
    });
    if (type === 'piers') lines.forEach((ln, i) => fo.push({ id: `gbeam-${i}`, type: 'beam', derivedFrom: ln.wallId, geometry: { a: ln.a, b: ln.b }, z: gbBot, height: f.gradeBeamDepthIn * IN, props: { role: 'gradeBeam', ckey: `gradeBeam:${ln.wallId}`, widthIn: f.gradeBeamWidthIn, label: 'Grade beam' } }));
    if (type === 'piersOnly') flags.foundation.push('Piers only: no grade beam or footing. The sill/floor framing bears pier to pier, so it needs a beam sized for that span (not generated or priced). Have an engineer or your building department check it.');
  } else if (type === 'slab') {
    fo.push({ id: 'slab', type: 'area', derivedFrom: 'footprint', geometry: { pts: fp.map((p) => p.slice()) }, z: topZ - f.slabIn * IN, height: f.slabIn * IN, props: { role: 'slab', ckey: 'slab:footprint', label: `${f.slabIn} in slab` } });
    lines.forEach((ln, i) => fo.push({ id: `footing-${i}`, type: 'footing', derivedFrom: ln.wallId, geometry: { a: ln.a, b: ln.b }, z: footBot, height: topZ - f.slabIn * IN - footBot, props: { ckey: `footing:${ln.wallId}`, widthIn: f.footingWidthIn, label: 'Thickened edge / footing' } }));
  } else {
    const wallTopZ = topZ;
    const wallBot = type === 'basement' ? topZ - f.basementWallFt : footTop;
    const fBot = type === 'basement' ? wallBot - f.footingDepthIn * IN : footBot;
    lines.forEach((ln, i) => {
      fo.push({ id: `footing-${i}`, type: 'footing', derivedFrom: ln.wallId, geometry: { a: ln.a, b: ln.b }, z: fBot, height: f.footingDepthIn * IN, props: { ckey: `footing:${ln.wallId}`, widthIn: f.footingWidthIn, depthIn: f.footingDepthIn, label: `Footing ${f.footingWidthIn}x${f.footingDepthIn} in` } });
      fo.push({ id: `stem-${i}`, type: 'footing', derivedFrom: ln.wallId, geometry: { a: ln.a, b: ln.b }, z: type === 'basement' ? wallBot : fBot + f.footingDepthIn * IN, height: wallTopZ - (type === 'basement' ? wallBot : fBot + f.footingDepthIn * IN), props: { role: 'stem', ckey: `stem:${ln.wallId}`, widthIn: f.stemWallIn, label: type === 'basement' ? 'Basement wall' : 'Stem wall' } });
    });
    if (type === 'basement') fo.push({ id: 'bslab', type: 'area', derivedFrom: 'footprint', geometry: { pts: fp.map((p) => p.slice()) }, z: wallBot, height: 4 * IN, props: { role: 'slab', ckey: 'bslab:footprint', label: 'Basement slab' } });
  }
  // hotfix: continuous concrete the user deleted stays deleted through regeneration
  const delC = new Set(f.deletedContinuous || []);
  const nBefore = fo.length;
  for (let i = fo.length - 1; i >= 0; i--) if (fo[i].props.ckey && delC.has(fo[i].props.ckey)) fo.splice(i, 1);
  if (nBefore - fo.length) flags.foundation.push(`${nBefore - fo.length} continuous concrete element(s) deleted by you (kept out of the drawing and the price). Restore them from the Foundation card.`);
  // manual piers: elevation follows the layer defaults unless the user set top/depth; flag, never delete
  const defTopIn = (type === 'piers' ? topZ - f.gradeBeamDepthIn * IN : topZ) / IN;
  const defDepthIn = pierDepthIn(f);
  const wl = walls.objects.filter((o) => o.type === 'wall');
  let nFlag = 0;
  manual.forEach((o) => {
    const top = o.props.topIn != null && o.props.topIn !== '' ? Number(o.props.topIn) : defTopIn;
    const depth = o.props.depthIn != null && o.props.depthIn !== '' ? Number(o.props.depthIn) : defDepthIn;
    pierZ(o, top, depth);
    o.props.label = pierShapeLabel(o, f);
    const c = o.geometry.c;
    const pf = [];
    const edge = Math.min(...fp.map((a, i) => distToSeg(c, a, fp[(i + 1) % fp.length]).d));
    if (!pointInPoly(c, fp) && edge > 0.01) pf.push(`outside the footprint (${fmtFtIn(edge)} out)`);
    const near = wl.length ? Math.min(...wl.map((w) => distToSeg(c, w.geometry.a, w.geometry.b).d)) : Infinity;
    if (o.props.onWall && near > PIERS.offWallTolFt) pf.push(`no longer under a wall line (${fmtFtIn(near)} away)`);
    if (pf.length) { o.props.flags = pf; nFlag++; } else delete o.props.flags;
  });
  if (nFlag) flags.foundation.push(`${nFlag} manual pier(s) FLAGGED after a footprint/wall change (outside the footprint or off a wall line). They were kept, not deleted — move or delete them.`);
  fnd.objects = fo.concat(fnd.objects.filter((o) => !o.derivedFrom));
  const nPre = fnd.objects.filter((o) => o.type === 'pier' && pierShapeOf(o, f).shape === 'precast').length;
  if (nPre) flags.foundation.unshift(`⚠ ${nPre} precast block(s): ${precastFrostWarning(f)}`);
  fnd.zBase = Math.min(footBot, ...fnd.objects.map((o) => o.z != null ? o.z : 0));
  fnd.zTop = topZ;

  // ---- Floor framing
  const fl = floor.params;
  const jd = LUMBER[fl.joistSize] * IN;
  const flo = [];
  let floorTop = topZ;
  if (type === 'slab') {
    flags.floor.push('Slab on grade: no floor framing.');
  } else {
    const sillZ = topZ, joistZ = topZ + LUMBER_T_IN * IN, subZ = joistZ + jd;
    floorTop = subZ + fl.subfloorIn * IN;
    const sillCl = offsetPolygon(fp, (LUMBER[fl.sillSize] * IN) / 2);
    sillCl.forEach((a, i) => flo.push({ id: `sill-${i}`, type: 'beam', derivedFrom: `w-ext-${i}`, geometry: { a, b: sillCl[(i + 1) % sillCl.length] }, z: sillZ, height: LUMBER_T_IN * IN, props: { role: 'sill', widthIn: LUMBER[fl.sillSize], label: `Sill ${fl.sill}` } }));
    const rimCl = offsetPolygon(fp, (LUMBER_T_IN * IN) / 2);
    rimCl.forEach((a, i) => flo.push({ id: `rim-${i}`, type: 'joist', derivedFrom: `w-ext-${i}`, geometry: { a, b: rimCl[(i + 1) % rimCl.length] }, z: joistZ, height: jd, props: { role: 'rim', widthIn: LUMBER_T_IN, label: `Rim joist ${fl.joistSize}` } }));
    // Joists span the short direction (spec §6) unless the user picks a direction.
    const inner = offsetPolygon(fp, LUMBER_T_IN * IN);
    const ib = bbox(inner);
    let runAxis = fl.direction; // 'x' = joists run east-west
    if (runAxis !== 'x' && runAxis !== 'y') runAxis = fb.w >= fb.h ? 'y' : 'x';
    const span = runAxis === 'y' ? fb.h : fb.w;
    const oc = fl.joistOcIn * IN;
    const lo = runAxis === 'y' ? ib.minX : ib.minY, hi = runAxis === 'y' ? ib.maxX : ib.maxY;
    let k = 0;
    for (let c = (runAxis === 'y' ? fb.minX : fb.minY) + oc; c < hi - 0.1; c += oc) {
      if (c < lo + 0.1) continue;
      scanline(inner, runAxis === 'y' ? 'x' : 'y', c).forEach(([a, b]) => flo.push({ id: `joist-${k++}`, type: 'joist', derivedFrom: 'footprint', geometry: { a, b }, z: joistZ, height: jd, props: { widthIn: LUMBER_T_IN, size: fl.joistSize, label: `${fl.joistSize} @ ${fl.joistOcIn} in o.c.` } }));
    }
    floor.params.computed = { runAxis, spanFt: span };
    if (span > fl.beamFlagSpanFt) {
      const mid = runAxis === 'y' ? fb.cy : fb.cx;
      scanline(inner, runAxis === 'y' ? 'y' : 'x', mid).forEach(([a, b], i) => flo.push({ id: `beam-${i}`, type: 'beam', derivedFrom: 'footprint', geometry: { a, b }, z: joistZ, height: jd, props: { role: 'girder', widthIn: 3 * LUMBER_T_IN, flag: true, label: 'Mid beam — FLAGGED, size by engineer' } }));
      flags.floor.push(`Joist span ${span.toFixed(1)} ft > ${fl.beamFlagSpanFt} ft: mid beam added and FLAGGED (not sized). Its support is not generated — verify.`);
    }
    flo.push({ id: 'subfloor', type: 'area', derivedFrom: 'footprint', geometry: { pts: fp.map((p) => p.slice()) }, z: subZ, height: fl.subfloorIn * IN, props: { role: 'subfloor', label: fl.subfloor } });
  }
  floor.objects = flo.concat(floor.objects.filter((o) => !o.derivedFrom));
  floor.zBase = topZ; floor.zTop = floorTop;

  // ---- Walls elevation (v4: a shed gives the exterior walls their own plate heights; rake walls slope)
  const rp = roof.params;
  const isShed = rp.shape === 'shed';
  let SF = null;
  if (isShed) {
    if (!rp.shed || typeof rp.shed !== 'object') rp.shed = {};
    const sh = rp.shed;
    if (!sh.highWallId || wallEdge(sh.highWallId) < 0 || wallEdge(sh.highWallId) >= fp.length) sh.highWallId = m.attachToExistingWallId || wallIdForSide(fp, 'N') || 'w-ext-0';
    if (!(Number(sh.lowPlateFt) > 0)) sh.lowPlateFt = wp.plateHeightFt;
    if (!(Number(sh.highPlateFt) > 0)) sh.highPlateFt = sh.lowPlateFt + 2;
    SF = shedFrame(fp, sh.highWallId, sh.highPlateFt, sh.lowPlateFt);
    rp.pitch = Math.round(SF.pitch * 10000) / 10000; // derived; heights are the source of truth
  }
  const maxPlate = isShed ? Math.max(rp.shed.highPlateFt, rp.shed.lowPlateFt, wp.plateHeightFt) : wp.plateHeightFt;
  walls.zBase = floorTop; walls.zTop = floorTop + maxPlate;
  walls.objects.forEach((o) => {
    if (o.type !== 'wall') return;
    o.z = walls.zBase;
    if (isShed && o.props.exterior) {
      // heights at the wall's extended ends (outside faces): exact high/low at the faces, linear between
      const t = (o.props.thicknessIn || 5.5) * IN / 2; const a = o.geometry.a, b = o.geometry.b; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const side = edgeSide(fp, wallEdge(o.id));
      let hA = SF.plateAt([a[0] - ux * t, a[1] - uy * t]), hB = SF.plateAt([b[0] + ux * t, b[1] + uy * t]);
      if (side === SF.highSide) hA = hB = rp.shed.highPlateFt; else if (side === SF.lowSide) hA = hB = rp.shed.lowPlateFt;
      const snap = (h) => Math.round(h * 1e4) / 1e4;
      o.props.plateHeightFt = snap(hA); o.props.plateHeightEndFt = snap(hB); o.props.extEndFt = t;
      o.height = Math.max(hA, hB);
    } else {
      delete o.props.plateHeightFt; delete o.props.plateHeightEndFt; delete o.props.extEndFt;
      o.height = wp.plateHeightFt;
    }
  });
  m.levels[0].floorZ = floorTop;

  const ro = [];
  const rd = LUMBER[rp.rafterSize] * IN;
  const oc = rp.rafterOcIn * IN;
  if (isShed) {
    // ---- Shed: one plane, rafters low eave tip → high eave tip, end stations are barge rafters, no ridge
    const g = shedGeometry(SF.run, floorTop + rp.shed.lowPlateFt, floorTop + rp.shed.highPlateFt, rp.overhangIn);
    const ohr = (Number(rp.rakeOverhangIn) || 0) * IN;
    const alongX = SF.axis === 'y'; // slope runs along y → rafters along y, stations along x
    const A0 = (alongX ? fb.minX : fb.minY) - ohr, A1 = (alongX ? fb.maxX : fb.maxY) + ohr;
    const hiC = { N: fb.minY, S: fb.maxY, W: fb.minX, E: fb.maxX }[SF.highSide], loC = { N: fb.minY, S: fb.maxY, W: fb.minX, E: fb.maxX }[SF.lowSide];
    const sgn = hiC < loC ? -1 : 1; const CH = hiC + sgn * g.oh, CL = loC - sgn * g.oh;
    const P = (along, cross) => (alongX ? [along, cross] : [cross, along]);
    const stations = []; for (let s0 = A0; s0 < A1 - 0.05; s0 += oc) stations.push(s0); stations.push(A1);
    stations.forEach((s0, k) => ro.push({ id: `rafter-${k}`, type: 'rafter', derivedFrom: 'roof', geometry: { a: P(s0, CL), b: P(s0, CH) }, z: g.eaveLowZ, height: rd, props: { zA: g.eaveLowZ, zB: g.eaveHighZ, size: rp.rafterSize, widthIn: LUMBER_T_IN, role: k === 0 || k === stations.length - 1 ? 'barge' : 'common', label: `${k === 0 || k === stations.length - 1 ? 'Barge rafter' : 'Rafter'} ${rp.rafterSize} @ ${rp.rafterOcIn} in o.c.` } }));
    ro.push({ id: 'roof-outline', type: 'area', derivedFrom: 'walls', geometry: { pts: [P(A0, CL), P(A1, CL), P(A1, CH), P(A0, CH)] }, z: g.eaveLowZ, height: 0, props: { role: 'outline', label: 'Roof outline' } });
    ro.push({ id: 'roof-high-edge', type: 'line', derivedFrom: 'roof', geometry: { a: P(A0, CH), b: P(A1, CH) }, z: g.eaveHighZ, height: 0, props: { role: 'eave', label: 'High eave' } });
    ro.push({ id: 'roof-pitch', type: 'label', derivedFrom: 'roof', geometry: { c: P((A0 + A1) / 2, (CH + CL) / 2) }, props: { text: fmtPitch(rp.pitch), arrow: alongX ? 'y' : 'x', down: SF.lowSide, dir: sgn } });
    roof.objects = ro.concat(roof.objects.filter((o) => !o.derivedFrom));
    roof.zBase = floorTop + Math.min(rp.shed.lowPlateFt, rp.shed.highPlateFt); roof.zTop = g.eaveHighZ + rd;
    roof.params.computed = { shed: true, ridgeAlongX: alongX, shedAxis: SF.axis, highEdge: SF.highEdge, highSide: SF.highSide, lowSide: SF.lowSide, rise: g.rise, highZ: g.highZ, lowZ: g.lowZ, eaveLowZ: g.eaveLowZ, eaveHighZ: g.eaveHighZ, runFt: SF.run, ridgeZ: g.eaveHighZ };
    if (!isAxisRect(fp)) flags.roof.push('Non-rectangular footprint: the shed is drawn over the bounding rectangle. Check / edit manually.');
    flags.roof.push(`Shed: ${fmtFtIn(rp.shed.highPlateFt)} ${({ N: 'north', S: 'south', E: 'east', W: 'west' })[SF.highSide]} wall down to ${fmtFtIn(rp.shed.lowPlateFt)} ${({ N: 'north', S: 'south', E: 'east', W: 'west' })[SF.lowSide]} wall over ${fmtFtIn(SF.run)} = ${fmtPitch(rp.pitch)}.`);
    flags.roof.push('Interior walls keep the wall layer plate height; they are not sloped.');
  } else {
  // ---- Roof (gable over the footprint's bounding rectangle in v1)
  const ridgeAlongX = rp.ridge === 'long' ? fb.w >= fb.h : fb.w < fb.h;
  const span = ridgeAlongX ? fb.h : fb.w;
  const g = gableGeometry(span, rp.pitch, rp.overhangIn, walls.zTop);
  const A0 = (ridgeAlongX ? fb.minX : fb.minY) - g.oh, A1 = (ridgeAlongX ? fb.maxX : fb.maxY) + g.oh;
  const C0 = (ridgeAlongX ? fb.minY : fb.minX) - g.oh, C1 = (ridgeAlongX ? fb.maxY : fb.maxX) + g.oh, Cm = ridgeAlongX ? fb.cy : fb.cx;
  const P = (along, cross) => (ridgeAlongX ? [along, cross] : [cross, along]);
  const stations = [];
  for (let s = A0; s < A1 - 0.05; s += oc) stations.push(s);
  stations.push(A1);
  let r = 0;
  stations.forEach((s) => {
    [C0, C1].forEach((c) => ro.push({ id: `rafter-${r++}`, type: 'rafter', derivedFrom: 'roof', geometry: { a: P(s, c), b: P(s, Cm) }, z: g.eaveTipZ, height: rd, props: { zA: g.eaveTipZ, zB: g.ridgeZ, size: rp.rafterSize, widthIn: LUMBER_T_IN, label: `Rafter ${rp.rafterSize} @ ${rp.rafterOcIn} in o.c.` } }));
  });
  ro.push({ id: 'ridge', type: 'beam', derivedFrom: 'roof', geometry: { a: P(A0, Cm), b: P(A1, Cm) }, z: g.ridgeZ, height: rd + 1.5 * IN, props: { role: 'ridge', widthIn: LUMBER_T_IN, label: 'Ridge board' } });
  ro.push({ id: 'roof-outline', type: 'area', derivedFrom: 'walls', geometry: { pts: [P(A0, C0), P(A1, C0), P(A1, C1), P(A0, C1)] }, z: g.eaveTipZ, height: 0, props: { role: 'outline', label: 'Roof outline' } });
  ro.push({ id: 'roof-pitch', type: 'label', derivedFrom: 'roof', geometry: { c: P((A0 + A1) / 2, (C0 + Cm) / 2) }, props: { text: `${Math.round(rp.pitch * 100) / 100}:12`, arrow: ridgeAlongX ? 'y' : 'x' } });
  roof.objects = ro.concat(roof.objects.filter((o) => !o.derivedFrom));
  roof.zBase = walls.zTop; roof.zTop = g.ridgeZ + rd;
  roof.params.computed = { ridgeAlongX, rise: g.rise, ridgeZ: g.ridgeZ };
  if (!isAxisRect(fp)) flags.roof.push('Non-rectangular footprint: v1 roof is a gable over the bounding rectangle. Check / edit manually.');
  if (rp.shape !== 'gable') flags.roof.push(`A ${String(rp.shape).replace('_', '-')} roof isn't drawn yet: showing a gable. Gable and shed are generated.`);
  flags.roof.push('Gable-end wall framing is not generated yet.');
  }

  // ---- custom layers keep their own z; stubs sit on top of the roof
  m.layers.forEach((l) => { if (flags[l.id]) l.flags = flags[l.id]; });

  // ---- notes for layers changed by an upstream edit
  const srcLayer = source === 'footprint' ? null : source;
  const changed = [];
  const now = Date.now();
  m.layers.forEach((l) => {
    if (l.stub || l.kind === 'custom' || l.id === srcLayer || source === 'init') return;
    if (sig(l) !== before[l.id]) {
      l.note = { text: `Updated from ${SOURCE_LABEL[source] || source}`, at: now };
      changed.push(l.name);
    }
  });
  if (changed.length) m.lastRegen = { source: SOURCE_LABEL[source] || source, layers: changed, at: now };
  return changed;
}
