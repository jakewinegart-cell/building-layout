// takeoff-reference.mjs - REFERENCE implementation of content-v4/takeoff-rules.json.
// v4: tax rate and frost depth come from the zip lookup (jurisdictions.json) via opts.jurisdiction; no Denver defaults.
// Content, not app code: App Builder may port or import it. Pure functions, no DOM.
// takeoff(model, rules, prices, opts) -> { lines[], groups{}, totals{}, flags[], report{}, pieces[], fasteners{} }
// opts.fastenerSchedule = ../fastener-schedule.json. With it, every framing piece / sheet / roofing unit becomes a
// pieces[] record {pieceId, type, length, price, fasteners:[{type, count, unitPrice, subtotal}], total} (the $ inspect
// hover data) and the fastener purchase lines ('fast.<fastenerId>') are bought from the summed per-piece counts.
// Without it the legacy EXAMPLE nails-per-piece tally is used (flagged).
// opts.jurisdiction = resolveJurisdiction(jurisdictionsDoc, zip, jurisdictionId) (see below) or null.
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

// Pick the zip entry + one jurisdiction from jurisdictions.json. Returns null when the zip is unknown.
export function resolveJurisdiction(jdoc, zip, jurisdictionId) {
  const z = jdoc && jdoc.zips && jdoc.zips[String(zip || '').trim()];
  if (!z) return null;
  const id = jurisdictionId || z.default_jurisdiction_id;
  const j = z.jurisdictions.find((x) => x.id === id) || z.jurisdictions[0];
  const fd = j.design && j.design.frost_depth_in;
  return { zip: z.zip, place: z.place, jurisdiction: j, multiple: z.jurisdictions.length > 1, tax: z.tax, store: z.store,
    frostDepthIn: fd && fd.verified ? fd.value : null, frostVerified: !!(fd && fd.verified), frostSource: fd ? fd.source : null,
    taxRatePct: z.tax && z.tax.verified ? z.tax.combined_pct : null, taxVerified: !!(z.tax && z.tax.verified), taxSource: z.tax ? z.tax.sources : null,
    iceBarrier: j.design && j.design.ice_barrier_required ? j.design.ice_barrier_required.value : null };
}

// Required bottom-of-pier depth below grade (in). Code rule: bottom of footing/pier at or below the
// local frost depth (IRC R403.1.4.1 / MT ARM 24.301.142(9)) and never less than 12 in below undisturbed
// ground (IRC R403.1.4). marginIn is an optional user safety margin (default 0; code adds none).
export function requiredPierDepthIn(frostDepthIn, rules, marginIn) {
  const F = rules.defaults.frost;
  if (frostDepthIn == null) return null;
  return Math.max(Number(frostDepthIn) + (marginIn ?? F.extraMarginIn), F.minBelowUndisturbedIn);
}

