// Worked example: Jake's 20x16 addition, Florence MT 59833. All inputs marked EXAMPLE must be measured/confirmed.
import { readFileSync, writeFileSync } from 'node:fs';
import * as R from './roof-reference.mjs';
const { r2, ftIn, slopeK, hipValleyK, heel, pickRafter, maxSpan, pickSheathing, iceBarrier, stockFor, buyCount, buyArea } = R;
const P = { ...JSON.parse(readFileSync(new URL('../../content-v3/homedepot-prices.json', import.meta.url))).prices,
            ...JSON.parse(readFileSync(new URL('../roofing-price-items.json', import.meta.url))).prices };
const priceKey = (size, len) => `lumber_${size}_${len}`;
function line(id, desc, qty, unit, ref, note) {
  const p = ref && P[ref]; const price = p && p.price != null ? p.price : null;
  return { id, desc, qty, unit, price_ref: ref || null, unitPriceEXAMPLE: price, extEXAMPLE: price != null ? r2(price * qty) : null, status: price != null ? 'EXAMPLE price (HD 2026-10-28, not localized)' : 'PRICE NEEDED', note };
}
const total = (lines) => ({ pricedSubtotalEXAMPLE: r2(lines.reduce((s, l) => s + (l.extEXAMPLE || 0), 0)), priceNeeded: lines.filter((l) => l.extEXAMPLE == null).map((l) => l.id) });
const lumberLine = (id, desc, size, L, n, w = 0.10) => { const s = stockFor(L)[0]; const q = buyCount(n * s.n, w); return line(id, `${desc} (${n} x ${ftIn(L)} cut -> ${s.n > 1 ? s.n + ' x ' : ''}${s.len} ft stock)`, q, 'each', P[priceKey(size, s.len)] ? priceKey(size, s.len) : priceKey(size, s.len) + '_MISSING'); };

// ---------------- inputs ----------------
const IN = {
  footprint: { alongHouseFt: 20, outFromHouseFt: 16, note: '20 ft wall against the house, 16 ft out (wizard option A).' },
  walls: { plateHeightFt: 8, studSize: '2x6', thicknessIn: 5.5 },
  snow: { pgAsdPsfEXAMPLE: 50, sensitivity: [30, 70], source: 'UNVERIFIED site value. content-v4/jurisdictions.json: ground snow site-specific/unverified; min roof snow 30 psf (MT R301.6); ice barrier required statewide. Get pg from https://snowload.montana.edu/ or the ASCE 7 Hazard Tool (x0.7 if strength-level).' },
  existing: {
    pitchEXAMPLE: 4, roofTopAtWallFtEXAMPLE: 8.5, eaveUndersideAtWallFtEXAMPLE: 7.9, overhangFtEXAMPLE: 1.0, ridgeDistFromWallFtEXAMPLE: 14,
    note: 'Heights above the HOUSE floor (= addition floor when flush). Measure: existing pitch, height to underside of eave at the wall, height to top of roof at the wall line, overhang, distance wall->ridge (half the home width for a centered ridge).'
  },
  roof: { overhangIn: 12, rafterOcIn: 24, seatIn: 3.5 },
};
const pg = IN.snow.pgAsdPsfEXAMPLE, E = IN.existing, W = IN.footprint.alongHouseFt, D = IN.footprint.outFromHouseFt, oh = IN.roof.overhangIn / 12;
const out = { generated: 'roofing-v1 reference, 2026-10-28', inputs: IN, variants: {} };

