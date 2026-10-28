// App shell: state, layer panel, properties, Plan/3D toggle, regeneration notes.
import { ASSUMPTIONS, DEFAULTS, PLAN, LUMBER, LAYER_COLORS, PIERS } from './config.js';
import { ensureManual, movePier, deletePier, duplicatePier, resetToAuto, restoreAutoLayout, isManual, originOf, pierDefaults, parseFtIn, allPiers, pierSlotKey } from './piers.js';
import { createDefaultModel, load, save, clear, getLayer, findObject, stackOrder, uid } from './model.js';
import { regenerate, headerFor } from './generate.js';
import { createPlan } from './plan.js';
import { createView3D } from './view3d.js';
import { fmtFtIn, dist } from './geom.js';
import { createInspector } from './inspect.js';
import { createZipModal, siteSummary } from './zipmodal.js';
import { frostKnown } from './config.js';
import { loadRun, layerPriceState } from './pricecheck.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/></svg>',
  ghost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" opacity=".45"/></svg>',
  isolate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

let model = load();
const fresh = !model;
// v4 migration: the old 24 in drawing placeholder becomes the 48 in unknown-ZIP fallback (content-v4)
if (model) { const fp0 = (model.layers.find((l) => l.id === 'foundation') || {}).params; if (fp0 && Number(fp0.placeholderFrostIn) === 24) fp0.placeholderFrostIn = 48; }
if (!model) { model = createDefaultModel(); regenerate(model, 'init'); } else regenerate(model, 'init'); // v2: re-lay auto piers with stable ids
let pending = new Set();
let pendingSource = null;
let saveT = 0;
let reportCtl = null; // price-check report controller (set when opened)
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => save(model), 150); };

const app = {
  getModel: () => model,
  defaults: DEFAULTS,
  toast,
  select(sel, silent) {
    model.selection = sel;
    if (sel && !silent) showTab('props', false);
    refresh({ props: true });
    persist();
  },
  preview(source) {
    regenerate(model, source).forEach((n) => pending.add(n));
    pendingSource = pendingSource || source;
    plan.render();
  },
  commit(source) {
    regenerate(model, source).forEach((n) => pending.add(n));
    const src = pendingSource || source;
    if (pending.size) showRegen(src, Array.from(pending));
    pending = new Set(); pendingSource = null;
    // drop selection if the object no longer exists
    if (model.selection && !findObject(model, model.selection)) model.selection = null;
    persist();
    refresh({ all: true });
    if (reportCtl && !$('#report').hidden) reportCtl.markStale();
    if (inspector) inspector.invalidate();
  },
  isInspecting: () => !!(inspector && inspector.isOn()),
  inspectHit: (hit, ev) => { if (inspector && inspector.isOn()) inspector.show(hit, ev); },
  onPierDrag(on) { $('#stage').classList.toggle('pierDragging', !!on); },
  revealPier(o) { requestAnimationFrame(() => { const pp = $('#pierPanel'); plan.ensureVisible(o.geometry.c, pp && !pp.hidden ? pp.offsetHeight + 8 : 0); }); },
  onTool(t) {
    $$('#planTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#pierOpts').hidden = t !== 'pier' || model.view !== 'plan';
    $('#stage').classList.toggle('pierTool', t === 'pier');
    if (t === 'pier') renderPierOpts();
    $('#polyDone').hidden = t !== 'poly';
    refreshStatus();
  },
};

// ---------- views
const plan = createPlan($('#plan'), app);
const v3 = createView3D($('#view3d'), app);
// ---------- $ price inspect (off until the user turns it on; never edits the model)
let inspector = null;
inspector = createInspector({ app, plan, v3, button: $('#inspectBtn') });
$('#inspectBtn').addEventListener('click', () => {
  if (!inspector.isOn()) return;
  if (v3.getAddMode()) setAdd3d(null);
  if (plan.getTool() !== 'select') plan.setTool('select');
  if (model.selection) app.select(null);
}, false);

function setView(v) {
  model.view = v;
  // Selection + active layer live in the model, so they persist across the toggle untouched.
  $$('#viewToggle button').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-selected', b.dataset.view === v); });
  $('#plan').hidden = v !== 'plan';
  $('#planTools').hidden = v !== 'plan';
  $('#pierOpts').hidden = v !== 'plan' || plan.getTool() !== 'pier';
  $('#view3d').hidden = v !== '3d';
  $('#tools3d').hidden = v !== '3d';
  $('#edit3d').hidden = v !== '3d';
  $('#stage').classList.toggle('is3d', v === '3d');
  if (v === '3d') { if (!v3.show()) toast('3D could not start (no WebGL)'); }
  else { plan.resize(); }
  refreshStatus();
  persist();
}
$$('#viewToggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

// ---------- toolbar
$$('#planTools [data-tool]').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  const needs = b.dataset.needs;
  if (needs) {
    const act = getLayer(model, model.activeLayerId);
    const kinds = needs.split(',');
    if (!kinds.includes(act.kind)) {
      // switch to the first suitable layer so the tool works right away
      const target = model.layers.find((l) => kinds.includes(l.kind) && !l.stub);
      if (target) { model.activeLayerId = target.id; toast(`Active layer → ${target.name}`); refresh({ all: true }); }
    }
  }
  plan.setTool(t);
}));
$('#polyDone').addEventListener('click', () => plan.finishPoly());
const snapSel = $('#snapSel');
PLAN.snapOptionsIn.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v === 16 ? '16 in o.c.' : `${v} in`; snapSel.appendChild(o); });
snapSel.value = model.snapIn;
snapSel.addEventListener('change', () => { model.snapIn = Number(snapSel.value); persist(); plan.render(); });

