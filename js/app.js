// App shell: state, layer panel, properties, Plan/3D toggle, regeneration notes.
import { ASSUMPTIONS, DEFAULTS, PLAN, LUMBER, LAYER_COLORS } from './config.js';
import { createDefaultModel, load, save, clear, getLayer, findObject, stackOrder, uid } from './model.js';
import { regenerate, headerFor } from './generate.js';
import { createPlan } from './plan.js';
import { createView3D } from './view3d.js';
import { fmtFtIn, dist } from './geom.js';

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
if (!model) { model = createDefaultModel(); regenerate(model, 'init'); }
let pending = new Set();
let pendingSource = null;
let saveT = 0;
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
  },
  onTool(t) {
    $$('#planTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#polyDone').hidden = t !== 'poly';
    refreshStatus();
  },
};

// ---------- views
const plan = createPlan($('#plan'), app);
const v3 = createView3D($('#view3d'), app);

function setView(v) {
  model.view = v;
  // Selection + active layer live in the model, so they persist across the toggle untouched.
  $$('#viewToggle button').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-selected', b.dataset.view === v); });
  $('#plan').hidden = v !== 'plan';
  $('#planTools').hidden = v !== 'plan';
  $('#view3d').hidden = v !== '3d';
  $('#tools3d').hidden = v !== '3d';
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
  if (b.dataset.menu === 'reset' && confirm('Start over with the 32×24 sample? This clears the saved model on this device.')) { clear(); model = createDefaultModel(); regenerate(model, 'init'); save(model); refresh({ all: true }); setView('plan'); plan.fit(); }
}));

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

function renderLayers() {
  const pane = $('#layersPane');
  const all = stackOrder(model);
  // top of the building first, like a layer stack; stub layers grouped at the end
  const rows = all.filter((l) => !l.stub).reverse().concat(all.filter((l) => l.stub));
  pane.innerHTML = `
    ${model.isolateLayerId ? '<div class="paneHead"><span>Isolating one layer</span><button class="btn" id="clearIso">Show all</button></div>' : ''}
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
      <button class="name" data-act="active" aria-label="Make ${l.name} active">
        <div class="t"><span class="dot" style="background:${l.color}"></span>${l.name}${l.stub ? ' <span class="muted">(stub)</span>' : ''}</div>
        <div class="z">${zRange(l)}</div>${note}
      </button>
      <button class="ib ${l.ghost ? 'on' : 'off'}" data-act="ghost" title="Ghost ${l.name} (~30%)" aria-label="Ghost ${l.name}" aria-pressed="${l.ghost}" ${l.stub ? 'disabled' : ''}>${ICON.ghost}</button>
      <button class="ib ${iso ? 'on' : 'off'}" data-act="iso" title="Isolate ${l.name}" aria-label="Isolate ${l.name}" aria-pressed="${iso}" ${l.stub ? 'disabled' : ''}>${ICON.isolate}</button>
      <button class="ib" data-act="active" title="Active layer" aria-label="Active: ${l.name}" ${l.stub ? 'disabled' : ''}><span class="radio"></span></button>`;
    host.appendChild(row);
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
      + (p.type === 'piers' ? field('Max pier spacing (ft)', num('pierMaxSpacingFt', p.pierMaxSpacingFt, 0.5)) + field('Pier diameter (in)', num('pierDiaIn', p.pierDiaIn, 1)) : field('Footing width (in)', num('footingWidthIn', p.footingWidthIn)) + field('Footing depth (in)', num('footingDepthIn', p.footingDepthIn)));
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

function objHTML(o, l) {
  const head = `<h3>${o.props.kind ? cap(o.props.kind) : cap(o.type)} <span class="muted">on ${l.name}</span></h3>`;
  const lockNote = l.locked ? '<div class="flag">Layer is locked — unlock it to edit.</div>' : '';
  if (o.type === 'opening') return head + lockNote + field('Kind', sel('kind', o.props.kind, ['door', 'window'])) + field('Width (in)', num('widthIn', o.props.widthIn)) + field('Height (in)', num('heightIn', o.props.heightIn))
    + field('Sill height (in)', num('sillIn', o.props.sillIn)) + (o.props.kind === 'door' ? field('Swing', sel('swing', o.props.swing || 'in', ['in', 'out'])) : '')
    + `<div class="flag">Header: <b>${o.props.header || headerFor(o.props.widthIn)}</b> — EXAMPLE from a simple table. Verify with your building department.</div>`
    + '<div class="btnRow"><button class="btn danger" data-del>Delete</button></div>';
  if (o.type === 'wall') return head + lockNote + `<div class="sub">${o.props.size} @ ${o.props.studOcIn || 16} in o.c. · ${fmtFtIn(dist(o.geometry.a, o.geometry.b))} long · ${o.props.exterior ? 'exterior (from footprint)' : 'interior'}</div>`
    + (o.props.exterior ? '<div class="muted">Drag this wall (Select tool, Walls active) to move it. Foundation, floor and roof follow.</div>' : field('Bearing wall (gets footing / piers)', chk('bearing', o.props.bearing)) + '<div class="btnRow"><button class="btn danger" data-del>Delete</button></div>');
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
  // layer params
  const lc = $('#layerCard', pane);
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
  renderLayers(); renderProps(); refreshStatus();
  plan.render();
  if (model.view === '3d' || v3.isReady()) v3.build();
}

window.addEventListener('resize', () => { plan.resize(); v3.resize(); });
window.__layout = { app, getModel: () => model, setView, plan, v3, regenerate: (s) => app.commit(s), assumptions: ASSUMPTIONS };

// ---------- boot
refresh();
setView(model.view || 'plan');
requestAnimationFrame(() => { plan.resize(); plan.fit(); if (fresh) toast('Sample 32×24 footprint loaded — drag ▭ Footprint to draw your own'); });
