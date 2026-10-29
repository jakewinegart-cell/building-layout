// Wizard chat box (wizard-v1/wizard-spec.md): typed only, no voice input. Side panel on desktop,
// bottom sheet on phones. The proxy returns ONE tool call; app code converts, validates, previews
// on a model copy (with the cost change), and applies only on Apply. Undo/redo: 20 steps (app.js).
import { regenerate } from './generate.js';
import { getContentCached } from './content.js';
import { runEstimate } from './estimate.js';
import { WIZARD_URL, buildSummary, localCommand, compileEdits, validate, resolveSide, SIDE_WORD, ruleCommand, parseToolText, localAnswer, CAN_DO, SUGGEST } from './wizard-core.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (x) => (x == null ? '—' : '$' + Math.round(x).toLocaleString('en-US'));
const signed = (x) => (x >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US');

export function createWizard(api) {
  // api: { getModel, setPreview(cloneOrNull), applyModel(clone, label), undo(), redo(), canUndo(), canRedo(), openReport(), toast }
  const root = document.createElement('aside');
  root.id = 'wizard'; root.className = 'wizard'; root.hidden = true; root.setAttribute('aria-label', 'Wizard');
  root.innerHTML = `
    <div class="wz-head"><b>✨ Wizard</b><span class="wz-sub">Type what to change or ask</span>
      <button type="button" class="wz-ic" id="wzUndo" title="Undo (Ctrl/Cmd-Z)" aria-label="Undo">↶</button>
      <button type="button" class="wz-ic" id="wzRedo" title="Redo" aria-label="Redo">↷</button>
      <button type="button" class="wz-ic" id="wzClose" aria-label="Close wizard">✕</button></div>
    <div class="wz-log" id="wzLog" aria-live="polite"></div>
    <form class="wz-form" id="wzForm" autocomplete="off">
      <input id="wzInput" class="wz-input" type="text" enterkeyhint="send" placeholder="e.g. roof 10 ft at one end to 8 ft at the other" aria-label="Type to the wizard">
      <button type="submit" class="wz-send" id="wzSend">Send</button>
    </form>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const log = $('#wzLog');
  const messages = []; // {role, content} sent to the proxy (last 12 kept there)
  let pending = null; // { clone, plan, label, block }
  let pendingAsk = null; // { intent, slots }
  let busy = false;

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  function bubble(role, html, cls = '') { const d = document.createElement('div'); d.className = `wz-msg ${role} ${cls}`; d.innerHTML = html; log.appendChild(d); scroll(); return d; }
  function say(text, cls) { messages.push({ role: 'assistant', content: String(text).slice(0, 900) }); return bubble('bot', esc(text), cls); }
  function syncUndo() { $('#wzUndo').disabled = !api.canUndo(); $('#wzRedo').disabled = !api.canRedo(); }

  function open() { root.hidden = false; document.body.classList.add('wizardOpen'); syncUndo(); if (!log.children.length) { const el = bubble('bot', 'Hi! Tell me what to change, like <i>“make it 20 by 16”</i>, <i>“make the walls 9 ft”</i>, <i>“add a window on the north wall”</i>, <i>“gable roof”</i>, <i>“piers 6 ft apart”</i>, or type <i>“price check”</i>. I show a preview first; nothing changes until you tap Apply.'); chips(el, SUGGEST.slice(0, 4)); } setTimeout(() => $('#wzInput').focus(), 30); }
  function close() { if (pending) cancel(true); root.hidden = true; document.body.classList.remove('wizardOpen'); }
  $('#wzClose').addEventListener('click', close);
  $('#wzUndo').addEventListener('click', () => doMeta('meta.undo'));
  $('#wzRedo').addEventListener('click', () => doMeta('meta.redo'));
  $('#wzForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#wzInput').value.trim(); if (!v || busy) return; $('#wzInput').value = ''; send(v); });

  function chips(el, options) {
    const row = document.createElement('div'); row.className = 'wz-chips';
    options.forEach((o) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'wz-chip'; b.textContent = o; b.addEventListener('click', () => { if (!busy) send(o, true); }); row.appendChild(b); });
    el.appendChild(row); scroll();
  }

  async function estimate() { try { const C = await getContentCached(); return runEstimate(api.getModel(true), C); } catch (e) { return null; } }
  let lastUser = '';
  async function send(text, fromChip = false) {
    bubble('user', esc(text)); messages.push({ role: 'user', content: text.slice(0, 1000) }); lastUser = text;
    // 1. a pending clarification answered with a chip/short reply → merge slots locally
    if (pendingAsk) { const handled = answerAsk(text); if (handled) return; }
    pendingAsk = null;
    // 2. on-device phrases (no AI call)
    const loc = localCommand(text);
    if (loc) return runTool(loc.kind === 'price' ? { local: 'price' } : loc.kind === 'meta' ? { name: 'meta', arguments: { intent: loc.intent } } : { name: 'propose_edit', arguments: { edits: loc.edits } });
    // 2b. v5 rule parser: common phrasings run on the device (fast, works with no AI / daily limit)
    const rule = ruleCommand(text);
    if (rule) return runTool(rule);
    void fromChip;
    // 3. the AI proxy; on any failure fall back to the rule parser (loose) or a plain "here's what I can do"
    busy = true; root.classList.add('busy'); const wait = bubble('bot', '<span class="wz-dots">Thinking…</span>');
    const fallback = (why) => {
      const r = ruleCommand(text, { loose: true });
      if (r) { runTool(r, { note: 'done on this device' }); return; }
      if (/^(what|how|why|which|is|are|can|does|do)\b|\?\s*$/i.test(text)) { estimate().then((est) => say((why ? `${why} ` : '') + localAnswer(api.getModel(true), est, '', text))); return; }
      cantDo(`${why ? why + ' ' : ''}I didn\u2019t understand \u201c${text}\u201d.`);
    };
    try {
      const est = await estimate();
      const res = await fetch(WIZARD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: messages.slice(-12), summary: buildSummary(api.getModel(true), est) }) });
      wait.remove();
      const isQ = /^(what|how|why|which|is|are|can|does|do)\b|\?\s*$/i.test(text);
      if (res.status === 429) { const r = ruleCommand(text, { loose: true }); if (r) return void runTool(r, { note: 'AI busy; done on this device' }); if (isQ) return void fallback('The AI is busy, please try again in a minute. From the plan data:'); return void say('The wizard is busy. Please try again in a minute. ' + CAN_DO, 'err'); }
      if (res.status === 503) { const r = ruleCommand(text, { loose: true }); if (r) return void runTool(r, { note: 'daily AI limit reached; done on this device' }); if (isQ) return void fallback('The daily free AI limit reached. From the plan data:'); return void say('The daily free AI limit reached. Try again tomorrow. Simple commands still work without AI: ' + CAN_DO, 'err'); }
      let j = null; try { j = await res.json(); } catch (e) { /* */ }
      if (!res.ok) {
        const tc = j && parseToolText(j.text); // the model printed the call as text (live 2026-10-29: "[answer_question(intent=ask.cost, ...)]")
        if (tc) return void runTool(tc, { fromAI: true });
        return void fallback('');
      }
      if (!j || !j.tool_call) return void fallback('');
      runTool(j.tool_call, { fromAI: true });
    } catch (e) {
      wait.remove(); fallback('Offline, so from the plan data:');
    } finally { busy = false; root.classList.remove('busy'); }
  }
  function cantDo(lead) {
    const el = say(`${lead} ${CAN_DO}`.trim()); chips(el, SUGGEST.slice(0, 4));
  }

  function answerAsk(text) {
    const a = pendingAsk; if (!a) return false;
    const isChip = (a.optionSlots && a.optionSlots[text]) || Array.from(log.querySelectorAll('.wz-msg.bot:last-of-type .wz-chip, .wz-chip')).some((b) => b.textContent === text);
    if (!isChip && text.trim().split(/\s+/).length > 4) return false; // a new full command, not an answer
    if (!isChip && (localCommand(text) || ruleCommand(text))) return false;
    if (a.intent === 'roof.make_shed') {
      const side = resolveSide(api.getModel(true), text);
      if (side) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: 'roof.make_shed', slots: Object.assign({}, a.slots, { highSide: SIDE_WORD[side] }) }] } }); return true; }
      const hl = text.match(/(\d+(?:\.\d+)?\s*(?:ft|'|feet)?)\s*(?:to|down to|-)\s*(\d+(?:\.\d+)?\s*(?:ft|'|feet)?)/i);
      if (hl) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: 'roof.make_shed', slots: Object.assign({}, a.slots, { highHeight: hl[1], lowHeight: hl[2] }) }] } }); return true; }
      if (/wall height/i.test(text)) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: 'roof.make_shed', slots: Object.assign({}, a.slots, { heightMeaning: 'wall' }) }] } }); return true; }
      if (/above ground/i.test(text)) { pendingAsk = null; say('Heights above the ground depend on the foundation. Please give wall heights (top of wall above the floor), e.g. “10 ft to 8 ft”.'); return true; }
    }
    if (a.intent === 'walls.set_height') {
      const s = a.slots || {};
      if (/^shed/i.test(text)) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: 'roof.make_shed', slots: { highHeight: s.height, highSide: s.wall } }] } }); return true; }
      if (/^all walls/i.test(text)) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: 'walls.set_height', slots: { height: s.height } }] } }); return true; }
    }
    if (a.optionSlots && a.optionSlots[text]) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: a.intent, slots: Object.assign({}, a.slots, a.optionSlots[text]) }] } }); return true; }
    if (a.intent === 'openings.add') { const side = resolveSide(api.getModel(true), text); if (side) { pendingAsk = null; runTool({ name: 'propose_edit', arguments: { edits: [{ intent: 'openings.add', slots: Object.assign({}, a.slots, { wall: SIDE_WORD[side] }) }] } }); return true; } }
    return false;
  }

  function runTool(tc, ctx = {}) {
    if (!tc) return cantDo('I didn\u2019t get that.');
    if (tc.local === 'price') { say('Running Price check on this device (no AI used).'); api.openReport(); return; }
    const args = tc.arguments || {};
    if (tc.name === 'say') return void cantDoOr(args.text);
    if (tc.name === 'meta') return doMeta(args.intent);
    if (tc.name === 'answer_question') {
      if (args.answer_draft && !args.local) return void say(args.answer_draft);
      return void estimate().then((est) => say(localAnswer(api.getModel(true), est, args.topic || args.intent, lastUser)));
    }
    if (tc.name === 'ask_clarification') {
      pendingAsk = { intent: args.intent, slots: args.slots_so_far || {} };
      const el = say(args.question || 'Can you say a bit more?'); chips(el, (args.options || []).slice(0, 5)); return;
    }
    if (tc.name === 'propose_edit') return propose(args.edits || [], ctx);
    cantDo('The wizard got an answer it doesn\u2019t know how to use.');
  }
  function cantDoOr(text) { const el = say(text); if (/I can:/.test(text)) chips(el, SUGGEST.slice(0, 4)); }

  function doMeta(intent) {
    if (intent === 'meta.apply') { if (pending) apply(); else say('There’s nothing waiting to apply.'); return; }
    if (intent === 'meta.cancel') { if (pending) cancel(); else say('OK.'); return; }
    if (pending) cancel(true);
    if (intent === 'meta.undo') { const l = api.undo(); say(l ? `Undone: ${l}.` : 'Nothing to undo.'); }
    if (intent === 'meta.redo') { const l = api.redo(); say(l ? `Redone: ${l}.` : 'Nothing to redo.'); }
    syncUndo();
  }

  function propose(edits, ctx = {}) {
    if (pending) cancel(true);
    const base = api.getModel(true);
    let plan = compileEdits(base, edits);
    if ((plan.error || plan.ask) && ctx.fromAI) { // the AI misfired (wrong intent / slots): try the device parser on the same words
      const r = ruleCommand(lastUser, { loose: true });
      if (r && r.name === 'propose_edit') { const p2 = compileEdits(base, r.arguments.edits); if (!p2.error) { plan = p2; edits = r.arguments.edits; } }
    }
    if (plan.error) { const el = say(plan.error); if (/I can:|Try/.test(plan.error)) chips(el, SUGGEST.slice(0, 4)); return; }
    if (plan.ask) { pendingAsk = { intent: plan.ask.intent, slots: plan.ask.slots, optionSlots: plan.ask.optionSlots }; const el = say(plan.ask.question); chips(el, plan.ask.options); return; }
    if (!plan.steps.length) return void cantDo('That wouldn\u2019t change anything.');
    const clone = JSON.parse(JSON.stringify(base));
    plan.steps.forEach((s) => s.apply(clone));
    const srcs = Array.from(new Set(plan.steps.map((s) => s.source).filter(Boolean)));
    srcs.forEach((s) => regenerate(clone, s));
    const strip = (m) => { const c = Object.assign({}, m); delete c.view; delete c.selection; delete c.lastRegen; return JSON.stringify(c); };
    if (strip(clone) === strip(base)) return void say(`That\u2019s already the case (${plan.steps.map((x) => x.label).join('; ')}). Nothing to change.`);
    const checks = validate(clone).filter((c) => c.severity !== 'info');
    const block = checks.some((c) => c.severity === 'block');
    const label = plan.steps.map((s) => s.label).join('; ');
    pending = { clone, label, block, edits };
    api.setPreview(clone);
    const card = bubble('bot', `<div class="wz-card" id="wzPreview"><div class="wz-tag">PREVIEW — not applied yet${ctx.note ? ` <span class="muted">(${esc(ctx.note)})</span>` : ''}</div>
      <ul>${plan.steps.map((s) => `<li>${esc(s.label)}</li>`).join('')}${plan.kept.length ? `<li class="muted">Kept: ${esc(plan.kept.join(', '))}</li>` : ''}</ul>
      ${checks.map((c) => `<div class="wz-chk ${c.severity}">${c.severity === 'block' ? '⛔' : '⚠'} ${esc(c.msg)}</div>`).join('')}
      <div class="wz-cost" id="wzCost">Cost change: working it out…</div>
      <div class="wz-btns"><button type="button" class="wz-apply" id="wzApply" ${block ? 'disabled title="Fix the red item first"' : ''}>Apply</button><button type="button" class="wz-cancel" id="wzCancel">Cancel</button></div></div>`);
    messages.push({ role: 'assistant', content: `Preview: ${label}. Apply or cancel?` });
    card.querySelector('#wzApply').addEventListener('click', apply);
    card.querySelector('#wzCancel').addEventListener('click', () => cancel());
    costDelta(base, clone, card.querySelector('#wzCost'));
    const sw = plan.steps.find((x) => x.swap);
    if (sw) { const row = document.createElement('div'); row.className = 'wz-chips'; const b = document.createElement('button'); b.type = 'button'; b.className = 'wz-chip'; b.textContent = sw.swap.label; b.addEventListener('click', () => { bubble('user', esc(sw.swap.label)); propose([{ intent: 'footprint.resize', slots: sw.swap.slots }]); }); row.appendChild(b); card.querySelector('.wz-card').insertBefore(row, card.querySelector('#wzCost')); }
    // V-ROOF-01 (covering too flat): one-tap fixes (wizard-spec §6 template)
    if (checks.some((c) => c.id === 'V-ROOF-01')) {
      const row = document.createElement('div'); row.className = 'wz-chips';
      const fixes = [['Standing seam metal', { intent: 'roof.set_covering', slots: { covering: 'metal_standing_seam' } }], ['Membrane (EPDM/TPO)', { intent: 'roof.set_covering', slots: { covering: 'single_ply' } }], ['Steeper: 2:12 (keep shingles)', { intent: 'roof.set_pitch', slots: { pitch: '2:12' } }]];
      fixes.forEach(([t, ed]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'wz-chip'; b.textContent = t; b.addEventListener('click', () => { bubble('user', esc(t)); propose(edits.filter((x) => x.intent !== ed.intent).concat([ed])); }); row.appendChild(b); });
      card.querySelector('.wz-card').insertBefore(row, card.querySelector('#wzCost'));
    }
  }

  async function costDelta(base, clone, el) {
    try {
      const C = await getContentCached(); const a = runEstimate(base, C), b = runEstimate(clone, C);
      const d = b.totals.materials - a.totals.materials;
      const ids = Array.from(new Set(a.groups.map((g) => g.id).concat(b.groups.map((g) => g.id))));
      const by = ids.map((id) => { const ga = a.groups.find((g) => g.id === id), gb = b.groups.find((g) => g.id === id); const dd = (gb ? gb.total : 0) - (ga ? ga.total : 0); return Math.abs(dd) >= 1 ? `${(gb || ga).name} ${signed(dd)}` : null; }).filter(Boolean);
      el.innerHTML = `<b>Cost change: ${Math.abs(d) < 1 ? 'about $0' : signed(d)}</b> (materials ${money(a.totals.materials)} → ${money(b.totals.materials)})${by.length ? `<div class="muted">${esc(by.join(' · '))}</div>` : ''}<div class="muted">Prices: Home Depot online snapshot${b.snapshotDate ? ' ' + esc(b.snapshotDate) : ''}, not a Denver store, EXAMPLE. Items marked PRICE NEEDED aren’t counted.</div>`;
      el.dataset.delta = String(Math.round(d));
    } catch (e) { el.textContent = 'Cost change: couldn’t price this preview (prices didn’t load).'; }
  }

  function apply() {
    if (!pending) return; if (pending.block) { say('That change has a red item, so it can’t be applied. Change it first.'); return; }
    const p = pending; pending = null; api.setPreview(null);
    api.applyModel(p.clone, p.label);
    const c = log.querySelector('#wzPreview'); if (c) { c.removeAttribute('id'); c.classList.add('done'); c.querySelectorAll('button').forEach((b) => b.remove()); c.querySelector('.wz-tag').textContent = 'APPLIED'; }
    say(`Done: ${p.label}. Price check is now out of date. Type “undo” to go back.`); syncUndo();
  }
  function cancel(silent) {
    if (!pending) return; pending = null; api.setPreview(null);
    const c = log.querySelector('#wzPreview'); if (c) { c.removeAttribute('id'); c.classList.add('done'); c.querySelectorAll('button').forEach((b) => b.remove()); c.querySelector('.wz-tag').textContent = 'CANCELLED'; }
    if (!silent) say('Cancelled. Nothing changed.');
  }

  return { open, close, toggle: () => (root.hidden ? open() : close()), isOpen: () => !root.hidden, send, hasPending: () => !!pending, syncUndo };
}
