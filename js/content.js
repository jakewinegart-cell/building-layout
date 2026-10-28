// ============================================================================
// content.js — loads the data the takeoff/report run on, so it can be swapped:
//   1. content/  — this app's placeholder rules, PLACEHOLDER price table, generic steps
//   2. content-v3/ — Remodel Guide's files (takeoff rules, a DATED Home Depot price snapshot,
//      build instructions). Used wherever they validate; see content-v3/SCHEMA-expected.md.
// A price from content-v3 is only treated as real if it has a number, a source and a date.
// Anything missing or invalid falls back to the placeholder entry, which stays labeled.
// ============================================================================
const RG_DIR = 'content-v3/';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function getJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

export function validatePrices(doc) {
  const issues = []; const ok = {};
  if (!doc || typeof doc !== 'object' || !doc.items || typeof doc.items !== 'object') return { ok, issues: ['price file has no "items" object'] };
  const fileDate = DATE.test(doc.snapshotDate || '') ? doc.snapshotDate : null;
  if (!fileDate) issues.push('price file has no snapshotDate (YYYY-MM-DD)');
  Object.entries(doc.items).forEach(([id, it]) => {
    const why = [];
    if (!it || typeof it !== 'object') why.push('not an object');
    else {
      if (!(typeof it.price === 'number' && isFinite(it.price) && it.price >= 0)) why.push('price is not a number');
      if (!it.source || typeof it.source !== 'string') why.push('no source');
      const d = it.sourceDate || fileDate;
      if (!d || !DATE.test(d)) why.push('no date');
      if (!it.name) why.push('no name');
    }
    if (why.length) issues.push(`${id}: ${why.join(', ')}`);
    else ok[id] = Object.assign({}, it, { placeholder: false, sourceDate: it.sourceDate || fileDate, unit: it.unit || 'ea' });
  });
  return { ok, issues, fileDate };
}
export function validateRules(doc) {
  if (!doc || !Array.isArray(doc.rules) || !doc.rules.length) return ['rules file has no "rules" array'];
  const bad = doc.rules.filter((r) => !r || !r.id || !r.layer || !((r.item && Array.isArray(r.terms)) || (r.map && r.itemTemplate)));
  return bad.length ? [`${bad.length} rule(s) missing id/layer/(item+terms | map+itemTemplate)`] : [];
}
export function validateSteps(doc) {
  if (!doc || !Array.isArray(doc.steps) || !doc.steps.length) return ['steps file has no "steps" array'];
  const bad = doc.steps.filter((s) => !s || !s.title || !s.text);
  return bad.length ? [`${bad.length} step(s) missing title/text`] : [];
}

/** → { rules, prices, steps, status } */
export async function loadContent() {
  const [rules, prices, steps] = await Promise.all([getJSON('content/takeoff-rules.json'), getJSON('content/prices-placeholder.json'), getJSON('content/build-steps.json')]);
  if (!rules || !prices || !steps) throw new Error('content/ files missing');
  const status = { remodelGuide: 'absent', used: [], issues: [], files: {} };
  const man = await getJSON(RG_DIR + 'manifest.json');
  const names = { rules: (man && man.takeoffRules) || 'takeoff-rules.json', prices: (man && man.prices) || 'prices.json', steps: (man && man.buildSteps) || 'build-steps.json' };
  const [rgRules, rgPrices, rgSteps] = await Promise.all([getJSON(RG_DIR + names.rules), getJSON(RG_DIR + names.prices), getJSON(RG_DIR + names.steps)]);
  let outRules = rules, outSteps = steps;
  const items = Object.assign({}, prices.items);
  const meta = { placeholderLabel: prices.label, createdDate: prices.createdDate, snapshotDate: null, store: null, currency: prices.currency || 'USD', searchUrlTemplate: prices.searchUrlTemplate };
  if (rgRules) {
    const iss = validateRules(rgRules);
    if (iss.length) status.issues.push(...iss.map((x) => `content-v3/${names.rules}: ${x}`));
    else { outRules = rgRules; status.used.push(`takeoff rules (content-v3/${names.rules})`); }
  }
  if (rgSteps) {
    const iss = validateSteps(rgSteps);
    if (iss.length) status.issues.push(...iss.map((x) => `content-v3/${names.steps}: ${x}`));
    else { outSteps = rgSteps; status.used.push(`build steps (content-v3/${names.steps})`); }
  }
  if (rgPrices) {
    const v = validatePrices(rgPrices);
    status.issues.push(...v.issues.map((x) => `content-v3/${names.prices}: ${x}`));
    const n = Object.keys(v.ok).length;
    if (n) {
      Object.assign(items, v.ok);
      meta.snapshotDate = v.fileDate; meta.store = rgPrices.store || null;
      status.used.push(`${n} dated prices (content-v3/${names.prices})`);
    }
  }
  if (status.used.length) status.remodelGuide = status.issues.length ? 'partial' : 'wired';
  status.files = { rules: outRules === rules ? 'content/takeoff-rules.json' : RG_DIR + names.rules, prices: 'content/prices-placeholder.json' + (status.used.some((u) => u.includes('prices')) ? ` + ${RG_DIR}${names.prices}` : ''), steps: outSteps === steps ? 'content/build-steps.json' : RG_DIR + names.steps };
  return { rules: outRules, prices: Object.assign({}, meta, { items }), steps: outSteps, status };
}
