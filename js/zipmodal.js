// ============================================================================
// zipmodal.js — v4 startup "Where are you building?" pop-up (content-v4/zip-popup-spec.md).
// ZIP → place, code, permits, frost depth, snow load, ice barrier, sales tax, nearest Home Depot and
// who to call, from content-v4/jurisdictions.json. Every row shows its source link and a verified /
// UNVERIFIED badge. Only verified values are written into the model; the user's own number always wins.
// Unknown ZIP or "Skip for now" → conservative 48 in piers (FLAGGED) and 0% tax (FLAGGED).
// ============================================================================
import { getLayer } from './model.js';
import { getJurisdictions } from './content.js';
import { MIN_PIER_DEPTH_IN } from './config.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const ZIP_RE = /^\d{5}(-\d{4})?$/;
export function cleanZip(v) { const t = String(v || '').trim(); return ZIP_RE.test(t) ? t.slice(0, 5) : null; }
const numOrNull = (v) => { const t = String(v == null ? '' : v).trim(); if (t === '') return null; const n = Number(t); return isFinite(n) ? n : null; };
const src1 = (o) => (o && (o.source || (o.sources && o.sources[0]))) || null;

/** Summary of the model's location for other panels (pre-check, report, inspect). */
export function siteSummary(m, jdoc) {
  const site = m.site || {};
  const f = getLayer(m, 'foundation').params;
  const z = jdoc && site.zip ? jdoc.zips[site.zip] : null;
  const j = z ? (z.jurisdictions.find((x) => x.id === site.jurisdictionId) || z.jurisdictions.find((x) => x.id === z.default_jurisdiction_id) || z.jurisdictions[0]) : null;
  return { site, zip: site.zip || '', known: !!z, z, j, skipped: !!site.skipped, frostDepthIn: f.frostDepthIn, frostSource: site.frostSource || (f.frostDepthIn ? 'user' : 'fallback'),
    label: z ? `${z.place.name}, ${z.place.primary_county} County, ${z.place.state}${j && z.jurisdictions.length > 1 ? ` — ${j.label}` : ''}` : (site.zip ? `ZIP ${site.zip} (no local data yet)` : 'No ZIP entered') };
}

