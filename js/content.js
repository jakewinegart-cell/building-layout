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
const RG = 'content-v3/';
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
    else if (!p.estimate_source) why.push('estimate without estimate_source');
    if (why.length) { issues.push(`${ref}: ${why.join(', ')} — treated as "needs a price"`); p.price = null; p.bulk_price = null; rejected++; return; }
    if (p.verified) verified++; else est++;
  });
  return { ok: true, doc: out, issues, counts: { total: Object.keys(out.prices).length, verified, estimated: est, unpriced, rejected } };
}

async function loadRemodelGuide() {
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
      const out = { mode: 'hd', rules: rg.rules, prices: rg.prices, instructionsMd: rg.instructionsMd, engine: rg.engine, snapshotDate: rg.prices.meta.snapshot_date, status };
      if (!rg.instructionsMd) out.steps = await getJSON('content/build-steps.json');
      return out;
    }
    status.remodelGuide = 'invalid';
  }
  const [rules, prices, steps] = await Promise.all([getJSON('content/takeoff-rules.json'), getJSON('content/prices-placeholder.json'), getJSON('content/build-steps.json')]);
  if (!rules || !prices || !steps) throw new Error('content/ files missing');
  status.files = { rules: 'content/takeoff-rules.json', prices: 'content/prices-placeholder.json (PLACEHOLDER)', steps: 'content/build-steps.json' };
  return { mode: 'placeholder', rules, prices, steps, status };
}

// One shared load for Price check and $ inspect (same rules, prices and engine).
let contentP = null;
export function getContentCached() { return (contentP = contentP || loadContent().catch((e) => { contentP = null; throw e; })); }
