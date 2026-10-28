// ============================================================================
// pricecheck.js — the "Price check" run: nothing is priced until the user runs it.
// A run freezes a copy of the model + the pre-check answers; the report always renders from
// that frozen copy. Edits after a run make it "Out of date" (signature mismatch) — never re-priced silently.
// ============================================================================
import { getLayer } from './model.js';
import { dropPier } from './piers.js';
import { applyClearSpan } from './estimate.js';

const RUN_KEY = 'layout-app.priceCheck.v3';

/** Signature of everything that changes the takeoff (footprint + every layer's params/objects). */
export function modelSig(m) {
  const s = JSON.stringify({ fp: m.footprint, layers: m.layers.map((l) => ({ id: l.id, p: l.params, o: l.objects })) });
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (h2 * 31 + c) >>> 0; }
  return `${s.length}-${h1.toString(36)}-${h2.toString(36)}`;
}

/** Mid floor beam state: girders, and the piers the user chose to put under them. */
export function beamState(m) {
  const fl = getLayer(m, 'floor');
  const girders = fl.objects.filter((o) => o.props && o.props.role === 'girder');
  const support = getLayer(m, 'foundation').objects.filter((o) => o.type === 'pier' && o.props && o.props.beamSupport);
  return { has: girders.length > 0, girders, supportPiers: support.length, supported: girders.length > 0 && support.length > 0, spanFt: (fl.params.computed && fl.params.computed.spanFt) || 0, joistSize: fl.params.joistSize, beamFlagSpanFt: fl.params.beamFlagSpanFt };
}

/** Choice "Add piers under the beam": manual piers along each mid beam (ends sit on the wall lines,
 *  so only interior points), spaced no more than the layer's pier spacing. Idempotent. Returns count. */
export function addBeamPiers(m) {
  const fnd = getLayer(m, 'foundation');
  fnd.objects = fnd.objects.filter((o) => !(o.type === 'pier' && o.props && o.props.beamSupport));
  const spFt = (Number(fnd.params.pierSpacingIn) || 72) / 12;
  let n = 0;
  beamState(m).girders.forEach((g) => {
    const [a, b] = [g.geometry.a, g.geometry.b];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(2, Math.ceil(L / spFt));
    for (let i = 1; i < k; i++) {
      const t = i / k; const o = dropPier(m, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      o.props.beamSupport = true; o.props.onWall = null; n++;
    }
  });
  return n;
}
export function removeBeamPiers(m) { const fnd = getLayer(m, 'foundation'); fnd.objects = fnd.objects.filter((o) => !(o.type === 'pier' && o.props && o.props.beamSupport)); }

/**
 * Apply pre-check answers to the LIVE model (caller commits/regenerates).
 * answers: { location, taxRatePct|null, taxSkipped, frostDepthIn|null, frostSkipped, beam: 'piers'|'clearspan'|'skip'|null }
 * Returns the regenerate sources needed.
 */
export function applyAnswers(m, ans) {
  // v4: a blank tax box means "use the ZIP lookup" (or unknown → 0% flagged); a number is the user's override.
  m.estimate = Object.assign({}, m.estimate || {}, { location: ans.location || '', taxRatePct: ans.taxRatePct == null ? null : ans.taxRatePct });
  getLayer(m, 'foundation').params.frostDepthIn = ans.frostSkipped ? null : ans.frostDepthIn;
  m.site = Object.assign({}, m.site || {});
  m.site.taxSource = ans.taxRatePct != null ? 'user' : (ans.taxSkipped ? 'unknown' : 'lookup');
  m.site.frostSource = ans.frostSkipped ? 'fallback' : (ans.lookupFrostIn != null && ans.frostDepthIn === ans.lookupFrostIn ? 'lookup' : 'user');
  const src = ['foundation'];
  if (ans.beam === 'piers') { addBeamPiers(m); }
  else if (ans.beam === 'skip') { removeBeamPiers(m); }
  else if (ans.beam === 'clearspan') { removeBeamPiers(m); applyClearSpan(m); src.unshift('floor'); }
  m.estimate.beamChoice = ans.beam || null;
  return src;
}

export function saveRun(run) { try { localStorage.setItem(RUN_KEY, JSON.stringify(Object.assign({}, run, { snaps: undefined }))); } catch (e) { /* quota */ } }
export function loadRun() { try { const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); return r && r.model && r.sig ? r : null; } catch (e) { return null; } }
export function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ } }
