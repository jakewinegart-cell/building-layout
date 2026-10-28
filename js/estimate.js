// ============================================================================
// estimate.js — one adapter over the two pricing engines so the report has a single shape.
//   hd:          Remodel Guide's reference engine (content-v3/reference/takeoff-reference.mjs)
//                with its rules + dated Home Depot snapshot. Totals = materials + tax + contingency
//                + delivery + labor (content-v3/pricing-rules.md). Tax rate is the USER's: blank → 0 and
//                the total says "tax not included".
//   placeholder: this app's js/takeoff.js with content/ data, every price a labeled PLACEHOLDER.
// ============================================================================
import { ESTIMATE_DEFAULTS } from './config.js';
import { getLayer } from './model.js';
import { regenerate } from './generate.js';
import { takeoff as placeholderTakeoff, measure } from './takeoff.js';
import { applyRoofingFixes, withFixPrices } from './roofing-fixes.js';

const r2 = (x) => Math.round(x * 100) / 100;
export const GROUPS = [
  { id: 'site', name: 'Site layout' }, { id: 'foundation', name: 'Foundation' }, { id: 'floor', name: 'Floor framing' },
  { id: 'walls', name: 'Walls, doors & windows' }, { id: 'roof', name: 'Roof framing & roofing' }, { id: 'fasteners', name: 'Fasteners' },
];
/** v4: the chosen ZIP's jurisdiction (null when no ZIP, an unknown ZIP, or v3 content). */
export function siteJurisdiction(m, C) {
  const site = m.site || {};
  if (!C || !C.jdoc || !site.zip || !C.engine || typeof C.engine.resolveJurisdiction !== 'function') return null;
  return C.engine.resolveJurisdiction(C.jdoc, site.zip, site.jurisdictionId) || null;
}
export function estimateSettings(m) { return Object.assign({}, ESTIMATE_DEFAULTS, m.estimate || {}); }
export function engineOpts(m) {
  const e = estimateSettings(m); const rp = getLayer(m, 'roof').params;
  // v4: blank tax = null → the engine uses the ZIP lookup (verified only) or prices 0% and FLAGS it. No Denver default.
  const o = { taxRatePct: e.taxRatePct == null || e.taxRatePct === '' ? null : Number(e.taxRatePct), contingencyPct: Number(e.contingencyPct) || 0, deliveryUsd: Number(e.deliveryUsd) || 0, laborUsd: e.laborUsd == null || e.laborUsd === '' ? null : Number(e.laborUsd), concreteMode: e.concreteMode || 'auto', iceBarrier: e.iceBarrier == null ? null : e.iceBarrier !== false,
    frostMarginIn: Number(getLayer(m, 'foundation').params.frostMarginIn) || 0 };
  if (o.iceBarrier == null) delete o.iceBarrier; // let the ZIP lookup decide (engine default ON)
  if (rp.ceilingJoistSize && rp.ceilingJoistSize !== 'auto') o.ceilingJoistSize = rp.ceilingJoistSize;
  return o;
}

