// ============================================================================
// roofing-fixes.js — three small roofing correctness fixes from Remodel Guide (roofing-v1,
// roofing-takeoff-rules.json "content_v3_corrections"), applied on top of the content-v4 reference
// engine's output so Price check and $ inspect share them:
//   (a) Ice barrier: courses rule. The barrier must reach 24 in inside the exterior wall
//       (IRC R905.1.2); along the slope that is (overhangIn + 24) × slopeFactor. One 36 in course,
//       each added course gives 33 in (3 in lap). 12 in overhang at 4:12 → 37.95 in → 2 courses.
//       Rolls = ceil((eaveLf × courses × 3 + valleyLf × 3) × 1.10 / 150).
//   (b) Roof sheathing at 24 in o.c.: 7/16 (24/16) is rated only 40 psf live load (Table
//       R503.2.1.1(1)), short for Montana snow → 19/32 OSB by default (16 in o.c. keeps 7/16).
//       H-clips for 19/32 have no Home Depot price yet → "needs a price" (PRICE NEEDED).
//   (c) Shingles from 2:12 up to (not including) 4:12 need double underlayment (IRC R905.1.1).
// Prices for the two new refs are copied from Remodel Guide's roofing-v1/roofing-price-items.json
// (homedepot.com, default online store, checked 2026-10-28 America/Denver, not localized).
// ============================================================================
const r2 = (x) => Math.round(x * 100) / 100;

export const ROOF_FIX_PRICES = {
  osb_1932_4x8: { price_ref: 'osb_1932_4x8', category: 'sheathing', name: 'Blue Ribbon 19/32 in OSB sheathing 4x8 (span rating 40/20 expected - UNVERIFIED on label)', unit: 'sheet', pack_qty: null, price: 22.77, bulk_price: { min_qty: 52, price: 21.63 }, url: null, source_url: 'https://www.homedepot.com/s/19%2F32%20plywood%20sheathing%204x8', date_checked: '2026-10-28', verified: true, denver_localized: false, notes: 'From Remodel Guide roofing-v1/roofing-price-items.json (search-result price). Buy 52+ $21.63.' },
  h_clip_1932: { price_ref: 'h_clip_1932', category: 'sheathing', name: 'H-clips for 19/32 panels', unit: '50-pack', pack_qty: 50, price: null, bulk_price: null, url: null, source_url: null, date_checked: '2026-10-28', verified: false, denver_localized: false, notes: 'PRICE NEEDED (Remodel Guide roofing-v1)' },
};
/** Add the fix price refs to a prices doc (in place, idempotent). */
export function withFixPrices(pricesDoc) {
  if (pricesDoc && pricesDoc.prices) Object.entries(ROOF_FIX_PRICES).forEach(([k, v]) => { if (!pricesDoc.prices[k]) pricesDoc.prices[k] = v; });
  return pricesDoc;
}

export const ICE_COURSE_IN = 36, ICE_ADDED_COURSE_IN = 33, ICE_INSIDE_WALL_IN = 24;
export function iceCourses(pitch, overhangIn) {
  const k = Math.sqrt(1 + (Number(pitch) / 12) ** 2);
  let req = ((Number(overhangIn) || 0) + ICE_INSIDE_WALL_IN) * k;
  if (pitch >= 8) req = Math.max(req, 36);
  return { reqIn: req, courses: req <= ICE_COURSE_IN ? 1 : 1 + Math.ceil((req - ICE_COURSE_IN) / ICE_ADDED_COURSE_IN) };
}
export const needsDoubleUnderlayment = (pitch) => Number(pitch) >= 2 && Number(pitch) < 4;
export const sheathingFor = (ocIn) => (Number(ocIn) > 16 ? { ref: 'osb_1932_4x8', clip: 'h_clip_1932', label: '19/32 OSB', why: '7/16 (24/16) is rated only 40 psf at 24 in o.c. (IRC Table R503.2.1.1(1)); Montana snow needs more' } : { ref: 'osb_716_4x8', clip: 'h_clip_716_50', label: '7/16 OSB', why: '' });

/**
 * Apply the fixes to an engine result r (mutates r): lines, pieces, groups, totals, flags, report.
 * roofParams = the model's roof layer params (pitch, overhangIn, rafterOcIn). P = prices.prices (with fix refs).
 */
