// v5 "Size of your build" pop-up: shown right after the ZIP pop-up on a first run or a new plan, and
// (width/depth only) from the Resize button. Generates a fresh plan at exactly the entered size.
import { createDefaultModel, getLayer, uid } from './model.js';
import { regenerate } from './generate.js';
import { wallIdForSide } from './roof-calc.js';
import { clampOpenings } from './wizard-core.js';
import { DEFAULTS } from './config.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const PRESETS = [[12, 12], [16, 20], [20, 16], [24, 24]];
// "Which side of the house does it go on?" → which wall of the addition touches the house (plan: north is up, front/street is south)
export const HOUSE_SIDES = { back: { label: 'Back of the house', wall: 'S', note: 'the house is drawn south of the addition' }, front: { label: 'Front of the house', wall: 'N', note: 'the house is drawn north of the addition' }, left: { label: 'Left side (as seen from the street)', wall: 'E', note: 'the house is drawn east of the addition' }, right: { label: 'Right side (as seen from the street)', wall: 'W', note: 'the house is drawn west of the addition' } };
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function ftIn(ft, inch) { const f = Number(ft) || 0, i = Number(inch) || 0; return Math.round((f + i / 12) * 1000) / 1000; }

/** Put the existing house outline on the site plan, touching the addition's `side` wall. */
export function attachHouse(m, side) {
  m.attachToExistingWallId = wallIdForSide(m.footprint, side);
  const site = getLayer(m, 'site'); site.objects = site.objects.filter((o) => !(o.props && o.props.role === 'existing' && o.props.label === 'House'));
  const fb = m.footprint.reduce((b, [x, y]) => ({ minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) }), { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 });
  const D = 24; const R = { N: [fb.minX - 4, fb.minY - D, fb.maxX + 4, fb.minY], S: [fb.minX - 4, fb.maxY, fb.maxX + 4, fb.maxY + D], W: [fb.minX - D, fb.minY - 4, fb.minX, fb.maxY + 4], E: [fb.maxX, fb.minY - 4, fb.maxX + D, fb.maxY + 4] }[side];
  site.objects.push({ id: uid('ex'), type: 'area', geometry: { pts: [[R[0], R[1]], [R[2], R[1]], [R[2], R[3]], [R[0], R[3]]] }, props: { role: 'existing', label: 'House', heightFt: 12, existingRoof: { assumed: { pitch: true, eaveUndersideFt: true } } } });
}

/** Copy the location (ZIP, tax, frost depth, soil) from the previous plan. */
export function carryLocation(m, prev) {
  if (!prev) return m;
  if (prev.site) m.site = JSON.parse(JSON.stringify(prev.site));
  if (prev.estimate) m.estimate = JSON.parse(JSON.stringify(prev.estimate));
  const F = getLayer(m, 'foundation'); const pf = (prev.layers.find((l) => l.id === 'foundation') || {}).params || {};
  ['frostDepthIn', 'placeholderFrostIn', 'soilType'].forEach((k) => { if (pf[k] !== undefined) F.params[k] = pf[k]; });
  return m;
}

/** Fresh plan at exactly w × d (ft). opts: { attached, houseSide: back|front|left|right, wallFt, roof: gable|shed, pitch }.
 *  Keeps the location (ZIP, frost depth, tax) from `prev`. */
export function generatePlan(prev, o) {
  const w = Number(o.width), d = Number(o.depth);
  const m = createDefaultModel();
  m.footprint = [[0, 0], [w, 0], [w, d], [0, d]];
  const W = getLayer(m, 'walls'); W.objects = W.objects.filter((x) => x.type !== 'opening'); W.params.plateHeightFt = Number(o.wallFt) || 8;
  const F = getLayer(m, 'foundation'); F.params.type = 'piersOnly';
  carryLocation(m, prev);
  const houseWall = o.attached ? (HOUSE_SIDES[o.houseSide] || HOUSE_SIDES.back).wall : null;
  const doorSide = houseWall ? OPP[houseWall] : 'S';
  const winSide = houseWall ? (houseWall === 'N' || houseWall === 'S' ? 'E' : 'S') : 'N';
  const add = (kind, side) => { const id = wallIdForSide(m.footprint, side); const i = Number(id.split('-')[2]); const a = m.footprint[i], b = m.footprint[(i + 1) % 4]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 5) return; W.objects.push({ id: uid('op'), type: 'opening', geometry: { wallId: id, t: Math.round(L / 2 * 100) / 100 }, props: Object.assign({ kind }, DEFAULTS.openings[kind]) }); };
  add('door', doorSide); add('window', winSide);
  const R = getLayer(m, 'roof').params; R.shape = o.roof === 'shed' ? 'shed' : 'gable'; R.pitch = Number(o.pitch) || (R.shape === 'shed' ? 2 : 4);
  if (houseWall) attachHouse(m, houseWall);
  if (R.shape === 'shed') { const hi = houseWall || 'N'; const run = hi === 'N' || hi === 'S' ? d : w; R.shed = { highWallId: wallIdForSide(m.footprint, hi), lowPlateFt: W.params.plateHeightFt, highPlateFt: Math.round((W.params.plateHeightFt + R.pitch * run / 12) * 1e4) / 1e4 }; }
  if (R.shape === 'shed' && R.pitch < 2) R.roofing = Object.assign({}, R.roofing, { covering: 'metal_standing_seam' });
  m.view = 'plan';
  regenerate(m, 'init');
  return m;
}