// ================= SHED, high side at the house =================
{
  const sz = '2x12', oc = 16, run = D;                                      // wizard: run = outside faces
  const clearSpan = D - 2 * (IN.walls.thicknessIn / 12) / 2 * 2 + 0;        // approx centerline span shown by wizard: 15.54
  const spanCL = r2(D - IN.walls.thicknessIn / 12 * 0.5 * 2 + 0.0);          // 16 - 0.458 = 15.54
  const rafterChecks = [30, 50, 70].map((g) => ({ pg: g, '2x12@16': maxSpan({ pgAsd: g, ocIn: 16, size: '2x12' }), '2x12@24': maxSpan({ pgAsd: g, ocIn: 24, size: '2x12' }), '2x10@16': maxSpan({ pgAsd: g, ocIn: 16, size: '2x10' }), need: spanCL }));
  // S1: Jake's literal command, 10 ft -> 8 ft, under the existing eave?
  const hi = 10, lo = 8, pitch = 12 * (hi - lo) / run;
  const h = heel(sz, pitch, IN.roof.seatIn);
  const roofTopAtHouse = hi + (h.hapIn + 0.59) / 12;     // top of 19/32 sheathing over the high plate (house-side face)
  const needEave = roofTopAtHouse + 5 / 12;              // + 4 in flashing leg + 1 in
  const S1 = { label: "Jake's command: high wall 10 ft at house, low wall 8 ft, slopes away", highPlateFt: hi, lowPlateFt: lo, pitch: r2(pitch), degrees: r2(R.degreesFromPitch(pitch)), percent: r2(pitch / 12 * 100), heel: h,
    roofTopAtHouseWallFt: r2(roofTopAtHouse), eaveUndersideNeededFt: r2(needEave), eaveUndersideExampleFt: E.eaveUndersideAtWallFtEXAMPLE,
    fitsUnderEave: needEave <= E.eaveUndersideAtWallFtEXAMPLE, shortByFt: r2(needEave - E.eaveUndersideAtWallFtEXAMPLE),
    coveringOK: { asphalt_shingle: pitch >= 2, roll_roofing: pitch >= 1, metal_panel_lapped: pitch >= 3, metal_panel_lapped_sealant: pitch >= 0.5, metal_standing_seam: pitch >= 0.25, modified_bitumen: pitch >= 0.25, single_ply: pitch >= 0.25 },
    rafter: pickRafter({ spanFt: spanCL, pgAsd: pg, ocIn: 16 }), rafterChecks };
  // S2: best "true under-eave" shed (no work on the existing roof)
  const S2 = [0, 15.5 / 12, 2].map((drop) => ({ floorDropFt: r2(drop), lowPlateFt: 7, ...R.shedUnderEave({ eaveUndersideFt: E.eaveUndersideAtWallFtEXAMPLE, floorDropFt: drop, lowPlateFt: 7, runFt: run, size: sz }) }));
  const dropFor2 = r2(7 + (heel(sz, 2).hapIn + 0.59) / 12 + run * 2 / 12 - (E.eaveUndersideAtWallFtEXAMPLE - 5 / 12));
  // S3: Jake's 10->8 shed carried up onto the existing roof (existing eave cut back over the 20 ft)
  const S3 = R.shedIntoRoofPlane({ zExistAtWallFt: E.roofTopAtWallFtEXAMPLE, existPitch: E.pitchEXAMPLE, newPitch: pitch, zLowFt: lo + (h.hapIn + 0.59) / 12, runFt: run });
  S3.overlayPlanSf = r2(W * S3.tieDistUpSlopeFt); S3.pastRidge = S3.tieDistUpSlopeFt > E.ridgeDistFromWallFtEXAMPLE - 1;
  const ext = R.extendPlane({ zExistAtWallFt: E.roofTopAtWallFtEXAMPLE, existPitch: E.pitchEXAMPLE, runFt: run });

  // ---- quantities for S3 (shed 10->8, 1.5:12, membrane, overlay onto existing roof) ----
  const k = slopeK(pitch);
  const planMain = (W + 2 * oh) * (D + oh);                    // rakes both sides, low eave overhang; high end runs onto the house
  const planOverlay = (W + 2 * oh) * S3.tieDistUpSlopeFt;
  const roofSf = r2((planMain + planOverlay) * k);
  const nRaft = Math.ceil(W * 12 / oc) + 1;                    // bearing rafters
  const rafterLenMain = (D + oh) * k + 0.5;                    // low tail + run, +0.5 trim; bears on new house-side wall
  const overlayRafterLen = S3.tieDistUpSlopeFt * k + 0.5;      // continuation over existing roof (sleepers/ purlins on existing framing)
  const sheath = pickSheathing(oc, pg);
  const eaveLf = W + 2 * oh, rakeLf = 2 * (D + oh + S3.tieDistUpSlopeFt) * k;
  const ice = iceBarrier({ eaveLf, overhangIn: 12, pitch });
  const lines = [
    lumberLine('roof.rafters', `Shed rafters ${sz} @ ${oc} in, over the addition`, sz, rafterLenMain, nRaft),
    lumberLine('roof.barge', 'Barge/fly rafters at rakes', sz, rafterLenMain, 2),
    lumberLine('roof.overlayRafters', 'Rafter extensions over existing roof (bear on sleepers - ENGINEER: loads the existing home)', '2x8', overlayRafterLen, nRaft),
    line('roof.sheathing', `${sheath.thickness} OSB (${sheath.spanRating}) - snow ${pg} psf at ${oc} in`, buyArea(roofSf, 0.10, 32), 'sheet', sheath.thickness === '19/32' ? 'osb_1932_4x8' : 'osb_716_4x8'),
    line('roof.membraneCap', 'Modified bitumen self-adhered cap sheet (100 sf rolls, 12% lap allowance UNVERIFIED)', buyArea(roofSf * 1.12, 0.05, 100), 'roll', 'modbit_sa_cap_100'),
    line('roof.membraneBase', 'Self-adhered base/ply sheet', buyArea(roofSf * 1.12, 0.05, 100), 'roll', 'modbit_sa_base_100'),
    line('roof.dripEdge', `Drip edge eave+rakes ${r2(eaveLf + rakeLf)} lf`, Math.ceil((eaveLf + rakeLf) * 1.1 / 10), '10 ft', 'drip_edge_10'),
    line('roof.tieInFlashing', 'Pitch-break / transition metal where new 1.5:12 meets existing 4:12 (20 ft + 10%)', Math.ceil(eaveLf * 1.1 / 10), '10 ft', 'l_flash_4x4_10', 'Custom-bent transition flashing usually; L flashing as EXAMPLE'),
    line('roof.existingReroof', 'Re-shingle existing roof strip above the tie line (2 ft x 22 ft) incl. ice & water', Math.ceil(2 * eaveLf * 1.15 / 33.33), 'bundle', 'shingles_bundle'),
    line('roof.gutter', '5 in aluminum K gutter on the low eave (22 ft)', Math.ceil(eaveLf * 1.05 / 10), '10 ft', 'gutter_k5_alum_10'),
    line('roof.gutterHangers', 'Hidden hangers @ 24 in (snow country; many installers use 16 in)', Math.ceil(eaveLf / 2) + 1, 'each', 'gutter_hanger_5'),
    line('roof.gutterEnds', 'End with outlet + end cap', 1, 'each', 'gutter_end_outlet_5'), line('roof.gutterCap', 'End cap', 1, 'each', 'gutter_end_cap_5'),
    line('roof.downspout', '2x3 downspout (eave ~10.5 ft above grade, EXAMPLE)', 2, '10 ft', 'downspout_2x3_10'),
    line('roof.downspoutElbows', 'Elbows', 3, 'each', 'downspout_elbow_flex'), line('roof.downspoutExt', 'Extension', 1, 'each', 'downspout_ext_flex'),
    line('roof.hurricaneTies', 'H2.5A at both bearings', buyCount(nRaft * 2, 0.10), 'each', 'hurricane_h25a'),
    line('roof.tieNails', 'N8 nails, 10 per tie', Math.ceil(buyCount(nRaft * 2, 0.10) * 10 / 150), 'box 150', 'nails_connector_n8_150'),
  ];
  out.variants.shed_house_high = { S1_jakes_10_to_8_under_eave: S1, S2_max_under_eave: S2, S2_floorDropNeededFor2to12Ft: dropFor2,
    S3_10_to_8_carried_onto_existing_roof: S3, extendExistingPlane: { ...ext, verdict: ext.zAtOuterWallFt < 7 ? 'NOT FEASIBLE: outer wall would be under 7 ft' : 'ok' },
    quantities_S3: { pitch: r2(pitch), roofSf, squares: r2(roofSf / 100), rafters: nRaft, rafterLenFt: r2(rafterLenMain), sheathing: sheath, iceBarrier: { ...ice, note: 'Membrane is fully adhered; separate ice barrier not added for mod-bit (R905.1.2 lists shingles/metal shingles/roll/slate/wood).' }, eaveLf, rakeLf: r2(rakeLf), lines, totals: total(lines) } };
}