export function applyRoofingFixes(r, roofParams, P, opts = {}) {
  const rp = roofParams || {}; const pitch = Number(rp.pitch) || 0; const oc = Number(rp.rafterOcIn) || 24;
  const D = opts.defaults || {}; const iceW = (D.roof && D.roof.iceBarrierWidthFt) || 3;
  const up = (ref, qty) => { const p = P[ref]; if (!p || p.price == null) return null; return p.bulk_price && qty >= p.bulk_price.min_qty ? p.bulk_price.price : p.price; };
  const setLine = (l, ref, buy, desc, note) => { const u = up(ref, buy); Object.assign(l, { price_ref: ref, buy, unit_price: u, ext: u == null ? null : r2(u * buy), verified: !!(P[ref] && P[ref].verified) }); if (desc) l.desc = desc; if (note !== undefined) l.note = note; };
  const applied = [];
  const pieces = r.pieces || [];
  const repiece = (p) => { // recompute a piece's total + hover after a price/fastener change
    p.fastenersTotal = r2(p.fasteners.reduce((s, f) => s + (f.subtotal || 0), 0));
    p.total = p.price == null ? null : r2(p.price + p.fasteners.reduce((s, f) => s + (f.subtotal || 0), 0));
    if (opts.hoverCopy) p.hover = opts.hoverCopy({ label: p.label, size: p.size, lengthIn: p.lengthIn, price: p.price, priceNote: p.priceBasis, fasteners: p.fasteners, total: p.total, sheet: true });
  };

  // (b) roof sheathing
  const sh = sheathingFor(oc);
  const shLines = r.lines.filter((l) => l.id === 'roof.sheathing');
  if (sh.ref !== 'osb_716_4x8' && shLines.length) {
    const panel = shLines.find((l) => /^osb_/.test(l.price_ref)); const clips = shLines.find((l) => /^h_clip/.test(l.price_ref));
    if (panel) setLine(panel, sh.ref, panel.buy, panel.desc.replace('7/16 OSB', sh.label), `${sh.label} at ${oc} in o.c.: ${sh.why} (Remodel Guide roofing fix)`);
    if (clips) setLine(clips, sh.clip, clips.buy, clips.desc.replace('H-clips', `H-clips for ${sh.label}`), 'PRICE NEEDED - no Home Depot price captured for 19/32 H-clips');
    const pu = up(sh.ref, panel ? panel.buy : 1);
    pieces.filter((p) => p.type === 'roof_sheet').forEach((p) => {
      p.price = pu; p.price_ref = sh.ref; p.label = (p.label || '').replace('7/16 OSB', sh.label); if (p.ctx) p.ctx.clipRef = sh.clip;
      p.fasteners.forEach((f) => { if (f.type === 'h_clip') { f.unitPrice = null; f.subtotal = null; } });
      repiece(p);
    });
    if (r.fasteners && r.fasteners.byType && r.fasteners.byType.h_clip) { r.fasteners.byType.h_clip.unitPrice = null; r.fasteners.byType.h_clip.usedValue = 0; }
    applied.push({ id: 'sheathing1932', text: `Roof sheathing: ${sh.label} (rafters at ${oc} in o.c.; 7/16 is rated only 40 psf there)` });
  }

  // (a) ice barrier courses
  const ice = r.lines.find((l) => l.id === 'roof.iceBarrier');
  if (ice) {
    const eaves = ice.qty_calc / iceW; const c = iceCourses(pitch, rp.overhangIn);
    const sqft = eaves * c.courses * 3; const rolls = Math.ceil(sqft * 1.10 / 150);
    const before = ice.buy;
    setLine(ice, ice.price_ref, rolls, `Ice & water barrier at eaves: ${c.courses} course${c.courses > 1 ? 's' : ''} (${eaves.toFixed(0)} lf x ${c.courses} x 3 ft, +10%) - reaches ${c.reqIn.toFixed(1)} in up the slope = 24 in inside the wall`, `courses rule: (overhang ${rp.overhangIn} in + 24 in) x slope factor at ${pitch}:12 (IRC R905.1.2; Remodel Guide roofing fix)`);
    ice.qty_calc = r2(sqft);
    pieces.filter((p) => p.type === 'ice_barrier').forEach((p) => { p.price = ice.ext; p.priceBasis = `${rolls} roll(s), ${c.courses} course(s)`; p.label = `Ice & water barrier, ${c.courses} course${c.courses > 1 ? 's' : ''} (${rolls} roll${rolls > 1 ? 's' : ''})`; repiece(p); });
    applied.push({ id: 'iceCourses', text: `Ice barrier: ${c.courses} course(s) (${c.reqIn.toFixed(1)} in up the slope needed), ${before} → ${rolls} roll(s)` });
  }

  // (c) double underlayment 2:12 ≤ pitch < 4:12 (shingles)
  if (needsDoubleUnderlayment(pitch)) {
    const ul = r.lines.find((l) => l.id === 'roof.underlayment' && /^underlayment/.test(l.price_ref));
    if (ul) {
      const rolls = Math.ceil(ul.qty_calc * 2 / 1000);
      setLine(ul, ul.price_ref, rolls, `Synthetic underlayment, DOUBLE layer (${pitch}:12 is under 4:12): 2 x ${ul.qty_calc} sq ft`, 'IRC R905.1.1: shingles from 2:12 to under 4:12 need two layers (19 in starter + 36 in courses lapped 19 in). Cap-nail count is for one layer - verify.');
      ul.qty_calc = r2(ul.qty_calc * 2);
      pieces.filter((p) => p.type === 'underlayment').forEach((p, i, arr) => { p.price = r2(ul.ext / arr.length); p.label = 'Synthetic underlayment (double layer)'; repiece(p); });
      applied.push({ id: 'doubleUnderlayment', text: `Underlayment doubled (${pitch}:12 is between 2:12 and 4:12)` });
    }
  }

  if (!applied.length) return r;
  // ---- re-total exactly like the engine (pricing-rules.md)
  const priced = r.lines.filter((l) => l.ext != null);
  const t = r.totals;
  const materials = r2(priced.reduce((s, l) => s + l.ext, 0));
  const tax = r2(materials * (Number(t.taxRatePct) || 0) / 100);
  const contingency = r2((materials + tax) * (t.contingencyPct || 0) / 100);
  const labor = t.labor === 'not included' || t.labor == null ? null : t.labor;
  Object.assign(t, { materials, materials_from_estimated_prices: r2(priced.filter((l) => !l.verified).reduce((s, l) => s + l.ext, 0)), unpriced_lines: r.lines.filter((l) => l.ext == null).map((l) => l.desc), tax, contingency, total: r2(materials + tax + contingency + (t.delivery || 0) + (labor || 0)) });
  const groups = {}; priced.forEach((l) => { groups[l.layer] = r2((groups[l.layer] || 0) + l.ext); }); r.groups = groups;
  r.roofingFixes = applied;
  return r;
}
