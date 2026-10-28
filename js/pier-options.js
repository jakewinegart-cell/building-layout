// ============================================================================
// pier-options.js — hotfix "Piers only" + pier shapes, applied around the content-v4 reference
// engine (which only knows round Sonotubes) so Price check, $ inspect and the plan sheets agree:
//   • round Sonotube   → the engine prices it (form tube, concrete, rebar) as before.
//   • square formed    → concrete s×s×h (merged into the one concrete line), #4 verticals (EXAMPLE),
//                        square form boards = "needs a price" (no Home Depot price in the file).
//   • precast block    → "needs a price" (no Home Depot price for a precast pier/deck block in
//                        content-v3 or content-v4 homedepot-prices.json). No concrete, no rebar.
//                        FLAGGED: sits on the surface, NOT frost-protected.
//   • Piers only       → no grade beam: pier rebar has no dowel into a beam and no corner L-bars.
// ============================================================================
import { pierShapeOf, precastFrostWarning, PIER_SHAPES } from './config.js';

const r2 = (x) => Math.round(x * 100) / 100;
const plen = (o) => Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]);
const polyArea = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const fnd = (m) => m.layers.find((l) => l.id === 'foundation');

/** Split the model copy for the engine: non-round piers are taken out (the engine would buy tubes for them). */
export function prepareEngineModel(mm) {
  const l = fnd(mm); const f = l.params;
  const square = [], precast = [];
  l.objects = l.objects.filter((o) => {
    if (o.type !== 'pier') return true;
    const sh = pierShapeOf(o, f);
    if (sh.shape === 'square') { square.push({ o, sh }); return false; }
    if (sh.shape === 'precast') { precast.push({ o, sh }); return false; }
    return true;
  });
  return { square, precast, type: f.type, round: l.objects.filter((o) => o.type === 'pier') };
}

export function squareVerticals(D, sizeIn) { const t = D.rebar.pierVerticalsEXAMPLE; return (t.find((x) => sizeIn <= x.maxDiaIn) || t[t.length - 1]).bars; }

