// ============================================================================
// roof-takeoff.js — v4 full roof takeoff from Remodel Guide's roofing-v1 (roofing-takeoff-rules.json items,
// roofing-price-items.json refs merged into the content-v4 price doc). Applied on top of the content-v4
// reference engine's result:
//   • shed roofs ALWAYS (the reference engine only knows gables), plus the shed's wall changes
//     (taller precut studs on the high/rake walls, rake top plates, no gable-end triangles);
//   • gable roofs when roof.params.takeoffV4 is on (Roof steps → Review → "Use the full roof takeoff").
// Default gable plans keep the content-v4 engine + roofing fixes, so their totals don't move.
// Items whose price is null in roofing-price-items.json stay as "needs a price" lines (never guessed).
// ============================================================================
import { slopeK, pickSheathing, iceCourses, groundSnow, rafterLength, tieInInfo, snowGuardsOn, shedFrame, edgeSide, wallEdge, ICE_BARRIER_COVERINGS, fmtPitch, coveringLabel, r2 } from './roof-calc.js';

const STOCK = [8, 10, 12, 14, 16, 20];
const IN = 1 / 12;
const LUMBER_LEN = (P, size, L) => {
  // smallest priced stock >= L; > 20 ft → n pieces of L/n (rules.defaults.stock)
  const n = L <= 20 + 1e-6 ? 1 : Math.ceil(L / 16); const each = L / n;
  for (const s of STOCK) if (s >= each - 1e-6 && P[`lumber_${size}_${s}`] && P[`lumber_${size}_${s}`].price != null) return { ref: `lumber_${size}_${s}`, len: s, n };
  const s = STOCK.find((x) => x >= each - 1e-6) || 20; return { ref: `lumber_${size}_${s}`, len: s, n };
};
const SIZE_UP = { '2x6': '2x8', '2x8': '2x10', '2x10': '2x12', '2x12': '2x12' };
const waste = (n, w = 0.1) => n + Math.round(n * w);

/** Engine-shaped line priced from P (bulk rule as the engine). */
function mkLine(P, id, layer, ref, qtyCalc, unit, buy, desc, note) {
  const p = ref ? P[ref] : null;
  const u = !p || p.price == null ? null : (p.bulk_price && buy >= p.bulk_price.min_qty ? p.bulk_price.price : p.price);
  const needs = !p || p.price == null;
  return { id, layer, price_ref: ref, qty_calc: r2(qtyCalc), unit, buy, unit_price: u, ext: u == null ? null : r2(u * buy), verified: !!(p && p.verified && !needs),
    desc: needs ? `${desc} — needs a price` : desc, note: note || (needs ? `PRICE NEEDED: ${p ? p.name : ref} has no Home Depot price (roofing-price-items.json)` : null), v4: true };
}

/** Roof measures for gable or shed (plan + sloped area, eave/rake/ridge lf). */
export function roofMeasures(m) {
  const roof = m.layers.find((l) => l.id === 'roof'); const rp = roof.params; const c = rp.computed || {};
  const xs = m.footprint.map((p) => p[0]), ys = m.footprint.map((p) => p[1]); const W0 = Math.max(...xs) - Math.min(...xs), H0 = Math.max(...ys) - Math.min(...ys);
  const oh = (Number(rp.overhangIn) || 0) * IN; const p = Number(rp.pitch) || 0; const k = slopeK(p);
  const rafters = roof.objects.filter((o) => o.type === 'rafter');
  if (c.shed) {
    const run = c.runFt; const L = c.shedAxis === 'y' ? W0 : H0; const ohr = (Number(rp.rakeOverhangIn) || 0) * IN;
    const planA = (run + 2 * oh) * (L + 2 * ohr); const slopeRun = (run + 2 * oh) * k;
    return { shape: 'shed', run, L, oh, ohr, k, p, planArea: r2(planA), slopedArea: r2(planA * k), eaveLf: r2(L + 2 * ohr), highEdgeLf: r2(L + 2 * ohr), rakeLf: r2(2 * slopeRun), ridgeLf: 0, slopeRun: r2(slopeRun),
      commons: rafters.filter((r) => r.props.role !== 'barge').length, barges: rafters.filter((r) => r.props.role === 'barge').length, rafterLen: r2(rafterLength(m)), slopes: 1 };
  }
  const span = c.ridgeAlongX ? H0 : W0; const L = c.ridgeAlongX ? W0 : H0; const ohr = oh; // gable: rake = eave overhang in v1 geometry
  const planA = (span + 2 * oh) * (L + 2 * ohr); const half = (span / 2 + oh) * k;
  const stations = rafters.length / 2;
  return { shape: 'gable', run: span / 2, span, L, oh, ohr, k, p, planArea: r2(planA), slopedArea: r2(planA * k), eaveLf: r2(2 * (L + 2 * ohr)), rakeLf: r2(4 * half), ridgeLf: r2(L + 2 * ohr), slopeRun: r2(half),
    commons: Math.max(0, rafters.length - 4), barges: Math.min(4, rafters.length), rafterLen: r2(rafterLength(m)), slopes: 2, pairs: stations };
}

