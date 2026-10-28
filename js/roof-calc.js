// ============================================================================
// roof-calc.js — v4 roofing math + checks (pure; no DOM). Ported from Remodel Guide's
// roofing-v1/reference/roof-reference.mjs (heel, span tables, sheathing, ice courses, tie-ins) and the
// validation lists in roofing-options.json (RF-*) + wizard-commands.json (V-ROOF-*, V-WALL-01, V-ATTACH-01).
// Conventions (wizard-spec §3): plate height = top of the top plate above the subfloor; shed pitch =
// 12·(high − low)/run with run between the OUTSIDE faces of the high and low walls; plan (x,y) → 3D (x,z).
// ============================================================================
import { EXISTING_ROOF_ASSUMED, SLOPE } from './config.js';

export const r2 = (x) => Math.round(x * 100) / 100;
export const LUMBER_DEPTH_IN = { '2x4': 3.5, '2x6': 5.5, '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 };
export const SIZES = ['2x4', '2x6', '2x8', '2x10', '2x12'];
export const slopeK = (p) => Math.sqrt(1 + (p / 12) ** 2);
export const hipValleyK = (p) => Math.sqrt(2 + (p / 12) ** 2);
export const degreesFromPitch = (p) => Math.atan(p / 12) * 180 / Math.PI;
export const pitchFromDegrees = (d) => 12 * Math.tan(d * Math.PI / 180);
export const pitchFromHeights = (hi, lo, run) => 12 * (hi - lo) / run;
/** Round a pitch to the slider step (0.25) for display / storage. */
export const snapPitch = (p) => Math.round(Number(p) / SLOPE.step) * SLOPE.step;
export function fmtPitch(p) { const v = Math.round(Number(p) * 100) / 100; return `${v}:12`; }
export function fmtFtInS(ft) {
  if (ft == null || !isFinite(ft)) return '—';
  const neg = ft < 0; ft = Math.abs(ft); let f = Math.floor(ft); let i = Math.round((ft - f) * 12 * 4) / 4; if (i >= 12) { f++; i -= 12; }
  const q = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }; const wi = Math.floor(i), fr = r2(i - wi);
  const ins = fr ? `${wi ? wi + '-' : ''}${q[fr]}` : String(wi);
  return `${neg ? '−' : ''}${f}' ${ins}"`;
}

// ---------- IRC R905 covering minimums (wizard-commands.json code_facts.minSlope; verified 2026-10-28)
export const MIN_SLOPE = {
  asphalt_shingle: { min: 2, section: 'R905.2.2', label: 'Asphalt shingles' },
  clay_concrete_tile: { min: 2.5, section: 'R905.3.2', label: 'Clay / concrete tile' },
  metal_shingle: { min: 3, section: 'R905.4.2', label: 'Metal shingles' },
  roll_roofing: { min: 1, section: 'R905.5.2', label: 'Rolled roofing' },
  slate: { min: 4, section: 'R905.6.2', label: 'Slate' },
  wood_shingle: { min: 3, section: 'R905.7.2', label: 'Wood shingles' },
  wood_shake: { min: 3, section: 'R905.8.2', label: 'Wood shakes' },
  built_up: { min: 0.25, section: 'R905.9.1', label: 'Built-up roofing' },
  metal_panel_lapped: { min: 3, section: 'R905.10.2 item 1', label: 'Metal panels, exposed fastener' },
  metal_panel_lapped_sealant: { min: 0.5, section: 'R905.10.2 item 2', label: 'Metal panels, sealed laps' },
  metal_standing_seam: { min: 0.25, section: 'R905.10.2 item 3', label: 'Standing seam metal' },
  modified_bitumen: { min: 0.25, section: 'R905.11.1', label: 'Modified bitumen' },
  single_ply: { min: 0.25, section: 'R905.12.1', label: 'EPDM / TPO membrane' },
  liquid_applied: { min: 0.25, section: 'R905.14.1', label: 'Liquid-applied' },
};
export const ICE_BARRIER_COVERINGS = new Set(['asphalt_shingle', 'metal_shingle', 'roll_roofing', 'clay_concrete_tile', 'slate', 'wood_shingle', 'wood_shake']);
export const coveringLabel = (c) => (MIN_SLOPE[c] || { label: c }).label;