/** Resize the current rectangle to w × d (NW corner kept); openings clamp to the new walls. */
export function resizeFootprint(m, w, d) {
  const xs = m.footprint.map((p) => p[0]), ys = m.footprint.map((p) => p[1]); const x = Math.min(...xs), y = Math.min(...ys);
  m.footprint = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]; clampOpenings(m);
}

export function createSizeModal({ getModel, onCreate, onResize }) {
  let root = null; let resolveFn = null;
  function ensure() {
    if (root) return root;
    root = document.createElement('div'); root.id = 'sizeModal'; root.className = 'zipModal sizeModal'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'szTitle');
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close('skip'); } });
    document.body.appendChild(root); return root;
  }
  const dimRow = (k, label, v) => { const f = Math.floor(v + 1e-9), i = Math.round((v - f) * 12); return `<div class="sz-dim"><span class="sz-dl">${label}</span><input type="number" id="sz${k}Ft" min="4" max="60" step="1" value="${f}" aria-label="${label} feet" inputmode="numeric"> ft <input type="number" id="sz${k}In" min="0" max="11" step="1" value="${i}" aria-label="${label} inches" inputmode="numeric"> in</div>`; };
  function read() {
    const q = (s) => root.querySelector(s);
    const w = ftIn(q('#szWFt').value, q('#szWIn').value), d = ftIn(q('#szDFt').value, q('#szDIn').value);
    return { width: w, depth: d, q };
  }
  function validDims(w, d) { return w >= 4 && w <= 60 && d >= 4 && d <= 60; }

  /** mode 'new' (full pop-up) | 'resize' (width/depth for the current plan). Resolves 'created' | 'resized' | 'skip'. */
  function open(mode = 'new') {
    ensure(); const m = getModel();
    const xs = m.footprint.map((p) => p[0]), ys = m.footprint.map((p) => p[1]);
    const cw = mode === 'resize' ? Math.max(...xs) - Math.min(...xs) : 16, cd = mode === 'resize' ? Math.max(...ys) - Math.min(...ys) : 20;
    const presets = PRESETS.map(([a, b]) => `<button type="button" class="sz-chip ${a === cw && b === cd ? 'on' : ''}" data-preset="${a}x${b}">${a}×${b}</button>`).join('') + `<button type="button" class="sz-chip" data-preset="custom">Custom</button>`;
    const dims = `<label class="zm-lab">Width × depth <span class="zm-em">(width runs east–west / left–right on the plan)</span></label><div class="sz-chips" id="szPresets">${presets}</div>${dimRow('W', 'Width', cw)}${dimRow('D', 'Depth', cd)}<div class="zm-err" id="szErr" hidden>Width and depth must be between 4 and 60 ft.</div>`;
    if (mode === 'resize') {
      root.innerHTML = `<div class="zm-card" id="szCard"><h2 id="szTitle">Resize the footprint</h2><p class="zm-copy">Type the new outside size. The north-west corner stays put; doors and windows slide to fit.</p>${dims}
        <div class="zm-btns"><button class="zm-primary" id="szCreate" type="button">Resize</button><button class="zm-skip" id="szSkip" type="button">Cancel</button></div></div>`;
    } else {
      const sides = Object.entries(HOUSE_SIDES).map(([k, s], i) => `<label class="zm-radio"><input type="radio" name="szSide" value="${k}" ${i === 0 ? 'checked' : ''}> <span>${esc(s.label)} <span class="zm-em">(${esc(s.note)})</span></span></label>`).join('');
      root.innerHTML = `<div class="zm-card" id="szCard"><h2 id="szTitle">Size of your build</h2>
        <p class="zm-copy">Tell us the size and we'll draw a fresh plan at exactly that size. You can change anything later.</p>
        <label class="zm-lab">What are you building?</label>
        <div class="sz-seg" role="radiogroup"><label><input type="radio" name="szType" value="attached" checked> Addition attached to the house</label><label><input type="radio" name="szType" value="free"> Freestanding (shed, studio, garage)</label></div>
        ${dims}
        <label class="zm-lab">Wall height</label>
        <div class="sz-chips" id="szWalls">${[8, 9, 10].map((h) => `<button type="button" class="sz-chip ${h === 8 ? 'on' : ''}" data-wall="${h}">${h} ft</button>`).join('')}<button type="button" class="sz-chip" data-wall="custom">Custom</button></div>
        <div class="sz-dim" id="szWallCustom" hidden><span class="sz-dl">Walls</span><input type="number" id="szWallFt" min="6" max="16" step="0.5" value="8" aria-label="Wall height feet"> ft</div>
        <div id="szSideBox"><label class="zm-lab">Which side of the house does it go on?</label>${sides}</div>
        <details class="sz-more"><summary>Roof (optional)</summary>
          <div class="sz-dim"><span class="sz-dl">Type</span><select id="szRoof"><option value="gable">Gable (peak in the middle)</option><option value="shed">Shed (one slope${' '}— high side at the house)</option></select></div>
          <div class="sz-dim"><span class="sz-dl">Slope</span><select id="szPitch">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((p) => `<option value="${p}" ${p === 4 ? 'selected' : ''}>${p}:12${p < 2 ? ' (metal only)' : ''}</option>`).join('')}</select></div>
        </details>
        <div class="zm-help">Foundation: <b>Piers only</b> (concrete piers, no grade beam). Change it later in the Foundation layer.</div>
        <div class="zm-btns"><button class="zm-primary" id="szCreate" type="button">Create plan</button><button class="zm-skip" id="szSkip" type="button">Keep the sample plan</button></div></div>`;
      const sideBox = root.querySelector('#szSideBox');
      root.querySelectorAll('input[name=szType]').forEach((r) => r.addEventListener('change', () => { sideBox.hidden = root.querySelector('input[name=szType]:checked').value !== 'attached'; }));
      root.querySelectorAll('[data-wall]').forEach((b) => b.addEventListener('click', () => { root.querySelectorAll('[data-wall]').forEach((x) => x.classList.toggle('on', x === b)); root.querySelector('#szWallCustom').hidden = b.dataset.wall !== 'custom'; if (b.dataset.wall !== 'custom') root.querySelector('#szWallFt').value = b.dataset.wall; else root.querySelector('#szWallFt').focus(); }));
      root.querySelector('#szRoof').addEventListener('change', (e) => { const p = root.querySelector('#szPitch'); if (e.target.value === 'shed' && Number(p.value) > 4) p.value = '2'; });
    }
    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x === b));
      if (b.dataset.preset === 'custom') { root.querySelector('#szWFt').focus(); root.querySelector('#szWFt').select(); return; }
      const [a, c] = b.dataset.preset.split('x').map(Number); root.querySelector('#szWFt').value = a; root.querySelector('#szWIn').value = 0; root.querySelector('#szDFt').value = c; root.querySelector('#szDIn').value = 0; sync();
    }));
    const sync = () => { const { width, depth } = read(); const ok = validDims(width, depth); root.querySelector('#szErr').hidden = ok; root.querySelector('#szCreate').disabled = !ok; root.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x.dataset.preset === `${width}x${depth}` || (x.dataset.preset === 'custom' && !PRESETS.some(([a, c]) => a === width && c === depth)))); };
    ['#szWFt', '#szWIn', '#szDFt', '#szDIn'].forEach((s) => root.querySelector(s).addEventListener('input', sync));
    root.querySelector('#szSkip').addEventListener('click', () => close('skip'));
    root.querySelector('#szCreate').addEventListener('click', () => {
      const { width, depth, q } = read(); if (!validDims(width, depth)) return sync();
      if (mode === 'resize') { onResize(width, depth); return close('resized'); }
      const attached = q('input[name=szType]:checked').value === 'attached';
      const opts = { width, depth, attached, houseSide: attached ? q('input[name=szSide]:checked').value : null, wallFt: Number(q('#szWallFt').value) || 8, roof: q('#szRoof').value, pitch: Number(q('#szPitch').value) };
      onCreate(opts); close('created');
    });
    root.hidden = false; document.body.classList.add('modalOpen');
    setTimeout(() => { const f = root.querySelector('#szCreate'); if (f) f.focus(); }, 30);
    return new Promise((res) => { resolveFn = res; });
  }
  function close(r) { if (!root || root.hidden) return; root.hidden = true; document.body.classList.remove('modalOpen'); const f = resolveFn; resolveFn = null; if (f) f(r); }
  return { open, close, isOpen: () => !!(root && !root.hidden) };
}