/**
 * Full v1 roof takeoff → { lines (engine format, layer 'roof' / 'walls'), sheets, sheathRef, info }.
 * P = prices.prices (content-v4 + roofing-v1 merged). spans = rafter-span-tables.json (optional).
 */
export function roofTakeoffV1(m, P, opts = {}) {
  const roof = m.layers.find((l) => l.id === 'roof'); const rp = roof.params; const M = roofMeasures(m); const lines = [];
  const add = (...a) => { const l = mkLine(P, ...a); lines.push(l); return l; };
  const cov = (rp.roofing && rp.roofing.covering) || 'asphalt_shingle'; const shingly = ICE_BARRIER_COVERINGS.has(cov);
  const size = rp.rafterSize; const oc = Number(rp.rafterOcIn) || 24; const trusses = rp.framing === 'trusses';
  const sn = groundSnow(m); const ti = tieInInfo(m); const tied = ti.type !== 'none';
  const keepEngineFraming = M.shape === 'gable' && !trusses; // gable framing stays the content-v4 engine's (same rules)
  // ---------- framing
  if (trusses) {
    const n = Math.floor(M.L * 12 / oc) + 1;
    add('roof.trusses', 'roof', 'roof_truss_custom', n + 2, 'each', n + 2, `Engineered trusses: ${n} commons + 2 gable-end (span ${r2(M.shape === 'shed' ? M.run : M.span)} ft, ${fmtPitch(M.p)}, ${oc} in o.c.)`, 'Order from a truss maker with: span, pitch, heel, overhang, ground snow, ceiling, spacing. Quote only.');
  } else if (!keepEngineFraming) {
    const st = LUMBER_LEN(P, size, M.rafterLen);
    add('roof.rafters', 'roof', st.ref, M.commons * st.n, 'each', waste(M.commons * st.n), `Rafters ${size} @ ${oc} in, ${M.commons} commons, each ${r2(M.rafterLen)} ft low eave → high eave (${fmtPitch(M.p)}, ${rp.overhangIn} in overhangs) (${size} x ${st.len} ft${st.n > 1 ? `, ${st.n} pieces each` : ''})`);
    add('roof.barge', 'roof', st.ref, M.barges * st.n, 'each', M.barges * st.n, `Barge (fly) rafters ${size}, ${M.barges} (${size} x ${st.len} ft)`);
    if (rp.ceiling === 'flat_attic') {
      const cj = LUMBER_LEN(P, '2x8', M.run);
      add('roof.ceilingJoists', 'roof', cj.ref, (M.commons + M.barges) * cj.n, 'each', waste((M.commons + M.barges) * cj.n), `Ceiling joists 2x8 @ ${oc} in under the shed, ${r2(M.run)} ft EXAMPLE — verify (IRC R802.5) (2x8 x ${cj.len} ft)`);
    }
    const ties = (M.commons + M.barges) * 2;
    add('roof.hurricaneTies', 'roof', 'hurricane_h25a', ties, 'each', ties, `H2.5A hurricane ties (${ties}: both ends of every rafter on a shed)`);
    add('roof.hurricaneTies', 'roof', 'nails_connector_n8_150', ties * 10, 'nails', Math.ceil(ties * 10 / 150), 'Connector nails N8 0.131 x 1-1/2 (10 per tie)');
    if ((Number(rp.rakeOverhangIn) || 0) > 9) { const n = Math.ceil(M.rakeLf / (oc / 12)); add('roof.lookouts', 'roof', 'lumber_2x4_8', n, 'each', Math.ceil(n / 4), `Rake lookouts 2x4 x 2 ft (${n}; rake overhang over 9 in, IRC R803.2.3)`); }
  }
  if (tied && (rp.tieIn || {}).bearingAtHouse === 'ledger' && (rp.tieIn || {}).manufacturerApproval === 'yes') add('roof.ledger', 'roof', 'ledgerlok_5_50', Math.ceil(M.L * 12 / 16) * 2, 'each', Math.ceil(Math.ceil(M.L * 12 / 16) * 2 / 50), `LedgerLOK 5 in screws, 2 per 16 in along ${r2(M.L)} ft (manufacturer-approved ledger)`);
  if (tied && ((rp.tieIn || {}).bearingAtHouse || 'freestanding_wall') === 'freestanding_wall' && !trusses) {
    const studs = Math.ceil(M.L * 12 / 16) + 1; const pl = LUMBER_LEN(P, '2x6', M.L);
    add('roof.bearingAtHouse', 'walls', 'lumber_2x6_stud116', studs, 'each', waste(studs), `New bearing wall next to the house (${r2(M.L)} ft): ${studs} studs @ 16 in, EXAMPLE height — not in the model`, 'roofing-v1 default: the addition carries its own roof (HUD 24 CFR 3282.8(j), 3285.903(c)).');
    add('roof.bearingAtHouse', 'walls', pl.ref, 3 * pl.n, 'each', 3 * pl.n, `Plates for the bearing wall next to the house (1 bottom + 2 top, 2x6 x ${pl.len} ft)`);
  }
  // ---------- tie-in framing (gable into the house roof)
  if (ti.type === 'gable_into_roof' && ti.valleyTrueFt) {
    const vl = 2 * ti.valleyTrueFt;
    if ((rp.tieIn || {}).framing === 'california_overlay') { const vb = LUMBER_LEN(P, '2x10', ti.valleyTrueFt + 0.5); add('roof.valleyBoards', 'roof', vb.ref, 2 * vb.n, 'each', 2 * vb.n, `Valley boards 2x10 laid flat on the house roof (2 x ${r2(ti.valleyTrueFt + 0.5)} ft)`); }
    else { const sz = SIZE_UP[size]; const vr = LUMBER_LEN(P, sz, ti.valleyTrueFt + 1); add('roof.valleyRafters', 'roof', vr.ref, 2 * vr.n, 'each', 2 * vr.n, `Valley rafters ${sz} (2 x ${r2(ti.valleyTrueFt + 1)} ft)`); }
    M.valleyLf = r2(vl);
  }
  // ---------- sheathing
  const snowForSheath = sn.pg == null ? null : Math.max(sn.pg * 0.7, (rp.snow && rp.snow.minRoofSnowPsf) || 30);
  const sh = snowForSheath == null ? (oc > 16 ? { t: '19/32', ref: 'osb_1932_4x8' } : { t: '7/16', ref: 'osb_716_4x8' }) : pickSheathing(oc, snowForSheath);
  const shRef = (rp.sheathing && rp.sheathing.thickness && rp.sheathing.thickness !== 'auto') ? ({ '7/16': 'osb_716_4x8', '15/32': 'ply_1532_4x8', '19/32': 'osb_1932_4x8', '5/8_zip': 'zip_roof_58_4x8' }[rp.sheathing.thickness] || sh.ref) : (sh.ref || 'osb_1932_4x8');
  const sheets = Math.ceil(M.slopedArea * 1.10 / 32);
  add('roof.sheathing', 'roof', shRef, M.slopedArea, 'sq ft', sheets, `Roof sheathing ${(P[shRef] || {}).name ? P[shRef].name.replace(/^(Blue Ribbon|Plytanium|Huber)\s*/, '').replace(/\s*\(.*$/, '') : shRef}: ${M.slopedArea} sq ft sloped (${M.planArea} plan x ${r2(M.k)}) +10%`, sh.capPsf ? `${sh.t} rated ${sh.capPsf} psf at ${oc} in o.c. (IRC Table R503.2.1.1(1))` : `${sh.t} at ${oc} in o.c. (ground snow not entered; Montana default)`);
  if ((rp.sheathing || {}).edgeSupport !== 'blocking' && oc > 16) {
    const clipRef = shRef === 'osb_716_4x8' ? 'h_clip_716_50' : 'h_clip_1932'; const n = sheets * 2;
    add('roof.hClips', 'roof', clipRef, n, 'each', Math.ceil(n / 50), `H-clips (${n}, 2 per sheet at ${oc} in o.c.)`);
  }
  // ---------- underlayment / ice barrier
  const membrane = ['modified_bitumen', 'single_ply', 'built_up', 'liquid_applied'].includes(cov);
  if (!membrane) {
    const dbl = cov === 'asphalt_shingle' && M.p >= 2 && M.p < 4;
    const rolls = Math.ceil(M.slopedArea * 1.10 * (dbl ? 2 : 1) / 1000);
    add('roof.underlayment', 'roof', 'underlayment_synth_1000', M.slopedArea * (dbl ? 2 : 1), 'sq ft', rolls, `Synthetic underlayment${dbl ? `, DOUBLE layer (${fmtPitch(M.p)} is from 2:12 up to 4:12, IRC R905.2.2)` : ''}: ${M.slopedArea} sq ft +10%`);
  }
  const iceOn = opts.iceBarrier !== false && (shingly || /^metal_/.test(cov));
  let ice = null;
  if (iceOn) {
    const c = iceCourses(M.p, rp.overhangIn); const valley = M.valleyLf || 0; const side = ti.type === 'shed_under_eave' && ti.highAtHouse ? M.highEdgeLf : 0;
    const sf = M.eaveLf * c.courses * 3 + valley * 3 + side * 3; const rolls = Math.ceil(sf * 1.10 / 150);
    ice = add('roof.iceBarrier', 'roof', 'ice_water_150', sf, 'sq ft', rolls, `Ice & water barrier: eaves ${M.eaveLf} lf x ${c.courses} course(s)${valley ? ` + valleys ${valley} lf` : ''}${side ? ` + house wall ${side} lf` : ''} x 3 ft, +10% (reaches ${c.reqIn} in up the slope)`, 'IRC R905.1.2 (Montana): eave to 24 in inside the exterior wall; 36 in lining in valleys (R905.2.8.2).');
  }
  // ---------- covering
  const squares = r2(M.slopedArea / 100);
  if (cov === 'asphalt_shingle') {
    const w = ti.type === 'gable_into_roof' ? 0.15 : 0.10; const extraSq = (M.valleyLf || 0) * 2 / 100;
    add('roof.shingles', 'roof', 'shingles_bundle', squares + extraSq, 'squares', Math.ceil((squares + extraSq) * (1 + w) * 3), `Shingles: ${r2(squares + extraSq)} sq +${Math.round(w * 100)}% x 3 bundles/sq${extraSq ? ' (incl. house-side valley reroof strip)' : ''}`);
    const starterLf = M.eaveLf + M.rakeLf; add('roof.starter', 'roof', 'starter_bundle', starterLf, 'lf', Math.ceil(starterLf * 1.10 / 120), `Starter strip (${r2(starterLf)} lf eaves + rakes)`);
    if (M.ridgeLf) add('roof.ridgeCap', 'roof', 'ridge_cap_bundle', M.ridgeLf, 'lf', Math.ceil(M.ridgeLf * 1.10 / 25), `Ridge cap (${M.ridgeLf} lf)`);
    add('roof.nails', 'roof', 'roofing_nails_5lb', squares * 1.15 * 2.5, 'lb', Math.ceil(squares * 1.15 * 2.5 / 5), `Roofing nails 1-1/4 in (${r2(squares * 1.15 * 2.5)} lb)`);
  } else if (cov === 'metal_panel_lapped' || cov === 'metal_panel_lapped_sealant') {
    const panelLen = M.slopeRun + 2 / 12; const ref = [8, 10, 12, 16].map((l) => ({ l, ref: `metal_smrib_3x${l}` })).find((x) => x.l >= panelLen) || { l: 16, ref: 'metal_smrib_3x16' };
    const per = Math.ceil((M.L + 2 * M.ohr) / 3) * (panelLen > 16 ? Math.ceil(panelLen / 16) : 1); const n = per * M.slopes;
    add('roof.metalPanels', 'roof', ref.ref, n, 'panels', n, `SM-Rib metal panels 3 ft coverage (UNVERIFIED) x ${ref.l} ft, ${per} per slope`);
    add('roof.metalScrews', 'roof', 'metal_screw_120', squares * 80, 'screws', Math.ceil(squares * 80 / 120), `Panel screws ~80 per square (UNVERIFIED) (${Math.round(squares * 80)})`);
    if (M.ridgeLf) add('roof.ridgeCap', 'roof', null, M.ridgeLf, 'lf', 0, `Metal ridge cap (${M.ridgeLf} lf)`);
  } else if (cov === 'metal_standing_seam') {
    add('roof.metalPanels', 'roof', 'standing_seam_panel', M.slopedArea, 'sq ft', Math.ceil(M.slopedArea * 1.1), `Standing-seam panels (${M.slopedArea} sq ft)`);
  } else if (cov === 'modified_bitumen') {
    const rolls = Math.ceil(M.slopedArea * 1.12 * 1.05 / 100);
    add('roof.membrane', 'roof', 'modbit_sa_cap_100', M.slopedArea, 'sq ft', rolls, `SBS self-adhered cap sheet (${M.slopedArea} sq ft +12% laps +5%)`);
    add('roof.membrane', 'roof', 'modbit_sa_base_100', M.slopedArea, 'sq ft', rolls, 'SBS self-adhered base sheet');
  } else if (cov === 'single_ply') {
    const tpo = ((rp.roofing || {}).singlePlyType || 'tpo') === 'tpo'; const ref = tpo ? 'tpo_6x50' : 'epdm_10x25'; const sf = tpo ? 300 : 250;
    add('roof.membrane', 'roof', ref, M.slopedArea, 'sq ft', Math.ceil(M.slopedArea * 1.12 * 1.05 / sf), `${tpo ? 'TPO' : 'EPDM'} membrane (${M.slopedArea} sq ft +12% +5%)`);
    add('roof.termBar', 'roof', 'termination_bar_10', M.eaveLf + M.rakeLf, 'lf', Math.ceil((M.eaveLf + M.rakeLf) / 10), 'Termination bar at the edges');
  } else if (cov === 'roll_roofing') {
    add('roof.membrane', 'roof', 'roll_roofing_mineral', M.slopedArea, 'sq ft', Math.ceil(M.slopedArea * 1.12 * 1.05 / 100), `Mineral roll roofing (${M.slopedArea} sq ft +12% +5%)`);
  } else {
    add('roof.covering', 'roof', null, squares, 'squares', Math.ceil(squares * 1.1), `${coveringLabel(cov)} (${squares} squares)`);
  }
  if (!membrane) add('roof.capNails', 'roof', 'cap_nails_2000', squares * 150, 'nails', Math.ceil(squares * 150 / 2000), `Cap nails for underlayment (~${Math.round(squares * 150)})`);
  // ---------- edges, flashing, vents
  const dripLf = M.eaveLf + M.rakeLf + (M.shape === 'shed' && !(ti.type === 'shed_under_eave' && ti.highAtHouse) ? M.highEdgeLf : 0);
  add('roof.dripEdge', 'roof', 'drip_edge_10', dripLf, 'lf', Math.ceil(dripLf * 1.10 / 10), `Drip edge (${r2(dripLf)} lf)`);
  if (ti.type === 'shed_under_eave' && ti.highAtHouse) {
    add('roof.headwallFlashing', 'roof', 'l_flash_4x4_10', M.highEdgeLf, 'lf', Math.ceil(M.highEdgeLf * 1.10 / 10), `Headwall flashing where the shed meets the house wall (${M.highEdgeLf} lf)`);
    add('roof.counterFlashing', 'roof', 'counter_flash_10', M.highEdgeLf, 'lf', Math.ceil(M.highEdgeLf / 10), 'Counter flashing over the headwall flashing');
  }
  if (ti.type === 'gable_into_roof' && M.valleyLf && (rp.valleys || {}).type === 'open_metal') {
    const wide = Number((rp.valleys || {}).metalWidthIn) >= 24; const ref = wide ? 'w_valley_24_10' : 'w_valley_18_10';
    add('roof.valleyMetal', 'roof', ref, M.valleyLf, 'lf', Math.ceil(M.valleyLf * 1.10 / 9.5), `W-valley metal ${wide ? 24 : 18} in (${M.valleyLf} lf)`);
  }
  const vented = /^vented/.test((rp.vent || {}).strategy || '') && rp.ceiling !== 'cathedral' || ((rp.vent || {}).strategy || '').startsWith('vented_cathedral');
  if (vented) {
    if (M.ridgeLf) add('roof.ridgeVent', 'roof', 'ridge_vent_cobra_snow_4ft', M.ridgeLf - 2, 'lf', Math.ceil((M.ridgeLf - 2) / 4), `Ridge vent (${r2(M.ridgeLf - 2)} lf, stops 12 in short of each end)`);
    else { const req = (M.run * M.L * 144) / 150; const n = Math.ceil(req / 2 / 60); add('roof.highVents', 'roof', 'roof_louver_60nfa', n, 'each', n, `High-side vents for the shed: ${n} roof louvers (60 sq in each; half of ${Math.round(req)} sq in NFA)`); }
    const eaveVentLf = M.shape === 'shed' ? M.eaveLf : M.eaveLf;
    if ((rp.eave || {}).soffit === 'vented_aluminum') add('roof.soffitVent', 'roof', 'soffit_alum_vented_12x12', eaveVentLf, 'lf', Math.ceil(eaveVentLf / 12), `Vented aluminum soffit (${eaveVentLf} lf of eave)`);
    else add('roof.soffitVent', 'roof', 'undereave_vent_6x8', eaveVentLf, 'lf', Math.ceil(eaveVentLf / 8), `Continuous under-eave vent (${eaveVentLf} lf)`);
    if ((rp.vent || {}).baffles !== false) { const bays = (M.commons + M.barges) - (M.shape === 'gable' ? 0 : 1); add('roof.baffles', 'roof', 'rafter_baffle_70', bays, 'each', Math.ceil(bays / 70), `Rafter vent baffles (${bays}, one per vented bay)`); }
  }
  const pipes = Number((rp.penetrations || {}).ventPipes) || 0; if (pipes) add('roof.pipeBoots', 'roof', 'pipe_boot_lead_2', pipes, 'each', pipes, `Pipe boots (${pipes})`);
  const sky = Number((rp.penetrations || {}).skylights) || 0; if (sky) add('roof.skylight', 'roof', 'skylight_curb_mount', sky, 'each', sky, `Skylight${sky > 1 ? 's' : ''} (${sky}), size TBD`);
  if (snowGuardsOn(rp)) {
    const g = rp.snowGuards || {}; const n = (Number(g.rows) || 1) * Math.ceil(M.eaveLf * 12 / (Number(g.spacingIn) || 24));
    if (/^metal_/.test(cov)) add('roof.snowGuards', 'roof', 'snow_guard_clear_25', n, 'each', Math.ceil(n / 25), `Snow guards for metal (${n})`);
    else add('roof.snowGuards', 'roof', 'snow_guard_shingle', n, 'each', n, `Snow guards for shingles (${n})`);
  }
  // ---------- gutters (low eave on a shed, both eaves on a gable)
  const gut = (rp.eave || {}).gutters || 'none';
  if (gut !== 'none') {
    const runs = M.shape === 'shed' ? 1 : 2; const runLf = M.shape === 'shed' ? M.eaveLf : M.eaveLf / 2;
    const n16 = Math.floor(runLf / 16); const rem = runLf - n16 * 16; const n10 = rem > 0.01 ? (rem <= 10 ? 1 : 0) : 0; const n16b = n16 + (rem > 10 ? 1 : 0);
    const vinyl = gut === '5in_vinyl'; const big = gut === '6in_aluminum_k';
    if (vinyl) add('roof.gutters', 'roof', 'gutter_k5_vinyl_10', runLf * runs, 'lf', Math.ceil(runLf / 10) * runs, `Vinyl K gutter 10 ft (${runs} run(s) of ${r2(runLf)} ft)`);
    else {
      if (n16b) add('roof.gutters', 'roof', 'gutter_k5_alum_16', n16b * 16 * runs, 'lf', n16b * runs, `${big ? '6 in (priced as 5 in) ' : ''}Aluminum K gutter 16 ft (${runs} run(s) of ${r2(runLf)} ft)`);
      if (n10) add('roof.gutters', 'roof', 'gutter_k5_alum_10', n10 * 10 * runs, 'lf', n10 * runs, 'Aluminum K gutter 10 ft (end piece)');
    }
    const spacing = sn.pg != null && sn.pg >= 50 ? 16 : 24; const hangers = (Math.ceil(runLf * 12 / spacing) + 1) * runs;
    add('roof.gutters', 'roof', 'gutter_hanger_5', hangers, 'each', hangers, `Hidden hangers @ ${spacing} in (${hangers})`);
    add('roof.gutters', 'roof', 'gutter_end_outlet_5', runs, 'each', runs, 'End piece with 2x3 drop outlet');
    add('roof.gutters', 'roof', 'gutter_end_cap_5', runs, 'each', runs, 'End caps');
    add('roof.gutters', 'roof', 'gutter_sealant', runs, 'tube', runs, 'Gutter sealant');
    const walls = m.layers.find((l) => l.id === 'walls'); const fl = (m.levels && m.levels[0] && m.levels[0].floorZ) || 0;
    const h = fl + (M.shape === 'shed' ? rp.shed.lowPlateFt : walls.params.plateHeightFt); const ds = Math.ceil(h / 10);
    add('roof.downspouts', 'roof', 'downspout_2x3_10', h * runs, 'lf', ds * runs, `Downspout 2x3 (${runs} x ${r2(h)} ft eave to grade)`);
    add('roof.downspouts', 'roof', 'downspout_elbow_flex', 3 * runs, 'each', 3 * runs, 'Downspout elbows (3 each)');
    add('roof.downspouts', 'roof', 'downspout_ext_flex', runs, 'each', runs, 'Downspout extensions');
  }
  return { lines, sheets, sheathRef: shRef, sheath: sh, measures: M, ice: ice && { buy: ice.buy }, keepEngineFraming };
}

