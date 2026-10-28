// ============================================================================
// content.js — loads the data the "I'm done" report runs on. Two sources, swappable:
//   • content-v3/ (Remodel Guide): takeoff-rules.json, homedepot-prices.json (dated HD snapshot),
//     instructions.md (templated build guide) and reference/takeoff-reference.mjs (the engine).
//     Used whenever it is present and valid. Every price is checked for a date and a source;
//     entries that fail are treated as "needs a price" (never shown as a Home Depot price).
//   • content/ (this app): placeholder rules + a PLACEHOLDER price table + generic steps.
//     Only used when content-v3 is missing or invalid; every price then says
//     "placeholder, not a real Home Depot price".
// ============================================================================
// v4 first (ZIP-driven tax/frost, jurisdictions.json); v3 kept as a fallback content set.
const RG_LIST = ['content-v4/', 'content-v3/'];
let RG = RG_LIST[0];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function getJSON(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function getText(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch (e) { return null; }
}

/** Validate Remodel Guide's homedepot-prices.json. Returns a cleaned copy + issues. */
export function validateHdPrices(doc) {
  const issues = [];
  if (!doc || !doc.meta || !doc.prices || typeof doc.prices !== 'object') return { ok: false, issues: ['homedepot-prices.json: needs { meta, prices }'] };
  if (!DATE.test(doc.meta.snapshot_date || '')) issues.push('meta.snapshot_date missing');
  const out = JSON.parse(JSON.stringify(doc));
  let verified = 0, est = 0, unpriced = 0, rejected = 0;
  Object.entries(out.prices).forEach(([ref, p]) => {
    if (p.price == null) { unpriced++; return; }
    const why = [];
    if (!(typeof p.price === 'number' && isFinite(p.price) && p.price >= 0)) why.push('price not a number');
    if (!DATE.test(p.date_checked || '')) why.push('no date_checked');
    if (p.verified) { if (!p.url && !p.source_url) why.push('verified but no url/source_url'); }
    else if (!p.estimate_source) {
      // An unverified price read from a cited HD page (source_url, e.g. "UNCONFIRMED PAGE") is kept as an est. price, labelled as such.
      if (p.source_url) p.estimate_source = `Unconfirmed Home Depot page (not verified): ${p.notes || p.source_url}`;
      else why.push('estimate without estimate_source');
    }
    if (why.length) { issues.push(`${ref}: ${why.join(', ')} — treated as "needs a price"`); p.price = null; p.bulk_price = null; rejected++; return; }
    if (p.verified) verified++; else est++;
  });
  return { ok: true, doc: out, issues, counts: { total: Object.keys(out.prices).length, verified, estimated: est, unpriced, rejected } };
}

async function loadRemodelGuide() {
  for (const dir of RG_LIST) { RG = dir; const r = await loadRemodelGuideFrom(); if (r.present && r.usable) return r; if (dir === RG_LIST[RG_LIST.length - 1]) return r; }
}
async function loadRemodelGuideFrom() {
  const [rules, prices, md] = await Promise.all([getJSON(RG + 'takeoff-rules.json'), getJSON(RG + 'homedepot-prices.json'), getText(RG + 'instructions.md')]);
  if (!rules && !prices && !md) return { present: false };
  const issues = [];
  if (!rules || !rules.defaults || !Array.isArray(rules.items)) issues.push('takeoff-rules.json missing or has no defaults/items');
  const v = validateHdPrices(prices);
  if (!v.ok) issues.push(...v.issues);
  let engine = null;
  try { engine = await import('../' + RG + 'reference/takeoff-reference.mjs'); } catch (e) { issues.push('reference/takeoff-reference.mjs could not be loaded: ' + e.message); }
  const usable = !!(rules && rules.defaults && v.ok && engine && typeof engine.takeoff === 'function');
  return { present: true, usable, rules, prices: v.ok ? v.doc : null, priceIssues: v.ok ? v.issues : [], counts: v.counts, instructionsMd: md, engine, issues };
}

/**
 * → { mode: 'hd' | 'placeholder', ... , status }
 *   hd:          { rules, prices (HD doc), instructionsMd, engine, snapshotDate }
 *   placeholder: { rules, prices, steps } (content/)
 */
export async function loadContent() {
  const rg = await loadRemodelGuide();
  const status = { remodelGuide: 'absent', issues: [], files: {} };
  if (rg.present) {
    status.issues = rg.issues.concat(rg.priceIssues || []);
    status.counts = rg.counts;
    if (rg.usable) {
      status.remodelGuide = rg.instructionsMd ? 'wired' : 'partial';
      status.files = { rules: RG + 'takeoff-rules.json', prices: RG + 'homedepot-prices.json', steps: rg.instructionsMd ? RG + 'instructions.md' : 'content/build-steps.json', engine: RG + 'reference/takeoff-reference.mjs' };
      const jdoc = RG === 'content-v4/' ? await getJSON(RG + 'jurisdictions.json') : null;
      if (jdoc) status.files.jurisdictions = RG + 'jurisdictions.json';
      // v4 fasteners: Remodel Guide's per-piece schedule (IRC 2024 MT Table R602.3(1)) → engine pieces[] + code-count fastener lines
      const fastenerSchedule = RG === 'content-v4/' ? await getJSON(RG + 'fastener-schedule.json') : null;
      if (fastenerSchedule) status.files.fasteners = RG + 'fastener-schedule.json';
      // v4 roofing (Remodel Guide roofing-v1, copied into content-roof-v1/): 70 price refs merged in (none overlap content-v4;
      // 15 have price null = "needs a price"), IRC R802.4.1 span tables, roofing options.
      const [roofPrices, spans, roofOptions] = await Promise.all([getJSON('content-roof-v1/roofing-price-items.json'), getJSON('content-roof-v1/rafter-span-tables.json'), getJSON('content-roof-v1/roofing-options.json')]);
      if (roofPrices && roofPrices.prices) {
        Object.entries(roofPrices.prices).forEach(([k, v]) => { if (!rg.prices.prices[k]) rg.prices.prices[k] = Object.assign({ price_ref: k }, v); });
        status.files.roofPrices = 'content-roof-v1/roofing-price-items.json';
      }
      if (spans) status.files.spans = 'content-roof-v1/rafter-span-tables.json';
      const out = { mode: 'hd', contentDir: RG, jdoc, fastenerSchedule, rules: rg.rules, prices: rg.prices, instructionsMd: rg.instructionsMd, engine: rg.engine, snapshotDate: rg.prices.meta.snapshot_date, status, spans, roofOptions, roofPrices };
      if (!rg.instructionsMd) out.steps = await getJSON('content/build-steps.json');
      return out;
    }
    status.remodelGuide = 'invalid';
  }
  const [rules, prices, steps] = await Promise.all([getJSON('content/takeoff-rules.json'), getJSON('content/prices-placeholder.json'), getJSON('content/build-steps.json')]);
  if (!rules || !prices || !steps) throw new Error('content/ files missing');
  status.files = { rules: 'content/takeoff-rules.json', prices: 'content/prices-placeholder.json (PLACEHOLDER)', steps: 'content/build-steps.json' };
  const spans = await getJSON('content-roof-v1/rafter-span-tables.json');
  return { mode: 'placeholder', rules, prices, steps, status, spans };
}

// One shared load for Price check and $ inspect (same rules, prices and engine).
let contentP = null;
export function getContentCached() { return (contentP = contentP || loadContent().catch((e) => { contentP = null; throw e; })); }

// v4 ZIP lookup (content-v4/jurisdictions.json), loaded on its own so the startup pop-up doesn't wait on the engine.
let jdocP = null;
export function getJurisdictions() {
  return (jdocP = jdocP || getJSON('content-v4/jurisdictions.json').then((d) => { if (!d || !d.zips) { jdocP = null; return null; } return d; }));
}
