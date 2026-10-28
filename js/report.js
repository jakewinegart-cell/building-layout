// ============================================================================
// report.js — the "I'm done" completion report: price, check-these flags, material list,
// plan sheets (A1, S1–S4), 3D views, build steps and the disclaimer. Printable (styles.css @media print).
// Data: content-v3/ (Remodel Guide) when present and valid, otherwise content/ placeholders.
// ============================================================================
import { getContentCached } from './content.js';
import { siteSummary } from './zipmodal.js';
import { runEstimate, siteJurisdiction, estimateSettings, clearSpanAlternative, CLEAR_SPAN_TYPICAL_MAX_FT } from './estimate.js';
import { modelSig, beamState, applyAnswers, saveRun, loadRun } from './pricecheck.js';
import { instructionVars, renderInstructions } from './instructions.js';
import { allSheets } from './sheets.js';
import { getLayer } from './model.js';
import { pierDepthIn } from './config.js';
import { bbox } from './geom.js';

export function getContent() { return getContentCached(); }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (x) => (x == null ? '—' : '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d) => { const [y, mo, da] = String(d).split('-').map(Number); return `${MONTHS[mo - 1]} ${da}, ${y}`; };
export const hdLabel = (d) => `Home Depot online price, checked ${niceDate(d)}, not localized`;

const DISCLAIMER = 'This is an estimate, not stamped plans. Material prices come from a homedepot.com snapshot taken {snapshot_date} (America/Denver). They were shown for Home Depot\'s default online store, not localized to your local store{store_note}, and they change often and vary by store. Some prices are estimates and are marked "est." Quantities follow general rules of thumb with waste included. Your plans, your local code and your building department decide what\'s actually required. Structural items (beams, headers, footings, piers, rebar, anything marked FLAGGED) need to be checked by your building department or a licensed engineer. Labor, permits, delivery and tools aren\'t included unless you add them.';
const DISCLAIMER_PH = 'This is an estimate, not stamped plans. ALL PRICES ARE PLACEHOLDERS, not real Home Depot prices. Quantities follow general rules of thumb with waste included. Your plans, your local code and your building department decide what\'s actually required. Structural items (beams, headers, footings, piers, rebar, anything marked FLAGGED) need to be checked by your building department or a licensed engineer. Labor, permits, delivery and tools aren\'t included unless you add them.';

function priceCell(l, C) {
  if (l.status === 'unpriced') return `<span class="ph">needs a price</span>`;
  const each = `${usd(l.unitPrice)}${l.unit ? ` / ${esc(l.unit)}` : ''}${l.bulk ? ' <span class="rp-meta">(bulk)</span>' : ''}`;
  if (l.status === 'hd') return `${each}<br><span class="ph real" title="${esc(hdLabel(l.dateChecked))}">${esc(hdLabel(l.dateChecked))}</span>`;
  if (l.status === 'estimate') return `${each}<br><span class="ph est">est. — estimate, not a Home Depot price</span>`;
  return `${each}<br><span class="ph">PLACEHOLDER — not a real Home Depot price</span>`;
}
function linkCell(l) {
  if (l.status === 'hd' && l.url) return `<a href="${esc(l.url)}" target="_blank" rel="noopener">Home Depot ↗</a>${l.internetNumber ? ` <span class="rp-meta">Internet #${esc(l.internetNumber)}</span>` : ''}`;
  if (l.status === 'estimate') return `<div class="rp-est-src"><b>Estimate source:</b> ${esc(l.estimateSource)}${l.sourceUrl ? ` <a href="${esc(l.sourceUrl)}" target="_blank" rel="noopener">source ↗</a>` : ''}${l.url ? ` · <a href="${esc(l.url)}" target="_blank" rel="noopener">Home Depot ↗</a>` : ''}</div>`;
  if (l.search) return `<a href="${esc(l.search)}" target="_blank" rel="noopener">Search Home Depot ↗</a>`;
  return '';
}

export async function renderReport(root, opts) {
  const { v3, onClose, toast } = opts;
  const getModel = opts.getModel || (() => opts.model);
  const commit = opts.commit || (() => {});
  const persist = opts.persist || (() => {});
  const C = await getContent();
  let run = memRun || loadRun();
  let scrollY = 0;
  const snapsFor = (k) => (run && run.snaps ? run.snaps[k] : null);

  // ---------------- pre-check
  function renderPrecheck() {
    const m = getModel();
    const set = estimateSettings(m);
    const f = getLayer(m, 'foundation').params;
    const beam = beamState(m);
    const prev = set.beamChoice;
    const lastStale = run ? modelSig(m) !== run.sig : false;
    let h = `<div class="rp-bar"><b>Price check</b><button id="pcCancel">Cancel</button></div><div class="rp-body pc">
<p class="pc-intro">Prices your floor plan <b>as it is right now</b>. Answer what you know — every item can be skipped, and anything skipped is flagged in the report.</p>
${run ? `<p class="rp-meta">Last price check: ${esc(new Date(run.ranAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${lastStale ? ' — <b class="rp-warn">out of date</b>' : ''}. <a href="#" id="pcViewLast">View last report</a></p>` : ''}
${(() => {
  const S = siteSummary(m, C.jdoc); const J = siteJurisdiction(m, C);
  const lt = J && J.taxRatePct != null ? J.taxRatePct : null; const lf = J && J.frostDepthIn != null ? J.frostDepthIn : null;
  const ov = S.site.taxSource === 'user' && set.taxRatePct != null ? set.taxRatePct : null;
  return `<div class="pc-card" id="pcTax"><div class="pc-h"><span class="pc-n">1</span><b>Location</b><button class="pc-skip" data-skip="tax">Skip</button></div>
<div class="pc-loc" id="pcLocInfo"><b>${S.zip ? 'ZIP ' + esc(S.zip) : 'No ZIP entered'}</b>${S.known ? ' · ' + esc(S.label) : S.zip ? ' · no local data yet' : ''}<br><span class="rp-meta">${J ? `Sales tax ${lt != null ? `<b>${esc(lt)}%</b> from the ZIP lookup ✅` : '<b>unknown</b> ⚠️'} · frost depth ${lf != null ? `<b>${esc(lf)} in</b> ✅` : 'unknown ⚠️'}${J.store ? ` · nearest store ${esc(J.store.name)} (prices not localized)` : ''}` : 'Tax and frost depth are unknown until you enter a ZIP (piers drawn at a conservative ' + esc(f.placeholderFrostIn) + ' in placeholder, tax not included — both flagged).'}</span>
<button type="button" class="btn" id="pcZipBtn">${S.zip ? 'Change ZIP' : 'Enter ZIP'}</button></div>
<input id="pcLoc" type="hidden" value="${esc(S.zip ? S.label + (S.known ? ' ' + S.zip : '') : '')}">
<label>Sales tax rate % <span class="rp-meta">(your rate — overrides the ZIP lookup)</span><input id="pcTaxPct" type="number" inputmode="decimal" step="0.01" min="0" max="20" placeholder="${lt != null ? `from ZIP: ${esc(lt)}%` : 'not set'}" value="${ov == null ? '' : esc(ov)}"></label>
<div class="rp-meta">${lt != null ? `Blank = use the ZIP lookup (${esc(lt)}%).` : 'Blank = not included (0%, flagged). The app never guesses a rate.'}</div></div>
<div class="pc-card" id="pcFrost"><div class="pc-h"><span class="pc-n">2</span><b>Frost depth</b><button class="pc-skip" data-skip="frost">Skip</button></div>
<label>Frost depth, inches<input id="pcFrostIn" type="number" inputmode="numeric" min="1" max="120" step="1" placeholder="blank = ${esc(f.placeholderFrostIn)} in placeholder" value="${f.frostDepthIn == null || f.frostDepthIn === '' ? '' : esc(f.frostDepthIn)}"></label>
<div class="rp-meta">${lf != null ? `From the ZIP lookup: ${esc(lf)} in (${esc(J.jurisdiction.label)}). ` : ''}Piers go max(frost + margin, 12) in below grade. Blank = piers/footings priced at a conservative ${esc(f.placeholderFrostIn)} in PLACEHOLDER (flagged).</div></div>`;
})()}`;
    if (beam.has) {
      const sel = beam.supported ? 'piers' : (prev === 'skip' ? 'skip' : '');
      h += `<div class="pc-card" id="pcBeam"><div class="pc-h"><span class="pc-n">3</span><b>Mid-floor beam support</b><button class="pc-skip" data-skip="beam">Skip</button></div>
<p class="rp-meta">Your ${beam.spanFt} ft joist span needs a mid beam, and right now nothing holds it up (piers are only under walls/corners). How should this project handle it?</p>
<label class="pc-opt"><input type="radio" name="pcBeam" value="piers"${sel === 'piers' ? ' checked' : ''}> <span><b>Add piers under the beam</b><br><span class="rp-meta">About ${Math.max(1, Math.ceil(beam.girders.reduce((s, g) => s + Math.hypot(g.geometry.b[0] - g.geometry.a[0], g.geometry.b[1] - g.geometry.a[1]), 0) / ((Number(f.pierSpacingIn) || 72) / 12)) - beam.girders.length)} piers along the beam line. Beam and piers still need an engineer.</span></span></label>
<label class="pc-opt"><input type="radio" name="pcBeam" value="clearspan"> <span><b>Use 2x12 joists spanning wall to wall instead</b><br><span class="rp-meta">No mid beam.${beam.spanFt > CLEAR_SPAN_TYPICAL_MAX_FT ? ` <span class="rp-warn">Caution: ${beam.spanFt} ft is longer than the ~${CLEAR_SPAN_TYPICAL_MAX_FT} ft a 2x12 typically spans — likely not enough.</span>` : ' Verify against your span table.'}</span></span></label>
<label class="pc-opt"><input type="radio" name="pcBeam" value="skip"${sel === 'skip' ? ' checked' : ''}> <span>Skip — leave it unsupported and flag it</span></label></div>`;
    }
    h += `<button id="pcRun" class="pc-run">Run price check</button><p class="rp-meta" style="text-align:center">Runs the material takeoff on your current plan and opens the report.</p></div>`;
    root.innerHTML = h; root.scrollTop = 0;
    const q = (s) => root.querySelector(s);
    q('#pcCancel').onclick = () => onClose && onClose();
    if (q('#pcZipBtn')) q('#pcZipBtn').onclick = () => { const zm = window.__layout && window.__layout.zipModal; if (zm) zm.open({ zip: (getModel().site || {}).zip, onDone: () => renderPrecheck() }); };
    if (q('#pcViewLast')) q('#pcViewLast').onclick = (e) => { e.preventDefault(); renderRun(); bindRun(); };
    root.querySelectorAll('.pc-skip').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.skip;
      if (k === 'tax') { q('#pcTaxPct').value = ''; }
      if (k === 'frost') q('#pcFrostIn').value = '';
      if (k === 'beam') q('input[name=pcBeam][value=skip]').checked = true;
      b.closest('.pc-card').classList.add('skipped'); b.textContent = 'Skipped';
    }));
    root.querySelectorAll('.pc-card input').forEach((i) => i.addEventListener('input', () => { const c = i.closest('.pc-card'); c.classList.remove('skipped'); const sb = c.querySelector('.pc-skip'); if (sb) sb.textContent = 'Skip'; }));
    q('#pcRun').onclick = () => {
      const tax = numOrNull(q('#pcTaxPct').value); const frost = numOrNull(q('#pcFrostIn').value);
      const bsel = root.querySelector('input[name=pcBeam]:checked');
      const answers = {
        location: q('#pcLoc').value.trim(), taxRatePct: tax, taxSkipped: tax == null && !(siteJurisdiction(getModel(), C) && siteJurisdiction(getModel(), C).taxRatePct != null),
        lookupFrostIn: (siteJurisdiction(getModel(), C) || {}).frostDepthIn ?? null,
        frostDepthIn: frost != null && frost > 0 ? frost : null, frostSkipped: !(frost != null && frost > 0),
        beam: beam.has ? (bsel ? bsel.value : 'skip') : null,
      };
      runPriceCheck(answers);
    };
  }

  function runPriceCheck(answers) {
    const m = getModel();
    const srcs = applyAnswers(m, answers);
    srcs.forEach((s) => commit(s));
    persist();
    const live = getModel();
    run = { ranAt: new Date().toISOString(), sig: modelSig(live), answers, model: JSON.parse(JSON.stringify(live)), snaps: takeSnaps() };
    memRun = run; saveRun(run);
    renderRun(); bindRun();
    toast && toast('Price check done');
  }
  function takeSnaps() {
    const out = {};
    if (!v3 || !v3.snapshot) return out;
    try {
      out.aerial = v3.snapshot('aerial', { w: 900, h: 600 }); out.front = v3.snapshot('front', { w: 900, h: 560 });
      out.side = v3.snapshot('side', { w: 900, h: 560 }); out.top = v3.snapshot('top', { w: 900, h: 700 });
      out['aerial-x'] = v3.snapshot('aerial', { w: 900, h: 640, exploded: true });
    } catch (e) { console.warn('3D snapshot failed', e); }
    return out;
  }

  // ---------------- report (always from the frozen run)
  function renderRun() {
    const m = run.model;
    const ans = run.answers || {};
    const est = runEstimate(m, C);
    const set = estimateSettings(m);
    const fnd = getLayer(m, 'foundation'); const f = fnd.params;
    const beam = beamState(m);
    const alt = beam.has && !beam.supported && C.mode === 'hd' ? clearSpanAlternative(m, C, est) : null;
    const stale = modelSig(getModel()) !== run.sig;
    if (!run.snaps && !stale) run.snaps = takeSnaps();
    const frostSet = f.frostDepthIn != null && f.frostDepthIn !== '';
    const T = est.totals; const hd = C.mode === 'hd';
    const b = bbox(m.footprint);
    const S = allSheets(m);
    const ranAt = new Date(run.ranAt);
    const snapDate = hd ? C.snapshotDate : null;
    const nEst = est.lines.filter((l) => l.status === 'estimate').length;
    const nHd = est.lines.filter((l) => l.status === 'hd').length;
    const flags = est.flags.slice();

    // ---------- header + TOC
    let h = `<div class="rp-bar"><b>Your addition — estimate &amp; plans</b><button id="rpPrint" class="primary">Print / PDF</button><button id="rpClose">Close</button></div>
<nav class="rp-toc"><a href="#rp-total">Total</a><a href="#rp-check">Check these</a><a href="#rp-mat">Materials</a><a href="#rp-A1">A1 Plan</a><a href="#rp-S1">S1 Foundation</a><a href="#rp-S2">S2 Floor</a><a href="#rp-S3">S3 Walls</a><a href="#rp-S4">S4 Roof</a><a href="#rp-3d">3D</a><a href="#rp-steps">Build steps</a><a href="#rp-disc">Disclaimer</a></nav>
<div class="rp-body">`;
    if (stale) h += `<div class="rp-stale" id="rpStale"><b>Out of date</b>You changed the plan after this price check. Everything below is for the plan as it was at ${esc(ranAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}; nothing has been re-priced. <button id="rpRerun" class="btn primary">Re-run price check</button></div>`;
    else h += `<div class="rp-fresh rp-meta" id="rpFresh">Priced from your plan as of this price check. If you edit the plan, this report is marked out of date until you re-run it.</div>`;

    // ---------- 1. total + breakdown
    h += `<section class="rp-sec" id="rp-total"><h2>Estimated cost</h2>
<div class="rp-meta">${esc(m.name || 'Addition')} · ${b.w.toFixed(1)} × ${b.h.toFixed(1)} ft · ${esc(f.type)} foundation · price check run ${esc(ranAt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}${ans.location ? ` · tax location: ${esc(ans.location)}` : ''}</div>`;
    h += hd
      ? `<div class="rp-price-src" id="rpPriceSrc"><b>Prices: ${esc(hdLabel(snapDate))}.</b> Snapshot date <b>${esc(snapDate)}</b> (America/Denver). ${nHd} lines use checked Home Depot prices${nEst ? `; <b>${nEst} lines are estimates</b> (marked <span class="ph est">est.</span>, source shown)` : ''}${T.unpriced.length ? `; ${T.unpriced.length} need a price` : ''}.</div>`
      : `<div class="rp-ph-banner"><b>PLACEHOLDER PRICES</b>Remodel Guide's Home Depot price data wasn't found, so every price here is a made-up placeholder, not a real Home Depot price.</div>`;
    h += `<div class="rp-total"><span class="amt" id="rpTotal">${usd(T.total)}</span><span class="rp-meta">${T.taxSet ? `includes ${T.taxRatePct}% sales tax${T.taxSource && T.taxSource !== 'user' ? ` (${esc(T.taxSource)})` : ''}` : '<b class="rp-warn">sales tax not included — rate unknown</b>'}${T.contingencyPct ? ` · ${T.contingencyPct}% contingency` : ''}${T.labor == null ? ' · labor not included' : ''}</span></div>`;
    h += `<div class="rp-settings" id="rpSettings">
<label>Sales tax rate %<input id="rpTax" inputmode="decimal" type="number" step="0.01" min="0" max="20" placeholder="${T.taxSet ? `from ZIP: ${T.taxRatePct}%` : 'not set — enter your rate'}" value="${set.taxRatePct == null ? '' : esc(set.taxRatePct)}"></label>
<label>Contingency %<input id="rpCont" inputmode="decimal" type="number" step="1" min="0" max="50" value="${esc(set.contingencyPct)}"></label>
<label>Delivery $<input id="rpDel" inputmode="decimal" type="number" step="1" min="0" placeholder="0" value="${set.deliveryUsd ? esc(set.deliveryUsd) : ''}"></label>
<label>Labor $<input id="rpLab" inputmode="decimal" type="number" step="1" min="0" placeholder="not included" value="${set.laborUsd == null ? '' : esc(set.laborUsd)}"></label>
${hd ? `<label>Concrete<select id="rpConc">${['auto', 'bags80', 'bags60', 'readymix'].map((k) => `<option value="${k}"${set.concreteMode === k ? ' selected' : ''}>${({ auto: 'Auto (ready-mix over 1 yd)', bags80: '80 lb bags', bags60: '60 lb bags', readymix: 'Ready-mix' })[k]}</option>`).join('')}</select></label>
<label class="ck"><input id="rpIce" type="checkbox"${set.iceBarrier !== false ? ' checked' : ''}> Ice &amp; water barrier at eaves</label>` : ''}
</div>`;
    h += `<table class="rp-break" id="rpBreak"><tbody>`;
    const maxG = Math.max(1, ...est.groups.map((g) => g.total));
    est.groups.forEach((g) => { h += `<tr data-group="${g.id}"><td>${esc(g.name)}<div class="bar" style="width:${Math.round((g.total / maxG) * 100)}%"></div></td><td class="n">${usd(g.total)}</td></tr>`; });
    h += `<tr class="sub"><td>Materials (waste included)${T.fromEstimates ? `<div class="rp-meta">of which ${usd(T.fromEstimates)} is from estimated prices (est.)</div>` : ''}${T.unpriced.length ? `<div class="rp-meta">${T.unpriced.length} line(s) need a price and aren't counted</div>` : ''}</td><td class="n">${usd(T.materials)}</td></tr>`;
    h += `<tr id="rpTaxRow"><td>Sales tax ${T.taxSet ? `@ <b>${T.taxRatePct}%</b> (${T.taxSource === 'user' ? 'your rate' : esc(T.taxSource)})` : '— <b>rate unknown, 0% used</b>. Enter your ZIP or your local rate above.'}${hd ? '<div class="rp-meta">If your jurisdiction collects use tax on materials at permit time, use that rate.</div>' : ''}</td><td class="n">${usd(T.tax)}</td></tr>`;
    h += `<tr><td>Contingency ${T.contingencyPct}% (on materials + tax)</td><td class="n">${usd(T.contingency)}</td></tr>`;
    h += `<tr><td>Delivery${T.delivery ? '' : ' <span class="rp-meta">(not added)</span>'}</td><td class="n">${usd(T.delivery)}</td></tr>`;
    h += `<tr><td>Labor</td><td class="n">${T.labor == null ? 'not included' : usd(T.labor)}</td></tr>`;
    h += `<tr class="sum"><td>Total <span class="rp-meta">(tax rate used: ${T.taxSet ? T.taxRatePct + '%' : 'none — 0%'})</span></td><td class="n">${usd(T.total)}</td></tr></tbody></table>`;
    if (est.concreteAlternatives) {
      const ca = est.concreteAlternatives; const r = est.report;
      h += `<p class="rp-meta">Concrete: ${r.concreteYd} cu yd (${r.concreteCuFt} cu ft) ${r.pierCount ? `incl. ${r.pierCount} piers` : 'for the foundation'}. Using <b>${esc(r.concreteMode)}</b>. Concrete cost by method (materials only): ${ca.bags80.qty} × 80 lb bags ${usd(ca.bags80.cost)} · ${ca.bags60.qty} × 60 lb bags ${usd(ca.bags60.cost)} · ready-mix ${ca.readymix.yd} yd ${usd(ca.readymix.cost)}${ca.readymix.estimate ? ' <span class="ph est">est.</span>' : ''}. Change it with the Concrete setting above.</p>`;
    }
    h += `</section>`;

    // ---------- 2. check these (pre-check answers + engine flags). Skipped pre-check items are flagged here.
    h += `<section class="rp-sec" id="rp-check"><h2>Check these before you buy</h2>`;
    h += ans.taxSkipped || !T.taxSet
      ? `<div class="rp-flag warn" id="rpFlagTax" data-skipped="tax"><b>Sales tax: unknown — not included</b><p>Tax rate unknown, enter yours. No ZIP lookup and no rate entered, so <b>no sales tax is included</b> (0% used). Enter your ZIP or rate and re-run the price check.</p></div>`
      : `<div class="rp-flag ok" id="rpFlagTax"><b>Sales tax: ${T.taxRatePct}%</b>${ans.location ? ` <span class="rp-meta">(${esc(ans.location)})</span>` : ''}<p>${T.taxSource === 'user' ? 'The rate you entered — check it with your city/county.' : `From the ${esc(T.taxSource)} (verified source in content-v4/jurisdictions.json).`}</p></div>`;
    h += frostSet
      ? `<div class="rp-flag ok" id="rpFrost"><b>Frost depth: ${esc(f.frostDepthIn)} in</b>${est.report && est.report.frostSource ? ` <span class="rp-meta">(${esc(est.report.frostSource)})</span>` : ''}<p>Piers/footings go ${esc(pierDepthIn(f))} in below grade (max(frost + margin, 12 in)).</p></div>`
      : `<div class="rp-flag warn" id="rpFrost" data-skipped="frost"><b>Frost depth unknown — pier depth is a PLACEHOLDER</b><p>Frost depth unknown. Piers drawn at ${esc(f.placeholderFrostIn)} in as a conservative <span class="ph">PLACEHOLDER</span>. Enter your local value (or your ZIP) and re-run the price check.</p></div>`;
    if (beam.has && beam.supported) {
      h += `<div class="rp-flag ok" id="rpBeam" data-choice="piers"><b>Mid floor beam: ${beam.supportPiers} pier(s) added under it</b><p>Your pre-check choice. They're priced in the foundation. The beam (3-ply ${esc(beam.joistSize)}) and these piers are EXAMPLE sizes — <b>FLAGGED</b> for an engineer to size.</p></div>`;
    } else if (beam.has) {
      h += `<div class="rp-flag bad" id="rpBeam" data-skipped="beam"><b>FLAGGED: mid floor beam has no supports</b>
<p>The ${beam.spanFt} ft joist span is over the ${beam.beamFlagSpanFt} ft limit, so the app added a mid beam (3-ply ${esc(beam.joistSize)}). <b>Nothing is under it</b> — piers are only under the walls and corners, and the app did not add any on its own. The beam-support question was skipped in the price check.</p>`;
      if (alt) h += `<p>Options (re-run the price check to pick one): add piers under the beam, or use <b>2x12 joists spanning wall to wall</b> (no mid beam) — about <b>${alt.delta <= 0 ? '−' : '+'}${usd(Math.abs(alt.delta))}</b> → ${usd(alt.total)}.${alt.withinTypical ? ' <span class="rp-meta">(Remodel Guide example: 2x12 @ 16 in — verify against your span table.)</span>' : ` <span class="rp-warn">Caution: ${beam.spanFt} ft is longer than the ~${CLEAR_SPAN_TYPICAL_MAX_FT} ft a 2x12 typically spans; it very likely won't work here.</span>`}</p>`;
      h += `</div>`;
    } else if (ans.beam === 'clearspan') {
      h += `<div class="rp-flag ok" id="rpBeam" data-choice="clearspan"><b>Floor: ${esc(beam.joistSize)} joists spanning wall to wall (no mid beam)</b><p>Your pre-check choice. ${beam.spanFt > CLEAR_SPAN_TYPICAL_MAX_FT ? `<span class="rp-warn">Caution: a ${beam.spanFt} ft span is longer than the ~${CLEAR_SPAN_TYPICAL_MAX_FT} ft a 2x12 @ 16 in typically spans — check a span table or use engineered joists.</span>` : 'EXAMPLE size — verify against your span table.'}</p></div>`;
    }
    const shown = flags.filter((x) => !(/mid beam/i.test(x)) && !(/Frost depth (not entered|unknown)/i.test(x)) && !(/tax rate unknown/i.test(x)));
    if (shown.length) h += `<ul class="rp-flags">${shown.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    h += `</section>`;

    // ---------- 3. material list
    h += `<section class="rp-sec pb" id="rp-mat"><h2>Material list</h2>
<p class="rp-meta">${hd ? `Prices: ${esc(hdLabel(snapDate))}. Lines marked <span class="ph est">est.</span> are estimates (source shown). Quantities include waste and are rounded up to what you buy.` : 'PLACEHOLDER prices — not real Home Depot prices.'}</p>
<table class="rp-mat"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Line total</th><th>Link / source</th></tr></thead><tbody>`;
    est.groups.forEach((g) => {
      h += `<tr class="grp"><td colspan="6">${esc(g.name)} <span class="n">${usd(g.total)}</span></td></tr>`;
      g.lines.forEach((l) => {
        h += `<tr class="item st-${l.status}" data-line="${esc(l.id)}"><td class="c-name">${esc(l.desc)}${l.product ? `<div class="basis">${esc(l.product)}</div>` : ''}${l.qtyCalc != null ? `<div class="basis">needs ${esc(l.qtyCalc)} ${esc(l.calcUnit)}${l.note ? ` · ${esc(l.note)}` : ''}</div>` : (l.note ? `<div class="basis">${esc(l.note)}</div>` : '')}</td>
<td class="c-qty n">${esc(l.qty)}</td><td class="c-unit">${esc(l.unit)}</td><td class="c-price n">${priceCell(l, C)}</td><td class="c-total n">${l.total == null ? '—' : usd(l.total)}</td><td class="c-link">${linkCell(l)}</td></tr>`;
      });
    });
    h += `<tr class="grp"><td colspan="6">Materials subtotal <span class="n">${usd(T.materials)}</span></td></tr></tbody></table></section>`;

    // ---------- 4. plan sheets
    const tb = (id, title) => `<div class="tb"><span><b>${id}</b> ${esc(title)}</span><span>${esc(m.name || 'Addition')} · not for construction without review</span></div>`;
    const notes = (n) => `<div class="notes">${n.map((x) => `<div>• ${esc(x)}</div>`).join('')}</div>`;
    ['A1', 'S1', 'S2'].forEach((k) => { const s = S[k]; h += `<section class="rp-sec pb" id="rp-${k}"><h2>${k} ${esc(s.title)}</h2><div class="rp-sheet">${s.svg}${tb(k, s.title)}${notes(s.notes)}</div></section>`; });
    h += `<section class="rp-sec pb" id="rp-S3"><h2>S3 ${esc(S.S3.title)}</h2>${S.S3.walls.map((w) => `<div class="rp-sheet">${w.svg}${tb('S3', `${w.name} · ${w.lenFt.toFixed(2)} ft · ${w.ops} opening(s)`)}</div>`).join('')}<div class="notes rp-meta">${S.S3.notes.map((x) => `<div>• ${esc(x)}</div>`).join('')}</div></section>`;
    h += `<section class="rp-sec pb" id="rp-S4"><h2>S4 ${esc(S.S4.title)}</h2><div class="rp-sheet">${S.S4.svg}${tb('S4', S.S4.title)}</div><div class="rp-sheet">${S.S4.section}${tb('S4', 'Roof section')}${notes(S.S4.notes)}</div></section>`;

    // ---------- 5. 3D views
    h += `<section class="rp-sec pb" id="rp-3d"><h2>A2 3D views</h2><div class="rp-3d">`;
    [['aerial', 'Aerial'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['aerial-x', 'Exploded']].forEach(([k, t]) => {
      h += `<div class="rp-sheet">${snapsFor(k) ? `<img alt="${t} view" src="${snapsFor(k)}">` : `<div class="rp-meta" style="padding:20px">3D view unavailable</div>`}${tb('A2', t + ' view')}</div>`;
    });
    h += `</div></section>`;

    // ---------- 6. build steps
    h += `<section class="rp-sec pb" id="rp-steps"><h2>Build steps (in build order)</h2>`;
    if (hd && C.instructionsMd) {
      const secs = renderInstructions(C.instructionsMd, instructionVars(m, est, C.rules));
      h += `<p class="rp-meta">From Remodel Guide's build guide, filled in with this model's numbers.</p><div class="rp-guide">${secs.map((s, i) => `<div class="rp-phase" data-phase="${i}"><h3>${esc(s.title)}</h3>${s.html}</div>`).join('')}</div>`;
    } else if (C.steps) {
      h += `<ol class="rp-steps">${C.steps.steps.map((s) => `<li><div class="ph-h">${esc(s.phase)}</div><b class="t">${esc(s.title)}</b>${(s.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}${s.check ? `<div class="chk">${esc(s.check)}</div>` : ''}</li>`).join('')}</ol>`;
    }
    h += `</section>`;

    // ---------- 7. disclaimer + data sources
    h += `<section class="rp-sec" id="rp-disc"><div class="rp-disc"><h2>Disclaimer</h2><p id="rpDiscText">${esc(hd ? DISCLAIMER.replace('{snapshot_date}', snapDate).replace('{store_note}', (est.jurisdiction && est.jurisdiction.store) ? ` (nearest: Home Depot ${est.jurisdiction.store.name})` : '') : DISCLAIMER_PH)}</p></div>
<h3>Data sources</h3><div class="rp-src">${hd ? `Price snapshot: ${esc(snapDate)} (${esc(C.prices.meta.timezone || 'America/Denver')}). ${esc(C.prices.meta.store_context || '')}<br>` : ''}
Takeoff rules: ${esc(C.status.files.rules)} · Prices: ${esc(C.status.files.prices)} · Steps: ${esc(C.status.files.steps)}${C.status.files.engine ? ` · Engine: ${esc(C.status.files.engine)}` : ''}<br>
${C.status.counts ? `Price entries: ${C.status.counts.total} (${C.status.counts.verified} checked, ${C.status.counts.estimated} estimates, ${C.status.counts.unpriced} without a price${C.status.counts.rejected ? `, ${C.status.counts.rejected} rejected` : ''}).<br>` : ''}
${C.status.issues.length ? `Data issues: ${C.status.issues.map(esc).join('; ')}` : ''}</div></section></div>`;

    root.innerHTML = h;
    root.scrollTop = scrollY; scrollY = 0;
  }
  function setEst(k, v) {
    run.model.estimate = Object.assign(estimateSettings(run.model), { [k]: v });
    const lm = getModel(); lm.estimate = Object.assign(estimateSettings(lm), { [k]: v }); persist();
    if (k === 'taxRatePct') { run.answers = Object.assign({}, run.answers, { taxRatePct: v, taxSkipped: v == null }); }
    saveRun(run); memRun = run; scrollY = root.scrollTop; renderRun(); bindRun();
  }
  function bindRun() {
    const q = (s) => root.querySelector(s);
    q('#rpClose').onclick = () => onClose && onClose();
    q('#rpPrint').onclick = () => window.print();
    root.querySelectorAll('.rp-toc a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const t = root.querySelector(a.getAttribute('href')); if (t) root.scrollTo({ top: t.offsetTop - 96, behavior: 'smooth' }); }));
    q('#rpTax').onchange = (e) => setEst('taxRatePct', numOrNull(e.target.value));
    q('#rpCont').onchange = (e) => setEst('contingencyPct', numOrNull(e.target.value) || 0);
    q('#rpDel').onchange = (e) => setEst('deliveryUsd', numOrNull(e.target.value) || 0);
    q('#rpLab').onchange = (e) => setEst('laborUsd', numOrNull(e.target.value));
    if (q('#rpConc')) q('#rpConc').onchange = (e) => setEst('concreteMode', e.target.value);
    if (q('#rpIce')) q('#rpIce').onchange = (e) => setEst('iceBarrier', e.target.checked);
    if (q('#rpRerun')) q('#rpRerun').onclick = () => renderPrecheck();
  }
  /** Called by the app after any committed edit while the report is open: mark stale, never re-price. */
  function markStale() {
    if (!run || !root.querySelector('#rp-total')) return;
    if (modelSig(getModel()) !== run.sig && !root.querySelector('#rpStale')) { scrollY = root.scrollTop; renderRun(); bindRun(); }
  }

  // Tapping "Price check" always starts at the pre-check for the CURRENT plan.
  if (opts.show === 'last' && run) { renderRun(); bindRun(); } else renderPrecheck();
  return { markStale, content: C, getRun: () => run };
}
const numOrNull = (s) => (String(s).trim() === '' || !isFinite(Number(s)) ? null : Number(s));
let memRun = null;