/** Run the estimate. C = loadContent() result. Never mutates m. */
export function runEstimate(m, C, optsOverride = {}) {
  const mm = JSON.parse(JSON.stringify(m));
  const set = estimateSettings(m);
  const taxSet = !(set.taxRatePct == null || set.taxRatePct === '');
  if (C.mode === 'hd') {
    const J = siteJurisdiction(m, C);
    const opts = Object.assign(engineOpts(m), J ? { jurisdiction: J } : {}, C.fastenerSchedule ? { fastenerSchedule: C.fastenerSchedule } : {}, optsOverride);
    withFixPrices(C.prices);
    const r = C.engine.takeoff(mm, C.rules, C.prices, opts);
    // Remodel Guide roofing fixes (ice-barrier courses, 19/32 at 24 in o.c., double underlayment 2:12–<4:12)
    if (!optsOverride.noRoofingFixes) applyRoofingFixes(r, getLayer(mm, 'roof').params, C.prices.prices, { defaults: C.rules.defaults, hoverCopy: C.engine.hoverCopy });
    const P = C.prices.prices;
    const lines = r.lines.map((l) => {
      const p = l.price_ref ? P[l.price_ref] : null;
      return {
        id: l.id, group: l.layer === 'all' ? 'fasteners' : l.layer, desc: l.desc, qtyCalc: l.qty_calc, calcUnit: l.unit,
        qty: l.buy, unit: (p && p.unit) || 'each', packQty: p && p.pack_qty, product: p ? p.name : null, priceRef: l.price_ref,
        unitPrice: l.unit_price, total: l.ext, bulk: !!(p && p.bulk_price && l.buy >= p.bulk_price.min_qty),
        status: l.ext == null ? 'unpriced' : (l.verified ? 'hd' : 'estimate'),
        dateChecked: p && p.date_checked, url: p && p.url, sourceUrl: p && p.source_url, estimateSource: p && !p.verified ? p.estimate_source : null,
        internetNumber: p && p.internet_number, note: l.note || null,
      };
    });
    const t = r.totals;
    return {
      mode: 'hd', lines, flags: r.flags, report: r.report, concreteAlternatives: r.concreteAlternatives, M: measure(m),
      groups: GROUPS.map((g) => ({ id: g.id, name: g.name, total: r2(r.groups[g.id === 'fasteners' ? 'all' : g.id] || 0), lines: lines.filter((l) => l.group === g.id) })).filter((g) => g.lines.length),
      jurisdiction: J,
      totals: { materials: t.materials, fromEstimates: t.materials_from_estimated_prices, unpriced: t.unpriced_lines, taxSet: t.taxSource ? t.taxSource !== 'unknown' : taxSet, taxSource: t.taxSource || (taxSet ? 'user' : 'unknown'), taxRatePct: (t.taxSource ? t.taxSource !== 'unknown' : taxSet) ? t.taxRatePct : null, tax: t.tax, contingencyPct: t.contingencyPct, contingency: t.contingency, delivery: t.delivery, labor: t.labor === 'not included' ? null : t.labor, total: t.total },
      snapshotDate: C.snapshotDate, raw: r,
      pieces: r.pieces || [], fasteners: r.fasteners || null, roofingFixes: r.roofingFixes || [],
    };
  }
  // placeholder engine
  const r = placeholderTakeoff(mm, C.rules, C.prices);
  const lines = r.lines.map((l) => ({ id: l.ruleId, group: l.layer, desc: l.basis, qtyCalc: null, calcUnit: '', qty: l.qty, unit: l.unit, product: l.name, priceRef: l.item, unitPrice: l.unitPrice, total: l.total, status: 'placeholder', search: l.search, note: l.flag }));
  const materials = r.total; const tax = taxSet ? r2(materials * Number(set.taxRatePct) / 100) : 0;
  const cont = r2((materials + tax) * (Number(set.contingencyPct) || 0) / 100); const del = Number(set.deliveryUsd) || 0; const lab = set.laborUsd == null || set.laborUsd === '' ? null : Number(set.laborUsd);
  return {
    mode: 'placeholder', lines, flags: [], report: {}, concreteAlternatives: null, M: r.M,
    groups: GROUPS.map((g) => ({ id: g.id, name: g.name, lines: lines.filter((l) => l.group === g.id) })).map((g) => Object.assign(g, { total: r2(g.lines.reduce((s, l) => s + l.total, 0)) })).filter((g) => g.lines.length),
    totals: { materials, fromEstimates: 0, unpriced: r.missing, taxSet, taxRatePct: taxSet ? Number(set.taxRatePct) : null, tax, contingencyPct: Number(set.contingencyPct) || 0, contingency: cont, delivery: del, labor: lab, total: r2(materials + tax + cont + del + (lab || 0)) },
    snapshotDate: null,
  };
}

/** Does the floor have an (unsupported) mid beam? */
export function midBeamInfo(m) {
  const fl = getLayer(m, 'floor'); const g = fl.objects.filter((o) => o.props && o.props.role === 'girder');
  const span = (fl.params.computed && fl.params.computed.spanFt) || 0;
  return { has: g.length > 0, count: g.length, spanFt: span, joistSize: fl.params.joistSize, lenFt: g.reduce((s, o) => s + Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]), 0) };
}
/** The 2x12 clear-span alternative from Remodel Guide's examples: 2x12 joists, mid beam threshold above the span (no beam, no hangers). */
export function applyClearSpan(m) {
  const fl = getLayer(m, 'floor');
  const span = (fl.params.computed && fl.params.computed.spanFt) || 0;
  fl.params.joistSize = '2x12';
  fl.params.beamFlagSpanFt = Math.max(17, Math.ceil(span + 0.5));
  return m;
}
export const CLEAR_SPAN_TYPICAL_MAX_FT = 17; // Remodel Guide's example uses 17 ft for 2x12 @ 16 in — EXAMPLE, verify against span tables
/** Price the clear-span alternative without touching the model. */
export function clearSpanAlternative(m, C, base) {
  const mm = applyClearSpan(JSON.parse(JSON.stringify(m)));
  regenerate(mm, 'floor');
  const alt = runEstimate(mm, C);
  return { total: alt.totals.total, materials: alt.totals.materials, delta: r2(alt.totals.total - base.totals.total), withinTypical: midBeamInfo(m).spanFt <= CLEAR_SPAN_TYPICAL_MAX_FT };
}