/** Mutates the engine result r (lines, flags, groups, totals, report). */
export function applyPierOptions(r, mm, split, C) {
  const D = C.rules.defaults, P = C.prices.prices; const f = fnd(mm).params;
  const W = (k) => (D.waste[k] != null ? D.waste[k] : 0);
  const up = (ref, qty) => { const p = P[ref]; if (!p || p.price == null) return null; return p.bulk_price && qty >= p.bulk_price.min_qty ? p.bulk_price.price : p.price; };
  const mk = (id, desc, qtyCalc, unit, ref, buy, note) => { const u = ref ? up(ref, buy) : null; return { id, layer: 'foundation', desc, qty_calc: r2(qtyCalc), unit, buy, price_ref: ref, unit_price: u, ext: u == null ? null : r2(u * buy), verified: !!(ref && P[ref] && P[ref].verified), note }; };
  const changed = [];
  const R = D.rebar;
  const nSq = split.square.length, nPre = split.precast.length;
  const piersOnly = split.type === 'piersOnly';

  // (1) Piers only: pier rebar has no dowel into a grade beam and no corner L-bars; ties are 2 per pier
  if (piersOnly && split.round.length) {
    const rb = r.lines.find((l) => l.id === 'found.rebar' && /pier verticals/.test(l.desc));
    if (rb) {
      let lf = 0; split.round.forEach((p) => { const bars = R.pierVerticalsEXAMPLE.find((x) => p.props.diaIn <= x.maxDiaIn).bars; lf += bars * (p.height * 12 - R.coverIn) / 12; });
      const bars = Math.ceil(lf * (1 + W('rebar')) / R.stockFt);
      Object.assign(rb, mk('found.rebar', `#4 rebar EXAMPLE: pier verticals only (Piers only: no grade beam, no corner bars) = ${lf.toFixed(0)} lf`, lf, 'lf', 'rebar_4_20', bars, 'EXAMPLE steel - engineer/plans govern'));
    }
    const tw = r.lines.find((l) => l.id === 'found.tieWire');
    if (tw) { const ties = 2 * split.round.length + 2 * nSq; Object.assign(tw, mk('found.tieWire', `Tie wire (~${ties} ties)`, ties, 'ties', 'tie_wire_roll', Math.max(1, Math.ceil(ties / R.tiesPerRollEstimate)))); }
    changed.push('piersOnly');
  }

  // (2) square formed piers: concrete merged into the one concrete line, verticals, forms (needs a price)
  if (nSq || nPre) {
    const fo = fnd(mm);
    const vRound = split.round.reduce((s, p) => s + Math.PI * (p.props.diaIn / 24) ** 2 * p.height, 0);
    const vSq = split.square.reduce((s, q) => s + (q.sh.sizeIn / 12) ** 2 * q.o.height, 0);
    const gb = fo.objects.filter((x) => x.type === 'beam' && x.props.role === 'gradeBeam');
    const vGB = gb.reduce((s, b) => s + plen(b) * (b.props.widthIn / 12) * (f.gradeBeamDepthIn / 12), 0);
    const vFoot = fo.objects.filter((x) => x.type === 'footing').reduce((s, x) => s + plen(x) * (x.props.widthIn / 12) * x.height, 0);
    const vSlab = fo.objects.filter((x) => x.type === 'area' && x.props.role === 'slab').reduce((s, a) => s + polyArea(a.geometry.pts) * a.height, 0);
    const vRaw = vRound + vSq + vGB + vFoot + vSlab, v = vRaw * (1 + W('concrete')), yd = v / 27;
    const bags80 = Math.ceil(v / D.concrete.bagYieldCuFt['80']), bags60 = Math.ceil(v / D.concrete.bagYieldCuFt['60']);
    const cm = (r.report && r.report.concreteModeRequested) || C.concreteMode || 'auto';
    const mode = cm === 'auto' ? (yd > D.concrete.readyMixThresholdYd ? 'readymix' : 'bags80') : cm;
    const parts = [['round piers', vRound], ['square piers', vSq], ['grade beam', vGB], ['footings/stem', vFoot], ['slab', vSlab]].filter(([k, x]) => x > 0 || k === 'square piers' && nSq).map(([k, x]) => `${k} ${x.toFixed(1)}`).join(' + ') || 'none';
    const desc = `Concrete: ${parts} = ${vRaw.toFixed(1)} cu ft; +${W('concrete') * 100}% = ${v.toFixed(1)} cu ft = ${yd.toFixed(2)} yd = ${bags80} x 80 lb or ${bags60} x 60 lb bags${nPre ? ` (${nPre} precast block(s): no poured concrete)` : ''}`;
    const at = r.lines.findIndex((l) => l.id === 'conc.total');
    const keep = r.lines.filter((l) => l.id !== 'conc.total');
    const conc = [];
    if (vRaw <= 0) { /* nothing poured (all precast) */ }
    else if (mode === 'readymix') { const ord = Math.ceil(yd * 2) / 2; conc.push(mk('conc.total', desc + ` -> READY-MIX recommended (> ${D.concrete.readyMixThresholdYd} yd), order ${ord} yd`, yd, 'cu yd', 'readymix_cy', ord)); conc.push(mk('conc.total', 'Ready-mix short-load fee (estimate)', 1, 'each', 'readymix_short_load', 1)); }
    else if (mode === 'bags60') conc.push(mk('conc.total', desc, v, 'cu ft', 'concrete_60lb', bags60));
    else conc.push(mk('conc.total', desc, v, 'cu ft', 'concrete_80lb', bags80));
    r.lines = keep.slice(0, Math.max(0, at)).concat(conc, keep.slice(Math.max(0, at)));
    r.concreteAlternatives = { bags80: { qty: bags80, cost: r2(bags80 * (up('concrete_80lb', bags80) || 0)) }, bags60: { qty: bags60, cost: r2(bags60 * (up('concrete_60lb', bags60) || 0)) }, readymix: { yd: Math.ceil(yd * 2) / 2, cost: r2(Math.ceil(yd * 2) / 2 * (P.readymix_cy ? P.readymix_cy.price : 0) + (P.readymix_short_load ? P.readymix_short_load.price : 0)), estimate: true } };
    Object.assign(r.report, { concreteCuFt: r2(v), concreteYd: r2(yd), bags80, bags60, concreteMode: mode });
    const ins = (lines) => { const i = r.lines.map((l) => l.layer).lastIndexOf('foundation'); r.lines.splice(i + 1, 0, ...lines); };
    if (nSq) {
      let lf = 0; split.square.forEach((q) => { lf += squareVerticals(D, q.sh.sizeIn) * (q.o.height * 12 - R.coverIn) / 12; });
      const sizes = Array.from(new Set(split.square.map((q) => q.sh.sizeIn))).join(' / ');
      const formSf = split.square.reduce((s, q) => s + 4 * (q.sh.sizeIn / 12) * Math.max(0, q.o.height + q.o.z + 0.5), 0); // form the part above grade + 6 in
      ins([
        mk('found.squarePiers', `Square formed piers ${sizes} in: ${nSq} pier(s), depth max(frost + margin, 12 in) = ${Math.round(-split.square[0].o.z * 12)} in below grade (concrete is on the concrete line)`, nSq, 'piers', null, nSq, 'Concrete priced on the concrete line'),
        mk('found.squareForms', `Square pier form boards (4 sides, ~${formSf.toFixed(0)} sq ft above grade + 6 in) - needs a price`, formSf, 'sq ft', null, Math.ceil(formSf), 'PRICE NEEDED - no Home Depot price for square pier forms in homedepot-prices.json'),
        mk('found.rebar', `#4 rebar EXAMPLE: square pier verticals (${lf.toFixed(0)} lf)`, lf, 'lf', 'rebar_4_20', Math.ceil(lf * (1 + W('rebar')) / R.stockFt), 'EXAMPLE steel - engineer/plans govern'),
      ]);
      if (!piersOnly || !split.round.length) { const ties = 2 * nSq; ins([mk('found.tieWire', `Tie wire for square piers (~${ties} ties)`, ties, 'ties', 'tie_wire_roll', Math.max(1, Math.ceil(ties / R.tiesPerRollEstimate)))]); }
      changed.push('square');
    }
    if (nPre) {
      ins([mk('found.precastBlocks', `${PIER_SHAPES.precast.label}: ${nPre} block(s) - needs a price`, nPre, 'each', null, nPre, 'PRICE NEEDED - no Home Depot price for a precast concrete pier/deck block in homedepot-prices.json')]);
      r.flags.unshift(`${nPre} precast block(s) - ${precastFrostWarning(f)}`);
      changed.push('precast');
    }
  }
  if (piersOnly) r.flags.push('Piers only: no grade beam or footing is priced. The sill/floor framing spans pier to pier and needs a beam sized for that span (not generated or priced) - engineer/building department review.');
  // only list the concrete parts that exist (Piers only: no "grade beam 0.0" / "footings 0.0" noise)
  r.lines.forEach((l) => { if (l.id === 'conc.total' && l.desc) l.desc = l.desc.replace(/\s*\+\s*(grade beam|footings\/stem|slab)\s+0\.0\b/g, ''); });
  r.report.pierCount = split.round.length + nSq + nPre;
  r.report.pierShapes = { round: split.round.length, square: nSq, precast: nPre };
  r.report.foundationType = split.type;
  if (r.report.pierDepthIn == null && nSq) r.report.pierDepthIn = Math.round(-split.square[0].o.z * 12);
  if (!changed.length) return r;
  // ---- re-total exactly like the engine (pricing-rules.md)
  const priced = r.lines.filter((l) => l.ext != null); const t = r.totals;
  const materials = r2(priced.reduce((s, l) => s + l.ext, 0));
  const tax = r2(materials * (Number(t.taxRatePct) || 0) / 100);
  const contingency = r2((materials + tax) * (t.contingencyPct || 0) / 100);
  const labor = t.labor === 'not included' || t.labor == null ? null : t.labor;
  Object.assign(t, { materials, materials_from_estimated_prices: r2(priced.filter((l) => !l.verified).reduce((s, l) => s + l.ext, 0)), unpriced_lines: r.lines.filter((l) => l.ext == null).map((l) => l.desc), tax, contingency, total: r2(materials + tax + contingency + (t.delivery || 0) + (labor || 0)) });
  const groups = {}; priced.forEach((l) => { groups[l.layer] = r2((groups[l.layer] || 0) + l.ext); }); r.groups = groups;
  r.pierOptions = changed;
  return r;
}