export function createZipModal({ getModel, commit, persist, toast }) {
  let root = null, jdoc = null, state = null, onDone = null;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div'); root.id = 'zipModal'; root.className = 'zipModal'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'zmTitle');
    document.body.appendChild(root);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); skip(); } });
    return root;
  }
  const footer = () => `<div class="zm-foot" id="zmFoot">These come from public sources checked on ${esc(jdoc ? jdoc.meta.checked_date : '—')}. Codes change, and your building official has the final say. Confirm before you dig or buy.</div>`;
  const badge = (ok, what) => ok ? '<span class="zm-badge ok" title="verified on the cited page">✅ verified</span>' : `<span class="zm-badge bad" title="not verified">⚠️ UNVERIFIED${what ? ', ' + esc(what) : ', call'}</span>`;
  const link = (u) => u ? `<a class="zm-src" href="${esc(u)}" target="_blank" rel="noopener">source</a>` : '';

  // ---------------- step 1: ZIP entry
  function renderEntry(prefill) {
    const m = getModel();
    const v = prefill != null ? prefill : ((m.site && m.site.zip) || '');
    root.innerHTML = `<div class="zm-card" id="zmEntry">
<h2 id="zmTitle">Where are you building?</h2>
<p class="zm-copy">Enter the ZIP code of the property. We'll use it to fill in your local building code, frost depth (how deep piers must go), snow-load info, sales tax and the nearest Home Depot. You can change any of it later.</p>
<p class="zm-copy zm-em"><i>A ZIP isn't a code boundary. We'll ask you to confirm the county if your ZIP crosses one.</i></p>
<label class="zm-lab" for="zmZip">ZIP code</label>
<input id="zmZip" class="zm-zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="10" placeholder="e.g. 59833" value="${esc(v)}">
<div class="zm-err" id="zmErr" hidden>Enter a 5-digit ZIP code.</div>
<div class="zm-btns"><button class="zm-primary" id="zmContinue" type="button">Continue</button><button class="zm-skip" id="zmSkip" type="button">Skip for now</button></div>
${footer()}</div>`;
    const inp = root.querySelector('#zmZip'), btn = root.querySelector('#zmContinue'), err = root.querySelector('#zmErr');
    const sync = (showErr) => { const ok = !!cleanZip(inp.value); btn.disabled = !ok; err.hidden = ok || !(showErr && inp.value.trim() !== ''); };
    inp.addEventListener('input', () => sync(inp.value.trim().length >= 5));
    inp.addEventListener('blur', () => sync(true));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { sync(true); if (!btn.disabled) btn.click(); } });
    btn.addEventListener('click', () => {
      const zip = cleanZip(inp.value); if (!zip) { sync(true); return; }
      const z = jdoc && jdoc.zips[zip];
      state = { zip, jid: z ? (m.site && m.site.zip === zip && m.site.jurisdictionId) || z.default_jurisdiction_id : null, editing: false, frost: null, tax: null };
      if (z) renderResult(); else renderUnknown();
    });
    root.querySelector('#zmSkip').addEventListener('click', skip);
    sync(false);
    setTimeout(() => inp.focus(), 30);
  }

  // ---------------- step 2: result card (ZIP found)
  function renderResult() {
    const z = jdoc.zips[state.zip];
    const j = z.jurisdictions.find((x) => x.id === state.jid) || z.jurisdictions[0];
    const d = j.design || {};
    const fd = d.frost_depth_in || {}, gs = d.ground_snow_load_psf || {}, rs = d.min_roof_snow_load_psf || {}, ib = d.ice_barrier_required || {};
    const t = z.tax || {}, st = z.store || {}, cf = j.call_first || {}, code = j.code || {}, ba = j.building_authority || {};
    const permit = j.residential_building_permit_required;
    const loc = st.price_localization || {};
    const frostVal = state.frost != null ? state.frost : (fd.verified ? fd.value : null);
    const taxVal = state.tax != null ? state.tax : (t.verified ? t.combined_pct : null);
    const rows = [];
    const row = (id, label, valueHtml, ok, u, what) => rows.push(`<div class="zm-row" data-row="${id}"><div class="zm-k">${label}</div><div class="zm-v">${valueHtml}<div class="zm-meta">${badge(ok, what)} ${link(u)}</div></div></div>`);
    row('place', 'Place', `<b>${esc(z.place.name)}</b> (${esc(z.place.type === 'CDP' ? 'unincorporated CDP' : z.place.type)}), ${esc(z.place.primary_county)} County, ${esc(z.place.state)}.${z.place.inside_city_limits === false ? ' <i>Not inside any city limits.</i>' : ''}`, !!z.place.verified, src1(z.place));
    let county = '';
    if (z.jurisdictions.length > 1) {
      county = `<fieldset class="zm-row zm-county" data-row="county"><legend class="zm-k">Which county?</legend><div class="zm-v">${z.jurisdictions.map((x) => `<label class="zm-radio"><input type="radio" name="zmJur" value="${esc(x.id)}"${x.id === j.id ? ' checked' : ''}> <span>${esc(x.label)}${x.id === z.default_jurisdiction_id ? ' <span class="zm-meta">(default)</span>' : ''}</span></label>`).join('')}</div></fieldset>`;
    }
    row('code', 'Code', `${esc(code.edition)} ${esc(code.residential === 'International Residential Code' ? 'IRC' : code.residential)}${code.amended_by ? ` as amended by ${esc(code.amended_by)}` : ''}${code.effective ? `, effective ${esc(code.effective)}` : ''} <span class="zm-meta">(${esc(ba.name || '')})</span>`, !!code.verified, code.source);
    const ep = (j.other_permits || []).find((p) => /electrical/i.test(p.what));
    row('permit', 'Building permit', `${permit === false ? '<b>Not required</b> by the State for a single-family home outside certified jurisdictions.' : permit === true ? '<b>Required.</b>' : '<b>Ask</b> your building department.'}${ep ? ' Electrical permit <b>is</b> required (homeowner permit OK).' : ''}<div class="zm-meta">${esc(j.residential_building_permit_note || '')}</div>`, permit !== 'ask', (j.residential_building_permit_sources || [])[0] || ba.url);
    const frostCell = state.editing
      ? `<label class="zm-inl">Frost depth <input id="zmFrostIn" type="number" inputmode="numeric" min="1" max="120" step="1" value="${frostVal == null ? '' : esc(frostVal)}"> in</label><div class="zm-warn" id="zmFrostWarn" hidden></div>`
      : (fd.verified ? `<b id="zmFrost">${esc(frostVal)} in</b> to bottom of footing for 1-story wood frame${fd.multistory_or_masonry_in ? ` (${esc(fd.multistory_or_masonry_in)} in for 2-story or masonry)` : ''}${state.frost != null ? ' <span class="zm-meta">(your value)</span>' : ''}. Piers go ${Math.max((frostVal || 0), MIN_PIER_DEPTH_IN)} in below grade.` : `<b>${state.frost != null ? esc(state.frost) + ' in (your value)' : 'enter it'}</b>`);
    row('frost', '<b>Frost depth</b>', frostCell, !!fd.verified, fd.source);
    row('snow', 'Ground snow load', `${gs.verified ? `<b>${esc(gs.value)} psf</b>` : `${esc(gs.status || 'UNVERIFIED')}`}${rs.verified ? `. Roof minimum ${esc(rs.value)} psf after reductions.` : ''}<div class="zm-meta">${esc(gs.note || '')}</div>`, !!gs.verified, gs.source, gs.verified ? '' : 'site-specific, call');
    row('ice', 'Ice barrier', ib.value == null ? 'unknown' : ib.value ? `<b>Required</b> in ${esc(z.place.state === 'MT' ? 'Montana' : z.place.state)}` : 'Not required', !!ib.verified, ib.source);
    const taxCell = state.editing
      ? `<label class="zm-inl">Sales tax <input id="zmTaxPct" type="number" inputmode="decimal" min="0" max="20" step="0.01" value="${taxVal == null ? '' : esc(taxVal)}"> %</label>`
      : (taxVal != null ? `<b id="zmTax">${esc(taxVal)}%</b>${state.tax != null ? ' <span class="zm-meta">(your value)</span>' : ''}. <span class="zm-meta">${esc((t.note || '').split('. ')[0])}.</span>` : '<b>enter it</b>');
    row('tax', 'Sales tax', taxCell, !!t.verified, src1(t));
    row('store', 'Nearest Home Depot', `${esc(st.name)}, ${esc(st.address)}, ${esc(st.phone)}. <i>Prices shown are NOT localized to this store${loc.status ? ` (${esc(loc.status)})` : ''}.</i>`, !!st.verified, src1(st));
    const others = (j.other_permits || []).filter((p) => !/electrical|plumbing|811/i.test(p.what)).map((p) => `${esc(p.what.split('.')[0])}: ${esc(p.who)}`).join('<br>');
    row('call', '<b>Call first</b>', `<b>${esc(cf.name)} ${esc(cf.phone)}</b>${cf.email ? `, ${esc(cf.email)}` : ''}<div class="zm-meta">${esc(cf.why || '')}</div>${others ? `<div class="zm-meta">${others}</div>` : ''}`, !!ba.verified, ba.url);
    rows.splice(1, 0, county);
    root.innerHTML = `<div class="zm-card zm-wide" id="zmResult"><h2 id="zmTitle">ZIP ${esc(state.zip)}: ${esc(z.place.name)}, ${esc(z.place.state)}</h2>
${z.jurisdictions.length > 1 ? `<p class="zm-copy zm-em">ZIP ${esc(state.zip)} crosses more than one code jurisdiction. Pick the one your address is in.</p>` : ''}
<div class="zm-rows">${rows.join('')}</div>
<div class="zm-btns"><button class="zm-primary" id="zmUse" type="button">Use these values</button><button id="zmEdit" type="button"${state.editing ? ' disabled' : ''}>Edit</button><button id="zmBack" type="button">Back</button></div>
${footer()}</div>`;
    root.querySelectorAll('input[name=zmJur]').forEach((r) => r.addEventListener('change', () => { readEdits(); state.jid = r.value; renderResult(); }));
    root.querySelector('#zmBack').addEventListener('click', () => renderEntry(state.zip));
    root.querySelector('#zmEdit').addEventListener('click', () => { state.editing = true; renderResult(); const i = root.querySelector('#zmFrostIn'); if (i) i.focus(); });
    const fi = root.querySelector('#zmFrostIn');
    if (fi) fi.addEventListener('input', () => {
      const w = root.querySelector('#zmFrostWarn'); const v = numOrNull(fi.value);
      const show = v != null && fd.verified && v < fd.value;
      w.hidden = !show; if (show) w.textContent = `That's shallower than the ${fd.value} in published for ${j.label}. Keep it?`;
    });
    root.querySelector('#zmUse').addEventListener('click', () => {
      readEdits();
      const fdv = fd.verified ? fd.value : null;
      if (state.frost != null && fdv != null && state.frost < fdv && !confirm(`That's shallower than the ${fdv} in published for ${j.label}. Keep it?`)) return;
      useLookup(z, j);
    });
  }
  function readEdits() {
    if (!state.editing || !root) return;
    const z = jdoc.zips[state.zip]; const j = z.jurisdictions.find((x) => x.id === state.jid) || z.jurisdictions[0];
    const fi = root.querySelector('#zmFrostIn'), ti = root.querySelector('#zmTaxPct');
    const fd = j.design.frost_depth_in || {}; const t = z.tax || {};
    if (fi) { const v = numOrNull(fi.value); state.frost = v != null && v > 0 && !(fd.verified && v === fd.value) ? v : null; }
    if (ti) { const v = numOrNull(ti.value); state.tax = v != null && v >= 0 && !(t.verified && v === t.combined_pct) ? v : null; }
  }

  function useLookup(z, j) {
    const m = getModel();
    const fd = j.design.frost_depth_in || {}; const ib = j.design.ice_barrier_required || {}; const t = z.tax || {};
    const frostSource = state.frost != null ? 'user' : (fd.verified ? 'lookup' : 'fallback');
    m.site = { zip: state.zip, jurisdictionId: j.id, lookupVersion: jdoc.meta.version, confirmedAt: new Date().toISOString(), frostSource, taxSource: state.tax != null ? 'user' : (t.verified ? 'lookup' : 'unknown') };
    getLayer(m, 'foundation').params.frostDepthIn = state.frost != null ? state.frost : (fd.verified ? fd.value : null);
    m.estimate = Object.assign({}, m.estimate || {});
    m.estimate.taxRatePct = state.tax != null ? state.tax : null; // null = use the ZIP lookup
    if (ib.verified) m.estimate.iceBarrier = !!ib.value; else delete m.estimate.iceBarrier;
    m.estimate.storeLabel = z.store && z.store.name ? `Home Depot ${z.store.name} (prices not localized)` : null;
    m.estimate.location = `${z.place.name}, ${z.place.state} ${state.zip}`;
    finish(`Location set: ${z.place.name}, ${z.place.state} — frost ${getLayer(m, 'foundation').params.frostDepthIn ?? '?'} in, tax ${state.tax != null ? state.tax : t.combined_pct}%`);
  }

  // ---------------- step 3: unknown ZIP
  function renderUnknown() {
    const fb = (jdoc && jdoc.fallback) || { conservativeFrostDepthIn: 48 };
    const q = encodeURIComponent(`${state.zip} building department`);
    root.innerHTML = `<div class="zm-card" id="zmUnknown"><h2 id="zmTitle">We don't have local data for ${esc(state.zip)} yet.</h2>
<p class="zm-copy">Two values change the estimate. Both are optional.</p>
<label class="zm-lab" for="zmUFrost">Frost depth (in)</label><input id="zmUFrost" type="number" inputmode="numeric" min="1" max="120" step="1" placeholder="blank = ${esc(fb.conservativeFrostDepthIn)} in placeholder (flagged)">
<div class="zm-help">Ask your city or county building department, or your state building codes office.</div>
<label class="zm-lab" for="zmUTax">Sales tax rate (%)</label><input id="zmUTax" type="number" inputmode="decimal" min="0" max="20" step="0.01" placeholder="blank = not included (flagged)">
<div class="zm-help">Your combined state + local rate on building materials.</div>
<div class="zm-callbd"><b>Call your building department.</b> <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Search “${esc(state.zip)} building department”</a></div>
<div class="zm-btns"><button class="zm-primary" id="zmUseU" type="button">Use these values</button><button id="zmBack" type="button">Back</button></div>
${footer()}</div>`;
    root.querySelector('#zmBack').addEventListener('click', () => renderEntry(state.zip));
    root.querySelector('#zmUseU').addEventListener('click', () => {
      const fr = numOrNull(root.querySelector('#zmUFrost').value), tx = numOrNull(root.querySelector('#zmUTax').value);
      applyFallback(state.zip, fr != null && fr > 0 ? fr : null, tx != null && tx >= 0 ? tx : null, false);
    });
    setTimeout(() => { const i = root.querySelector('#zmUFrost'); if (i) i.focus(); }, 30);
  }

  function applyFallback(zip, frost, tax, skipped) {
    const m = getModel();
    m.site = { zip: zip || '', jurisdictionId: null, lookupVersion: jdoc ? jdoc.meta.version : null, confirmedAt: skipped ? null : new Date().toISOString(), frostSource: frost != null ? 'user' : 'fallback', taxSource: tax != null ? 'user' : 'unknown' };
    if (skipped) m.site.skipped = true;
    getLayer(m, 'foundation').params.frostDepthIn = frost;
    m.estimate = Object.assign({}, m.estimate || {}, { taxRatePct: tax, location: zip ? `ZIP ${zip}` : '' });
    delete m.estimate.storeLabel; delete m.estimate.iceBarrier;
    const fb = (jdoc && jdoc.fallback && jdoc.fallback.conservativeFrostDepthIn) || 48;
    finish(skipped ? `Skipped — piers drawn at a ${fb} in placeholder (flagged); tax not included` : `ZIP ${zip}: ${frost != null ? `frost ${frost} in` : `frost unknown → ${fb} in placeholder (flagged)`}, ${tax != null ? `tax ${tax}%` : 'tax not included (flagged)'}`);
  }
  function skip() {
    const m = getModel();
    if (m.site && m.site.zip && !m.site.skipped) { close(); return; } // already set: Skip/Esc just closes
    applyFallback('', null, m.estimate && m.estimate.taxRatePct != null && m.site && m.site.taxSource === 'user' ? m.estimate.taxRatePct : null, true);
  }

  function finish(msg) {
    commit('foundation'); persist();
    close(); toast && toast(msg);
    const cb = onDone; onDone = null; if (cb) cb();
  }
  let waiters = [];
  function close() { if (root) { root.hidden = true; root.innerHTML = ''; } document.body.classList.remove('zipOpen'); const w = waiters; waiters = []; w.forEach((f) => f()); }
  /** v5: resolves when the pop-up is closed (Use / Skip / ✕), so the size pop-up can follow it. */
  const whenClosed = () => (root && !root.hidden ? new Promise((r) => waiters.push(r)) : Promise.resolve());

  async function open(opts = {}) {
    jdoc = await getJurisdictions();
    ensureRoot(); onDone = opts.onDone || null;
    root.hidden = false; document.body.classList.add('zipOpen');
    renderEntry(opts.zip);
  }
  /** Boot: first launch (no ZIP) or a previous Skip → full modal; newer lookup data → one-line banner. */
  async function maybeShowOnStart() {
    const m = getModel(); const site = m.site || {};
    jdoc = await getJurisdictions();
    if (!site.zip || site.skipped) { await open(); return 'modal'; }
    if (jdoc && site.lookupVersion && jdoc.meta.version !== site.lookupVersion && jdoc.zips[site.zip]) { showBanner(); return 'banner'; }
    return null;
  }
  function showBanner() {
    let b = document.getElementById('zipBanner');
    if (!b) { b = document.createElement('div'); b.id = 'zipBanner'; b.className = 'zipBanner'; document.getElementById('stage').appendChild(b); }
    b.innerHTML = 'Local info updated, review? <button type="button" id="zipBannerGo">Review</button><button type="button" id="zipBannerX" aria-label="Dismiss">×</button>';
    b.hidden = false;
    b.querySelector('#zipBannerGo').onclick = () => { b.hidden = true; open({ zip: (getModel().site || {}).zip }); };
    b.querySelector('#zipBannerX').onclick = () => { b.hidden = true; };
  }
  return { open, close, whenClosed, maybeShowOnStart, isOpen: () => !!(root && !root.hidden), getJdoc: () => jdoc };
}