export function takeoff(model, rules, pricesDoc, opts = {}) {
  const D = rules.defaults, P = pricesDoc.prices;
  const J = opts.jurisdiction || null;
  const o = Object.assign({ taxRatePct: null, contingencyPct: 10, deliveryUsd: 0, laborUsd: null, concreteMode: D.concrete.mode, iceBarrier: true }, opts);
  // tax: user override > zip lookup > unknown (priced as 0 and FLAGGED, never a made-up rate)
  let taxSource = 'user';
  if (opts.taxRatePct == null) {
    if (J && J.taxRatePct != null) { o.taxRatePct = J.taxRatePct; taxSource = `zip ${J.zip} lookup`; }
    else { o.taxRatePct = 0; taxSource = 'unknown'; }
  }
  if (opts.iceBarrier == null && J && J.iceBarrier != null) o.iceBarrier = J.iceBarrier;
  const lines = [], flags = [];
  if (taxSource === 'unknown') flags.push('Sales tax rate unknown (zip not in lookup and none entered) - priced at 0%. Enter your local rate.');
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

  // ---- $ inspect pieces (fastener-schedule.json) ----
  const FS = opts.fastenerSchedule || null;
  const PCS = [];
  // pc(type, lengthFt, lineId, ref, frac, ctx): one installed piece; frac = share of one purchased unit of ref
  const pc = (type, lengthFt, lineId, ref, frac = 1, ctx = {}) => PCS.push({ type, lengthFt, lineId, ref, frac, ctx });
  if (!FS) flags.push('No fastener schedule passed (opts.fastenerSchedule) - fasteners use the legacy EXAMPLE nails-per-piece tally, not code counts.');

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
    piers.forEach((p) => pc('pier', p.height, null, null, 0, { label: `${p.props.diaIn} in pier, ${Math.round(p.height * 12)} in deep` }));
    gbeams.forEach((b) => pc('grade_beam', plen(b), null, null, 0, { ties: lines4 * plen(b) / 2 + corners * 4 / gbeams.length }));
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
  // frost depth check against the zip lookup
  const pierBottomIn = piers.length ? Math.round(-Math.min(...piers.map((p) => p.z)) * 12) : null;
  const jFrost = J ? J.frostDepthIn : null;
  const reqIn = requiredPierDepthIn(jFrost ?? (fo.params.frostDepthIn || null), rules, opts.frostMarginIn);
  const frostSource = fo.params.frostDepthIn ? (jFrost != null && Number(fo.params.frostDepthIn) === jFrost ? `zip ${J.zip} lookup (${J.jurisdiction.label})` : 'user-entered') : 'not entered';
  if (!fo.params.frostDepthIn) flags.push(jFrost != null
    ? `Frost depth not applied to the model - piers priced at placeholder ${fo.params.placeholderFrostIn} in, but zip ${J.zip} (${J.jurisdiction.label}) requires ${jFrost} in. Set foundation.params.frostDepthIn = ${jFrost} and regenerate.`
    : `Frost depth unknown - piers priced at placeholder ${fo.params.placeholderFrostIn} in. Ask your building department and enter it.`);
  if (pierBottomIn != null && reqIn != null && pierBottomIn < reqIn) flags.push(`Piers bottom out at ${pierBottomIn} in below grade, shallower than the required ${reqIn} in (frost ${jFrost ?? fo.params.frostDepthIn} in${J ? `, ${J.jurisdiction.label}` : ''}). Deepen the piers.`);
  if (J) { const gs = J.jurisdiction.design && J.jurisdiction.design.ground_snow_load_psf; if (!gs || !gs.verified) flags.push(`Ground snow load for this site is UNVERIFIED (${J.jurisdiction.label}); rafter, ridge, header and ceiling-joist sizes are EXAMPLE and were NOT checked against it. Get the site value (ASCE 7 Hazard Tool or ${J.jurisdiction.call_first ? J.jurisdiction.call_first.name + ' ' + J.jurisdiction.call_first.phone : 'your building department'}).`); }
  if (J && J.multiple) flags.push(`ZIP ${J.zip} spans more than one code jurisdiction; using "${J.jurisdiction.label}". Confirm your address's county.`);

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
    sills.forEach((x) => { const L = plen(x), s = stock('pt', fpP.sillSize, L); for (let i = 0; i < s.n; i++) pc('sill_plate', L / s.n, 'floor.sill', s.ref, 1, { size: fpP.sillSize }); });
    const sillLf = sills.reduce((s, x) => s + plen(x), 0);
    add('floor.sillGasket', 'floor', `Sill gasket (${sillLf.toFixed(0)} lf)`, sillLf, 'lf', 'sill_gasket_2pk', Math.ceil(sillLf / 100));
    const rims = fl.objects.filter((x) => x.type === 'joist' && x.props.role === 'rim');
    addRuns('floor.rim', 'floor', `Rim joist ${js}`, 'lumber', js, rims.map(plen), 'framing');
    rims.forEach((x) => { const L = plen(x), s = stock('lumber', js, L); for (let i = 0; i < s.n; i++) pc('rim_joist', L / s.n, 'floor.rim', s.ref, 1, { size: js }); });
    const joists = fl.objects.filter((x) => x.type === 'joist' && !x.props.role);
    const girders = fl.objects.filter((x) => x.type === 'beam' && x.props.role === 'girder');
    const flush = girders.length && joists.length && Math.abs(girders[0].z - joists[0].z) < 0.1;
    let pieces = [];
    joists.forEach((j) => { const L = plen(j); if (flush) { const gw = girders[0].props.widthIn / 12; pieces.push((L - gw) / 2, (L - gw) / 2); } else pieces.push(L); });
    const intPar = wl.objects.filter((x) => x.type === 'wall' && !x.props.exterior).length; // proxy; refine with direction
    addRuns('floor.joists', 'floor', `Floor joists ${js} @ ${fpP.joistOcIn} in${flush ? ' (cut at flush mid beam)' : ''}`, 'lumber', js, pieces, 'framing');
    nail.count += pieces.length * NP.joist + rims.reduce((s, r) => s + plen(r), 0) * NP.rim_lf;
    pieces.forEach((L) => pc('floor_joist', L, 'floor.joists', stock('lumber', js, L).ref, 1, flush ? { size: js, bearings: 1, rimEnds: 1, hangers: 1 } : { size: js, bearings: 2, rimEnds: 2, hangers: 0 }));
    let hangers = flush ? joists.length * 2 : 0;
    if (girders.length) {
      girders.forEach((g) => {
        const plies = Math.round(g.props.widthIn / 1.5);
        const s = stock('lumber', js, plen(g));
        add('floor.girder', 'floor', `Mid beam FLAGGED: ${plies}-ply ${js} EXAMPLE, ${plen(g).toFixed(1)} ft - size by engineer; supports NOT priced`, plies * s.n, 'each', s.ref, plies * s.n, 'Supports/posts not generated; conflicts with piers-under-walls-only rule');
        for (let p = 0; p < plies; p++) for (let i = 0; i < s.n; i++) pc(p === 0 ? 'beam_ply_first' : 'beam_ply_added', plen(g) / s.n, 'floor.girder', s.ref, 1, { size: js, ply: p + 1 });
        if (!FS) {
          const scr = Math.ceil(plen(g) * 12 / 16) * 2;
          add('floor.girder', 'floor', `Structural screws to laminate beam plies (${scr})`, scr, 'each', 'screws_structural_12pk', Math.ceil(scr / 12));
        } else if (s.n > 1) flags.push('Mid beam plies are spliced: add 3 nails at each splice (Table R602.3(1) item 28) - not counted.');
      });
      flags.push(`Joist span ${fpP.computed?.spanFt} ft > beamFlagSpanFt ${fpP.beamFlagSpanFt}: app adds a FLAGGED mid beam whose supports are not generated. Under the piers-only-under-walls rule, prefer deeper joists that clear-span (verify) or have an engineer size the beam and its supports.`);
    }
    if (hangers) {
      const href = `hanger_lus${js.replace('2x', '2')}`;
      add('floor.hangers', 'floor', `Face-mount joist hangers at flush beam (${hangers})`, hangers, 'each', has(href) ? href : null, hangers, has(href) ? undefined : 'hanger price_ref missing for this joist size');
      if (!FS) add('floor.hangers', 'floor', 'Hanger nails 0.148 x 3 in (12 per hanger)', hangers * 12, 'nails', 'nails_connector_10d3_250', Math.ceil(hangers * 12 / 250));
    }
    const area = polyArea(fp);
    const sub = Math.ceil(area * (1 + W('sheathing')) / D.floor.subfloorSheetSqFt);
    add('floor.subfloor', 'floor', `23/32 T&G subfloor: ${area.toFixed(0)} sq ft +${W('sheathing') * 100}%`, area, 'sq ft', 'subfloor_2332_tg', sub);
    for (let i = 0; i < Math.ceil(area / D.floor.subfloorSheetSqFt); i++) pc('subfloor_sheet', 8, 'floor.subfloor', 'subfloor_2332_tg', 1, { supportOcIn: fpP.joistOcIn });
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
    const studRef = studSuffix && has(`lumber_${size}_${studSuffix}`) ? `lumber_${size}_${studSuffix}` : stock('lumber', size, studLenIn / 12).ref;
    lay.studs.forEach(() => pc('stud', studLenIn / 12, 'walls.studs', studRef, 1, { size }));
    for (let i = 0; i < lay.kings; i++) pc('king_stud', studLenIn / 12, 'walls.studs', studRef, 1, { size });
    if (w.props.exterior) for (let i = 0; i < D.walls.extraStudsPerCorner; i++) pc('corner_stud', studLenIn / 12, 'walls.studs', studRef, 1, { size });
    const nPl = wp.bottomPlates + wp.topPlates;
    for (let k = 0; k < nPl; k++) {
      const pre = ftype === 'slab' && k < wp.bottomPlates ? 'pt' : 'lumber', s = stock(pre, size, L);
      const t = k < wp.bottomPlates ? 'bottom_plate' : k === wp.bottomPlates ? 'top_plate_lower' : 'top_plate_upper';
      for (let i = 0; i < s.n; i++) pc(t, L / s.n, 'walls.plates', s.ref, 1, { size, laps: i === 0 ? 1 : 0, splices: i > 0 ? 1 : 0, exterior: !!w.props.exterior });
    }
    (plateRuns[size] = plateRuns[size] || []).push(...Array(wp.bottomPlates + wp.topPlates).fill(L));
    nail.count += L * (wp.bottomPlates + wp.topPlates) * NP.plateLf;
    ops.forEach(({ o: op }) => {
      openArea += op.props.widthIn * op.props.heightIn / 144;
      const m = /(\d)-(2x\d+)/.exec(op.props.header || '2-2x6'); const plies = +m[1], hs = m[2];
      const hLen = (op.props.widthIn + 2 * D.walls.headerBearingIn) / 12;
      (shortPieces[hs] = shortPieces[hs] || []).push(...Array(plies).fill(hLen));
      for (let p = 0; p < plies; p++) pc(p === 0 ? 'header_ply_first' : 'header_ply_added', hLen, 'walls.headers', `lumber_${hs}_8`, hLen / 8, { size: hs, ply: p + 1, opening: op.id });
      const jackLen = ((op.props.sillIn || 0) + op.props.heightIn) / 12; // jack: top of bottom plate to underside of header
      for (let i = 0; i < 2; i++) pc('jack_stud', jackLen, 'walls.studs', studRef, jackLen / (studLenIn / 12), { size, opening: op.id });
      nail.count += plies * NP.headerPly;
      const a = op.geometry.t - op.props.widthIn / 24, b = op.geometry.t + op.props.widthIn / 24;
      let k = 0; for (let d = oc; d < L; d += oc) if (d > a && d < b) k++;
      const above = studLenIn - (op.props.sillIn + op.props.heightIn) - LUMBER[hs];
      const below = op.props.kind === 'window' ? op.props.sillIn - 1.5 * wp.bottomPlates - 1.5 * D.walls.roughSillPlies : 0;
      const cr = [];
      if (above > 2) { cr.push(...Array(k).fill(above / 12)); for (let i = 0; i < k; i++) pc('cripple_above', above / 12, 'walls.studs', studRef, above / studLenIn, { size, opening: op.id }); }
      if (below > 2) {
        cr.push(...Array(k).fill(below / 12)); (shortPieces[size] = shortPieces[size] || []).push(op.props.widthIn / 12);
        for (let i = 0; i < k; i++) pc('cripple_below', below / 12, 'walls.studs', studRef, below / studLenIn, { size, opening: op.id });
        pc('rough_sill', op.props.widthIn / 12, 'walls.headers', `lumber_${size}_8`, op.props.widthIn / 96, { size, opening: op.id });
      }
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
  for (let i = 0; i < Math.ceil(shArea / 32); i++) pc('wall_sheet', 8, 'walls.sheathing', 'osb_716_4x8', 1, { supportOcIn: wp.studOcIn });
  add('walls.sheathing', 'walls', `7/16 OSB walls: ${per.toFixed(0)} ft x ${(H + band).toFixed(2)} ft + gables ${gable.toFixed(1)} - openings ${openArea.toFixed(1)} = ${shArea.toFixed(0)} sq ft +${W('sheathing') * 100}%`, shArea, 'sq ft', 'osb_716_4x8', wallSheets);
  const wrapA = gross * D.envelope.wrapLapFactor;
  add('walls.wrap', 'walls', `House wrap ${gross.toFixed(0)} sq ft gross +laps`, wrapA, 'sq ft', 'housewrap_tyvek_9x150', Math.ceil(wrapA / P.housewrap_tyvek_9x150.pack_qty));
  { // house-wrap cap nails on stud lines (DuPont: <= 18 in o.c.); gable-end stud lines added at their own heights
    const nr = Math.ceil(wrapA / P.housewrap_tyvek_9x150.pack_qty), hIn = (H + band) * 12, lines = Math.ceil(per * 12 / wp.studOcIn);
    let caps = lines * (Math.floor(hIn / 18) + 1);
    if (rf.params.shape === 'gable' && rc.rise) { const c = spanAcross / 2; for (let x = wp.studOcIn / 12; x < spanAcross - 1e-6; x += wp.studOcIn / 12) { const h = rc.rise * (1 - Math.abs(x - c) / c) * 12; caps += 2 * (Math.floor(h / 18) + 1); } }
    for (let i = 0; i < nr; i++) pc('housewrap', 150, 'walls.wrap', 'housewrap_tyvek_9x150', 1, { caps: caps / nr });
  }
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
    { const s = stock('lumber', rp.rafterSize, rlen), nb = rafters.length - 4; rafters.forEach((_, i) => pc(i < nb ? 'rafter' : 'rafter_barge', rlen, 'roof.rafters', s.ref, 1 / s.n, { size: rp.rafterSize })); }
    addRuns('roof.rafters', 'roof', `Rafters ${rp.rafterSize} @ ${rp.rafterOcIn} in, ${rafters.length} incl. 4 barge, each ${rlen.toFixed(2)} ft (pitch ${rp.pitch}:12, overhang ${rp.overhangIn} in)`, 'lumber', rp.rafterSize, rafters.map(() => rlen), 'framing');
    const ridge = rf.objects.find((x) => x.props && x.props.role === 'ridge');
    const ridgeLen = ridge ? plen(ridge) : ridgeLenBldg + 2 * rp.overhangIn / 12;
    const ridgeSize = D.roof.ridgeOneSizeUp[rp.rafterSize];
    { const s = stock('lumber', ridgeSize, ridgeLen); for (let i = 0; i < s.n; i++) pc('ridge_board', ridgeLen / s.n, 'roof.ridge', s.ref, 1, { size: ridgeSize, splices: i > 0 ? 1 : 0 }); }
    addRuns('roof.ridge', 'roof', `Ridge board ${ridgeSize} (${ridgeLen.toFixed(1)} ft incl. overhangs)`, 'lumber', ridgeSize, [ridgeLen], 'framing');
    const pairs = rafters.length / 2, bearingPairs = Math.max(0, pairs - 2);
    const tieSpan = spanAcross; const clear = spanAcross - 2 * LUMBER[wp.extSize] / 12;
    const cjSize = (opts.ceilingJoistSize) || D.roof.ceilingJoistTableEXAMPLE.find((x) => clear <= x.maxSpanFt).size.split(' ')[0];
    { const s = stock('lumber', cjSize, tieSpan); for (let k = 0; k < bearingPairs; k++) for (let i = 0; i < s.n; i++) pc('ceiling_joist', tieSpan / s.n, 'roof.ceilingJoists', s.ref, 1, { size: cjSize, bearings: s.n === 1 ? 2 : 1, heels: s.n === 1 ? 2 : 1, laps: i > 0 ? 1 : 0 }); }
    addRuns('roof.ceilingJoists', 'roof', `Ceiling joists / rafter ties ${cjSize} @ 24 in EXAMPLE (clear span ${clear.toFixed(1)} ft) - verify`, 'lumber', cjSize, Array(bearingPairs).fill(tieSpan), 'framing');
    const ct = Math.ceil(bearingPairs / D.roof.collarTie.everyNthPair), ctLen = spanAcross * D.roof.collarTie.lengthFraction;
    for (let i = 0; i < ct; i++) pc('collar_tie', ctLen, 'roof.collarTies', 'lumber_2x4_8', ctLen / 8, { size: '2x4' });
    add('roof.collarTies', 'roof', `Collar ties 2x4 (${ct} @ ${ctLen.toFixed(1)} ft, every 2nd pair)`, ct, 'each', 'lumber_2x4_8', withWasteCount(pack(Array(ct).fill(ctLen), 8), W('framing')));
    const ht = bearingPairs * 2 * D.roof.hurricaneTiesPerBearing;
    add('roof.hurricaneTies', 'roof', `H2.5A hurricane ties (${ht}, one per bearing rafter)`, ht, 'each', 'hurricane_h25a', ht);
    if (!FS) add('roof.hurricaneTies', 'roof', 'Connector nails N8 0.131 x 1-1/2 (10 per tie)', ht * 10, 'nails', 'nails_connector_n8_150', Math.ceil(ht * 10 / 150));
    const gs = Math.max(0, Math.floor(spanAcross * 12 / wp.studOcIn) - 1), gLf = rf.params.shape === 'gable' ? 2 * gs * (rc.rise || 0) / 2 : 0;
    if (gLf) { const c = spanAcross / 2; for (let k = 1; k <= gs; k++) { const x = k * wp.studOcIn / 12, h = (rc.rise || 0) * (1 - Math.abs(x - c) / c); for (let e = 0; e < 2; e++) pc('gable_stud', h, 'roof.gableFraming', `lumber_${wp.extSize}_8`, h / 8, { size: wp.extSize }); } }
    if (gLf) add('roof.gableFraming', 'roof', `Gable-end studs ${wp.extSize} (${2 * gs} studs, ${gLf.toFixed(0)} lf) - not modeled by app`, gLf, 'lf', `lumber_${wp.extSize}_8`, Math.ceil(gLf * (1 + W('framing')) / 8));
    const lk = (Math.ceil(rlen * 12 / D.roof.lookoutOcIn) + 1) * 4;
    if (rp.overhangIn > 0) for (let i = 0; i < lk; i++) pc('lookout', D.roof.lookoutLenFt, 'roof.lookouts', 'lumber_2x4_8', D.roof.lookoutLenFt / 8, { size: '2x4' });
    if (rp.overhangIn > 0) add('roof.lookouts', 'roof', `Rake lookouts 2x4 x ${D.roof.lookoutLenFt} ft (${lk})`, lk, 'each', 'lumber_2x4_8', withWasteCount(pack(Array(lk).fill(D.roof.lookoutLenFt), 8), W('framing')));
    nail.count += rafters.length * NP.rafter + bearingPairs * (NP.ceilingJoist + NP.collarTie / 2) + ridgeLen * NP.ridge_lf + 2 * gs * NP.gableStud + lk * NP.lookout;
    roofArea = 2 * rlen * ridgeLen;
    roofSheets = Math.ceil(roofArea * (1 + W('sheathing')) / 32);
    for (let i = 0; i < Math.ceil(roofArea / 32); i++) pc('roof_sheet', 8, 'roof.sheathing', 'osb_716_4x8', 1, { supportOcIn: rp.rafterOcIn, clipRef: 'h_clip_716_50' });
    add('roof.sheathing', 'roof', `Roof sheathing 7/16 OSB: 2 x ${rlen.toFixed(2)} x ${ridgeLen.toFixed(1)} = ${roofArea.toFixed(0)} sq ft +${W('sheathing') * 100}%`, roofArea, 'sq ft', 'osb_716_4x8', roofSheets, 'Panel must be rated for 24 in o.c. - check stamp');
    add('roof.sheathing', 'roof', `H-clips (${roofSheets * D.roof.sheathingClipsPerSheet})`, roofSheets * D.roof.sheathingClipsPerSheet, 'each', 'h_clip_716_50', Math.ceil(roofSheets * D.roof.sheathingClipsPerSheet / 50));
    const sq = roofArea / 100;
    add('roof.underlayment', 'roof', `Synthetic underlayment (${sq.toFixed(2)} squares)`, roofArea * 1.1, 'sq ft', 'underlayment_synth_1000', Math.ceil(roofArea * 1.1 / 1000));
    { const nr = Math.ceil(roofArea * 1.1 / 1000); for (let i = 0; i < nr; i++) pc('underlayment', 250, 'roof.underlayment', 'underlayment_synth_1000', 1, { slopeIn: rlen * 12, eaveIn: ridgeLen * 12, planes: 2 / nr }); }
    const eaves = 2 * ridgeLen, rakes = 4 * rlen;
    if (o.iceBarrier) pc('ice_barrier', eaves, 'roof.iceBarrier', 'ice_water_150', 1, {});
    if (o.iceBarrier) add('roof.iceBarrier', 'roof', `Ice & water barrier at eaves (${eaves.toFixed(0)} lf x ${D.roof.iceBarrierWidthFt} ft)`, eaves * D.roof.iceBarrierWidthFt, 'sq ft', 'ice_water_150', Math.ceil(eaves * D.roof.iceBarrierWidthFt / 150));
    const bundles = Math.ceil(sq * (1 + W('shingles')) * D.roof.bundlesPerSquare);
    for (let i = 0; i < Math.ceil(sq * D.roof.bundlesPerSquare); i++) pc('shingle_bundle', 0, 'roof.shingles', 'shingles_bundle', 1, {});
    add('roof.shingles', 'roof', `Shingles: ${sq.toFixed(2)} sq +${W('shingles') * 100}% x 3 bundles/sq`, sq, 'squares', 'shingles_bundle', bundles);
    for (let i = 0; i < Math.ceil((eaves + rakes) / (10 - 2 / 12)); i++) pc('drip_edge', 10, 'roof.dripEdge', 'drip_edge_10', 1, {});
    add('roof.dripEdge', 'roof', `Drip edge: eaves ${eaves.toFixed(0)} + rakes ${rakes.toFixed(0)} lf`, eaves + rakes, 'lf', 'drip_edge_10', Math.ceil((eaves + rakes) * 1.1 / 10));
    const st = (eaves + (D.roof.starterOnRakes ? rakes : 0)) * 1.1;
    add('roof.starter', 'roof', `Starter strip (${st.toFixed(0)} lf)`, st, 'lf', 'starter_bundle', Math.ceil(st / P.starter_bundle.pack_qty));
    { let left = eaves + (D.roof.starterOnRakes ? rakes : 0); while (left > 1e-6) { const lf = Math.min(left, P.starter_bundle.pack_qty); pc('starter_bundle', lf, 'roof.starter', 'starter_bundle', 1, { lf }); left -= lf; } }
    add('roof.ridgeCap', 'roof', `Ridge cap (${ridgeLen.toFixed(0)} lf)`, ridgeLen, 'lf', 'ridge_cap_bundle', Math.ceil(ridgeLen * 1.05 / P.ridge_cap_bundle.pack_qty));
    { const nb = Math.ceil(ridgeLen * 1.05 / P.ridge_cap_bundle.pack_qty); for (let i = 0; i < nb; i++) pc('ridge_cap_bundle', ridgeLen / nb, 'roof.ridgeCap', 'ridge_cap_bundle', 1, { ridgeIn: ridgeLen * 12 / nb, starter: i === 0 ? 1 : 0 }); }
    const lb = sq * (1 + W('shingles')) * D.roof.roofingNailsLbPerSquare;
    if (!FS) add('roof.nails', 'roof', `Roofing nails 1-1/4 in (${lb.toFixed(1)} lb)`, lb, 'lb', 'roofing_nails_5lb', Math.ceil(lb / 5));
    const caps = sq * D.roof.capNailsPerSquare + gross * 0.5;
    if (!FS) add('roof.underlayment', 'roof', `Cap nails for underlayment + house wrap (~${Math.round(caps)})`, caps, 'nails', 'cap_nails_2000', Math.ceil(caps / 2000));
  } else flags.push('No rafters in model - roof not priced.');

  // ---------------- FASTENERS ----------------
  const fn = Math.ceil(nail.count * (1 + NP.extraPct));
  if (!FS) {
  packs('fast.framingNails', 'all', `Framing nails 3-1/4 x .131 (~${fn}, EXAMPLE nailing)`, fn, 'nails_framing_16d_4000', 'nails_framing_16d_1000');
  const sn = floorSheets * D.floor.sheathingNailsPerSheet + wallSheets * D.walls.sheathingNailsPerSheet + roofSheets * D.roof.sheathingNailsPerSheet;
  packs('fast.sheathingNails', 'all', `Sheathing nails 2-3/8 ring shank (~${sn})`, sn, 'nails_sheathing_5000', 'nails_sheathing_2000');
  }
  // sill anchor bolts: the code rule is per plate segment, so check the line against the per-piece count
  const fsr = FS ? fastenerPass({ FS, PCS, P, D, lines, flags, add, unitPrice, rf, J, spanAcrossFt: spanAcross }) : null;
  if (fsr) { const pb = fsr.pieces.filter((x) => x.type === 'sill_plate').reduce((s, x) => s + (x.fasteners.find((f) => f.type === 'anchor_bolt')?.count || 0), 0); if (pb > bolts) flags.push(`Anchor bolts: ${pb} needed when counted per sill piece (>= 2 per piece, <= 12 in from each end) vs ${bolts} on the line - add ${pb - bolts}.`); }

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
  return { lines, groups, flags, concreteAlternatives: alt, pieces: fsr ? fsr.pieces : [], fasteners: fsr ? fsr.summary : null,
    totals: { materials, materials_from_estimated_prices: estimated, unpriced_lines: unpriced, taxRatePct: o.taxRatePct, taxSource, tax, contingencyPct: o.contingencyPct, contingency, delivery, labor: labor ?? 'not included', total },
    report: { pierCount: piers.length, pierDiaIn: piers[0]?.props.diaIn, pierDepthIn: piers[0] ? Math.round(piers[0].height * 12) : null, concreteCuFt: r2(v), concreteYd: r2(yd), bags80, bags60, concreteMode: mode, anchorBolts: bolts, roofAreaSqFt: r2(roofArea), wallSheets, roofSheets, floorSheets, framingNails: FS ? null : fn, fastenerMode: FS ? `schedule ${FS.version}` : 'legacy EXAMPLE tally', priceSnapshot: pricesDoc.meta.snapshot_date,
      pierBottomBelowGradeIn: pierBottomIn, requiredPierDepthIn: reqIn, frostDepthIn: fo.params.frostDepthIn ?? null, frostSource,
      jurisdiction: J ? { zip: J.zip, id: J.jurisdiction.id, label: J.jurisdiction.label, code: J.jurisdiction.code, callFirst: J.jurisdiction.call_first } : null,
      store: J && J.store ? { label: `${J.store.retailer} ${J.store.name}`, localized: false, note: J.store.price_localization?.note } : null } };
}

// ---------------- $ inspect: per-piece fasteners from fastener-schedule.json ----------------
const r4 = (x) => Math.round(x * 10000) / 10000;
function sheetNails(r, supportOcIn) {
  const oc = supportOcIn || r.support_oc_in;
  if (r.long_edges_on_framing) { // vertical wall sheet: long edges + plates at edge spacing, studs between at field spacing
    const lines = Math.round(r.w_in / oc) + 1, edge = r.l_in / r.edge_oc_in + 1, plate = r.w_in / r.edge_oc_in + 1 - 2, mid = r.l_in / r.field_oc_in + 1 - 2;
    return 2 * edge + 2 * plate + (lines - 2) * mid;
  }
  const sup = Math.round(r.l_in / oc) + 1; // panel long direction across supports
  return 2 * (r.w_in / r.edge_oc_in + 1) + (sup - 2) * (r.w_in / r.field_oc_in + 1);
}
function heelNails(H, { slopePitch, spacingIn, spanFt, snowPsf }) {
  if (Number(slopePitch) !== Number(H.slope.split(':')[0])) return { n: null, why: `heel-joint table stored only for ${H.slope}; pitch ${slopePitch}:12 - look up Table R802.5.2(1)` };
  const sp = Object.keys(H.by_spacing_in).map(Number).sort((a, b) => a - b).find((x) => x >= spacingIn - 1e-6);
  const sn = Object.keys(H.by_spacing_in[String(sp)]).map(Number).sort((a, b) => a - b).find((x) => x >= snowPsf - 1e-6);
  const ci = H.spans_ft.findIndex((x) => x >= spanFt - 1e-6);
  if (sp == null || sn == null || ci < 0) return { n: null, why: 'outside Table R802.5.2(1) - heel joint must be engineered' };
  return { n: H.by_spacing_in[String(sp)][String(sn)][ci], spacing: sp, snow: sn, span: H.spans_ft[ci] };
}
function fastenerPass({ FS, PCS, P, D, lines, flags, add, unitPrice, rf, J, spanAcrossFt }) {
  const F = FS.fasteners, notes = new Set();
  const lineFor = (id, ref) => lines.find((l) => l.id === id && l.price_ref === ref) || lines.find((l) => l.price_ref === ref);
  const getPath = (path) => path.split('.').slice(1).reduce((o, k) => o && o[k], D);
  // heel-joint nails (per ceiling-joist end)
  const gs = J && J.jurisdiction.design && J.jurisdiction.design.ground_snow_load_psf;
  const snowKnown = gs && gs.verified && gs.value != null;
  const heel = heelNails(FS.heel_table, { slopePitch: rf.params.pitch, spacingIn: rf.params.rafterOcIn, spanFt: spanAcrossFt, snowPsf: snowKnown ? gs.value : FS.heel_table.unknown_snow_psf_used });
  if (!snowKnown) flags.push(`Heel joints: ${FS.heel_table.unknown_snow_flag} -> ${heel.n ?? '?'} x 16d per heel (rafter spacing ${heel.spacing} in, span column ${heel.span} ft).`);
  if (heel.n == null) flags.push(`Heel joints: ${heel.why}. Not counted.`);
  // 1) raw counts per piece
  const raw = PCS.map((pc, idx) => {
    const spec = FS.pieces[pc.type]; const Lin = pc.lengthFt * 12, c = pc.ctx; const out = [];
    if (!spec) { notes.add(`no schedule entry for piece type ${pc.type}`); return { pc, idx, out }; }
    for (const conn of spec.connections || []) {
      const r = conn.rule || {}; let n = 0;
      switch (r.kind) {
        case 'fixed': n = r.n; break;
        case 'per_end': n = r.n * (r.ends || 2); break;
        case 'spacing': n = (r.rows || 1) * (Math.floor(Lin / r.oc_in + 1e-9) + 1) + (r.plus || 0); break;
        case 'groups': if (pc.type === 'bottom_plate' && !c.exterior) n = Math.floor(Lin / 12 + 1e-9) + 1; else n = r.n * Math.ceil(Lin / r.oc_in - 1e-9); break;
        case 'per_bearing': n = r.n * (c.bearings ?? 2); break;
        case 'per_rim_end': n = r.n * (c.rimEnds ?? 2); break;
        case 'per_hanger': n = (r.n_by_size ? r.n_by_size[c.size] ?? null : r.n) * (c.hangers || 0); if (Number.isNaN(n) || n == null) { n = 0; if (c.hangers) notes.add(`hanger nail count missing for ${c.size}`); } break;
        case 'per_splice': n = r.n * (c.splices || 0); break;
        case 'per_lap': n = r.n * (c.laps || 0); break;
        case 'per_lf': n = r.per_lf * (c.lf ?? pc.lengthFt); break;
        case 'sheet': n = sheetNails(r, c.supportOcIn); break;
        case 'heel_table': n = heel.n == null ? 0 : heel.n * (c.heels ?? 2); break;
        case 'anchor_bolts': n = Math.max(r.min_per_plate, Math.ceil((pc.lengthFt - 2 * r.max_from_end_in / 12) / r.max_oc_ft) + 1); break;
        case 'ridge_cap': n = r.nails_per_piece * (Math.ceil(c.ridgeIn / r.exposure_in) + (c.starter || 0)); break;
        case 'underlayment': { const courses = Math.ceil(c.slopeIn / (r.roll_w_in - r.side_lap_in)); n = c.planes * ((courses + 1) * (Math.floor(c.eaveIn / r.lap_oc_in) + 1) + courses * (Math.floor(c.eaveIn / r.center_oc_in) + 1)); break; }
        case 'housewrap': n = c.caps || 0; break;
        case 'per_lf_bars': n = c.ties || 0; break;
        default: n = 0;
      }
      if (conn.fastener && n > 0) out.push({ fid: conn.fastener, count: n, conn });
    }
    return { pc, idx, out };
  });
  // 2) aggregate + buy
  const need = {}; raw.forEach(({ out }) => out.forEach((f) => { need[f.fid] = (need[f.fid] || 0) + f.count; }));
  const buys = {};
  const bestMix = (opts, q) => {
    const O = opts.filter((r) => P[r] && P[r].price != null && P[r].pack_qty);
    let best = null; const A = O[0], B = O[1];
    if (!A) return null;
    for (let na = 0; na <= Math.ceil(q / P[A].pack_qty); na++) {
      const rem = Math.max(0, q - na * P[A].pack_qty), nb = B ? Math.ceil(rem / P[B].pack_qty) : 0;
      if (!B && rem > 0) continue;
      const cost = na * unitPrice(A, na) + (B ? nb * unitPrice(B, nb) : 0);
      if (!best || cost < best.cost - 1e-9) best = { mix: [[A, na], [B, nb]].filter(([r, n]) => r && n > 0), cost };
    }
    return best;
  };
  // fasteners sharing one box product are bought together (e.g. 8d HDG for ties + roof sheathing)
  const agg = Object.keys(need).filter((id) => F[id] && F[id].purchase === 'aggregate');
  const qty = Object.fromEntries(agg.map((id) => [id, Math.ceil(need[id] * (1 + (F[id].extra_pct || 0)))]));
  agg.forEach((id) => { buys[id] = bestMix(F[id].options, qty[id]); });
  const merged = {}; // box ref -> [ids] for single-box choices
  agg.forEach((id) => { const b = buys[id]; if (b && b.mix.length === 1) (merged[b.mix[0][0]] = merged[b.mix[0][0]] || []).push(id); });
  const groupsOut = [];
  const done = new Set();
  Object.entries(merged).forEach(([ref, ids]) => {
    if (ids.length < 2) return;
    const q = ids.reduce((s, id) => s + qty[id], 0), n = Math.ceil(q / P[ref].pack_qty), sep = ids.reduce((s, id) => s + buys[id].cost, 0), cost = n * unitPrice(ref, n);
    if (cost <= sep + 1e-9) { groupsOut.push({ ids, mix: [[ref, n]], q }); ids.forEach((id) => done.add(id)); }
  });
  agg.filter((id) => !done.has(id)).forEach((id) => groupsOut.push({ ids: [id], mix: buys[id] ? buys[id].mix : [], q: qty[id] }));
  const unit = {}; // fastener id -> unit price (bought cost / bought count)
  const lineOf = {}; groupsOut.forEach((g) => g.ids.forEach((id) => { lineOf[id] = `fast.${g.ids.join('+')}`; }));
  groupsOut.forEach((g) => {
    if (!g.mix.length) { g.ids.forEach((id) => { unit[id] = null; flags.push(`Fastener ${F[id].label}: PRICE NEEDED (no priced option)`); }); return; }
    const cnt = g.mix.reduce((s, [r, n]) => s + n * P[r].pack_qty, 0), cost = g.mix.reduce((s, [r, n]) => s + n * unitPrice(r, n), 0);
    g.ids.forEach((id) => { unit[id] = cost / cnt; });
    const label = g.ids.map((id) => `${F[id].label} ${Math.round(need[id])}`).join(' + ');
    g.mix.forEach(([r, n]) => add(`fast.${g.ids.join('+')}`, 'all', `${label} installed (fastener-schedule.json) +extra = ${g.q} to buy`, g.q, 'nails', r, n, 'per-piece code/manufacturer counts; see pieces[]'));
  });
  // connectors already bought by their own line: unit price from that line
  Object.keys(need).filter((id) => F[id] && F[id].purchase === 'line').forEach((id) => {
    const f = F[id];
    if (f.price_ref_by_size) { unit[id] = Object.fromEntries(Object.entries(f.price_ref_by_size).map(([sz, ref]) => { const l = lineFor(f.line_id, ref); return [sz, l && l.unit_price != null ? l.unit_price : null]; })); return; }
    const l = lineFor(f.line_id, f.price_ref); const per = f.units_per_pack_rule ? getPath(f.units_per_pack_rule) : (P[f.price_ref].pack_qty || 1);
    unit[id] = l && l.unit_price != null ? l.unit_price / per : null;
    if (!l) notes.add(`${id}: line ${f.line_id} not in this takeoff`);
  });
  // 3) piece records
  const typeCount = {};
  const pieces = raw.map(({ pc, out }) => {
    const spec = FS.pieces[pc.type] || {};
    typeCount[pc.type] = (typeCount[pc.type] || 0) + 1;
    const l = pc.ref ? lineFor(pc.lineId, pc.ref) : null;
    const price = l && l.unit_price != null ? r2(l.unit_price * pc.frac) : null;
    const priceNote = pc.ref ? (price == null ? 'PRICE NEEDED' : undefined) : 'concrete + rebar priced on the foundation lines';
    const fasteners = out.map(({ fid, count, conn }) => {
      const u0 = unit[fid]; const u = u0 && typeof u0 === 'object' ? u0[pc.ctx.size] ?? null : u0;
      const f = F[fid];
      return { type: fid, label: f.short || f.label, kind: f.kind, count: r2(count), unitPrice: u == null ? null : r4(u), subtotal: u == null ? null : r4(count * u), to: conn.to, code: conn.item != null ? String(conn.item) : undefined, source: conn.source, alt: conn.alt, flag: conn.interpretation || f.interpretation || undefined, bought_on: f.purchase === 'line' ? f.line_id : lineOf[fid] };
    });
    const fsum = fasteners.reduce((s, f) => s + (f.subtotal || 0), 0);
    const total = price == null ? null : r2(price + fsum);
    const hover = hoverCopy({ label: spec.label, size: pc.ctx.size, lengthIn: pc.lengthFt * 12, price, priceNote, fasteners, total, sheet: /sheet|bundle|drip|underlay|housewrap|ice_/.test(pc.type) });
    return { pieceId: `${pc.type}-${typeCount[pc.type]}`, type: pc.type, label: spec.label, size: pc.ctx.size, length: r2(pc.lengthFt), lengthIn: r2(pc.lengthFt * 12), price, price_ref: pc.ref, priceBasis: !pc.ref ? priceNote : pc.frac === 1 ? 'one purchased unit' : `${(pc.frac * 100).toFixed(0)}% of one ${pc.ref}`, line: pc.lineId, fasteners, fastenersTotal: r2(fsum), total, hover, ctx: pc.ctx, EXAMPLE: true };
  });
  // 4) summary
  const summary = { schedule: FS.version, byType: {}, notes: [...notes] };
  Object.keys(need).forEach((id) => {
    const used = pieces.reduce((s, p) => s + p.fasteners.filter((f) => f.type === id).reduce((a, f) => a + (f.subtotal || 0), 0), 0);
    const g = groupsOut.find((x) => x.ids.includes(id));
    summary.byType[id] = { label: F[id].label, kind: F[id].kind, installed: r2(need[id]), toBuy: g ? qty[id] : undefined, boxes: g ? g.mix.map(([r, n]) => ({ price_ref: r, n, pack_qty: P[r].pack_qty, box_price: unitPrice(r, n) })) : undefined, sharedWith: g && g.ids.length > 1 ? g.ids.filter((x) => x !== id) : undefined, unitPrice: typeof unit[id] === 'number' ? r4(unit[id]) : unit[id], usedValue: r2(used), boughtOn: F[id].purchase === 'line' ? F[id].line_id : `fast.${(g ? g.ids : [id]).join('+')}` };
  });
  const fastLines = lines.filter((l) => l.id.startsWith('fast.'));
  summary.purchasedCost = r2(fastLines.reduce((s, l) => s + (l.ext || 0), 0));
  summary.usedValueNailsOnly = r2(Object.entries(summary.byType).filter(([id]) => F[id].purchase === 'aggregate').reduce((s, [, v]) => s + v.usedValue, 0));
  summary.heelJoint = heel;
  return { pieces, summary };
}

// hover copy (see fastener-schedule.md "Hover copy format"): money < $0.10 shows 3 decimals, else 2
export const money = (x) => (x == null ? 'PRICE NEEDED' : `$${Math.abs(x) < 0.1 && x !== 0 ? x.toFixed(3) : x.toFixed(2)}`);
const fmtCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtLen = (inch) => { const ft = Math.floor(inch / 12 + 1e-9), i = Math.round((inch - ft * 12) * 8) / 8; return ft ? `${ft} ft${i ? ` ${i} in` : ''}` : `${i} in`; };
export function hoverCopy({ label, size, lengthIn, price, priceNote, fasteners, total, sheet }) {
  const head = `${size ? size + ' ' : ''}${(label || '').replace(/\s*\(.*\)$/, '')}${!sheet && lengthIn ? ', ' + fmtLen(lengthIn) : ''}`;
  const out = [head, price == null && priceNote ? priceNote : `${money(price)} EXAMPLE`];
  const m = []; // same fastener type merged for the hover (pieces[].fasteners keeps one row per connection)
  fasteners.forEach((f) => { const x = m.find((y) => y.type === f.type && y.unitPrice === f.unitPrice); if (x) { x.count += f.count; x.subtotal = x.subtotal == null ? null : x.subtotal + f.subtotal; } else m.push({ ...f }); });
  m.forEach((f) => out.push(`${fmtCount(f.count)} x ${f.label} @ ${money(f.unitPrice)}${f.kind === 'adhesive' ? '/lf' : ' each'} = ${money(f.subtotal)}`));
  out.push(`total ${total == null && priceNote ? money(fasteners.reduce((a, f) => a + (f.subtotal || 0), 0)) : money(total)} EXAMPLE${fasteners.some((f) => f.unitPrice == null) ? ' (+ PRICE NEEDED items)' : ''}`);
  return out;
}