// ---------- 3D edit tools (Select / ◎ Pier / + Wall / + Door / + Window / X-ray / Delete)
function setAdd3d(mode) {
  if (mode === 'pier') {
    const f = getLayer(model, 'foundation');
    if (f.locked) { toast('Foundation is locked'); return; }
    model.activeLayerId = 'foundation'; if (!f.visible) f.visible = true; if (model.isolateLayerId && model.isolateLayerId !== 'foundation') model.isolateLayerId = null;
    toast('Tap the ground to drop a Sonotube (snaps to walls)');
  } else if (mode) {
    const w = getLayer(model, 'walls');
    if (w.locked) { toast('Walls layer is locked'); return; }
    model.activeLayerId = 'walls'; if (!w.visible) w.visible = true; if (model.isolateLayerId && model.isolateLayerId !== 'walls') model.isolateLayerId = null;
    toast(mode === 'wall' ? 'Drag along the floor to draw an interior wall' : `Tap a wall to add a ${mode}`);
  }
  v3.setAddMode(mode);
  syncEdit3d();
  if (mode) refresh({ all: true });
}
function syncEdit3d() {
  const am = v3.getAddMode();
  $('#sel3dBtn').setAttribute('aria-pressed', !am);
  $('#pier3dBtn').setAttribute('aria-pressed', am === 'pier');
  $$('#edit3d [data-add]').forEach((b) => b.setAttribute('aria-pressed', am === b.dataset.add));
  $('#xrayBtn').setAttribute('aria-pressed', !!model.xray);
  $('#del3dBtn').disabled = !deletable();
}
$('#sel3dBtn').addEventListener('click', () => setAdd3d(null));
$('#pier3dBtn').addEventListener('click', () => setAdd3d(v3.getAddMode() === 'pier' ? null : 'pier'));
$$('#edit3d [data-add]').forEach((b) => b.addEventListener('click', () => setAdd3d(v3.getAddMode() === b.dataset.add ? null : b.dataset.add)));
$('#xrayBtn').addEventListener('click', () => {
  model.xray = !model.xray; persist(); syncEdit3d(); v3.build();
  const al = getLayer(model, model.activeLayerId);
  toast(model.xray ? `X-ray on — layers above ${al.name} are see-through and ignore taps` : 'X-ray off');
});
/** the selected object if the user may delete it (walls/openings/manual or auto piers/lines/areas) */
function deletable() {
  const o = findObject(model, model.selection); if (!o) return null;
  const l = getLayer(model, model.selection.layerId);
  if (o.type === 'pier') return o;
  if (o.derivedFrom) return null;
  if (o.type === 'wall' && o.props.exterior) return null;
  return o && l ? o : null;
}
function deleteSelected() {
  const o = deletable(); if (!o) { toast('Select a pier, interior wall, door, window or drawn item to delete'); return; }
  const l = getLayer(model, model.selection.layerId);
  if (l.locked) { toast(`${l.name} is locked`); return; }
  if (o.type === 'pier') { deletePier(model, o); model.selection = null; app.commit('foundation'); toast('Pier deleted'); return; }
  l.objects = l.objects.filter((x) => x !== o && !(x.type === 'opening' && x.geometry.wallId === o.id));
  model.selection = null; app.commit(l.id); toast(`${cap(o.props.kind || o.type)} deleted`);
}
$('#del3dBtn').addEventListener('click', deleteSelected);
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && model.view === '3d' && deletable()) { e.preventDefault(); deleteSelected(); }
  if (e.key === 'Escape' && model.view === '3d' && v3.getAddMode()) setAdd3d(null);
});
$$('#tools3d [data-cam]').forEach((b) => b.addEventListener('click', () => v3.preset(b.dataset.cam)));
$('#explodeBtn').addEventListener('click', () => { model.exploded = !model.exploded; persist(); refresh({ all: true }); v3.preset('aerial'); });
$('#wallModeBtn').addEventListener('click', () => { model.wallMode = model.wallMode === 'studs' ? 'solid' : 'studs'; persist(); refresh({ all: true }); });
$('#sheathBtn').addEventListener('click', () => { const r = getLayer(model, 'roof'); r.params.showSheathing = !r.params.showSheathing; persist(); refresh({ all: true }); });

// ---------- top menu
$('#layersBtn').innerHTML = ICON.layers;
$('#menuBtn').innerHTML = ICON.more;
$('#layersBtn').addEventListener('click', () => { const open = $('#sheet').dataset.state === 'open' && !$('#layersPane').hidden; showTab('layers', !open); if (open) setSheet('peek'); });
$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; });
document.addEventListener('click', () => { $('#menu').hidden = true; });
$$('#menu [data-menu]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.menu === 'fit') plan.fit();
  if (b.dataset.menu === 'zip') zipModal.open({ zip: (model.site || {}).zip });
  if (b.dataset.menu === 'done') openReport();
  if (b.dataset.menu === 'reset' && confirm('Start over with the 32×24 sample? This clears the saved model on this device.')) { clear(); model = createDefaultModel(); regenerate(model, 'init'); save(model); refresh({ all: true }); setView('plan'); plan.fit(); }
}));

// ---------- "Price check" → pre-check → report (price + plan sheets + build steps).
// Nothing in the app is priced until the user runs it; the report is frozen to that run.
$('#doneBtn').addEventListener('click', () => openReport());
async function openReport() {
  const rep = $('#report');
  rep.hidden = false; document.body.classList.add('reportOpen');
  rep.innerHTML = '<div class="rp-loading">Loading price check…</div>';
  try {
    const { renderReport } = await import('./report.js');
    reportCtl = await renderReport(rep, { model, getModel: () => model, v3, onClose: closeReport, toast, commit: (s) => app.commit(s), persist });
  } catch (err) {
    console.error(err);
    rep.innerHTML = `<div class="rp-loading">Could not build the report: ${String(err && err.message || err)} <button class="btn" id="rpErrClose">Close</button></div>`;
    $('#rpErrClose').addEventListener('click', closeReport);
  }
}
function closeReport() { $('#report').hidden = true; document.body.classList.remove('reportOpen'); refresh({ all: true }); }

