// takeoff-reference.mjs - REFERENCE implementation of content-v3/takeoff-rules.json.
// Content, not app code: App Builder may port or import it. Pure functions, no DOM.
// takeoff(model, rules, prices, opts) -> { lines[], groups{}, totals{}, flags[], report{} }
// model = the saved app model (localStorage 'buildingLayout.model.v1') AFTER regenerate().

const LUMBER = { '2x4': 3.5, '2x6': 5.5, '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 };
const T = 1.5 / 12;
const layer = (m, id) => m.layers.find((l) => l.id === id);
const plen = (o) => Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]);
const polyArea = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const perim = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
const r2 = (x) => Math.round(x * 100) / 100;

// same logic as js/homeplan-derived.js studLayout()
function studLayout(len, ocFt, openings, studT = T) {
  const cuts = (openings || []).map((o) => ({ a: o.center - o.widthFt / 2, b: o.center + o.widthFt / 2 }));
  const blocked = (d) => cuts.some((c) => d + studT / 2 >= c.a - 2 * studT && d - studT / 2 <= c.b + 2 * studT);
  const studs = [];
  const place = (d) => { if (d >= 0 && d <= len && !blocked(d)) studs.push(d); };
  place(studT / 2); place(len - studT / 2);
  for (let d = ocFt; d < len - studT; d += ocFt) place(d);
  return { studs, kings: cuts.length * 2, jacks: cuts.length * 2, cuts };
}

