// roofing-v1 reference calculator (NOT app code). Pure functions, feet unless noted.
// Run: node run-worked-example.mjs   -> writes ../worked-example-20x16.json
// Conventions match content-v3 (waste, stock lengths, buy rules). All $ are EXAMPLE.
import { readFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
export const SPANS = JSON.parse(readFileSync(new URL('../rafter-span-tables.json', here)));

export const LUMBER_DEPTH_IN = { '2x4': 3.5, '2x6': 5.5, '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 };
export const SIZES = ['2x4', '2x6', '2x8', '2x10', '2x12'];
export const r2 = (x) => Math.round(x * 100) / 100;
export const ftIn = (ft) => { const s = ft < 0 ? '-' : ''; ft = Math.abs(ft); let f = Math.floor(ft); let i = Math.round((ft - f) * 12 * 4) / 4; if (i >= 12) { f++; i -= 12; } return `${s}${f}'-${i}"`; };

// ---------- pitch ----------
export const slopeK = (p) => Math.sqrt(1 + (p / 12) ** 2);          // common-rafter factor (true/plan)
export const hipValleyK = (p) => Math.sqrt(2 + (p / 12) ** 2);      // equal-pitch hip/valley: true length per ft of COMMON run
export const pitchFromDegrees = (deg) => 12 * Math.tan(deg * Math.PI / 180);
export const degreesFromPitch = (p) => Math.atan(p / 12) * 180 / Math.PI;
export const pitchFromHeights = (highFt, lowFt, runFt) => 12 * (highFt - lowFt) / runFt; // same reference line (e.g. top of plates)

// ---------- rafter seat / heel ----------
// HAP = plumb height from top of plate to top of rafter at the OUTSIDE face of the wall.
// Bottom edge of rafter crosses plate level at the inside end of the seat cut (seat length s).
export function heel(size, pitch, seatIn = 3.5) {
  const d = LUMBER_DEPTH_IN[size], c = Math.cos(Math.atan(pitch / 12)), t = pitch / 12, sn = Math.sin(Math.atan(pitch / 12));
  const hapIn = d / c - seatIn * t;
  const notchPerpIn = seatIn * sn;          // depth of birdsmouth measured square to the rafter
  const remainPerpIn = hapIn * c;           // uncut depth square to rafter at outside face
  const warnings = [];
  if (seatIn < 1.5) warnings.push('ROOF_SEAT_LT_1_5IN (IRC R802.6: 1-1/2 in bearing on wood)');
  if (notchPerpIn > d / 4) warnings.push('ROOF_BIRDSMOUTH_DEEP (notch > 1/4 depth; R802.7.1 -> R502.8.1)');
  if (remainPerpIn < 3.5) warnings.push('ROOF_TAIL_LT_3_5IN (R802.7.1.1)');
  return { hapIn: r2(hapIn), notchPerpIn: r2(notchPerpIn), remainPerpIn: r2(remainPerpIn), plumbCutIn: r2(d / c), warnings };
}

// ---------- span tables ----------
const parseFtIn = (s) => { const [f, i] = s.split('-').map(Number); return f + (i || 0) / 12; };
export function snowTableKey(pgAsd) {
  if (pgAsd > 70) return null;                       // R301.2.3 -> engineered
  const g = pgAsd <= 20 ? 20 : pgAsd <= 30 ? 30 : pgAsd <= 50 ? 50 : 70; // round UP to next table
  return g;
}
export function maxSpan({ pgAsd, attached = false, ocIn = 24, species = 'Spruce-pine-fir', grade = '#2', size, deadPsf = 10 }) {
  const g = snowTableKey(pgAsd); if (g == null) return null;
  const tname = SPANS.table_index[`${g}_${attached ? 'attached' : 'notAttached'}`];
  const row = SPANS.tables[tname].rows[`${ocIn}|${species}|${grade}`]; if (!row) return null;
  const idx = SIZES.indexOf(size) + (deadPsf > 10 ? 5 : 0);
  const v = row[idx]; if (!v || v === '—' || v === '-') return null;
  return { table: tname, spanFt: r2(parseFtIn(v)), raw: v, tableSnow: g };
}
export function pickRafter({ spanFt, pgAsd, attached, ocIn, species, deadPsf }) {
  for (const size of ['2x6', '2x8', '2x10', '2x12']) {
    const m = maxSpan({ pgAsd, attached, ocIn, species, size, deadPsf });
    if (m && m.spanFt >= spanFt) return { size, ...m };
  }
  return { size: null, note: 'No sawn 2x rafter in IRC tables works -> reduce spacing, add a beam/purlin, use LVL/I-joist or trusses (engineered).' };
}

// ---------- sheathing (Table R503.2.1.1(1), allowable live load) ----------
export function pickSheathing(ocIn, snowPsf) {
  const opts = [ { t: '7/16', rating: '24/16', at16: 100, at24: 40 }, { t: '15/32', rating: '32/16', at16: 180, at24: 70 }, { t: '19/32', rating: '40/20', at16: 305, at24: 130 } ];
  for (const o of opts) { const cap = ocIn <= 16 ? o.at16 : o.at24; if (cap >= snowPsf) return { thickness: o.t, spanRating: o.rating, allowableLivePsf: cap, edgeSupport: 'H-clips (one per span between supports) or blocking' }; }
  return { thickness: '23/32', spanRating: '48/24', note: 'engineer' };
}

// ---------- ice barrier (Montana R905.1.2) ----------
export function iceBarrier({ eaveLf, overhangIn, pitch, wallThkIn = 0, rollWidthIn = 36, lapIn = 3 }) {
  // eave edge to >= 24 in inside the exterior wall line, measured along slope (conservative reading)
  let reqHorizIn = overhangIn + 24; // exterior wall line = outside face; wallThk not added (UNVERIFIED reading)
  let reqSlopeIn = reqHorizIn * slopeK(pitch);
  if (pitch >= 8) reqSlopeIn = Math.max(reqSlopeIn, 36);
  const courses = reqSlopeIn <= rollWidthIn ? 1 : 1 + Math.ceil((reqSlopeIn - rollWidthIn) / (rollWidthIn - lapIn));
  return { reqSlopeIn: r2(reqSlopeIn), courses, sf: r2(eaveLf * courses * rollWidthIn / 12) };
}

// ---------- stock lumber (content-v3 rule) ----------
export const STOCK = [8, 10, 12, 14, 16, 20];
export function stockFor(L) { if (L <= 20) return [{ len: STOCK.find((s) => s >= L - 1e-6), n: 1 }]; const n = Math.ceil(L / 16); return [{ len: STOCK.find((s) => s >= L / n - 1e-6), n }]; }
export const buyCount = (n, w) => n + Math.round(n * w);
export const buyArea = (q, w, unit) => Math.ceil(q * (1 + w) / unit - 1e-9);

// ---------- shed tie-in ----------
// Heights are TOP OF ROOF SHEATHING above the ADDITION finished floor. run = house wall face -> outer wall face (plan).
export function shedUnderEave({ eaveUndersideFt, floorDropFt = 0, flashClearIn = 5, lowPlateFt, runFt, size, seatIn = 3.5, sheathIn = 0.59, foamAboveIn = 0 }) {
  const zHiMax = eaveUndersideFt + floorDropFt - flashClearIn / 12;   // highest new roof surface at the house wall
  // iterate: HAP depends on pitch
  let p = 1; for (let k = 0; k < 20; k++) { const h = heel(size, Math.max(p, 0.01)); const zLow = lowPlateFt + (h.hapIn + sheathIn + foamAboveIn) / 12; p = 12 * (zHiMax - zLow) / runFt; }
  const h = heel(size, Math.max(p, 0.01));
  const zLow = lowPlateFt + (h.hapIn + sheathIn + foamAboveIn) / 12;
  return { zHiMaxFt: r2(zHiMax), zLowFt: r2(zLow), pitch: r2(p), degrees: r2(degreesFromPitch(Math.max(p, 0))), feasible: p > 0, heel: h };
}
// shed whose plane is carried UP onto the existing roof (existing eave cut back): where do the planes meet?
export function shedIntoRoofPlane({ zExistAtWallFt, existPitch, newPitch, zLowFt, runFt }) {
  // new plane at house wall face: zLow + run*pn/12 ; existing plane at distance a up-slope: zE + a*pe/12 ; new plane there: zLow + (run+a)*pn/12
  const zNewAtWall = zLowFt + runFt * newPitch / 12;
  const a = (zNewAtWall - zExistAtWallFt) / ((existPitch - newPitch) / 12);
  return { tieDistUpSlopeFt: r2(a), tieHeightFt: r2(zExistAtWallFt + a * existPitch / 12), zNewAtWallFt: r2(zNewAtWall) };
}
// extend the existing plane straight down over the addition
export function extendPlane({ zExistAtWallFt, existPitch, runFt }) { return { zAtOuterWallFt: r2(zExistAtWallFt - runFt * existPitch / 12) }; }

// ---------- gable (ridge perpendicular to house) tied into existing roof ----------
// u = plan distance in from an addition side-wall face; a = plan distance up the existing slope from the house wall face (negative = over the addition)
export function gableTieIn({ widthFt, depthFt, newPitch, existPitch, zNewEaveLineFt, zExistAtWallFt, eaveOhFt, rakeOhFt, existOhFt, existRidgeDistFt }) {
  const half = widthFt / 2, pn = newPitch / 12, pe = existPitch / 12;
  const rise = half * pn;
  const zRidge = zNewEaveLineFt + rise;                                   // top of sheathing at ridge line
  const aTip = (zRidge - zExistAtWallFt) / pe;                            // ridge meets existing roof
  const aAt = (u) => (zNewEaveLineFt + u * pn - zExistAtWallFt) / pe;     // valley line a(u)
  const uStart = Math.max(-eaveOhFt, (pe * (-existOhFt) + zExistAtWallFt - zNewEaveLineFt) / pn); // valley foot: new eave edge or existing eave edge, whichever governs
  const aStart = aAt(uStart);
  const planLen = Math.hypot(half - uStart, aTip - aStart);
  const trueLen = Math.hypot(planLen, (half - uStart) * pn);
  const planAngleDeg = Math.atan2(aTip - aStart, half - uStart) * 180 / Math.PI; // 45 when pitches & heights match
  const warnings = [];
  if (existRidgeDistFt != null && aTip > existRidgeDistFt - 1) warnings.push('ROOF_TIE_PAST_EXIST_RIDGE: new ridge reaches within 1 ft of (or over) the existing ridge - lower pitch, narrower addition, or hip the back');
  if (aTip < 0) warnings.push('ROOF_NEW_RIDGE_BELOW_EXIST_EAVE: new ridge is below the existing roof at the wall - no valleys; becomes a gable butting the wall under the eave (needs headwall/cricket)');
  return { riseFt: r2(rise), zRidgeFt: r2(zRidge), tieDistUpSlopeFt: r2(aTip), valleyFoot: { u: r2(uStart), a: r2(aStart) }, valleyPlanFt: r2(planLen), valleyTrueFt: r2(trueLen), valleyPlanAngleDeg: r2(planAngleDeg), overlayTrianglePlanSf: r2(0.5 * widthFt * Math.max(0, aTip)), warnings };
}