// ---------- sheet
function setSheet(state) {
  $('#sheet').dataset.state = state;
  // collapsed sheet on a phone: keep the active layer's row in view
  if (state === 'peek') { const pane = $('#layersPane'); const ar = pane.querySelector('.lrow.active'); if (ar) pane.scrollTop = ar.offsetTop - pane.offsetTop; }
}
$('#sheetHandle').addEventListener('click', () => setSheet($('#sheet').dataset.state === 'open' ? 'peek' : 'open'));
function showTab(tab, open = true) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#layersPane').hidden = tab !== 'layers';
  $('#propsPane').hidden = tab !== 'props';
  if (open) setSheet('open');
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- layer panel
function zRange(l) {
  if (l.stub) return 'coming later';
  return `${fmtFtIn(l.zBase)} → ${fmtFtIn(l.zTop)} from grade`;
}
function timeStr(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function locationLine() {
  const S = siteSummary(model, zipModal && zipModal.getJdoc());
  return `<div class="locLine" id="locLine"><span>📍 <b>${S.zip ? 'ZIP ' + S.zip : 'No ZIP'}</b>${S.known ? ' · ' + S.label : S.zip ? ' · no local data yet' : ' · frost + tax unknown'}</span><button class="btn" id="locChange" type="button">${S.zip ? 'Change' : 'Enter ZIP'}</button></div>`;
}
// Feature C: each layer's "Complete" box. Price check prices only Complete layers; editing a Complete
// layer after a price check keeps the check but marks that layer's price stale.
const PRICED_LAYERS = ['site', 'foundation', 'floor', 'walls', 'roof']; // same list as estimate.js
const PRICE_STATE = { priced: ['priced', 'Priced in the last price check'], stale: ['price stale', 'Edited since the last price check — re-run Price check'], unpriced: ['not priced yet', 'Marked complete — run Price check to price it'] };
function completeRow(l) {
  const st = layerPriceState(model, lastRun, l.id); const b = PRICE_STATE[st];
  const priced = PRICED_LAYERS.includes(l.id);
  return `<div class="lcomplete"><label title="Price check prices only layers marked Complete"><input type="checkbox" data-complete="${l.id}" ${l.complete ? 'checked' : ''} aria-label="${l.name} complete"> Complete</label>${l.complete && b && priced ? `<span class="lprice ${st}" data-pricestate="${st}" title="${b[1]}">${b[0]}</span>` : ''}${l.complete && !priced ? '<span class="lprice none">no price rule</span>' : ''}</div>`;
}
let lastRun = null;
function renderLayers() {
  lastRun = loadRun();
  const pane = $('#layersPane');
  const all = stackOrder(model);
  // top of the building first, like a layer stack; stub layers grouped at the end
  const rows = all.filter((l) => !l.stub).reverse().concat(all.filter((l) => l.stub));
  pane.innerHTML = `
    ${model.isolateLayerId ? '<div class="paneHead"><span>Isolating one layer</span><button class="btn" id="clearIso">Show all</button></div>' : ''}
    ${locationLine()}
    <div id="lrows"></div>
    <div class="paneHead"><label><input type="checkbox" id="autoGhost" ${model.autoGhost ? 'checked' : ''}> Ghost non-active layers (~30%)</label></div>
    <div class="legend">Icons per row: show/hide · lock · <b>ghost</b> (fade to ~30%) · <b>isolate</b> (show only this) · <b>active</b> (new drawing goes here). Tap a name to make it active.</div>
    <div class="card" id="addLayerCard">
      <h3>Add layer</h3>
      <div class="btnRow" id="presetRow"><button class="btn" data-p="Deck">Deck</button><button class="btn" data-p="Porch">Porch</button><button class="btn" data-p="Notes">Notes</button></div>
      <div class="field"><span>Name</span><input type="text" id="nlName" placeholder="e.g. Deck"></div>
      <div class="field"><span>Bottom (ft from grade)</span><input type="number" id="nlZ0" step="0.25" value="2"></div>
      <div class="field"><span>Top (ft from grade)</span><input type="number" id="nlZ1" step="0.25" value="3"></div>
      <div class="field"><span>Color</span><input type="color" id="nlColor" value="${LAYER_COLORS.custom}"></div>
      <div class="btnRow"><button class="btn primary" id="nlAdd">Add layer</button></div>
    </div>`;
  const host = $('#lrows', pane);
  const lc = $('#locChange', pane); if (lc) lc.addEventListener('click', () => zipModal.open({ zip: (model.site || {}).zip }));
  rows.forEach((l) => {
    const isAct = l.id === model.activeLayerId;
    const iso = model.isolateLayerId === l.id;
    const row = document.createElement('div');
    row.className = 'lrow' + (isAct ? ' active' : '') + (l.stub ? ' stub' : '');
    row.dataset.layer = l.id;
    if (l.stub && !host.querySelector('.groupHead')) host.insertAdjacentHTML('beforeend', '<div class="groupHead">Coming later</div>');
    const note = l.note ? `<div class="note">↻ ${l.note.text} · ${timeStr(l.note.at)}</div>` : '';
    row.innerHTML = `
      <button class="ib ${l.visible ? '' : 'off'}" data-act="vis" title="${l.visible ? 'Hide' : 'Show'} ${l.name}" aria-label="${l.visible ? 'Hide' : 'Show'} ${l.name}" aria-pressed="${l.visible}" ${l.stub ? 'disabled' : ''}>${l.visible ? ICON.eye : ICON.eyeOff}</button>
      <button class="ib ${l.locked ? 'on' : 'off'}" data-act="lock" title="${l.locked ? 'Unlock' : 'Lock'} ${l.name}" aria-label="${l.locked ? 'Unlock' : 'Lock'} ${l.name}" aria-pressed="${l.locked}" ${l.stub ? 'disabled' : ''}>${l.locked ? ICON.lock : ICON.unlock}</button>
      <div class="lmain"><button class="name" data-act="active" aria-label="Make ${l.name} active">
        <div class="t"><span class="dot" style="background:${l.color}"></span>${l.name}${l.stub ? ' <span class="muted">(stub)</span>' : ''}</div>
        <div class="z">${zRange(l)}</div>${note}${l.id === 'foundation' && !frostKnown(l.params) ? `<div class="frostFlag" id="frostFlag">Frost depth unknown. Piers drawn at ${l.params.placeholderFrostIn} in as a conservative placeholder. Enter your local value.</div>` : ''}
      </button>${l.stub ? '' : completeRow(l)}</div>
      <button class="ib ${l.ghost ? 'on' : 'off'}" data-act="ghost" title="Ghost ${l.name} (~30%)" aria-label="Ghost ${l.name}" aria-pressed="${l.ghost}" ${l.stub ? 'disabled' : ''}>${ICON.ghost}</button>
      <button class="ib ${iso ? 'on' : 'off'}" data-act="iso" title="Isolate ${l.name}" aria-label="Isolate ${l.name}" aria-pressed="${iso}" ${l.stub ? 'disabled' : ''}>${ICON.isolate}</button>
      <button class="ib" data-act="active" title="Active layer" aria-label="Active: ${l.name}" ${l.stub ? 'disabled' : ''}><span class="radio"></span></button>`;
    host.appendChild(row);
  });
  host.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-complete]'); if (!cb) return;
    const l = getLayer(model, cb.dataset.complete); if (!l) return;
    l.complete = cb.checked; persist(); renderLayers();
    if (reportCtl && !$('#report').hidden) reportCtl.markStale();
    toast(cb.checked ? `${l.name} marked complete — Price check will price it` : `${l.name} unmarked — Price check will skip it`);
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const l = getLayer(model, b.closest('.lrow').dataset.layer);
    if (l.stub) { toast(`${l.name} is a placeholder for a later version`); return; }
    const act = b.dataset.act;
    if (act === 'vis') l.visible = !l.visible;
    if (act === 'lock') l.locked = !l.locked;
    if (act === 'ghost') l.ghost = !l.ghost;
    if (act === 'iso') model.isolateLayerId = model.isolateLayerId === l.id ? null : l.id;
    if (act === 'active') { model.activeLayerId = l.id; if (!l.visible) l.visible = true; }
    persist(); refresh({ all: true });
  });
  if ($('#sheet').dataset.state === 'peek' && window.innerWidth < ASSUMPTIONS.phoneBreakpointPx) { const ar = host.querySelector('.lrow.active'); if (ar) pane.scrollTop = ar.offsetTop - pane.offsetTop; }
  $('#autoGhost').addEventListener('change', (e) => { model.autoGhost = e.target.checked; persist(); refresh({ all: true }); });
  const ci = $('#clearIso'); if (ci) ci.addEventListener('click', () => { model.isolateLayerId = null; persist(); refresh({ all: true }); });
  const P = { Deck: [1.5, 2.5, '#8d6e63'], Porch: [0.5, 1.5, '#607d8b'], Notes: [0, 12, '#2f8fb0'] };
  $$('#presetRow [data-p]').forEach((b) => b.addEventListener('click', () => { const p = P[b.dataset.p]; $('#nlName').value = b.dataset.p; $('#nlZ0').value = p[0]; $('#nlZ1').value = p[1]; $('#nlColor').value = p[2]; }));
  $('#nlAdd').addEventListener('click', () => {
    const name = $('#nlName').value.trim() || 'Custom layer';
    const z0 = Number($('#nlZ0').value) || 0, z1 = Math.max(z0, Number($('#nlZ1').value) || z0);
    const l = { id: uid('L'), order: 99, kind: 'custom', name, levelId: 'L1', zBase: z0, zTop: z1, visible: true, locked: false, ghost: false, opacity: PLAN.ghostOpacity, color: $('#nlColor').value, params: {}, objects: [], note: null };
    model.layers.push(l); model.activeLayerId = l.id;
    persist(); refresh({ all: true }); toast(`Added “${name}” — draw on it with Line`);
  });
}