/** Shed wall changes vs the engine's single plate height: taller precut studs, rake top plates, no gable triangles. */
export function shedWallAdjust(r, m, P) {
  const walls = m.layers.find((l) => l.id === 'walls'); const wp = walls.params; const rp = m.layers.find((l) => l.id === 'roof').params;
  const plates = (wp.bottomPlates || 1) + (wp.topPlates || 2); const out = [];
  const precut = (needIn) => (needIn <= 92.625 + 1e-6 ? null : needIn <= 104.625 + 1e-6 ? 'lumber_2x6_stud104' : needIn <= 116.625 + 1e-6 ? 'lumber_2x6_stud116' : null);
  let moved = 0; const byRef = {}; let extraArea = 0; const rakePlates = [];
  walls.objects.filter((o) => o.type === 'wall' && o.props.exterior && o.props.plateHeightFt != null).forEach((o) => {
    const hA = o.props.plateHeightFt, hB = o.props.plateHeightEndFt; const L = Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]) + 2 * (o.props.extEndFt || 0);
    const oc = (o.props.studOcIn || 16) / 12; const n = Math.floor(L / oc) + 1;
    for (let i = 0; i < n; i++) {
      const d = Math.min(L, i * oc); const h = hA + (hB - hA) * (d / L); const need = h * 12 - plates * 1.5;
      if (h <= wp.plateHeightFt + 1e-6) continue;
      const ref = precut(need) || LUMBER_LEN(P, '2x6', need / 12).ref; byRef[ref] = (byRef[ref] || 0) + 1; moved++;
    }
    extraArea += L * (((hA + hB) / 2) - wp.plateHeightFt);
    if (Math.abs(hA - hB) > 1e-4) { const sl = Math.hypot(L, hA - hB); const a = LUMBER_LEN(P, '2x6', L), b = LUMBER_LEN(P, '2x6', sl); if (a.ref !== b.ref) rakePlates.push({ from: a.ref, to: b.ref, n: (wp.topPlates || 2) * b.n }); }
  });
  const studs = r.lines.find((l) => l.id === 'walls.studs');
  if (studs && moved) {
    const keep = Math.max(0, studs.buy - waste(moved)); const u = studs.unit_price; Object.assign(studs, { buy: keep, ext: u == null ? null : r2(u * keep) });
    studs.desc += ` — ${moved} taller studs moved to the shed lines below`;
    Object.entries(byRef).forEach(([ref, n]) => out.push(mkLine(P, 'walls.shedStuds', 'walls', ref, n, 'each', waste(n), `Taller studs for the shed's high and rake walls (${n} + waste; cut rake studs to the slope) — ${(P[ref] || {}).name || ref}`)));
  }
  const merged = {}; rakePlates.forEach((x) => { const k = x.from + '>' + x.to; merged[k] = merged[k] ? Object.assign(merged[k], { n: merged[k].n + x.n }) : Object.assign({}, x); });
  Object.values(merged).forEach((rp2) => {
    const from = r.lines.find((l) => l.id === 'walls.plates' && l.price_ref === rp2.from);
    if (from && from.buy >= rp2.n) { from.buy -= rp2.n; from.ext = from.unit_price == null ? null : r2(from.unit_price * from.buy); }
    out.push(mkLine(P, 'walls.rakePlates', 'walls', rp2.to, rp2.n, 'each', rp2.n, `Rake-wall top plates follow the slope (longer than the plan length): ${rp2.n} x ${rp2.to.replace('lumber_', '').replace('_', ' x ')} ft`));
  });
  const sh = r.lines.find((l) => l.id === 'walls.sheathing');
  if (sh) {
    const gm = /gables ([\d.]+)/.exec(sh.desc || ''); const gable = gm ? Number(gm[1]) : 0;
    const newCalc = Math.max(0, sh.qty_calc - gable + extraArea); const buy = Math.ceil(newCalc * 1.10 / 32);
    sh.desc = `${sh.desc.replace(/ \+ gables [\d.]+/, '')} — shed: no gable triangles${gable ? ` (−${gable})` : ''}, + ${r2(extraArea)} sq ft taller high/rake walls`;
    sh.qty_calc = r2(newCalc); sh.buy = buy; sh.ext = sh.unit_price == null ? null : r2(sh.unit_price * buy);
  }
  void rp; void edgeSide; void wallEdge; void shedFrame;
  return out;
}

