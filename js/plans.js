// v5 Plans: several named plans in localStorage (autosaved), share links (plan in the URL hash,
// deflate + base64url), .json export / import, and the phone share sheet. No server, no accounts.
import { SCHEMA_VERSION } from './config.js';
import { migrate } from './model.js';

export const PLANS_KEY = 'buildingLayout.plans.v1';
export const LINK_WARN_CHARS = 8000;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const newId = () => 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clean = (m) => { const c = JSON.parse(JSON.stringify(m)); delete c.selection; delete c.lastRegen; return c; };
const sizeOf = (m) => { const xs = m.footprint.map((p) => p[0]), ys = m.footprint.map((p) => p[1]); const f = (v) => Math.round(v * 10) / 10; return `${f(Math.max(...xs) - Math.min(...xs))}×${f(Math.max(...ys) - Math.min(...ys))} ft`; };

// ---------- storage
export function readStore() { try { const s = JSON.parse(localStorage.getItem(PLANS_KEY) || 'null'); if (s && Array.isArray(s.plans)) return s; } catch (e) { /* */ } return { currentId: null, plans: [] }; }
export function writeStore(s) { try { localStorage.setItem(PLANS_KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
export function isModel(m) { return !!(m && typeof m === 'object' && Array.isArray(m.layers) && Array.isArray(m.footprint) && m.footprint.length >= 3 && m.layers.some((l) => l.id === 'walls')); }

// ---------- share codec
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function pipe(bytes, stream) { const r = new Blob([bytes]).stream().pipeThrough(stream); return new Uint8Array(await new Response(r).arrayBuffer()); }
/** {name, model} → "z.<deflate base64url>" (or "j.<base64url json>" without CompressionStream). */
export async function encodePlan(name, model, { noCompress = false } = {}) {
  const json = JSON.stringify({ app: 'building-layout', v: 1, name, model: clean(model) });
  const bytes = new TextEncoder().encode(json);
  if (!noCompress && typeof CompressionStream === 'function') { try { return 'z.' + b64u(await pipe(bytes, new CompressionStream('deflate'))); } catch (e) { /* fall through */ } }
  return 'j.' + b64u(bytes);
}
export async function decodePlan(code) {
  const t = String(code || '').trim(); const kind = t.slice(0, 2); const data = t.slice(2);
  let bytes = unb64u(data);
  if (kind === 'z.') { if (typeof DecompressionStream !== 'function') throw new Error('This browser can\u2019t open compressed links. Ask for the .json file instead.'); bytes = await pipe(bytes, new DecompressionStream('deflate')); }
  else if (kind !== 'j.') throw new Error('Not a plan link.');
  const o = JSON.parse(new TextDecoder().decode(bytes));
  if (!o || !isModel(o.model)) throw new Error('That link doesn\u2019t contain a plan.');
  return { name: String(o.name || 'Shared plan').slice(0, 80), model: o.model };
}
export const shareHashCode = (hash) => { const m = /(?:^#|&)plan=([^&]+)/.exec(hash || ''); return m ? decodeURIComponent(m[1]) : null; };

export function createPlans({ getModel, loadModel, toast, openSize, onShareSaved }) {
  let store = readStore();
  let shared = null; // { name } while viewing a share link that isn't saved yet
  const cur = () => store.plans.find((p) => p.id === store.currentId) || null;
  function ensureCurrent(defaultName = 'My plan') {
    if (cur()) return cur();
    const p = { id: newId(), name: defaultName, created: Date.now(), updated: Date.now(), model: clean(getModel()) };
    store.plans.push(p); store.currentId = p.id; writeStore(store); return p;
  }
  function autosave(m) {
    if (shared) return false; // a share link never overwrites saved plans until "Save to my plans"
    const p = cur() || ensureCurrent(); p.model = clean(m); p.updated = Date.now(); store.lastSaved = p.updated;
    if (!writeStore(store)) { toast('Couldn\u2019t autosave: this device\u2019s storage is full. Export the plan as a file.'); return false; }
    renderIfOpen(); return true;
  }
  const uniqueName = (n) => { let name = n, i = 2; while (store.plans.some((p) => p.name === name)) name = `${n} (${i++})`; return name; };
  function saveAs(name) {
    name = String(name || '').trim(); if (!name) return null;
    const p = { id: newId(), name: uniqueName(name), created: Date.now(), updated: Date.now(), model: clean(getModel()) };
    store.plans.push(p); store.currentId = p.id; shared = null; writeStore(store); hideBanner(); toast(`Saved as \u201c${p.name}\u201d`); renderIfOpen(); return p;
  }
  function open(id) { const p = store.plans.find((x) => x.id === id); if (!p) return false; if (!shared) autosave(getModel()); shared = null; hideBanner(); store.currentId = id; writeStore(store); loadModel(migrate(JSON.parse(JSON.stringify(p.model))), { label: p.name }); toast(`Opened \u201c${p.name}\u201d`); renderIfOpen(); return true; }
  function rename(id, name) { const p = store.plans.find((x) => x.id === id); name = String(name || '').trim(); if (!p || !name) return false; p.name = name.slice(0, 80); writeStore(store); renderIfOpen(); return true; }
  function duplicate(id) { const p = store.plans.find((x) => x.id === id); if (!p) return null; if (id === store.currentId && !shared) p.model = clean(getModel()); const c = { id: newId(), name: uniqueName(p.name + ' copy'), created: Date.now(), updated: Date.now(), model: JSON.parse(JSON.stringify(p.model)) }; store.plans.push(c); writeStore(store); renderIfOpen(); toast(`Duplicated as \u201c${c.name}\u201d`); return c; }
  function remove(id) {
    const i = store.plans.findIndex((x) => x.id === id); if (i < 0) return false; const was = store.plans[i]; store.plans.splice(i, 1);
    if (store.currentId === id) { store.currentId = null; writeStore(store); if (store.plans.length) open(store.plans[store.plans.length - 1].id); else newPlan(true); }
    else writeStore(store);
    toast(`Deleted \u201c${was.name}\u201d`); renderIfOpen(); return true;
  }
  /** New plan: keep the current one saved, start a blank one and open the size pop-up. */
  function newPlan(silent) {
    if (!shared && cur()) autosave(getModel());
    shared = null; hideBanner();
    const p = { id: newId(), name: uniqueName('New plan'), created: Date.now(), updated: Date.now(), model: null };
    store.plans.push(p); store.currentId = p.id; writeStore(store);
    closePanel(); return openSize('new', { newPlan: true, silent });
  }
  // ---------- share
  async function shareUrl() { const p = cur(); const code = await encodePlan(shared ? shared.name : (p ? p.name : 'My plan'), getModel()); const u = new URL(location.href); u.hash = 'plan=' + code; u.search = ''; return u.toString(); }
  async function copyLink() {
    const url = await shareUrl(); let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* clipboard blocked: show the box */ }
    lastLink = url; renderIfOpen();
    const long = url.length > LINK_WARN_CHARS;
    toast(long ? `Link copied, but it\u2019s long (${url.length.toLocaleString()} characters); some apps cut it off. Export the file too.` : copied ? 'Share link copied' : 'Copy the link from the box');
    return { url, copied, long };
  }
  async function nativeShare() {
    const p = cur(); const name = shared ? shared.name : (p ? p.name : 'My plan'); const url = await shareUrl();
    const file = new File([exportText()], fileName(name), { type: 'application/json' });
    try {
      if (url.length > LINK_WARN_CHARS && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ title: name, text: `Building plan: ${name}`, files: [file] });
      else await navigator.share({ title: name, text: `Building plan: ${name}`, url });
      return true;
    } catch (e) { if (e && e.name !== 'AbortError') toast('Sharing didn\u2019t work; use Copy share link.'); return false; }
  }
  const fileName = (n) => `${String(n || 'plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'plan'}.layout.json`;
  function exportText() { const p = cur(); return JSON.stringify({ app: 'building-layout', v: 1, name: shared ? shared.name : (p ? p.name : 'My plan'), exported: new Date().toISOString(), model: clean(getModel()) }, null, 1); }
  function exportFile() { const p = cur(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' })); a.download = fileName(shared ? shared.name : p ? p.name : 'plan'); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function importText(text, fname) {
    let o; try { o = JSON.parse(text); } catch (e) { toast('That file isn\u2019t a plan (.json) file.'); return null; }
    const model = isModel(o) ? o : o && o.model; if (!isModel(model)) { toast('That file doesn\u2019t contain a plan.'); return null; }
    if (model.schema !== SCHEMA_VERSION) model.schema = SCHEMA_VERSION;
    if (!shared && cur()) autosave(getModel());
    shared = null; hideBanner();
    const p = { id: newId(), name: uniqueName(String((o && o.name) || (fname || 'Imported plan').replace(/\.layout\.json$|\.json$/i, '')).slice(0, 80)), created: Date.now(), updated: Date.now(), model: clean(model) };
    store.plans.push(p); store.currentId = p.id; writeStore(store); loadModel(migrate(JSON.parse(JSON.stringify(model))), { label: p.name }); toast(`Imported \u201c${p.name}\u201d`); renderIfOpen(); return p;
  }
  /** Open a share link: read-in copy, not saved until the user taps Save to my plans. */
  async function openShare(code) {
    try {
      const { name, model } = await decodePlan(code);
      if (cur()) autosave(getModel());
      shared = { name }; loadModel(migrate(model), { label: name, shared: true }); showBanner(name); return true;
    } catch (e) { toast(String(e.message || e)); return false; }
  }
  function saveShared() {
    if (!shared) return null; const name = shared.name; shared = null;
    const p = { id: newId(), name: uniqueName(name), created: Date.now(), updated: Date.now(), model: clean(getModel()) };
    store.plans.push(p); store.currentId = p.id; writeStore(store); hideBanner(); clearHash(); toast(`Saved \u201c${p.name}\u201d to your plans`); if (onShareSaved) onShareSaved(); renderIfOpen(); return p;
  }
  function closeShared() { if (!shared) return; shared = null; hideBanner(); clearHash(); const p = cur(); if (p && p.model) loadModel(migrate(JSON.parse(JSON.stringify(p.model))), { label: p.name }); }
  const clearHash = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* */ } };
  function showBanner(name) {
    let b = document.getElementById('shareBanner');
    if (!b) { b = document.createElement('div'); b.id = 'shareBanner'; b.className = 'shareBanner'; b.setAttribute('role', 'status'); document.getElementById('stage').appendChild(b); }
    b.innerHTML = `<span>Shared plan <b>\u201c${esc(name)}\u201d</b>. It isn\u2019t in your plans yet.</span><button type="button" class="sb-save" id="sbSave">Save to my plans</button><button type="button" id="sbClose">Close</button>`;
    b.hidden = false; b.querySelector('#sbSave').onclick = saveShared; b.querySelector('#sbClose').onclick = closeShared;
  }
  function hideBanner() { const b = document.getElementById('shareBanner'); if (b) b.hidden = true; }

  // ---------- panel
  let panel = null; let lastLink = null;
  const when = (t) => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  function render() {
    const p = cur(); const name = shared ? shared.name : p ? p.name : 'My plan';
    const rows = store.plans.filter((x) => x.model).slice().sort((a, b) => b.updated - a.updated).map((x) => `<div class="pl-row ${x.id === store.currentId && !shared ? 'cur' : ''}" data-id="${x.id}"><div class="pl-name">${esc(x.name)}</div><div class="pl-meta">${esc(sizeOf(x.model))} · saved ${esc(when(x.updated))}</div>
      <div class="pl-btns"><button type="button" data-act="open">Open</button><button type="button" data-act="rename">Rename</button><button type="button" data-act="dup">Duplicate</button><button type="button" data-act="del">Delete</button></div></div>`).join('');
    const long = lastLink && lastLink.length > LINK_WARN_CHARS;
    panel.innerHTML = `<div class="pl-card" id="plCard" role="dialog" aria-label="Plans"><h2>Plans <button type="button" class="pl-x" id="plClose" aria-label="Close">✕</button></h2>
      <div class="pl-cur">${shared ? `Viewing shared plan <b>${esc(name)}</b> (not saved yet)` : `Open now: <b id="plCurName">${esc(name)}</b> · autosaved ${esc(when(p && p.updated))}`}</div>
      <div class="pl-acts">
        ${shared ? '<button type="button" class="pl-primary" data-act="saveShared">Save to my plans</button>' : '<button type="button" class="pl-primary" data-act="save">Save as…</button>'}
        <button type="button" data-act="new">Start new plan…</button>
        <button type="button" data-act="link">Copy share link</button>
        ${navigator.share ? '<button type="button" data-act="share">Share…</button>' : ''}
        <button type="button" data-act="export">Export .json file</button>
        <button type="button" data-act="import">Import .json file</button>
      </div>
      ${lastLink ? `<input class="pl-link" id="plLink" readonly value="${esc(lastLink)}" aria-label="Share link"><div class="pl-meta">${lastLink.length.toLocaleString()} characters. Anyone with the link sees a copy; it never changes your saved plans.</div>` : ''}
      ${long ? `<div class="pl-warn" id="plLongWarn">This link is long (${lastLink.length.toLocaleString()} characters, over ~${LINK_WARN_CHARS.toLocaleString()}); texts and some apps may cut it off. <button type="button" data-act="export">Export the .json file</button> and send that instead.</div>` : ''}
      <div class="pl-meta" style="margin:6px 0 4px">My plans (${store.plans.filter((x) => x.model).length}), saved on this device only</div>
      <div class="pl-list" id="plList">${rows || '<div class="pl-meta">No saved plans yet.</div>'}</div>
      <input type="file" id="plFile" accept=".json,application/json" hidden></div>`;
    panel.querySelector('#plClose').onclick = closePanel;
    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); act(b.dataset.act, b.closest('.pl-row') && b.closest('.pl-row').dataset.id); }));
    const f = panel.querySelector('#plFile'); f.addEventListener('change', async () => { const file = f.files[0]; if (file) { importText(await file.text(), file.name); closePanel(); } });
    const li = panel.querySelector('#plLink'); if (li) li.addEventListener('focus', () => li.select());
  }
  async function act(a, id) {
    if (a === 'save') { const n = prompt('Name this plan:', (cur() && cur().name !== 'My plan' ? cur().name + ' copy' : '') || 'My plan'); if (n) saveAs(n); }
    if (a === 'saveShared') saveShared();
    if (a === 'new') newPlan();
    if (a === 'link') await copyLink();
    if (a === 'share') await nativeShare();
    if (a === 'export') exportFile();
    if (a === 'import') panel.querySelector('#plFile').click();
    if (a === 'open') { open(id); closePanel(); }
    if (a === 'rename') { const p = store.plans.find((x) => x.id === id); const n = prompt('New name:', p.name); if (n) rename(id, n); }
    if (a === 'dup') duplicate(id);
    if (a === 'del') { const p = store.plans.find((x) => x.id === id); if (confirm(`Delete \u201c${p.name}\u201d? This can\u2019t be undone.`)) remove(id); }
  }
  function openPanel() { if (!panel) { panel = document.createElement('div'); panel.id = 'plansPanel'; panel.className = 'plansPanel'; panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); }); panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); }); document.body.appendChild(panel); } store = readStore(); render(); panel.hidden = false; }
  function closePanel() { if (panel) panel.hidden = true; }
  function renderIfOpen() { if (panel && !panel.hidden) render(); }

  return { ensureCurrent, autosave, saveAs, open, rename, duplicate, remove, newPlan, copyLink, shareUrl, nativeShare, exportText, exportFile, importText, openShare, saveShared, closeShared, openPanel, closePanel,
    isShared: () => !!shared, current: () => cur(), list: () => readStore().plans, setCurrentName: (n) => { const p = cur(); if (p && /^(My plan|New plan)( \(\d+\))?$/.test(p.name)) { p.name = uniqueName(n); writeStore(store); } }, isOpen: () => !!(panel && !panel.hidden) };
}