// ---------- properties pane
const OPTS = {
  lumber: Object.keys(LUMBER), oc: [12, 16, 19.2, 24],
  ftype: [['slab', 'Slab on grade'], ['crawlspace', 'Crawlspace (perimeter footing)'], ['basement', 'Basement'], ['piers', 'Piers (under wall lines)']],
};
function field(label, html) { return `<div class="field"><span>${label}</span>${html}</div>`; }
function sel(key, value, options) { return `<select data-k="${key}">${options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${t}</option>`; }).join('')}</select>`; }
function num(key, value, step = 1, ph = '') { return `<input type="number" data-k="${key}" value="${value == null ? '' : value}" step="${step}" placeholder="${ph}">`; }
function chk(key, value) { return `<input type="checkbox" data-k="${key}" ${value ? 'checked' : ''}>`; }

function layerParamsHTML(l) {
  const p = l.params;
  switch (l.kind) {
    case 'site': return field('Grade', sel('grade.type', p.grade.type, [['flat', 'Flat'], ['slope', 'Sloped']]))
      + (p.grade.type === 'slope' ? field('Slope %', num('grade.slopePct', p.grade.slopePct, 0.5)) + field('Downhill toward', sel('grade.downhill', p.grade.downhill, ['N', 'S', 'E', 'W'])) : '')
      + field('Front setback (S), ft', num('setbacksFt.front', p.setbacksFt.front)) + field('Rear setback (N), ft', num('setbacksFt.rear', p.setbacksFt.rear)) + field('Side setbacks, ft', num('setbacksFt.side', p.setbacksFt.side))
      + '<div class="btnRow"><button class="btn" data-add="existing">+ Existing building</button></div><div class="muted">Use the Line tool on this layer for utilities (water, sewer, power, gas).</div>';
    case 'foundation': return field('Type', sel('type', p.type, OPTS.ftype))
      + field('Frost depth (in) — required', num('frostDepthIn', p.frostDepthIn, 1, 'enter local code'))
      + field(`Top above grade (in), ${p.type}`, num(`topAboveGradeIn.${p.type}`, p.topAboveGradeIn[p.type], 1))
      + (p.type === 'piers' ? pierSpacingHTML(l) : field('Footing width (in)', num('footingWidthIn', p.footingWidthIn)) + field('Footing depth (in)', num('footingDepthIn', p.footingDepthIn)) + manualPierNote(l));
    case 'floor': return field('Joist size', sel('joistSize', p.joistSize, OPTS.lumber.slice(2))) + field('Spacing (in o.c.)', sel('joistOcIn', p.joistOcIn, OPTS.oc))
      + field('Joist direction', sel('direction', p.direction, [['auto', 'Auto (short span)'], ['y', 'North–south'], ['x', 'East–west']]))
      + field('Show subfloor (3D)', chk('showSubfloor', p.showSubfloor))
      + `<div class="muted">Sill ${p.sill} · subfloor ${p.subfloor}${p.computed ? ` · span ${fmtFtIn(p.computed.spanFt)}` : ''}</div>`;
    case 'walls': return field('Exterior studs', sel('extSize', p.extSize, OPTS.lumber)) + field('Interior studs', sel('intSize', p.intSize, OPTS.lumber))
      + field('Plate height (ft)', num('plateHeightFt', p.plateHeightFt, 0.5)) + field('Stud spacing (in o.c.)', sel('studOcIn', p.studOcIn, OPTS.oc))
      + `<div class="muted">Plates: ${p.bottomPlates} bottom, ${p.topPlates} top. Drag a footprint corner or an exterior wall in Select to reshape (Walls must be active).</div>`;
    case 'roof': return field('Shape', sel('shape', p.shape, [['gable', 'Gable'], ['shed', 'Shed (later)'], ['hip', 'Hip (later)']])) + field('Pitch (in 12)', num('pitch', p.pitch, 0.5))
      + field('Overhang (in)', num('overhangIn', p.overhangIn)) + field('Rafter size', sel('rafterSize', p.rafterSize, OPTS.lumber)) + field('Rafter spacing (in o.c.)', sel('rafterOcIn', p.rafterOcIn, OPTS.oc))
      + field('Ridge along', sel('ridge', p.ridge, [['long', 'Long side'], ['short', 'Short side']])) + field('Sheathing (3D)', chk('showSheathing', p.showSheathing));
    case 'custom': return field('Name', `<input type="text" data-L="name" value="${l.name}">`) + field('Bottom (ft)', `<input type="number" data-L="zBase" value="${l.zBase}" step="0.25">`)
      + field('Top (ft)', `<input type="number" data-L="zTop" value="${l.zTop}" step="0.25">`) + field('Color', `<input type="color" data-L="color" value="${l.color}">`)
      + '<div class="btnRow"><button class="btn danger" data-del-layer>Delete layer</button></div>';
    default: return '<div class="muted">Placeholder layer — coming in a later version.</div>';
  }
}

// ---------- piers v2: spacing control (layer card), pier panel (floating), place-pier options
const ftIn = (inches) => { const tot = Math.round(Number(inches) * 4) / 4; return [Math.floor(tot / 12), +(tot - Math.floor(tot / 12) * 12).toFixed(2)]; };
const chips = (attr, value) => `<div class="chips">${PIERS.diametersIn.map((d) => `<button type="button" ${attr}="${d}" class="${Number(value) === d ? 'on' : ''}" aria-pressed="${Number(value) === d}">${d}"</button>`).join('')}</div>`;
function pierCounts() {
  const ps = allPiers(model);
  return { auto: ps.filter((o) => !isManual(o)).length, manual: ps.filter(isManual).length, flagged: ps.filter((o) => o.props.flags && o.props.flags.length).length, removed: (getLayer(model, 'foundation').params.deletedAutoSlots || []).length, converted: ps.filter((o) => isManual(o) && o.props.autoSlot).length };
}
function pierLegend() {
  const c = pierCounts();
  return `<div class="pierLegend"><span><i class="lg auto"></i>${c.auto} auto</span><span><i class="lg man"></i>${c.manual} manual</span>${c.flagged ? `<span class="bad"><i class="lg flag"></i>${c.flagged} flagged</span>` : ''}</div>`;
}
function pierSpacingHTML(l) {
  const p = l.params; const [ft, inch] = ftIn(p.pierSpacingIn);
  const c = pierCounts();
  return `<div class="pierSpacing" id="pierSpacing">
    <div class="field"><span>Pier spacing</span><div class="seg2" role="group" aria-label="Spacing mode">
      <button type="button" data-spmode="max" class="${p.pierSpacingMode !== 'exact' ? 'on' : ''}">Max</button><button type="button" data-spmode="exact" class="${p.pierSpacingMode === 'exact' ? 'on' : ''}">Exact o.c.</button></div></div>
    <div class="field"><span>${p.pierSpacingMode === 'exact' ? 'Every' : 'No more than'}</span><div class="ftin">
      <input type="number" inputmode="numeric" id="spFt" min="1" max="20" step="1" value="${ft}" aria-label="Spacing feet"><b>ft</b>
      <input type="number" inputmode="decimal" id="spIn" min="0" max="11.75" step="0.5" value="${inch}" aria-label="Spacing inches"><b>in</b></div></div>
    <div class="muted">${p.pierSpacingMode === 'exact' ? 'A tube every ' + fmtFtIn(p.pierSpacingIn / 12) + ' on center from each corner along exterior + bearing walls; the last gap is what is left.' : 'Equal gaps along each exterior + bearing wall, none longer than ' + fmtFtIn(p.pierSpacingIn / 12) + '. Corners always get a tube.'} Changing this re-lays the auto piers; manual ones stay.</div>
    <div class="field"><span>Auto tube Ø</span>${chips('data-autodia', p.pierDiaIn)}</div>
    ${pierLegend()}
    <div class="btnRow"><button type="button" class="btn" id="pierToolBtn">◎ Place pier</button>${c.converted || c.removed ? `<button type="button" class="btn" id="restoreAuto">Restore auto layout (${c.converted + c.removed})</button>` : ''}</div>
  </div>`;
}
function manualPierNote() {
  const c = pierCounts();
  return `<div class="muted" style="margin-top:6px">Auto Sonotubes along the walls come with Type → Piers. You can still drop piers anywhere (e.g. under a mid beam) with ◎ Pier.</div>${c.manual ? pierLegend() : ''}`;
}
function bindPierSpacing(lc, al) {
  const box = lc.querySelector('#pierSpacing'); if (!box) return;
  const guard = () => { if (al.locked) { toast(`${al.name} is locked`); renderProps(); return false; } return true; };
  box.querySelectorAll('[data-spmode]').forEach((b) => b.addEventListener('click', () => { if (!guard()) return; al.params.pierSpacingMode = b.dataset.spmode; app.commit('foundation'); toast(`Auto piers re-laid: ${b.dataset.spmode === 'exact' ? 'exact' : 'max'} ${fmtFtIn(al.params.pierSpacingIn / 12)}`); }));
  const setSp = () => {
    if (!guard()) return;
    const ft = Number($('#spFt', box).value) || 0, inch = Number($('#spIn', box).value) || 0;
    const tot = Math.max(12, Math.min(240, ft * 12 + inch));
    al.params.pierSpacingIn = tot; app.commit('foundation');
    toast(`Auto piers re-laid at ${al.params.pierSpacingMode === 'exact' ? 'exactly' : 'max'} ${fmtFtIn(tot / 12)}`);
  };
  ['#spFt', '#spIn'].forEach((sel) => $(sel, box).addEventListener('change', setSp));
  box.querySelectorAll('[data-autodia]').forEach((b) => b.addEventListener('click', () => { if (!guard()) return; al.params.pierDiaIn = Number(b.dataset.autodia); app.commit('foundation'); }));
  const pt = $('#pierToolBtn', box); if (pt) pt.addEventListener('click', () => { if (model.view !== 'plan') setView('plan'); plan.setTool('pier'); setSheet('peek'); });
  const ra = $('#restoreAuto', box); if (ra) ra.addEventListener('click', () => { if (!guard()) return; const n = restoreAutoLayout(model); app.commit('foundation'); toast(`Restored ${n} auto pier slot(s); piers you placed by hand stay`); });
}

function renderPierOpts() {
  const f = getLayer(model, 'foundation').params; const d = pierDefaults(model);
  $('#pierOpts').innerHTML = `<span class="lbl">Ø</span>${chips('data-placedia', f.placeDiaIn || 12)}
    <label>Top <input type="number" inputmode="decimal" id="poTop" value="${f.placeTopIn ?? ''}" placeholder="${d.topIn}">"</label>
    <label>Depth <input type="number" inputmode="decimal" id="poDepth" value="${f.placeDepthIn ?? ''}" placeholder="${d.depthIn}">"</label>
    <span class="hint">Tap the plan to drop · tap a tube to edit</span>`;
  $$('#pierOpts [data-placedia]').forEach((b) => b.addEventListener('click', () => { f.placeDiaIn = Number(b.dataset.placedia); persist(); renderPierOpts(); plan.render(); }));
  $('#poTop').addEventListener('change', (e) => { f.placeTopIn = e.target.value === '' ? null : Number(e.target.value); persist(); });
  $('#poDepth').addEventListener('change', (e) => { f.placeDepthIn = e.target.value === '' ? null : Number(e.target.value); persist(); });
}

function selectedPier() {
  const o = findObject(model, model.selection);
  return o && o.type === 'pier' && model.selection.layerId === 'foundation' ? o : null;
}
function renderPierPanel() {
  const pp = $('#pierPanel');
  const o = selectedPier();
  pp.hidden = !o;
  $('#stage').classList.toggle('pierOpen', !!o);
  if (!o) return;
  const l = getLayer(model, 'foundation');
  const man = isManual(o);
  const org = originOf(model); const d = pierDefaults(model);
  const [xf, xi] = ftIn((o.geometry.c[0] - org[0]) * 12), [yf, yi] = ftIn((o.geometry.c[1] - org[1]) * 12);
  const dis = l.locked ? 'disabled' : '';
  const topNow = o.props.topIn ?? null, depNow = o.props.depthIn ?? null;
  pp.innerHTML = `
    <div class="pp-head"><b>Sonotube</b>${man ? '<span class="tag man">◆ Manual</span>' : '<span class="tag auto">Auto</span>'}
      <span class="pp-sub">${fmtFtIn((o.height || 0))} tall · ${fmtFtIn(-(o.z || 0))} below grade</span>
      <button type="button" class="pp-x" data-pp="close" aria-label="Close">×</button></div>
    ${l.locked ? '<div class="flag">Foundation is locked — unlock it to edit.</div>' : ''}
    ${(o.props.flags || []).map((f) => `<div class="flag warn">FLAGGED: ${f}</div>`).join('')}
    <div class="pp-row"><span class="k">Ø</span>${chips('data-dia', o.props.diaIn).replace(/<button/g, `<button ${dis}`)}<span class="u">in</span></div>
    <div class="pp-row xy"><span class="k">X</span><input ${dis} type="number" inputmode="decimal" data-xy="x" data-part="ft" value="${xf}" aria-label="X feet"><b>'</b><input ${dis} type="number" inputmode="decimal" data-xy="x" data-part="in" value="${xi}" aria-label="X inches"><b>"</b>
      <span class="k">Y</span><input ${dis} type="number" inputmode="decimal" data-xy="y" data-part="ft" value="${yf}" aria-label="Y feet"><b>'</b><input ${dis} type="number" inputmode="decimal" data-xy="y" data-part="in" value="${yi}" aria-label="Y inches"><b>"</b></div>
    <div class="pp-row"><span class="k">Top</span><input ${dis} type="number" inputmode="decimal" data-pk="topIn" value="${topNow ?? ''}" placeholder="${d.topIn}" aria-label="Top above grade (in)"><span class="u">in above grade</span>
      <span class="k">Depth</span><input ${dis} type="number" inputmode="decimal" data-pk="depthIn" value="${depNow ?? ''}" placeholder="${d.depthIn}" aria-label="Depth below grade (in)"><span class="u">in</span></div>
    <div class="pp-btns">
      <button type="button" class="btn" data-pp="dup" ${dis}>Duplicate</button>
      ${man && o.props.autoSlot ? `<button type="button" class="btn" data-pp="reset" ${dis}>Reset to auto</button>` : ''}
      <button type="button" class="btn danger" data-pp="del" ${dis}>Delete</button>
    </div>
    <div class="muted pp-note">X/Y = center from the W / N outside face. Blank top/depth follow the layer${d.frostEntered ? '' : ' (depth = placeholder until you enter frost depth)'}.${man ? '' : ' Editing an auto pier makes it manual so regeneration keeps it.'}</div>`;
  const guard = () => { if (l.locked) { toast('Foundation is locked'); return false; } return true; };
  pp.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => { if (!guard()) return; ensureManual(model, o); o.props.diaIn = Number(b.dataset.dia); app.commit('foundation'); }));
  // X/Y: apply when focus leaves the X/Y row (or on Enter), so hopping ft → in doesn't re-render mid-entry
  const xyRow = pp.querySelector('.pp-row.xy');
  const applyXY = () => {
    if (!guard()) return;
    const v = (ax) => { const f = Number(pp.querySelector(`[data-xy="${ax}"][data-part="ft"]`).value) || 0, i = Number(pp.querySelector(`[data-xy="${ax}"][data-part="in"]`).value) || 0; return f + i / 12; };
    const c = [org[0] + v('x'), org[1] + v('y')];
    if (Math.hypot(c[0] - o.geometry.c[0], c[1] - o.geometry.c[1]) < 1e-6) return;
    movePier(model, o, c); app.commit('foundation');
  };
  xyRow.addEventListener('focusout', (e) => { if (!xyRow.contains(e.relatedTarget)) applyXY(); });
  xyRow.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyXY(); } });
  pp.querySelectorAll('[data-pk]').forEach((inp) => inp.addEventListener('change', () => { if (!guard()) return; ensureManual(model, o); o.props[inp.dataset.pk] = inp.value === '' ? null : Number(inp.value); app.commit('foundation'); }));
  pp.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.pp;
    if (a === 'close') { app.select(null, true); return; }
    if (!guard()) return;
    if (a === 'dup') { const c = duplicatePier(model, o); model.selection = { layerId: 'foundation', objectId: c.id }; app.commit('foundation'); toast(`Duplicated ${PIERS.duplicateOffsetFt} ft over — drag it into place`); }
    if (a === 'del') { deletePier(model, o); app.commit('foundation'); toast(man && !o.props.autoSlot ? 'Pier deleted' : 'Pier deleted — its auto slot stays empty (Restore auto layout brings it back)'); }
    if (a === 'reset') {
      const slot = o.props.autoSlot; resetToAuto(model, o); app.commit('foundation');
      const back = allPiers(model).find((p) => !isManual(p) && pierSlotKey(p.geometry.c) === slot);
      if (back) app.select({ layerId: 'foundation', objectId: back.id }, true);
      toast(back ? 'Back to auto — it will follow the spacing again' : 'Removed — that auto slot no longer exists at the current spacing');
    }
  }));
}

function objHTML(o, l) {
  if (o.type === 'pier') return `<h3>Sonotube <span class="muted">on ${l.name}</span></h3><div class="sub">Ø${o.props.diaIn} in · ${isManual(o) ? 'manual' : 'auto'} · ${fmtFtIn(o.height || 0)} tall</div><div class="muted">Edit it in the pier panel over the plan (diameter, X/Y, top/depth, duplicate, delete${isManual(o) && o.props.autoSlot ? ', reset to auto' : ''}).</div>`
    + (o.props.flags || []).map((f) => `<div class="flag warn">FLAGGED: ${f}</div>`).join('');
  const head = `<h3>${o.props.kind ? cap(o.props.kind) : cap(o.type)} <span class="muted">on ${l.name}</span></h3>`;
  const lockNote = l.locked ? '<div class="flag">Layer is locked — unlock it to edit.</div>' : '';
  if (o.type === 'opening') return head + lockNote + field('Kind', sel('kind', o.props.kind, ['door', 'window'])) + field('Width (in)', num('widthIn', o.props.widthIn)) + field('Height (in)', num('heightIn', o.props.heightIn))
    + field('Sill height (in)', num('sillIn', o.props.sillIn)) + (o.props.kind === 'door' ? field('Swing', sel('swing', o.props.swing || 'in', ['in', 'out'])) : '')
    + `<div class="flag">Header: <b>${o.props.header || headerFor(o.props.widthIn)}</b> — EXAMPLE from a simple table. Verify with your building department.</div>`
    + '<div class="btnRow"><button class="btn danger" data-del>Delete</button></div>';
  if (o.type === 'wall') return head + lockNote + `<div class="sub">${o.props.size} @ ${o.props.studOcIn || 16} in o.c. · ${fmtFtIn(dist(o.geometry.a, o.geometry.b))} long · ${o.props.exterior ? 'exterior (from footprint)' : 'interior'}</div>`
    + (o.props.exterior ? '<div class="muted">Drag this wall to move it — in Plan (Select tool, Walls active) or in 3D (drag it or its ✥ handle; corners have ◉ handles). Foundation, floor and roof follow.</div>' : field('Bearing wall (gets footing / piers)', chk('bearing', o.props.bearing)) + '<div class="btnRow"><button class="btn danger" data-del>Delete</button></div>');
  if (o.type === 'line' || (o.type === 'area' && !o.derivedFrom)) return head + lockNote + field('Label', `<input type="text" data-k="label" value="${o.props.label || ''}">`) + (o.type === 'area' && l.kind === 'site' ? field('Height (ft)', num('heightFt', o.props.heightFt || 10)) : '') + '<div class="btnRow"><button class="btn danger" data-del>Delete</button></div>';
  const elev = o.z != null ? ` · bottom ${fmtFtIn(o.z)}${o.height ? `, ${fmtFtIn(o.height)} tall` : ''}` : '';
  return head + `<div class="sub">${o.props.label || o.type}${elev}</div><div class="muted">Generated ${o.derivedFrom && o.derivedFrom.startsWith('w-') ? 'from wall ' + o.derivedFrom : 'from ' + (o.derivedFrom || 'defaults')}. Change it with this layer's settings below.</div>`
    + (o.props.flag ? '<div class="flag warn">FLAGGED: not sized. Have an engineer size this member and its supports.</div>' : '');
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function renderProps() {
  const pane = $('#propsPane');
  const o = findObject(model, model.selection);
  const ol = o ? getLayer(model, model.selection.layerId) : null;
  const al = getLayer(model, model.activeLayerId);
  const flags = (al.flags || []).map((f) => `<div class="flag ${/FLAGGED|crosses/.test(f) ? 'warn' : ''}">${f}</div>`).join('');
  pane.innerHTML = `
    <div class="card" id="selCard">${o ? objHTML(o, ol) : '<h3>Nothing selected</h3><div class="muted">Tap a wall, opening, pier or member in Plan or 3D.</div>'}</div>
    ${o && ol && ol.id !== al.id && (o.derivedFrom || o.type === 'pier') && !ol.stub && ol.kind !== 'custom' ? `<div class="card" id="objLayerCard"><h3>${ol.name} settings <span class="muted">for the selected ${o.type}</span></h3>${layerParamsHTML(ol)}</div>` : ''}
    <div class="card" id="layerCard"><h3>${al.name} <span class="muted">active layer</span></h3>
      ${al.note ? `<div class="flag">↻ ${al.note.text} · ${timeStr(al.note.at)}</div>` : ''}
      ${layerParamsHTML(al)}${flags}
      <div class="muted" style="margin-top:6px">Defaults are typical US residential practice, not engineering. Check structure with a local engineer / building department.</div>
    </div>`;
  // object edits
  const sc = $('#selCard', pane);
  if (o) {
    sc.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
      if (ol.locked) { toast(`${ol.name} is locked`); renderProps(); return; }
      const k = inp.dataset.k; o.props[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) : inp.value;
      if (k === 'kind') Object.assign(o.props, DEFAULTS.openings[o.props.kind]);
      app.commit(ol.id === 'walls' ? 'walls' : ol.id);
    }));
    const del = sc.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => {
      if (ol.locked) { toast(`${ol.name} is locked`); return; }
      ol.objects = ol.objects.filter((x) => x !== o && !(x.type === 'opening' && x.geometry.wallId === o.id));
      model.selection = null; app.commit(ol.id);
    });
  }
  bindLayerCard($('#layerCard', pane), al);
  const olc = $('#objLayerCard', pane);
  if (olc) bindLayerCard(olc, ol);
}