export function takeoff(model, rules, pricesDoc, opts = {}) {
  const D = rules.defaults, P = pricesDoc.prices;
  const o = Object.assign({ taxRatePct: 9.15, contingencyPct: 10, deliveryUsd: 0, laborUsd: null, concreteMode: D.concrete.mode, iceBarrier: true }, opts);
  const lines = [], flags = [];
  const W = (k) => D.waste[k] ?? 0;
  const has = (ref) => !!(P[ref] && P[ref].price != null);

  function unitPrice(ref, qty) {
    const p = P[ref]; if (!p || p.price == null) return null;
    return p.bulk_price && qty >= p.bulk_price.min_qty ? p.bulk_price.price : p.price;
  }
  function add(id, layerId, desc, qtyCalc, unit, ref, buy, note) {
    const up = ref ? unitPrice(ref, buy) : null;
    const p = ref ? P[ref] : null;
    lines.push({ id, layer: layerId, desc, qty_calc: typeof qtyCalc === 'number' ? r2(qtyCalc) : qtyCalc, unit, buy, price_ref: ref,
      unit_price: up, ext: up == null ? null : r2(up * buy), verified: p ? !!p.verified : false, note: note || undefined });
  }
  // counted members: + round(n*w) ; quantities: ceil(q*(1+w))
  const withWasteCount = (n, w) => n + Math.round(n * w);
  // stock length choice for one run of length L (ft)
  function stock(prefix, size, L) {
    const lens = D.stock.lengthsFt.filter((x) => has(`${prefix}_${size}_${x}`));
    const n = L <= D.stock.maxSinglePieceFt + 1e-6 ? 1 : Math.ceil(L / D.stock.splitPieceFt);
    const need = L / n;
    let len = lens.find((x) => x + 1e-6 >= need);
    if (len == null) { len = lens[lens.length - 1]; flags.push(`No ${prefix} ${size} stock >= ${need.toFixed(1)} ft priced; used ${len} ft`); }
    return { n, len, ref: `${prefix}_${size}_${len}` };
  }
  function addRuns(id, layerId, desc, prefix, size, runs, wasteKey) {
    const tally = {};
    runs.forEach((L) => { const s = stock(prefix, size, L); tally[s.ref] = (tally[s.ref] || 0) + s.n; });
    Object.entries(tally).forEach(([ref, n]) => add(id, layerId, `${desc} (${ref.split('_').slice(1).join(' x ').replace(/_/g, ' ')} ft)`, n, 'each', ref, withWasteCount(n, W(wasteKey))));
    return Object.values(tally).reduce((a, b) => a + b, 0);
  }
  // first-fit-decreasing of short pieces (ft) into stock of length S
  function pack(pieces, S) { const bins = []; [...pieces].sort((a, b) => b - a).forEach((p) => { const b = bins.find((x) => x + p <= S + 1e-6); if (b != null) bins[bins.indexOf(b)] += p; else bins.push(p); }); return bins.length; }
  // cheapest mix of two pack sizes covering q
  function packs(id, layerId, desc, q, big, small) {
    const B = P[big], S = small ? P[small] : null; let best = null;
    for (let nb = 0; nb <= Math.ceil(q / B.pack_qty); nb++) {
      const rem = Math.max(0, q - nb * B.pack_qty);
      const ns = S ? Math.ceil(rem / S.pack_qty) : (rem > 0 ? Infinity : 0);
      const cost = nb * B.price + (S ? ns * S.price : 0);
      if (!best || cost < best.cost) best = { nb, ns, cost };
    }
    if (best.nb) add(id, layerId, desc, q, 'pcs', big, best.nb);
    if (best.ns) add(id, layerId, desc, q, 'pcs', small, best.ns);
  }

  const fo = layer(model, 'foundation'), fl = layer(model, 'floor'), wl = layer(model, 'walls'), rf = layer(model, 'roof');
  const fp = model.footprint, ftype = fo.params.type;
  const nail = { count: 0 }; const NP = D.framingNailsPerPieceEXAMPLE;

  // ---------------- SITE ----------------
  const corners = fp.length;
  add('site.layout', 'site', 'Batter-board stakes (3 per corner)', corners * 3, 'stakes', 'grade_stakes_24in_24pk', Math.ceil(corners * 3 / 24));
  add('site.layout', 'site', 'Batter-board ledgers 2x4x8 (2 per corner)', corners * 2, 'each', 'lumber_2x4_8', corners * 2);

  // ---------------- FOUNDATION ----------------
  const piers = fo.objects.filter((x) => x.type === 'pier');
  const gbeams = fo.objects.filter((x) => x.type === 'beam' && x.props.role === 'gradeBeam');
  const footings = fo.objects.filter((x) => x.type === 'footing');
  const slabs = fo.objects.filter((x) => x.type === 'area' && x.props.role === 'slab');
  const vPier = piers.reduce((s, p) => s + Math.PI * (p.props.diaIn / 24) ** 2 * p.height, 0);
  const gbLf = gbeams.reduce((s, b) => s + plen(b), 0);
  const vGB = gbeams.reduce((s, b) => s + plen(b) * (b.props.widthIn / 12) * (fo.params.gradeBeamDepthIn / 12), 0);
  const vFoot = footings.reduce((s, f) => s + plen(f) * (f.props.widthIn / 12) * f.height, 0);
  const vSlab = slabs.reduce((s, a) => s + polyArea(a.geometry.pts) * a.height, 0);
  const vRaw = vPier + vGB + vFoot + vSlab, v = vRaw * (1 + W('concrete')), yd = v / 27;
  const bags80 = Math.ceil(v / D.concrete.bagYieldCuFt['80']), bags60 = Math.ceil(v / D.concrete.bagYieldCuFt['60']);
  const mode = o.concreteMode === 'auto' ? (yd > D.concrete.readyMixThresholdYd ? 'readymix' : 'bags80') : o.concreteMode;
  const concDesc = `Concrete: piers ${vPier.toFixed(1)} + grade beam ${vGB.toFixed(1)} + footings/stem ${vFoot.toFixed(1)} + slab ${vSlab.toFixed(1)} = ${vRaw.toFixed(1)} cu ft; +${W('concrete') * 100}% = ${v.toFixed(1)} cu ft = ${yd.toFixed(2)} yd = ${bags80} x 80 lb or ${bags60} x 60 lb bags`;
  if (mode === 'readymix') {
    const ord = Math.ceil(yd * 2) / 2;
    add('conc.total', 'foundation', concDesc + ` -> READY-MIX recommended (> ${D.concrete.readyMixThresholdYd} yd), order ${ord} yd`, yd, 'cu yd', 'readymix_cy', ord);
    add('conc.total', 'foundation', 'Ready-mix short-load fee (estimate)', 1, 'each', 'readymix_short_load', 1);
  } else if (mode === 'bags60') add('conc.total', 'foundation', concDesc, v, 'cu ft', 'concrete_60lb', bags60);
  else add('conc.total', 'foundation', concDesc, v, 'cu ft', 'concrete_80lb', bags80);
  const alt = { bags80: { qty: bags80, cost: r2(bags80 * unitPrice('concrete_80lb', bags80)) }, bags60: { qty: bags60, cost: r2(bags60 * unitPrice('concrete_60lb', bags60)) }, readymix: { yd: Math.ceil(yd * 2) / 2, cost: r2(Math.ceil(yd * 2) / 2 * P.readymix_cy.price + P.readymix_short_load.price), estimate: true } };

  if (piers.length) {
    const byDia = {};
    piers.forEach((p) => { (byDia[p.props.diaIn] = byDia[p.props.diaIn] || []).push(p.height * 12 + D.formTube.extraIn); });
    Object.entries(byDia).forEach(([dia, needs]) => {
      const L = D.formTube.stockLengthIn; let full = 0; const rem = [];
      needs.forEach((n) => { if (n <= L) rem.push(n); else { full += Math.floor(n / L); if (n % L > 0.01) rem.push(n % L); } });
      const tubes = full + pack(rem, L);
      add('found.formTubes', 'foundation', `Form tubes ${dia} in dia: ${needs.length} piers, each needs ${(needs[0]).toFixed(0)} in${needs[0] > L ? ' (taped extension; or buy 10-12 ft tubes from a lumber yard)' : ''}`, needs.length, 'piers', D.formTube.diameterPriceRef[dia], tubes);
    });
    // rebar
    const R = D.rebar; let lf = 0;
    piers.forEach((p) => { const bars = R.pierVerticalsEXAMPLE.find((x) => p.props.diaIn <= x.maxDiaIn).bars; lf += bars * (p.height * 12 - R.coverIn + R.pierDowelIntoBeamIn) / 12; });
    const lines4 = R.gradeBeamBarsEXAMPLE.top + R.gradeBeamBarsEXAMPLE.bottom;
    lf += lines4 * (gbLf + Math.ceil(gbLf / R.stockFt) * R.lapIn / 12) + corners * R.cornerBarsPerCorner * 2 * R.cornerBarLegIn / 12;
    const bars = Math.ceil(lf * (1 + W('rebar')) / R.stockFt);
    add('found.rebar', 'foundation', `#4 rebar EXAMPLE: pier verticals + ${lines4} grade-beam bars + laps + corner L-bars = ${lf.toFixed(0)} lf`, lf, 'lf', 'rebar_4_20', bars, 'EXAMPLE steel - engineer/plans govern');
    const ties = 2 * piers.length + lines4 * gbLf / 2 + corners * 4;
    add('found.tieWire', 'foundation', `Tie wire (~${Math.round(ties)} ties)`, ties, 'ties', 'tie_wire_roll', Math.max(1, Math.ceil(ties / R.tiesPerRollEstimate)));
    const gbBottomAboveGrade = (fo.params.topAboveGradeIn.piers - fo.params.gradeBeamDepthIn);
    if (gbeams.length) {
      const pcs = Math.ceil(gbLf * 3 * 1 / 16);
      add('found.gradeBeamForms', 'foundation', `Grade-beam forms: 2 sides + bottom of 2x12 along ${gbLf.toFixed(1)} lf (reusable)`, gbLf * 3, 'lf', 'lumber_2x12_16', withWasteCount(pcs, W('framing')), gbBottomAboveGrade > 0 ? `Beam bottom is ${gbBottomAboveGrade} in ABOVE grade - needs shored bottom form; engineer review` : undefined);
      add('found.gradeBeamForms', 'foundation', 'Form stakes / kickers (1 per 2 ft per side)', gbLf, 'stakes', 'grade_stakes_24in_24pk', Math.ceil(gbLf / 24));
      if (gbBottomAboveGrade > 0) flags.push(`Grade beam bottom ${gbBottomAboveGrade} in above grade (topAboveGradeIn.piers ${fo.params.topAboveGradeIn.piers} - gradeBeamDepthIn ${fo.params.gradeBeamDepthIn}). Elevated beam needs shoring/bottom forms; consider casting it at grade. Engineer review.`);
    }
  }
  if (footings.length) {
    const R = D.rebar; const flf = footings.reduce((s, f) => s + plen(f) * (f.props.role === 'stem' ? R.stemBarsEXAMPLE : R.footingBarsEXAMPLE), 0) * (1 + R.lapIn / 12 / R.stockFt);
    add('found.rebar', 'foundation', `#4 rebar EXAMPLE in footings/stem walls (${flf.toFixed(0)} lf)`, flf, 'lf', 'rebar_4_20', Math.ceil(flf * (1 + W('rebar')) / R.stockFt));
  }
  if (ftype === 'slab' || ftype === 'crawlspace') { const a = polyArea(fp) * (ftype === 'slab' ? 1.10 : 1.15); add('found.vaporRetarder', 'foundation', '6 mil poly vapor retarder', a, 'sq ft', 'poly_6mil_10x100', Math.ceil(a / 1000)); }
  if (!fo.params.frostDepthIn) flags.push(`Frost depth not entered - piers priced at placeholder ${fo.params.placeholderFrostIn} in. Denver-area codes commonly require ~36 in (verify locally).`);

  // anchor bolts
  const sills = fl.objects.filter((x) => x.props && x.props.role === 'sill');
  const AB = D.anchorBolts;
  const boltRuns = ftype === 'slab' ? wl.objects.filter((x) => x.type === 'wall' && x.props.exterior).map(plen) : sills.map(plen);
  let bolts = boltRuns.reduce((s, L) => s + Math.max(AB.minPerPlate, Math.ceil((L - 2 * AB.maxFromEndIn / 12) / AB.maxOcFt) + 1), 0);
  if (ftype === 'slab') bolts += 2 * wl.objects.filter((x) => x.type === 'opening' && x.props.kind === 'door').length;
  add('found.anchorBolts', 'foundation', `1/2 x 10 in anchor bolts: ${bolts} (<= 6 ft o.c., <= 12 in from ends)`, bolts, 'each', 'anchor_bolt_50pk', Math.ceil(bolts / 50));

  // ---------------- FLOOR ----------------
  if (ftype !== 'slab') {
    const fpP = fl.params, js = fpP.joistSize, jd = LUMBER[js] / 12;
    addRuns('floor.sill', 'floor', `PT sill ${fpP.sillSize}`, 'pt', fpP.sillSize, sills.map(plen), 'framing');
    const sillLf = sills.reduce((s, x) => s + plen(x), 0);
    add('floor.sillGasket', 'floor', `Sill gasket (${sillLf.toFixed(0)} lf)`, sillLf, 'lf', 'sill_gasket_2pk', Math.ceil(sillLf / 100));
    const rims = fl.objects.filter((x) => x.type === 'joist' && x.props.role === 'rim');
    addRuns('floor.rim', 'floor', `Rim joist ${js}`, 'lumber', js, rims.map(plen), 'framing');
    const joists = fl.objects.filter((x) => x.type === 'joist' && !x.props.role);
    const girders = fl.objects.filter((x) => x.type === 'beam' && x.props.role === 'girder');
    const flush = girders.length && joists.length && Math.abs(girders[0].z - joists[0].z) < 0.1;
    let pieces = [];
    joists.forEach((j) => { const L = plen(j); if (flush) { const gw = girders[0].props.widthIn / 12; pieces.push((L - gw) / 2, (L - gw) / 2); } else pieces.push(L); });
    const intPar = wl.objects.filter((x) => x.type === 'wall' && !x.props.exterior).length; // proxy; refine with direction
    addRuns('floor.joists', 'floor', `Floor joists ${js} @ ${fpP.joistOcIn} in${flush ? ' (cut at flush mid beam)' : ''}`, 'lumber', js, pieces, 'framing');
    nail.count += pieces.length * NP.joist + rims.reduce((s, r) => s + plen(r), 0) * NP.rim_lf;
    let hangers = flush ? joists.length * 2 : 0;
    if (girders.length) {
      girders.forEach((g) => {
        const plies = Math.round(g.props.widthIn / 1.5);
        const s = stock('lumber', js, plen(g));
        add('floor.girder', 'floor', `Mid beam FLAGGED: ${plies}-ply ${js} EXAMPLE, ${plen(g).toFixed(1)} ft - size by engineer; supports NOT priced`, plies * s.n, 'each', s.ref, plies * s.n, 'Supports/posts not generated; conflicts with piers-under-walls-only rule');
        const scr = Math.ceil(plen(g) * 12 / 16) * 2;
        add('floor.girder', 'floor', `Structural screws to laminate beam plies (${scr})`, scr, 'each', 'screws_structural_12pk', Math.ceil(scr / 12));
      });
      flags.push(`Joist span ${fpP.computed?.spanFt} ft > beamFlagSpanFt ${fpP.beamFlagSpanFt}: app adds a FLAGGED mid beam whose supports are not generated. Under the piers-only-under-walls rule, prefer deeper joists that clear-span (verify) or have an engineer size the beam and its supports.`);
    }
    if (hangers) {
      const href = `hanger_lus${js.replace('2x', '2')}`;
      add('floor.hangers', 'floor', `Face-mount joist hangers at flush beam (${hangers})`, hangers, 'each', has(href) ? href : null, hangers, has(href) ? undefined : 'hanger price_ref missing for this joist size');
      add('floor.hangers', 'floor', 'Hanger nails 0.148 x 3 in (12 per hanger)', hangers * 12, 'nails', 'nails_connector_10d3_250', Math.ceil(hangers * 12 / 250));
    }
    const area = polyArea(fp);
    const sub = Math.ceil(area * (1 + W('sheathing')) / D.floor.subfloorSheetSqFt);
    add('floor.subfloor', 'floor', `23/32 T&G subfloor: ${area.toFixed(0)} sq ft +${W('sheathing') * 100}%`, area, 'sq ft', 'subfloor_2332_tg', sub);
    const glueLf = pieces.reduce((a, b) => a + b, 0) + rims.reduce((s, r) => s + plen(r), 0) + girders.reduce((s, g) => s + plen(g), 0);
    add('floor.adhesive', 'floor', `Subfloor adhesive (${glueLf.toFixed(0)} lf of framing)`, glueLf, 'lf', 'subfloor_adhesive_28oz', Math.ceil(glueLf / D.floor.adhesiveLfPerTube));
    var floorSheets = sub, floorDepthFt = (LUMBER[js] + fpP.subfloorIn) / 12;
  } else { var floorSheets = 0, floorDepthFt = 0; }

  // ---------------- WALLS ----------------
  const wp = wl.params, H = wp.plateHeightFt, studLenIn = H * 12 - (wp.bottomPlates + wp.topPlates) * 1.5;
  const walls = wl.objects.filter((x) => x.type === 'wall');
  const openings = wl.objects.filter((x) => x.type === 'opening');
  const studSuffix = D.stock.precutStuds[String(H)];
  const studTally = {}, plateRuns = {}, shortPieces = {};
  let openArea = 0, crippleTotal = 0;
  walls.forEach((w) => {
    const L = plen(w), size = w.props.size, oc = (w.props.studOcIn || wp.studOcIn) / 12;
    const ops = openings.filter((x) => x.geometry.wallId === w.id).map((x) => ({ center: x.geometry.t, widthFt: x.props.widthIn / 12, o: x }));
    const lay = studLayout(L, oc, ops);
    let n = lay.studs.length + lay.kings + lay.jacks;
    if (w.props.exterior) n += D.walls.extraStudsPerCorner * 2 / 2; // 2 corners per wall, 1 extra each side -> extraStudsPerCorner per corner overall
    studTally[size] = (studTally[size] || 0) + n;
    nail.count += lay.studs.length * NP.stud + lay.kings * NP.king + lay.jacks * NP.jack;
    (plateRuns[size] = plateRuns[size] || []).push(...Array(wp.bottomPlates + wp.topPlates).fill(L));
    nail.count += L * (wp.bottomPlates + wp.topPlates) * NP.plateLf;
    ops.forEach(({ o: op }) => {
      openArea += op.props.widthIn * op.props.heightIn / 144;
      const m = /(\d)-(2x\d+)/.exec(op.props.header || '2-2x6'); const plies = +m[1], hs = m[2];
      const hLen = (op.props.widthIn + 2 * D.walls.headerBearingIn) / 12;
      (shortPieces[hs] = shortPieces[hs] || []).push(...Array(plies).fill(hLen));
      nail.count += plies * NP.headerPly;
      const a = op.geometry.t - op.props.widthIn / 24, b = op.geometry.t + op.props.widthIn / 24;
      let k = 0; for (let d = oc; d < L; d += oc) if (d > a && d < b) k++;
      const above = studLenIn - (op.props.sillIn + op.props.heightIn) - LUMBER[hs];
      const below = op.props.kind === 'window' ? op.props.sillIn - 1.5 * wp.bottomPlates - 1.5 * D.walls.roughSillPlies : 0;
      const cr = [];
      if (above > 2) cr.push(...Array(k).fill(above / 12));
      if (below > 2) { cr.push(...Array(k).fill(below / 12)); (shortPieces[size] = shortPieces[size] || []).push(op.props.widthIn / 12); }
      (op.cripples = cr); crippleTotal += cr.length; nail.count += cr.length * NP.cripple;
      (studTally['_crip_' + size] = studTally['_crip_' + size] || []).push(...cr);
    });
  });
  const extCorners = fp.length; // extraStudsPerCorner applied above (per wall end pair)
  Object.keys(studTally).filter((k) => !k.startsWith('_')).forEach((size) => {
    const crip = studTally['_crip_' + size] || [];
    const cripStuds = pack(crip, studLenIn / 12);
    const n = studTally[size] + cripStuds;
    const ref = studSuffix && has(`lumber_${size}_${studSuffix}`) ? `lumber_${size}_${studSuffix}` : stock('lumber', size, studLenIn / 12).ref;
    add('walls.studs', 'walls', `${size} studs @ ${wp.studOcIn} in (o.c. + ends + king/jack + corner backers ${D.walls.extraStudsPerCorner}/corner) + ${cripStuds} studs cut into ${crip.length} cripples; stud ${studLenIn} in`, n, 'each', ref, withWasteCount(n, W('framing')));
  });
  const ptBottom = ftype === 'slab';
  Object.entries(plateRuns).forEach(([size, runs]) => {
    if (ptBottom) {
      const bottoms = runs.filter((_, i) => i % (wp.bottomPlates + wp.topPlates) < wp.bottomPlates), tops = runs.filter((_, i) => i % (wp.bottomPlates + wp.topPlates) >= wp.bottomPlates);
      addRuns('walls.plates', 'walls', `PT bottom plate ${size} (on concrete)`, 'pt', size, bottoms, 'framing');
      addRuns('walls.plates', 'walls', `Top plates ${size} (x${wp.topPlates})`, 'lumber', size, tops, 'framing');
    } else addRuns('walls.plates', 'walls', `Plates ${size}: ${wp.bottomPlates} bottom + ${wp.topPlates} top`, 'lumber', size, runs, 'framing');
  });
  Object.entries(shortPieces).forEach(([size, pcs]) => {
    const n = pack(pcs, 8);
    add('walls.headers', 'walls', `Headers (EXAMPLE table, verify) + window rough sills, ${size}: ${pcs.length} pieces from 8 ft stock`, pcs.length, 'pieces', `lumber_${size}_8`, withWasteCount(n, W('framing')), 'EXAMPLE header sizes - verify');
  });
  // sheathing / wrap
  const per = perim(fp), rc = rf.params.computed || {};
  const xs = fp.map((p) => p[0]), ys = fp.map((p) => p[1]);
  const spanAcross = rc.ridgeAlongX ? Math.max(...ys) - Math.min(...ys) : Math.max(...xs) - Math.min(...xs);
  const ridgeLenBldg = rc.ridgeAlongX ? Math.max(...xs) - Math.min(...xs) : Math.max(...ys) - Math.min(...ys);
  const gable = rf.params.shape === 'gable' ? 2 * spanAcross * (rc.rise || 0) / 2 : 0;
  const band = D.walls.bandIncludesFloor ? floorDepthFt : 0;
  const gross = per * (H + band) + gable;
  const shArea = gross - openArea;
  const wallSheets = Math.ceil(shArea * (1 + W('sheathing')) / 32);
  add('walls.sheathing', 'walls', `7/16 OSB walls: ${per.toFixed(0)} ft x ${(H + band).toFixed(2)} ft + gables ${gable.toFixed(1)} - openings ${openArea.toFixed(1)} = ${shArea.toFixed(0)} sq ft +${W('sheathing') * 100}%`, shArea, 'sq ft', 'osb_716_4x8', wallSheets);
  const wrapA = gross * D.envelope.wrapLapFactor;
  add('walls.wrap', 'walls', `House wrap ${gross.toFixed(0)} sq ft gross +laps`, wrapA, 'sq ft', 'housewrap_tyvek_9x150', Math.ceil(wrapA / P.housewrap_tyvek_9x150.pack_qty));
  add('walls.wrap', 'walls', 'House-wrap seam tape', gross, 'sq ft', 'housewrap_tape', Math.ceil(gross / D.envelope.tapeSqFtPerRoll));
  const ftLf = openings.reduce((s, x) => s + (x.props.kind === 'door' ? (2 * x.props.heightIn + x.props.widthIn) : 2 * (x.props.widthIn + x.props.heightIn)) / 12, 0) * D.envelope.flashingTapeFactor;
  if (openings.length) add('walls.flashingTape', 'walls', `Flashing tape around openings (${ftLf.toFixed(0)} lf)`, ftLf, 'lf', 'flashing_tape_4x75', Math.ceil(ftLf / 75));
  const prod = {};
  openings.forEach((x) => { const ref = `${x.props.kind === 'door' ? 'door_ext' : 'window'}_${x.props.widthIn}x${x.props.heightIn}`; prod[ref] = (prod[ref] || 0) + 1; });
  Object.entries(prod).forEach(([ref, n]) => add(ref.startsWith('door') ? 'walls.doors' : 'walls.windows', 'walls', ref.startsWith('door') ? 'Prehung exterior door' : 'Window', n, 'each', has(ref) ? ref : null, n, has(ref) ? undefined : 'no price_ref for this size - user picks a product'));

  // ---------------- ROOF ----------------
  const rafters = rf.objects.filter((x) => x.type === 'rafter');
  let roofArea = 0, roofSheets = 0;
  if (rafters.length) {
    const rp = rf.params, rlen = Math.hypot(plen(rafters[0]), rafters[0].props.zB - rafters[0].props.zA);
    addRuns('roof.rafters', 'roof', `Rafters ${rp.rafterSize} @ ${rp.rafterOcIn} in, ${rafters.length} incl. 4 barge, each ${rlen.toFixed(2)} ft (pitch ${rp.pitch}:12, overhang ${rp.overhangIn} in)`, 'lumber', rp.rafterSize, rafters.map(() => rlen), 'framing');
    const ridge = rf.objects.find((x) => x.props && x.props.role === 'ridge');
    const ridgeLen = ridge ? plen(ridge) : ridgeLenBldg + 2 * rp.overhangIn / 12;
    const ridgeSize = D.roof.ridgeOneSizeUp[rp.rafterSize];
    addRuns('roof.ridge', 'roof', `Ridge board ${ridgeSize} (${ridgeLen.toFixed(1)} ft incl. overhangs)`, 'lumber', ridgeSize, [ridgeLen], 'framing');
    const pairs = rafters.length / 2, bearingPairs = Math.max(0, pairs - 2);
    const tieSpan = spanAcross; const clear = spanAcross - 2 * LUMBER[wp.extSize] / 12;
    const cjSize = (opts.ceilingJoistSize) || D.roof.ceilingJoistTableEXAMPLE.find((x) => clear <= x.maxSpanFt).size.split(' ')[0];
    addRuns('roof.ceilingJoists', 'roof', `Ceiling joists / rafter ties ${cjSize} @ 24 in EXAMPLE (clear span ${clear.toFixed(1)} ft) - verify`, 'lumber', cjSize, Array(bearingPairs).fill(tieSpan), 'framing');
    const ct = Math.ceil(bearingPairs / D.roof.collarTie.everyNthPair), ctLen = spanAcross * D.roof.collarTie.lengthFraction;
    add('roof.collarTies', 'roof', `Collar ties 2x4 (${ct} @ ${ctLen.toFixed(1)} ft, every 2nd pair)`, ct, 'each', 'lumber_2x4_8', withWasteCount(pack(Array(ct).fill(ctLen), 8), W('framing')));
    const ht = bearingPairs * 2 * D.roof.hurricaneTiesPerBearing;
    add('roof.hurricaneTies', 'roof', `H2.5A hurricane ties (${ht}, one per bearing rafter)`, ht, 'each', 'hurricane_h25a', ht);
    add('roof.hurricaneTies', 'roof', 'Connector nails N8 0.131 x 1-1/2 (10 per tie)', ht * 10, 'nails', 'nails_connector_n8_150', Math.ceil(ht * 10 / 150));
    const gs = Math.max(0, Math.floor(spanAcross * 12 / wp.studOcIn) - 1), gLf = rf.params.shape === 'gable' ? 2 * gs * (rc.rise || 0) / 2 : 0;
    if (gLf) add('roof.gableFraming', 'roof', `Gable-end studs ${wp.extSize} (${2 * gs} studs, ${gLf.toFixed(0)} lf) - not modeled by app`, gLf, 'lf', `lumber_${wp.extSize}_8`, Math.ceil(gLf * (1 + W('framing')) / 8));
    const lk = (Math.ceil(rlen * 12 / D.roof.lookoutOcIn) + 1) * 4;
    if (rp.overhangIn > 0) add('roof.lookouts', 'roof', `Rake lookouts 2x4 x ${D.roof.lookoutLenFt} ft (${lk})`, lk, 'each', 'lumber_2x4_8', withWasteCount(pack(Array(lk).fill(D.roof.lookoutLenFt), 8), W('framing')));
    nail.count += rafters.length * NP.rafter + bearingPairs * (NP.ceilingJoist + NP.collarTie / 2) + ridgeLen * NP.ridge_lf + 2 * gs * NP.gableStud + lk * NP.lookout;
    roofArea = 2 * rlen * ridgeLen;
    roofSheets = Math.ceil(roofArea * (1 + W('sheathing')) / 32);
    add('roof.sheathing', 'roof', `Roof sheathing 7/16 OSB: 2 x ${rlen.toFixed(2)} x ${ridgeLen.toFixed(1)} = ${roofArea.toFixed(0)} sq ft +${W('sheathing') * 100}%`, roofArea, 'sq ft', 'osb_716_4x8', roofSheets, 'Panel must be rated for 24 in o.c. - check stamp');
    add('roof.sheathing', 'roof', `H-clips (${roofSheets * D.roof.sheathingClipsPerSheet})`, roofSheets * D.roof.sheathingClipsPerSheet, 'each', 'h_clip_716_50', Math.ceil(roofSheets * D.roof.sheathingClipsPerSheet / 50));
    const sq = roofArea / 100;
    add('roof.underlayment', 'roof', `Synthetic underlayment (${sq.toFixed(2)} squares)`, roofArea * 1.1, 'sq ft', 'underlayment_synth_1000', Math.ceil(roofArea * 1.1 / 1000));
    const eaves = 2 * ridgeLen, rakes = 4 * rlen;
    if (o.iceBarrier) add('roof.iceBarrier', 'roof', `Ice & water barrier at eaves (${eaves.toFixed(0)} lf x ${D.roof.iceBarrierWidthFt} ft)`, eaves * D.roof.iceBarrierWidthFt, 'sq ft', 'ice_water_150', Math.ceil(eaves * D.roof.iceBarrierWidthFt / 150));
    const bundles = Math.ceil(sq * (1 + W('shingles')) * D.roof.bundlesPerSquare);
    add('roof.shingles', 'roof', `Shingles: ${sq.toFixed(2)} sq +${W('shingles') * 100}% x 3 bundles/sq`, sq, 'squares', 'shingles_bundle', bundles);
    add('roof.dripEdge', 'roof', `Drip edge: eaves ${eaves.toFixed(0)} + rakes ${rakes.toFixed(0)} lf`, eaves + rakes, 'lf', 'drip_edge_10', Math.ceil((eaves + rakes) * 1.1 / 10));
    const st = (eaves + (D.roof.starterOnRakes ? rakes : 0)) * 1.1;
    add('roof.starter', 'roof', `Starter strip (${st.toFixed(0)} lf)`, st, 'lf', 'starter_bundle', Math.ceil(st / P.starter_bundle.pack_qty));
    add('roof.ridgeCap', 'roof', `Ridge cap (${ridgeLen.toFixed(0)} lf)`, ridgeLen, 'lf', 'ridge_cap_bundle', Math.ceil(ridgeLen * 1.05 / P.ridge_cap_bundle.pack_qty));
    const lb = sq * (1 + W('shingles')) * D.roof.roofingNailsLbPerSquare;
    add('roof.nails', 'roof', `Roofing nails 1-1/4 in (${lb.toFixed(1)} lb)`, lb, 'lb', 'roofing_nails_5lb', Math.ceil(lb / 5));
    const caps = sq * D.roof.capNailsPerSquare + gross * 0.5;
    add('roof.underlayment', 'roof', `Cap nails for underlayment + house wrap (~${Math.round(caps)})`, caps, 'nails', 'cap_nails_2000', Math.ceil(caps / 2000));
  } else flags.push('No rafters in model - roof not priced.');

  // ---------------- FASTENERS ----------------
  const fn = Math.ceil(nail.count * (1 + NP.extraPct));
  packs('fast.framingNails', 'all', `Framing nails 3-1/4 x .131 (~${fn}, EXAMPLE nailing)`, fn, 'nails_framing_16d_4000', 'nails_framing_16d_1000');
  const sn = floorSheets * D.floor.sheathingNailsPerSheet + wallSheets * D.walls.sheathingNailsPerSheet + roofSheets * D.roof.sheathingNailsPerSheet;
  packs('fast.sheathingNails', 'all', `Sheathing nails 2-3/8 ring shank (~${sn})`, sn, 'nails_sheathing_5000', 'nails_sheathing_2000');

  // ---------------- TOTALS ----------------
  const priced = lines.filter((l) => l.ext != null);
  const materials = r2(priced.reduce((s, l) => s + l.ext, 0));
  const estimated = r2(priced.filter((l) => !l.verified).reduce((s, l) => s + l.ext, 0));
  const unpriced = lines.filter((l) => l.ext == null).map((l) => l.desc);
  const tax = r2(materials * o.taxRatePct / 100);
  const contingency = r2((materials + tax) * (o.contingencyPct || 0) / 100);
  const delivery = r2(o.deliveryUsd || 0), labor = o.laborUsd == null ? null : r2(o.laborUsd);
  const total = r2(materials + tax + contingency + delivery + (labor || 0));
  const groups = {}; priced.forEach((l) => { groups[l.layer] = r2((groups[l.layer] || 0) + l.ext); });
  return { lines, groups, flags, concreteAlternatives: alt,
    totals: { materials, materials_from_estimated_prices: estimated, unpriced_lines: unpriced, taxRatePct: o.taxRatePct, tax, contingencyPct: o.contingencyPct, contingency, delivery, labor: labor ?? 'not included', total },
    report: { pierCount: piers.length, pierDiaIn: piers[0]?.props.diaIn, pierDepthIn: piers[0] ? Math.round(piers[0].height * 12) : null, concreteCuFt: r2(v), concreteYd: r2(yd), bags80, bags60, concreteMode: mode, anchorBolts: bolts, roofAreaSqFt: r2(roofArea), wallSheets, roofSheets, floorSheets, framingNails: fn, priceSnapshot: pricesDoc.meta.snapshot_date } };
}