// ---------- heel / seat (roof-reference.mjs heel())
export function heel(size, pitch, seatIn = 3.5) {
  const d = LUMBER_DEPTH_IN[size] || 7.25, th = Math.atan(Math.max(pitch, 0.01) / 12), c = Math.cos(th), t = Math.tan(th), sn = Math.sin(th);
  const hapIn = d / c - seatIn * t;
  return { hapIn: r2(hapIn), notchPerpIn: r2(seatIn * sn), remainPerpIn: r2(hapIn * c), plumbCutIn: r2(d / c), deepNotch: seatIn * sn > d / 4, shortTail: hapIn * c < 3.5 };
}
/** Roof surface (top of sheathing) height above the floor over a wall with plate height plateFt. */
export const roofTopOverWall = (plateFt, size, pitch, seatIn = 3.5, sheathIn = 0.59) => plateFt + (heel(size, pitch, seatIn).hapIn + sheathIn) / 12;

// ---------- span tables (rafter-span-tables.json, IRC R802.4.1)
const parseSpan = (s) => { const [f, i] = String(s).split('-').map(Number); return f + (i || 0) / 12; };
export function snowTableKey(pg) { if (pg == null) return null; if (pg > 70) return null; return pg <= 20 ? 20 : pg <= 30 ? 30 : pg <= 50 ? 50 : 70; }
export function maxSpan(SP, { pg, attached = false, ocIn = 24, species = 'Spruce-pine-fir', grade = '#2', size, deadPsf = 10 }) {
  if (!SP) return null; const g = snowTableKey(pg); if (g == null) return null;
  const tname = SP.table_index[`${g}_${attached ? 'attached' : 'notAttached'}`]; const T = SP.tables[tname]; if (!T) return null;
  const oc = Number(ocIn) === 19.2 ? '19.2' : String(Number(ocIn));
  const row = T.rows[`${oc}|${species}|${grade}`]; if (!row) return null;
  const v = row[SIZES.indexOf(size) + (deadPsf > 10 ? 5 : 0)]; if (!v || v === '—' || v === '-') return null;
  return { table: tname, spanFt: r2(parseSpan(v)), raw: v, tableSnow: g };
}
export function pickRafter(SP, o) {
  for (const size of ['2x6', '2x8', '2x10', '2x12']) { const m = maxSpan(SP, Object.assign({}, o, { size })); if (m && m.spanFt >= o.spanFt) return Object.assign({ size }, m); }
  return { size: null };
}
// ---------- sheathing (Table R503.2.1.1(1) allowable live load)
export function pickSheathing(ocIn, snowPsf) {
  const opts = [{ t: '7/16', ref: 'osb_716_4x8', at16: 100, at24: 40 }, { t: '15/32', ref: 'ply_1532_4x8', at16: 180, at24: 70 }, { t: '19/32', ref: 'osb_1932_4x8', at16: 305, at24: 130 }];
  for (const o of opts) { const cap = ocIn <= 16 ? o.at16 : o.at24; if (cap >= snowPsf) return Object.assign({ capPsf: cap }, o); }
  return { t: '23/32', ref: null, capPsf: null, engineer: true };
}
export function iceCourses(pitch, overhangIn) {
  let req = ((Number(overhangIn) || 0) + 24) * slopeK(Number(pitch) || 0); if (pitch >= 8) req = Math.max(req, 36);
  return { reqIn: r2(req), courses: req <= 36 ? 1 : 1 + Math.ceil((req - 36) / 33) };
}