/** Wire a layer-settings card (used for the active layer, and for the layer of a selected generated member). */
function bindLayerCard(lc, al) {
  lc.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    if (al.locked) { toast(`${al.name} is locked`); renderProps(); return; }
    const path = inp.dataset.k.split('.');
    let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
    if (/^(joistOcIn|studOcIn|rafterOcIn)$/.test(path[0])) v = Number(v);
    let t = al.params; for (let i = 0; i < path.length - 1; i++) t = t[path[i]]; t[path[path.length - 1]] = v;
    app.commit(al.id);
  }));
  lc.querySelectorAll('[data-L]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.L; al[k] = inp.type === 'number' ? Number(inp.value) : inp.value; persist(); refresh({ all: true });
  }));
  bindPierSpacing(lc, al);
  const dl = lc.querySelector('[data-del-layer]');
  if (dl) dl.addEventListener('click', () => { model.layers = model.layers.filter((x) => x !== al); model.activeLayerId = 'walls'; if (model.isolateLayerId === al.id) model.isolateLayerId = null; persist(); refresh({ all: true }); });
  const ex = lc.querySelector('[data-add="existing"]');
  if (ex) ex.addEventListener('click', () => {
    const lot = al.params.lot; const x = lot.minX + 3, y = lot.minY + 3;
    const ob = { id: uid('ex'), type: 'area', geometry: { pts: [[x, y], [x + 14, y], [x + 14, y + 10], [x, y + 10]] }, props: { role: 'existing', label: 'Existing shed', heightFt: 9 } };
    al.objects.push(ob); model.selection = { layerId: al.id, objectId: ob.id }; app.commit('site');
  });
}