/**
 * Apply the v4 roof takeoff to an engine result r (mutates r): replaces roof lines (all of them for a shed;
 * covering + edges for a gable, keeping the engine's gable framing), shed wall changes, pieces, totals.
 */
export function applyRoofV4(r, m, P, opts = {}) {
  const rp = m.layers.find((l) => l.id === 'roof').params; const isShed = rp.shape === 'shed';
  const T = roofTakeoffV1(m, P, opts);
  const FRAMING = new Set(['roof.rafters', 'roof.ridge', 'roof.ceilingJoists', 'roof.collarTies', 'roof.hurricaneTies', 'roof.gableFraming', 'roof.lookouts']);
  r.lines = r.lines.filter((l) => l.layer !== 'roof' || (T.keepEngineFraming && FRAMING.has(l.id)));
  const wallAdds = isShed ? shedWallAdjust(r, m, P) : [];
  r.lines = r.lines.concat(wallAdds, T.lines.filter((l) => !(T.keepEngineFraming && FRAMING.has(l.id))));
  // pieces: keep rafters; roof sheets re-priced to the v4 sheathing; drop gable-only pieces on a shed
  if (r.pieces) {
    const dropGable = new Set(['ridge_board', 'ceiling_joist', 'collar_tie', 'gable_stud']);
    r.pieces = r.pieces.filter((p) => !(isShed && (dropGable.has(p.type) || /^roof\.(ridge|ceilingJoists|collarTies|gableFraming)/.test(p.line || ''))));
    const shLine = T.lines.find((l) => l.id === 'roof.sheathing');
    r.pieces.filter((p) => p.type === 'roof_sheet').forEach((p) => { p.price = shLine.unit_price; p.price_ref = T.sheathRef; p.label = `Roof sheet ${(P[T.sheathRef] || {}).name || T.sheathRef}`; if (p.price != null) p.total = r2(p.price + (p.fasteners || []).reduce((s, f) => s + (f.subtotal || 0), 0)); });
  }
  r.report = Object.assign({}, r.report, { roofSheets: T.sheets, roofV4: { measures: T.measures, sheathRef: T.sheathRef } });
  // ---- re-total exactly like the engine (pricing-rules.md)
  const priced = r.lines.filter((l) => l.ext != null); const t = r.totals;
  const materials = r2(priced.reduce((s, l) => s + l.ext, 0));
  const tax = r2(materials * (Number(t.taxRatePct) || 0) / 100);
  const contingency = r2((materials + tax) * (t.contingencyPct || 0) / 100);
  const labor = t.labor === 'not included' || t.labor == null ? null : t.labor;
  Object.assign(t, { materials, materials_from_estimated_prices: r2(priced.filter((l) => !l.verified).reduce((s, l) => s + l.ext, 0)), unpriced_lines: r.lines.filter((l) => l.ext == null).map((l) => l.desc), tax, contingency, total: r2(materials + tax + contingency + (Number(t.delivery) || 0) + (labor || 0)) });
  const groups = {}; priced.forEach((l) => { groups[l.layer] = r2((groups[l.layer] || 0) + l.ext); }); r.groups = groups;
  r.roofV4 = { measures: T.measures, sheets: T.sheets, needsPrice: r.lines.filter((l) => l.v4 && l.ext == null).map((l) => l.desc) };
  (r.flags = r.flags || []).push(isShed ? 'Roof priced with Remodel Guide roofing-v1 rules (shed). EXAMPLE quantities — verify.' : 'Roof covering priced with Remodel Guide roofing-v1 rules. EXAMPLE quantities — verify.');
  return r;
}