// ================= GABLE, ridge perpendicular to the house, tied into existing roof =================
{
  const pitch = 4, sz = '2x10', oc = 24, half = W / 2;
  const h = heel(sz, pitch, IN.roof.seatIn);
  const sheath = pickSheathing(oc, pg);
  const zNew = IN.walls.plateHeightFt + (h.hapIn + 0.59) / 12;           // top of sheathing over the side-wall outside face
  const geo = R.gableTieIn({ widthFt: W, depthFt: D, newPitch: pitch, existPitch: E.pitchEXAMPLE, zNewEaveLineFt: zNew, zExistAtWallFt: E.roofTopAtWallFtEXAMPLE, eaveOhFt: oh, rakeOhFt: oh, existOhFt: E.overhangFtEXAMPLE, existRidgeDistFt: E.ridgeDistFromWallFtEXAMPLE });
  const spanH = half - (IN.walls.thicknessIn / 12) / 2;                  // horizontal span wall centerline -> ridge (approx)
  const rafter = pickRafter({ spanFt: spanH, pgAsd: pg, ocIn: oc });
  const k = slopeK(pitch);
  const planMain = (W + 2 * oh) * (D + oh), planOverlay = geo.overlayTrianglePlanSf;
  const roofSf = r2((planMain + planOverlay) * k);
  const eaveLf = 2 * (D + oh - E.overhangFtEXAMPLE);                     // each eave runs from far rake corner to where it meets the existing eave
  const rakeLf = r2(2 * (half + oh) * k);
  const ridgeLf = r2(D + oh + geo.tieDistUpSlopeFt);
  const valleyLf = r2(2 * geo.valleyTrueFt);
  const ice = iceBarrier({ eaveLf, overhangIn: 12, pitch });
  const valleyIceSf = r2(valleyLf * 3);
  const nPairs = Math.floor(D * 12 / oc) + 1;                            // stations from far gable wall to the house wall line
  const commonLen = (half - 0.75 / 12 + oh) * k + (LUM(sz) * pitch / 12) / 12;
  function LUM(s) { return R.LUMBER_DEPTH_IN[s]; }
  const jackStations = []; for (let a = oc / 12; a < geo.tieDistUpSlopeFt - 0.01; a += oc / 12) jackStations.push(r2(a));
  const jackLens = jackStations.map((a) => r2(Math.max(0, half - (a - geo.valleyFoot.a) * (E.pitchEXAMPLE / pitch) - 0.75 / 12) * k + 0.3)).filter((L) => L >= 1.5); // plan run from valley board to ridge
  // pair jacks into stock (long+short)
  const sorted = [...jackLens].sort((x, y) => y - x); const jackPieces = []; while (sorted.length) { const a = sorted.shift(); const b = sorted.length ? sorted.pop() : 0; jackPieces.push(r2(a + b)); }
  const jackStock = jackPieces.map((L) => stockFor(L)[0].len);
  const iceRolls = buyArea(ice.sf + valleyIceSf, 0.10, 150);
  const squares = roofSf / 100;
  const reroofSf = r2(valleyLf * 2);                                      // existing-side strip ~2 ft wide along both valleys
  const bundles = Math.ceil(squares * 1.15 * 3 - 1e-9) + Math.ceil(reroofSf * 1.10 / 33.33);
  const heelNails = { table: 'R802.5.2(1)', pitch: '4:12', ocIn: 24, spanColumnFt: 24, nails16d: { 30: 9, 50: 13, 70: 17 }[pg] };
  const gableTri = 0.5 * W * geo.riseFt;
  const lines = [
    lumberLine('roof.rafters', `Common rafters ${sz} @ ${oc} in (${nPairs} pairs)`, sz, commonLen, nPairs * 2),
    lumberLine('roof.barge', 'Barge/fly rafters at the far rake', sz, commonLen, 2),
    ...jackStock.map((len, i) => line(`roof.jacks.${i}`, `Valley jack pair cut from one ${len} ft ${sz} (${jackPieces[i]} ft incl. trim) x2 sides`, 2, 'each', priceKey(sz, len))),
    lumberLine('roof.valleyBoards', 'California valley boards (2x10 laid flat on existing sheathing)', '2x10', geo.valleyTrueFt + 0.5, 2, 0),
    line('roof.ridge16', `Ridge board 2x12 (one size up; 2x10 plumb cut ${h.plumbCutIn} in > 9.25 in), ${ridgeLf} ft = 16 ft + 12 ft spliced over a rafter pair`, 1, 'each', 'lumber_2x12_16'),
    line('roof.ridge12', 'Ridge board 2x12 x 12 ft (second piece)', 1, 'each', 'lumber_2x12_12'),
    lumberLine('roof.ceilingJoists', 'Ceiling joists / rafter ties 2x10 @ 24 across 20 ft (size per content-v3 EXAMPLE table, verify R802.5)', '2x10', W, nPairs),
    lumberLine('roof.collarTies', 'Collar ties 2x4 every 2nd pair, ~6.8 ft', '2x4', W * 0.34, Math.ceil(nPairs / 2)),
    line('roof.gableFraming', `Far gable-end infill ${r2(gableTri)} sf, 2x4 @ 16 (content-v3 rule)`, Math.ceil(W * 12 / 16) + 2, 'each (2x4x8)', 'lumber_2x4_8'),
    lumberLine('roof.lookouts', 'Rake lookouts @ 24, 2 ft', '2x4', 2, Math.ceil(2 * (half + oh) * k / 2)),
    line('roof.sheathing', `19/32 OSB (40/20) - code minimum here is ${sheath.thickness} (${sheath.spanRating}) for ${pg} psf @ ${oc} in; 19/32 OSB is cheaper than 15/32 plywood at HD`, buyArea(roofSf, 0.10, 32), 'sheet', 'osb_1932_4x8'),
    line('roof.hClips', 'H-clips 19/32, one per rafter bay per sheet row', buyArea(roofSf, 0.10, 32) * 2, 'each', 'h_clip_1932'),
    line('roof.underlayment', 'Synthetic underlayment (single layer OK at 4:12)', buyArea(roofSf, 0.10, 1000), 'roll', 'underlayment_synth_1000'),
    line('roof.iceBarrier', `Ice & water: eaves ${ice.courses} courses (needs ${ice.reqSlopeIn} in up-slope) + 36 in in valleys`, iceRolls, 'roll 150 sf', 'ice_water_150'),
    line('roof.shingles', `Architectural shingles ${r2(squares)} sq x 1.15 (valleys) + existing-side valley reroof ${reroofSf} sf`, bundles, 'bundle', 'shingles_bundle'),
    line('roof.starter', `Starter eaves+rakes ${r2(eaveLf + rakeLf)} lf`, buyArea(eaveLf + rakeLf, 0.10, 120), 'bundle', 'starter_bundle'),
    line('roof.ridgeCap', `Ridge cap ${ridgeLf} lf`, buyArea(ridgeLf, 0.10, 25), 'bundle', 'ridge_cap_bundle'),
    line('roof.ridgeVent', 'Ridge vent over the addition attic only (~14 ft usable)', 4, '4 ft piece', 'ridge_vent_cobra_snow_4ft'),
    line('roof.soffitVent', 'Continuous under-eave vent, both eaves', Math.ceil(eaveLf / 8), '8 ft', 'undereave_vent_6x8'),
    line('roof.baffles', 'Rafter baffles, every bay at both eaves', 2 * (nPairs - 1), 'each (pack of 70)', null, 'buy 1 pack rafter_baffle_70 ($179 EXAMPLE) or cheaper 22.5 in baffles - PRICE NEEDED per piece'),
    line('roof.dripEdge', `Drip edge ${r2(eaveLf + rakeLf)} lf`, Math.ceil((eaveLf + rakeLf) * 1.1 / 10), '10 ft', 'drip_edge_10'),
    line('roof.nails', 'Roofing nails 2.5 lb/sq', Math.ceil((squares + reroofSf / 100) * 1.15 * 2.5 / 5), '5 lb box', 'roofing_nails_5lb'),
    line('roof.capNails', 'Cap nails for underlayment', 1, 'box 2000', 'cap_nails_2000'),
    line('roof.hurricaneTies', 'H2.5A, one per rafter at the plate', buyCount(nPairs * 2, 0.10), 'each', 'hurricane_h25a'),
    line('roof.tieNails', 'N8 nails', Math.ceil(buyCount(nPairs * 2, 0.10) * 10 / 150), 'box 150', 'nails_connector_n8_150'),
    line('roof.gutters', '5 in aluminum K gutter both eaves (2 x 16 ft)', 2, '16 ft', 'gutter_k5_alum_16'),
    line('roof.gutterParts', 'Outlets (2) ', 2, 'each', 'gutter_end_outlet_5'), line('roof.gutterCaps', 'End caps (2)', 2, 'each', 'gutter_end_cap_5'),
    line('roof.gutterHangers', 'Hangers @ 24 in', 2 * (Math.ceil(16 / 2) + 1), 'each', 'gutter_hanger_5'),
    line('roof.downspouts', '2x3 downspouts', 2, '10 ft', 'downspout_2x3_10'), line('roof.dsElbows', 'Elbows', 6, 'each', 'downspout_elbow_flex'),
  ];
  const sweep = [3, 4, 5, 6, 8].map((p) => { const hh = heel(sz, p); const z = IN.walls.plateHeightFt + (hh.hapIn + 0.59) / 12; const g = R.gableTieIn({ widthFt: W, depthFt: D, newPitch: p, existPitch: E.pitchEXAMPLE, zNewEaveLineFt: z, zExistAtWallFt: E.roofTopAtWallFtEXAMPLE, eaveOhFt: oh, rakeOhFt: oh, existOhFt: E.overhangFtEXAMPLE, existRidgeDistFt: E.ridgeDistFromWallFtEXAMPLE }); return { pitch: p, degrees: r2(R.degreesFromPitch(p)), riseFt: g.riseFt, ridgeTopAboveFloorFt: g.zRidgeFt, tieDistUpExistingRoofFt: g.tieDistUpSlopeFt, valleyTrueFt: g.valleyTrueFt, valleyPlanAngleDeg: g.valleyPlanAngleDeg, warnings: g.warnings }; });
  const parallel = { note: 'Gable with ridge PARALLEL to the house: back slope drains toward the house wall -> needs a cricket/saddle the full 20 ft or the back slope must tie into the existing roof (two valleys + a flat/back-pitched cricket).', ridgeTopFt: r2(IN.walls.plateHeightFt + (heel('2x8', 4).hapIn + 0.59) / 12 + 8 * 4 / 12), backEaveAtHouseTopFt: r2(IN.walls.plateHeightFt + (heel('2x8', 4).hapIn + 0.59) / 12), existingEaveUndersideFt: E.eaveUndersideAtWallFtEXAMPLE };
  out.variants.gable_tie_in = { pitch, degrees: r2(R.degreesFromPitch(pitch)), heel: h, zNewEaveLineFt: r2(zNew), geometry: geo, rafter: { spanHorizFt: r2(spanH), pick: rafter, checks: [30, 50, 70].map((g) => ({ pg: g, '2x8@24': maxSpan({ pgAsd: g, ocIn: 24, size: '2x8' }), '2x10@24': maxSpan({ pgAsd: g, ocIn: 24, size: '2x10' }), '2x10@24_DL20': maxSpan({ pgAsd: g, ocIn: 24, size: '2x10', deadPsf: 20 }) })) },
    commonRafterLenFt: r2(commonLen), jackStationsFt: jackStations, jackLensFt: jackLens, heelNails, hipValleyFactor: r2(hipValleyK(pitch)), slopeFactor: r2(k),
    quantities: { roofSf, squares: r2(squares), planMainSf: r2(planMain), planOverlaySf: planOverlay, eaveLf, rakeLf, ridgeLf, valleyLf, iceBarrier: ice, valleyIceSf, sheathing: sheath, ventilation: { atticFloorSf: W * D, nfa150SqIn: r2(W * D / 150 * 144), nfa300SqIn: r2(W * D / 300 * 144), note: '1/300 only in CZ6 with Class I/II vapor retarder on warm side AND 40-50% upper vents (R806.2). Half low, half high.' }, lines, totals: total(lines) },
    pitchSweep: sweep, ridgeParallelVariant: parallel };
}
writeFileSync(new URL('../worked-example-20x16.json', import.meta.url), JSON.stringify(out, null, 1));
const g = out.variants.gable_tie_in, s = out.variants.shed_house_high;
console.log(JSON.stringify({ S1: s.S1_jakes_10_to_8_under_eave, S2: s.S2_max_under_eave, drop2: s.S2_floorDropNeededFor2to12Ft, S3: s.S3_10_to_8_carried_onto_existing_roof, ext: s.extendExistingPlane, sq: { roofSf: s.quantities_S3.roofSf, len: s.quantities_S3.rafterLenFt, n: s.quantities_S3.rafters, t: s.quantities_S3.totals } }, null, 1));
console.log(JSON.stringify({ heel: g.heel, z: g.zNewEaveLineFt, geo: g.geometry, rafter: g.rafter, common: g.commonRafterLenFt, jacks: [g.jackStationsFt, g.jackLensFt], q: { ...g.quantities, lines: undefined }, sweep: g.pitchSweep, par: g.ridgeParallelVariant }, null, 1));
for (const l of g.quantities.lines) console.log('G', l.id, l.qty, l.unit, l.price_ref, l.extEXAMPLE, '|', l.desc);
for (const l of s.quantities_S3.lines) console.log('S', l.id, l.qty, l.unit, l.price_ref, l.extEXAMPLE, '|', l.desc);