// ---------- status, toasts, regen note
function refreshStatus() {
  const al = getLayer(model, model.activeLayerId);
  const o = findObject(model, model.selection);
  const tool = model.view === 'plan' ? ` · tool: ${plan.getTool()}` : '';
  $('#status').innerHTML = `Active: <b id="stActive">${al.name}</b> · Selected: <b id="stSel">${o ? (o.props.label || o.props.kind || o.type) + ' (' + o.id + ')' : 'none'}</b>${tool}`;
  $('#explodeBtn').setAttribute('aria-pressed', model.exploded);
  $('#wallModeBtn').textContent = model.wallMode === 'studs' ? 'Walls: studs' : 'Walls: solid';
  $('#sheathBtn').setAttribute('aria-pressed', !!getLayer(model, 'roof').params.showSheathing);
  $$('#planTools [data-needs]').forEach((b) => b.classList.toggle('dim', !b.dataset.needs.split(',').includes(al.kind)));
  syncEdit3d();
}
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
let regenT = 0;
function showRegen(source, layers) {
  const b = $('#regenBanner');
  b.textContent = `↻ Updated from ${source}: ${layers.join(', ')}`;
  b.hidden = false; clearTimeout(regenT); regenT = setTimeout(() => { b.hidden = true; }, 7000);
}

function refresh() {
  renderLayers(); renderProps(); renderPierPanel(); refreshStatus();
  if (plan.getTool() === 'pier' && !$('#pierOpts').hidden) renderPierOpts();
  plan.render();
  if (model.view === '3d' || v3.isReady()) v3.build();
}

window.addEventListener('resize', () => { plan.resize(); v3.resize(); });
window.__layout = { app, inspector, zipModal: null, getModel: () => model, setView, plan, v3, openReport, closeReport, deleteSelected, regenerate: (s) => app.commit(s), assumptions: ASSUMPTIONS };

// ---------- boot
refresh();
setView(model.view || 'plan');
requestAnimationFrame(() => { plan.resize(); plan.fit(); if (fresh) toast('Sample 32×24 footprint loaded — drag ▭ Footprint to draw your own'); });
// ---------- v4 startup ZIP pop-up (content-v4/zip-popup-spec.md)
var zipModal = createZipModal({ getModel: () => model, commit: (s) => app.commit(s), persist, toast });
window.__layout.zipModal = zipModal;
zipModal.maybeShowOnStart().then((r) => { window.__layout.zipStart = r || 'none'; renderLayers(); });