// ---------------------------------------------------------------------------
// Feature C: Price check prices only the layers marked Complete.
export const PRICED_LAYERS = ['site', 'foundation', 'floor', 'walls', 'roof'];
const PIECE_LAYER = { pier: 'foundation', grade_beam: 'foundation' };
/** ids of layers the user checked Complete (any non-stub layer). */
export function completeLayerIds(m) { return m.layers.filter((l) => !l.stub && l.complete).map((l) => l.id); }
/** The priced layers present in this model (stub/custom layers have no price rules). */
export function pricedLayers(m) { return PRICED_LAYERS.map((id) => m.layers.find((l) => l.id === id && !l.stub)).filter(Boolean); }
/**
 * Restrict a full estimate to the Complete layers. Fasteners (bought as shared boxes, layer "all") are
 * allocated by the fastener value the completed layers' pieces use (fastener-schedule pieces[]); without
 * pieces, by those layers' share of material cost. Totals re-run with the same formula as the engine.
 */
export function partialEstimate(est, m, ids) {
  const done = new Set(ids);
  const layers = pricedLayers(m);
  const priced = layers.filter((l) => done.has(l.id)).map((l) => ({ id: l.id, name: l.name }));
  const notPriced = layers.filter((l) => !done.has(l.id)).map((l) => ({ id: l.id, name: l.name }));
  const info = { isPartial: notPriced.length > 0, none: priced.length === 0, priced, notPriced, completeIds: [...done] };
  if (!info.isPartial) return Object.assign({}, est, { partial: info });
  const T = est.totals;
  // fastener share
  let share = 0, shareBasis = '';
  const pcs = est.pieces || [];
  const layerOf = (p) => (p.line ? p.line.split('.')[0] : PIECE_LAYER[p.type] || null);
  const boxVal = (p) => p.fasteners.filter((f) => String(f.bought_on || '').startsWith('fast.')).reduce((s, f) => s + (f.subtotal || 0), 0);
  if (pcs.length) {
    const all = pcs.reduce((s, p) => s + boxVal(p), 0); const mine = pcs.filter((p) => done.has(layerOf(p))).reduce((s, p) => s + boxVal(p), 0);
    share = all ? mine / all : 0; shareBasis = 'by the nails the completed layers\u2019 pieces use (fastener-schedule.json)';
  } else {
    const nonF = est.groups.filter((g) => g.id !== 'fasteners'); const all = nonF.reduce((s, g) => s + g.total, 0); const mine = nonF.filter((g) => done.has(g.id)).reduce((s, g) => s + g.total, 0);
    share = all ? mine / all : 0; shareBasis = 'by the completed layers\u2019 share of material cost';
  }
  const groups = [];
  est.groups.forEach((g) => {
    if (g.id === 'fasteners') {
      if (!share) return;
      const lines = g.lines.map((l) => Object.assign({}, l, { total: l.total == null ? null : r2(l.total * share), shareOf: l.total, note: `${Math.round(share * 1000) / 10}% share of ${l.total == null ? 'needs a price' : '$' + l.total.toFixed(2)} for the completed layers${l.note ? ' · ' + l.note : ''}` }));
      groups.push(Object.assign({}, g, { name: `${g.name} (share for completed layers)`, total: r2(lines.reduce((s, l) => s + (l.total || 0), 0)), lines, fullTotal: g.total }));
    } else if (done.has(g.id)) groups.push(g);
  });
  const lines = groups.reduce((a, g) => a.concat(g.lines), []);
  const materials = r2(groups.reduce((s, g) => s + g.total, 0));
  const rate = T.taxSet ? Number(T.taxRatePct) || 0 : 0;
  const tax = r2(materials * rate / 100);
  const contingency = r2((materials + tax) * (T.contingencyPct || 0) / 100);
  const total = r2(materials + tax + contingency + (T.delivery || 0) + (T.labor || 0));
  const totals = Object.assign({}, T, { materials, tax, contingency, total, fromEstimates: r2(lines.filter((l) => l.status === 'estimate').reduce((s, l) => s + (l.total || 0), 0)), unpriced: lines.filter((l) => l.status === 'unpriced').map((l) => l.desc), fullTotal: T.total });
  info.fastenerShare = share; info.fastenerShareBasis = shareBasis;
  return Object.assign({}, est, { groups, lines, totals, partial: info, full: est });
}
