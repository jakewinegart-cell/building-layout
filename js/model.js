// Building model (spec §7): Building → layers → objects. Persisted to localStorage.
import { DEFAULTS, LAYER_COLORS, STORAGE_KEY, SCHEMA_VERSION, PLAN, ESTIMATE_DEFAULTS } from './config.js';

let counter = 0;
export const uid = (p = 'o') => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

function layer(id, order, kind, name, params, extra = {}) {
  return Object.assign({
    id, order, kind, name, levelId: (kind === 'site' || kind === 'foundation') ? null : 'L1',
    zBase: 0, zTop: 0, visible: true, locked: false, ghost: false, opacity: PLAN.ghostOpacity,
    color: LAYER_COLORS[kind] || LAYER_COLORS.custom, params: clone(params || {}), objects: [], note: null,
  }, extra);
}

export function createDefaultModel() {
  const fp = clone(DEFAULTS.footprint);
  const m = {
    schema: SCHEMA_VERSION,
    units: 'ft-in',
    footprint: fp,
    // (b) single story for v1, but layers carry levelId so Level 2 can be added later.
    levels: [{ id: 'L1', name: 'Level 1', index: 0, floorZ: 0 }],
    activeLevelId: 'L1',
    layers: [
      layer('site', 0, 'site', 'Site / Ground', DEFAULTS.site),
      layer('foundation', 1, 'foundation', 'Foundation', DEFAULTS.foundation),
      layer('floor', 2, 'floor', 'Floor framing', DEFAULTS.floor),
      layer('walls', 3, 'walls', 'Walls', DEFAULTS.walls),
      layer('roof', 4, 'roof', 'Roof framing', DEFAULTS.roof),
      layer('sheathing', 5, 'stub', 'Sheathing / envelope', {}, { stub: true, visible: false, locked: true }),
      layer('mep', 6, 'stub', 'MEP', {}, { stub: true, visible: false, locked: true, color: LAYER_COLORS.mep }),
    ],
    activeLayerId: 'walls',
    selection: null,            // { layerId, objectId }
    isolateLayerId: null,
    autoGhost: true,            // ghost every non-active layer to ~30%
    view: 'plan',
    exploded: false,
    wallMode: 'studs',          // studs | solid (3D)
    snapIn: PLAN.defaultSnapIn,
    lastRegen: null,
    estimate: clone(ESTIMATE_DEFAULTS),
  };
  // Sample openings so a first run shows door swings / window breaks.
  const walls = m.layers.find((l) => l.id === 'walls');
  walls.objects.push(
    { id: 'op-door1', type: 'opening', geometry: { wallId: 'w-ext-2', t: 16 }, props: Object.assign({ kind: 'door' }, DEFAULTS.openings.door) },
    { id: 'op-win1', type: 'opening', geometry: { wallId: 'w-ext-2', t: 6 }, props: Object.assign({ kind: 'window' }, DEFAULTS.openings.window) },
    { id: 'op-win2', type: 'opening', geometry: { wallId: 'w-ext-0', t: 10 }, props: Object.assign({ kind: 'window' }, DEFAULTS.openings.window) },
    { id: 'op-win3', type: 'opening', geometry: { wallId: 'w-ext-1', t: 12 }, props: Object.assign({ kind: 'window' }, DEFAULTS.openings.window) },
  );
  return m;
}

export function getLayer(m, id) { return m.layers.find((l) => l.id === id); }
export function findObject(m, sel) {
  if (!sel) return null;
  const l = getLayer(m, sel.layerId);
  return l ? l.objects.find((o) => o.id === sel.objectId) || null : null;
}

/** Display order bottom→top: construction layers fixed, custom layers slot in by zBase, stubs last. */
export function stackOrder(m) {
  const main = m.layers.filter((l) => !l.stub);
  const fixed = main.filter((l) => l.kind !== 'custom').sort((a, b) => a.order - b.order);
  const custom = main.filter((l) => l.kind === 'custom').sort((a, b) => a.zBase - b.zBase);
  const out = [];
  fixed.forEach((f, i) => {
    out.push(f);
    const next = fixed[i + 1];
    custom.filter((c) => c.zBase >= f.zBase && (!next || c.zBase < next.zBase) && !out.includes(c)).forEach((c) => out.push(c));
  });
  custom.forEach((c) => { if (!out.includes(c)) out.unshift(c); });
  return out.concat(m.layers.filter((l) => l.stub));
}

/** Effective visibility/opacity used identically by Plan and 3D (spec §5). */
export function layerDisplay(m, l) {
  if (l.stub) return { shown: false, alpha: 0 };
  if (m.isolateLayerId) return { shown: l.id === m.isolateLayerId, alpha: 1 };
  if (!l.visible) return { shown: false, alpha: 0 };
  const ghosted = l.ghost || (m.autoGhost && l.id !== m.activeLayerId);
  return { shown: true, alpha: ghosted ? l.opacity : 1, ghosted };
}

export function save(m) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch (e) { /* quota / private mode */ }
}
export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m || m.schema !== SCHEMA_VERSION || !Array.isArray(m.layers)) return null;
    return migrate(m);
  } catch (e) { return null; }
}
export function clear() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ } }

/** Fill params added after a model was saved (v2 piers) without losing the user's work. */
export function migrate(m) {
  const f = m.layers.find((l) => l.id === 'foundation');
  if (f) {
    const p = f.params;
    if (p.pierSpacingIn == null) p.pierSpacingIn = p.pierMaxSpacingFt != null ? Math.round(p.pierMaxSpacingFt * 12) : DEFAULTS.foundation.pierSpacingIn;
    delete p.pierMaxSpacingFt;
    Object.keys(DEFAULTS.foundation).forEach((k) => { if (!(k in p)) p[k] = clone(DEFAULTS.foundation[k]); });
    if (!Array.isArray(p.deletedAutoSlots)) p.deletedAutoSlots = [];
    if (!Array.isArray(p.deletedContinuous)) p.deletedContinuous = [];
    // hotfix: older saves keep their foundation type; just give Piers only its own top height
    Object.keys(DEFAULTS.foundation.topAboveGradeIn).forEach((k) => { if (p.topAboveGradeIn[k] == null) p.topAboveGradeIn[k] = DEFAULTS.foundation.topAboveGradeIn[k]; });
  }
  const r = m.layers.find((l) => l.id === 'roof');
  if (r) Object.keys(DEFAULTS.roof).forEach((k) => {
    if (!(k in r.params)) r.params[k] = clone(DEFAULTS.roof[k]);
    else if (DEFAULTS.roof[k] && typeof DEFAULTS.roof[k] === 'object' && !Array.isArray(DEFAULTS.roof[k]) && r.params[k] && typeof r.params[k] === 'object') Object.keys(DEFAULTS.roof[k]).forEach((kk) => { if (!(kk in r.params[k])) r.params[k][kk] = clone(DEFAULTS.roof[k][kk]); });
  });
  if (!('attachToExistingWallId' in m)) m.attachToExistingWallId = null;
  m.estimate = Object.assign(clone(ESTIMATE_DEFAULTS), m.estimate || {});
  return m;
}