// ---------- walls / sides
const SIDE_NAME = { N: 'north', S: 'south', E: 'east', W: 'west' };
export const sideName = (s) => SIDE_NAME[s] || s;
/** Compass side of exterior wall edge i (outward normal; plan +y = south). */
export function edgeSide(fp, i) {
  const a = fp[i], b = fp[(i + 1) % fp.length];
  let area = 0; fp.forEach((p, k) => { const q = fp[(k + 1) % fp.length]; area += p[0] * q[1] - q[0] * p[1]; });
  const dx = b[0] - a[0], dy = b[1] - a[1];
  // outward normal: for positive (clockwise on screen, y down) area the outward normal of a→b is (dy, −dx)
  let nx = dy, ny = -dx; if (area < 0) { nx = -nx; ny = -ny; }
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? 'E' : 'W';
  return ny > 0 ? 'S' : 'N';
}
export const wallEdge = (wallId) => { const m = /^w-ext-(\d+)$/.exec(wallId || ''); return m ? Number(m[1]) : -1; };
export function wallIdForSide(fp, side) { for (let i = 0; i < fp.length; i++) if (edgeSide(fp, i) === side) return `w-ext-${i}`; return null; }
const bb = (fp) => { const xs = fp.map((p) => p[0]), ys = fp.map((p) => p[1]); return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Shed frame for a footprint + high wall: axis, run (outside faces), sides, and the plate-height plane. */
export function shedFrame(fp, highWallId, hi, lo) {
  const b = bb(fp); let i = wallEdge(highWallId); if (i < 0 || i >= fp.length) i = 0;
  const hs = edgeSide(fp, i), ls = OPP[hs];
  const axis = hs === 'N' || hs === 'S' ? 'y' : 'x';
  const run = axis === 'y' ? b.h : b.w;
  const hiCoord = { N: b.minY, S: b.maxY, W: b.minX, E: b.maxX }[hs];
  const dir = { N: 1, S: -1, W: 1, E: -1 }[hs]; // + = moving from the high face toward the low face
  const plateAt = (p) => { const c = axis === 'y' ? p[1] : p[0]; const u = (c - hiCoord) * dir; return hi + (lo - hi) * (u / run); };
  return { highEdge: i, highSide: hs, lowSide: ls, lowWallId: wallIdForSide(fp, ls), axis, run, plateAt, bbox: b, pitch: pitchFromHeights(hi, lo, run) };
}

/** The house object on the site layer (role existing) and its roof data (ASSUMED values filled + flagged). */
export function houseOf(m) {
  const site = (m.layers || []).find((l) => l.id === 'site'); if (!site) return null;
  const ex = site.objects.filter((o) => o.props && o.props.role === 'existing');
  const o = ex.find((x) => x.props.existingRoof) || ex.find((x) => /house|home/i.test(x.props.label || '')) || null;
  if (!o) return null;
  const er = o.props.existingRoof || {};
  const assumed = Object.assign({}, er.assumed || {});
  const R = {}; Object.keys(EXISTING_ROOF_ASSUMED).forEach((k) => { if (er[k] == null) { R[k] = EXISTING_ROOF_ASSUMED[k]; assumed[k] = true; } else R[k] = er[k]; });
  return { obj: o, roof: R, assumed, isAssumed: (k) => !!assumed[k] };
}

/** Effective tie-in type ('auto' resolved, roofing-options tieIns default). */
export function tieInType(m) {
  const rp = (m.layers.find((l) => l.id === 'roof') || {}).params || {}; const t = (rp.tieIn && rp.tieIn.type) || 'auto';
  if (!m.attachToExistingWallId) return 'none';
  if (t !== 'auto') return t;
  return rp.shape === 'shed' ? 'shed_under_eave' : 'gable_into_roof';
}

/** Tie-in numbers for the current model (shed under eave / into plane / extend plane / gable into roof). */
export function tieInInfo(m) {
  const roof = m.layers.find((l) => l.id === 'roof'); const rp = roof.params; const walls = m.layers.find((l) => l.id === 'walls');
  const type = tieInType(m); if (type === 'none') return { type };
  const H = houseOf(m); const R = H ? H.roof : Object.assign({}, EXISTING_ROOF_ASSUMED); const assumed = H ? H.assumed : { pitch: true, eaveUndersideFt: true };
  const ti = rp.tieIn || {}; const clr = Number(ti.flashingClearIn) || 5; const drop = Number(ti.floorDropFt) || 0;
  const out = { type, house: R, assumed, flashingClearIn: clr, floorDropFt: drop, houseWallId: m.attachToExistingWallId };
  const plate = walls.params.plateHeightFt; const size = rp.rafterSize; const pitch = Number(rp.pitch) || 0;
  if (rp.shape === 'shed' && rp.shed) {
    const s = rp.shed; const f = shedFrame(m.footprint, s.highWallId, s.highPlateFt, s.lowPlateFt);
    const houseSide = edgeSide(m.footprint, wallEdge(m.attachToExistingWallId));
    const plateAtHouse = houseSide === f.highSide ? s.highPlateFt : houseSide === f.lowSide ? s.lowPlateFt : null;
    out.highAtHouse = houseSide === f.highSide; out.lowAtHouse = houseSide === f.lowSide; out.houseSide = houseSide;
    const topRaw = plateAtHouse == null ? null : roofTopOverWall(plateAtHouse, size, pitch, rp.seatIn);
    out.roofTopAtHouseFt = topRaw == null ? null : r2(topRaw);
    out.lowRoofTopFt = r2(roofTopOverWall(s.lowPlateFt, size, pitch, rp.seatIn));
    if (type === 'shed_under_eave') {
      const zMax = R.eaveUndersideFt == null ? null : R.eaveUndersideFt + drop - clr / 12;
      out.zHiMaxFt = zMax == null ? null : r2(zMax);
      out.eaveNeededFt = topRaw == null ? null : r2(topRaw - drop + clr / 12);
      out.fits = zMax == null || topRaw == null ? null : topRaw <= zMax + 1e-6;
      out.shortByFt = out.fits === false ? r2(topRaw - zMax) : 0;
      if (out.zHiMaxFt != null && out.highAtHouse) {
        // highest high wall that still fits (same low wall), solving the heel at that pitch
        let hiMax = s.highPlateFt; for (let k = 0; k < 25; k++) { const p = Math.max(0.01, pitchFromHeights(hiMax, s.lowPlateFt, f.run)); hiMax = zMax - (heel(size, p, rp.seatIn).hapIn + 0.59) / 12; }
        out.maxHighPlateFt = r2(hiMax); out.maxPitch = r2(pitchFromHeights(hiMax, s.lowPlateFt, f.run));
      }
    } else if (type === 'shed_into_roof_plane' && R.pitch != null && R.roofTopAtWallFt != null) {
      const zNewAtWall = out.roofTopAtHouseFt; const pe = R.pitch, pn = pitch;
      out.tieDistUpSlopeFt = pe > pn ? r2((zNewAtWall - R.roofTopAtWallFt) / ((pe - pn) / 12)) : null;
    } else if (type === 'extend_plane' && R.pitch != null && R.roofTopAtWallFt != null) {
      out.zAtOuterWallFt = r2(R.roofTopAtWallFt - f.run * R.pitch / 12);
    }
  } else if (rp.shape === 'gable' && type === 'gable_into_roof' && R.pitch) {
    const b = bb(m.footprint); const c = rp.computed || {};
    const span = c.ridgeAlongX ? b.h : b.w; const pn = pitch, pe = R.pitch;
    const zEave = plate + (heel(size, pn, rp.seatIn).hapIn + 0.59) / 12; const zRidge = zEave + (span / 2) * pn / 12;
    const zEx = R.roofTopAtWallFt != null ? R.roofTopAtWallFt : R.eaveUndersideFt + 0.6;
    out.zRidgeFt = r2(zRidge); out.tieDistUpSlopeFt = r2((zRidge - zEx) * 12 / pe);
    const half = span / 2; const u0 = 0; const a0 = (zEave - zEx) * 12 / pe;
    const planLen = Math.hypot(half - u0, out.tieDistUpSlopeFt - a0); out.valleyPlanFt = r2(planLen); out.valleyTrueFt = r2(Math.hypot(planLen, half * pn / 12));
    out.valleys = 2; out.pastRidge = R.ridgeDistFt != null && out.tieDistUpSlopeFt > R.ridgeDistFt - 1;
  }
  return out;
}

/** Ground snow (ASD) the checks use: the user value, else the ZIP lookup, else null (= ask). */
export function groundSnow(m) {
  const rp = m.layers.find((l) => l.id === 'roof').params; const s = rp.snow || {};
  if (s.groundSnowPsf != null && s.groundSnowPsf !== '') { const v = Number(s.groundSnowPsf) * (s.strengthLevel ? 0.7 : 1); return { pg: r2(v), source: s.source || 'user', strength: !!s.strengthLevel }; }
  const j = m.site && m.site.groundSnowPsf; if (j != null) return { pg: Number(j), source: 'zip_lookup' };
  return { pg: null, source: 'unknown' };
}

/** Horizontal rafter span (IRC R802.4.1 measures on the horizontal projection). */
export function rafterSpan(m) {
  const rp = m.layers.find((l) => l.id === 'roof').params; const walls = m.layers.find((l) => l.id === 'walls');
  const t = ({ '2x4': 3.5, '2x6': 5.5, '2x8': 7.25 }[walls.params.extSize] || 5.5) / 12; const b = bb(m.footprint);
  if (rp.shape === 'shed' && rp.shed) { const f = shedFrame(m.footprint, rp.shed.highWallId, rp.shed.highPlateFt, rp.shed.lowPlateFt); return r2(f.run - t); }
  const c = rp.computed || {}; const span = c.ridgeAlongX ? b.h : b.w; return r2((span - t) / 2);
}

/** Rafter cut length incl. overhang (shed: low eave tip → high eave tip; gable: eave tip → ridge). */
export function rafterLength(m) {
  const roof = m.layers.find((l) => l.id === 'roof'); const r = roof.objects.find((o) => o.type === 'rafter');
  if (!r) return 0; return Math.hypot(r.geometry.b[0] - r.geometry.a[0], r.geometry.b[1] - r.geometry.a[1], r.props.zB - r.props.zA);
}

/**
 * All roof checks for the model → [{ id, severity: block|warn|info, msg, cite?, step }].
 * step = Roof stepper step (1-11) the warning shows inline on. ctx = { spans } (rafter-span-tables.json).
 */
export function roofChecks(m, ctx = {}) {
  const out = []; const add = (id, severity, msg, step, cite) => out.push({ id, severity, msg, step, cite: cite || null });
  const roof = m.layers.find((l) => l.id === 'roof'); const rp = roof.params; const walls = m.layers.find((l) => l.id === 'walls'); const wp = walls.params;
  const pitch = Number(rp.pitch) || 0; const cov = (rp.roofing && rp.roofing.covering) || 'asphalt_shingle'; const ms = MIN_SLOPE[cov] || MIN_SLOPE.asphalt_shingle;
  const P = fmtPitch(r2(pitch));
  // shape
  if (['hip', 'half_hip', 'dutch_gable', 'saltbox', 'flat'].includes(rp.shape)) add('V-ROOF-08', 'block', `${rp.shape.replace('_', '-')} roofs aren't drawn yet — numbers only. Pick gable or shed.`, 1);
  if (rp.shape === 'shed' && !rp.shed) add('V-GEN-SHED', 'block', 'Pick the high wall and the high/low wall heights for the shed.', 3);
  // covering vs slope
  if (pitch < ms.min - 1e-9) add('V-ROOF-01', 'block', `${ms.label} need at least ${fmtPitch(ms.min)} (IRC ${ms.section}). This roof is ${P}.`, 8, ms.section);
  if (cov === 'asphalt_shingle' && pitch >= 2 && pitch < 4) add('V-ROOF-02', 'warn', `Between 2:12 and 4:12 asphalt shingles need two layers of underlayment (IRC R905.2.2, Table R905.1.1(2)). The takeoff doubles it.`, 8, 'R905.2.2');
  if (/^metal_(panel|standing)/.test(cov)) add('V-ROOF-03', 'warn', 'Check your panel\u2019s minimum slope. The maker can be stricter than code.', 8, 'R905.10.2');
  if (pitch < 2) add('V-ROOF-04', 'info', 'Low-slope roof: make sure the low edge drains away from the house and walkways (IRC R903.4). Snow sits longer.', 3, 'R903.4');
  if (pitch < 3 && rp.shape === 'gable') add('RF-LOWPITCH-01', 'block', 'Under 3:12 the ridge must be a designed beam, not a ridge board (IRC R802.4.4) — engineer.', 5, 'R802.4.4');
  // rafter span vs snow
  const sn = groundSnow(m); const span = rafterSpan(m);
  if (rp.framing !== 'trusses') {
    if (sn.pg == null) add('RF-SNOW-01', 'warn', `We need your site\u2019s ground snow load before checking rafters. Florence: snowload.montana.edu or the Building Codes Bureau (406) 841-2056. Rafters span about ${fmtFtInS(span)} (horizontal).`, 6, 'R301.2.3');
    else if (sn.pg > 70) add('RF-SNOW-02', 'block', 'Over 70 psf ground snow: the roof needs engineering (IRC R301.2.3).', 6, 'R301.2.3');
    else if (ctx.spans) {
      const attached = rp.ceiling !== 'cathedral';
      const ms2 = maxSpan(ctx.spans, { pg: sn.pg, attached, ocIn: rp.rafterOcIn, species: (rp.lumber && rp.lumber.species) || 'Spruce-pine-fir', size: rp.rafterSize });
      if (!ms2 || ms2.spanFt < span) {
        const sug = pickRafter(ctx.spans, { pg: sn.pg, attached, ocIn: rp.rafterOcIn, species: (rp.lumber && rp.lumber.species) || 'Spruce-pine-fir', spanFt: span });
        const sug16 = pickRafter(ctx.spans, { pg: sn.pg, attached, ocIn: 16, species: (rp.lumber && rp.lumber.species) || 'Spruce-pine-fir', spanFt: span });
        add('V-ROOF-05', 'warn', `${rp.rafterSize} @ ${rp.rafterOcIn} in spans ${ms2 ? fmtFtInS(ms2.spanFt) : 'n/a'} for ${sn.pg} psf snow (${ms2 ? ms2.table : 'IRC R802.4.1'}); this roof needs ${fmtFtInS(span)}. ${sug.size ? `Try ${sug.size} @ ${rp.rafterOcIn} in` : sug16.size ? `Try ${sug16.size} @ 16 in` : 'No sawn 2x works: beam, LVL or trusses (engineer)'}. Verify.`, 5, 'R802.4.1');
      } else add('V-ROOF-05', 'info', `${rp.rafterSize} @ ${rp.rafterOcIn} in spans up to ${fmtFtInS(ms2.spanFt)} at ${sn.pg} psf (${ms2.table}); this roof needs ${fmtFtInS(span)}. EXAMPLE check, verify.`, 5, 'R802.4.1');
    }
  } else add('RF-TRUSS', 'info', 'Trusses are engineered and ordered: the app gives the order spec, not sizes.', 5);
  const rl = rafterLength(m);
  if (rl + 0.5 > 20 + 1e-6) add('V-ROOF-06', 'warn', `${fmtFtInS(rl)} rafters are longer than any board in the price list (20 ft) and can't be spliced mid-span without support.`, 5);
  if (sn.pg != null) {
    const sh = pickSheathing(rp.rafterOcIn, Math.max(sn.pg * 0.7, (rp.snow && rp.snow.minRoofSnowPsf) || 30));
    if (sh.engineer) add('RF-SHEATH-01', 'warn', `No standard roof sheathing is rated for that snow at ${rp.rafterOcIn} in o.c. — engineer.`, 6, 'R503.2.1.1(1)');
    else add('RF-SHEATH-01', 'info', `Roof sheathing: ${sh.t} (rated ${sh.capPsf} psf at ${rp.rafterOcIn} in o.c., Table R503.2.1.1(1)).`, 6, 'R503.2.1.1(1)');
    if (sn.strength) add('RF-SNOW-04', 'info', 'Converted the hazard-tool value ×0.7 to ASD for the IRC tables.', 6);
  }
  if ((Number(rp.overhangIn) || 0) > 24) add('RF-TAIL-01', 'warn', 'Overhangs over 24 in on notched rafter tails need design (IRC R802.7.1.1).', 4, 'R802.7.1.1');
  if ((Number(rp.rakeOverhangIn) || 0) > 9) add('RF-RAKE-01', 'info', 'Rake overhang over 9 in needs lookouts or a ladder (IRC R803.2.3).', 4, 'R803.2.3');
  if (ICE_BARRIER_COVERINGS.has(cov)) { const ic = iceCourses(pitch, rp.overhangIn); add('RF-ICE-01', 'info', `Montana requires ice barrier from the eave to 24 in inside the wall: ${ic.courses} course(s) of 36 in membrane with your ${rp.overhangIn} in overhang (${ic.reqIn} in up the slope).`, 8, 'R905.1.2'); }
  if (rp.ceiling === 'cathedral' && rp.ridgeType !== 'beam' && rp.shape === 'gable') add('RF-RIDGE-01', 'warn', 'Vaulted ceiling without ties needs a structural ridge beam supported at both ends (IRC R802.3) — engineer/LVL.', 5, 'R802.3');
  // walls
  const studMax = (h) => h * 12 - 1.5 * ((wp.bottomPlates || 1) + (wp.topPlates || 2));
  const hiPlate = rp.shape === 'shed' && rp.shed ? Math.max(rp.shed.highPlateFt, rp.shed.lowPlateFt) : wp.plateHeightFt;
  if (studMax(hiPlate) > 120) add('V-WALL-01', 'warn', `Studs over 10 ft (${r2(studMax(hiPlate))} in) need extra lateral support or design (IRC Table R602.3(5)).`, 3, 'R602.3(5)');
  if (rp.shape === 'shed' && rp.shed && Math.min(rp.shed.highPlateFt, rp.shed.lowPlateFt) < 7) add('RF-HEAD-01', 'warn', `The low wall is ${fmtFtInS(Math.min(rp.shed.highPlateFt, rp.shed.lowPlateFt))}: check ceiling height for a habitable room (IRC R305.1: 7 ft over most of the room).`, 3, 'R305.1');
  if (rp.shape === 'shed' && rp.shed && rp.shed.highPlateFt <= rp.shed.lowPlateFt) add('V-GEN-SHED', 'block', 'The high wall must be taller than the low wall.', 3);
  // ventilation (R806.2)
  if (/^vented/.test((rp.vent || {}).strategy || 'vented') && rp.ceiling !== 'cathedral') {
    const b = bb(m.footprint); const req = r2(b.w * b.h * 144 / ((rp.vent || {}).ratio === '1/300' ? 300 : 150));
    add('RF-VENT-01', 'info', `Attic vent needed: about ${Math.round(req)} sq in net free area (${(rp.vent || {}).ratio || '1/150'} of the ceiling, IRC R806.2), split low/high.`, 7, 'R806.2');
    if (rp.shape === 'gable' && (roof.params.computed || {}).rise >= 2.5) add('RF-ATTIC-01', 'info', 'Attic is 30 in or taller: add a 22×30 in attic access (IRC R807.1).', 7, 'R807.1');
  }
  if (rp.shape === 'shed' && /^vented/.test((rp.vent || {}).strategy || '') && rp.ceiling === 'flat_attic') add('RF-VENT-02', 'info', 'A shed roof has no ridge: vent with soffit vents low and a high-side vent strip.', 7, 'R806.2');
  // tie-in
  const ti = tieInInfo(m); const H = houseOf(m);
  if (m.attachToExistingWallId) {
    add('RF-ENG-01', 'warn', 'Building against the house (ledger, flashing, tying in) is a permit and engineer trigger.', 2);
    const R = ti.house || {};
    if (ti.assumed && ti.assumed.pitch) add('RF-TIE-04', 'warn', `House roof pitch is ASSUMED ${fmtPitch(R.pitch)}. Measure it: tie-in heights and valleys depend on it.`, 2);
    const t = rp.tieIn || {};
    if (t.bearingAtHouse === 'ledger' && t.manufacturerApproval !== 'yes' && ['hud_manufactured', 'state_modular', 'unknown'].includes(R.homeType || 'unknown'))
      add('RF-LEDGER-01', 'block', 'A ledger on the house needs the manufacturer\u2019s written OK (or an engineer): HUD 24 CFR 3282.8(j)(1) and 3285.903(c) require add-ons to be structurally independent. Default: a new bearing wall next to the house.', 2, 'HUD_3282.8j');
    if (t.framing === 'cut_in' && R.framing === 'trusses') add('RF-TIE-06', 'block', 'Cutting trusses needs a truss engineer\u2019s repair letter (IRC R802.7.2).', 9, 'R802.7.2');
    if ((t.framing === 'california_overlay' && ti.type === 'gable_into_roof') || ti.type === 'shed_into_roof_plane') add('RF-TIE-05', 'warn', 'This puts new framing and valley snow on your house roof. With a modular/manufactured home, get the manufacturer\u2019s or an engineer\u2019s OK (HUD 24 CFR 3282.8(j), 3285.903(c), 3280.305).', 9, 'HUD_3282.8j');
    if (rp.shape === 'shed' && ti.type === 'shed_under_eave') {
      add('RF-SNOW-03', 'warn', 'Your new roof sits below the house roof: snow slides and drifts onto it. The IRC tables don\u2019t include that load — have an engineer size it.', 6, 'ASCE7_drift');
      const eaveAssumed = ti.assumed && ti.assumed.eaveUndersideFt;
      if (ti.fits === false) {
        const fix = ti.maxHighPlateFt != null ? ` Options: lower the high wall to ${fmtFtInS(ti.maxHighPlateFt)} (${ti.maxPitch > 0 ? fmtPitch(r2(ti.maxPitch)) : 'no slope left'}), step the floor down, tie into the roof slope, or switch to a gable tie-in.` : ' Options: step the floor down, tie into the roof slope, or a gable tie-in.';
        add('RF-TIE-01', eaveAssumed ? 'block' : 'warn', `${eaveAssumed ? `Using the ASSUMED ${fmtFtInS(R.eaveUndersideFt)} house eave, t` : 'T'}he roof at the house wall (${fmtFtInS(ti.roofTopAtHouseFt)} above the floor) would hit the eave by ${fmtFtInS(ti.shortByFt)}: it needs the eave underside at ${fmtFtInS(ti.eaveNeededFt)} or more (${ti.flashingClearIn} in flashing room).${fix}${eaveAssumed ? ' Measure your eave height to go on.' : ''}`, 2);
      } else if (eaveAssumed) add('RF-TIE-01', 'block', `House eave height is ASSUMED ${fmtFtInS(R.eaveUndersideFt)}. Measure it (floor to the underside of the eave at the wall) before the shed can be tied to the house.`, 2);
      else add('RF-TIE-01', 'info', `Fits under the house eave: roof top at the house ${fmtFtInS(ti.roofTopAtHouseFt)} ≤ ${fmtFtInS(ti.zHiMaxFt)}.`, 2);
      if (ti.lowAtHouse) add('RF-DRAIN-01', 'warn', 'Water would run toward the house wall. Put the high side at the house (slope away) or add a cricket.', 3);
    }
    if (ti.type === 'shed_into_roof_plane' && ti.tieDistUpSlopeFt != null && R.ridgeDistFt != null && ti.tieDistUpSlopeFt >= R.ridgeDistFt - 1) add('RF-TIE-02', 'block', 'The new roof would reach the house ridge. Lower the pitch or make the addition narrower.', 2);
    if (ti.type === 'gable_into_roof' && ti.pastRidge) add('RF-TIE-02', 'block', 'The new ridge would reach the house ridge. Lower the pitch, hip the back, or make the addition narrower.', 2);
    if (ti.type === 'extend_plane' && ti.zAtOuterWallFt != null && ti.zAtOuterWallFt < 7) add('RF-TIE-03', 'block', `Extending the house slope would leave the outer wall ${fmtFtInS(ti.zAtOuterWallFt)} tall. Not usable; break the pitch or use a gable.`, 2);
    if (ti.type === 'gable_into_roof' && rp.shape === 'gable') {
      add('RF-VALLEY-02', 'info', `Valleys: ${ti.valleys} × about ${fmtFtInS(ti.valleyTrueFt)} long. Lined with 36 in self-adhered membrane; keep skylights and vents out of them.`, 9, 'R905.2.8.2');
      if (pitch < 3) add('RF-LOWPITCH-01', 'block', 'Under 3:12 valleys must be designed beams (IRC R802.4.4).', 9, 'R802.4.4');
    }
  }
  const v = rp.valleys || {};
  if (v.type === 'open_metal' && (Number(v.metalWidthIn) || 0) < 24) add('RF-VALLEY-01', 'warn', 'Open metal valleys need 24 in wide metal (IRC R905.2.8.2); HD stock W-valley is 18 in.', 9, 'R905.2.8.2');
  if (v.type === 'woven' && cov === 'asphalt_shingle' && (rp.roofing || {}).shingleVariant !== 'three_tab') add('RF-VALLEY-03', 'warn', 'Many architectural shingles don\u2019t allow woven valleys. Check the shingle maker (UNVERIFIED per product).', 9);
  if (snowGuardsOn(rp)) add('RF-GUARD-01', 'info', 'Snow guards added over the eave (metal sheds snow suddenly).', 10);
  return out;
}
export const snowGuardsOn = (rp) => { const g = rp.snowGuards || {}; if (g.enabled === true) return true; if (g.enabled === false) return false; return /^metal_/.test((rp.roofing || {}).covering || ''); };
export const worst = (checks) => (checks.some((c) => c.severity === 'block') ? 'block' : checks.some((c) => c.severity === 'warn') ? 'warn' : 'ok');
