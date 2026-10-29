// Wizard core (pure, no DOM): model summary (wizard-spec §2.3), unit parsing, local commands,
// edit compilation (LLM slots → ops on a model), and validation. The LLM only parses; this code
// converts units, resolves walls, builds ops and checks them. Nothing here writes the real model.
import { getLayer } from './model.js';
import { bbox, dist } from './geom.js';
import { edgeSide, wallIdForSide, shedFrame, fmtPitch, roofChecks, r2, MIN_SLOPE, pitchFromDegrees, houseOf } from './roof-calc.js';
import { SLOPE, DEFAULTS, PIER_SHAPES } from './config.js';
import { fmtFtIn } from './geom.js';
import { uid } from './model.js';

export const WIZARD_URL = 'https://building-layout-wizard-proxy.jakewinegart.workers.dev/chat';
export const SIDE_WORD = { N: 'north', S: 'south', E: 'east', W: 'west' };
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, 'twenty-four': 24 };
const words2num = (s) => String(s).toLowerCase().replace(/\b(twenty-four|thirteen|fourteen|fifteen|sixteen|eighteen|twenty|eleven|twelve|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => NUMW[w]);

/** Length string → feet. Accepts 10ft, 10 ft, 10', 10 feet, ten feet, 8'6", 8 ft 6 in, 8-6, 102", 102 in.
 *  A bare number is feet unless hint = 'in' (opening sizes). Returns null if it can't tell. */
export function parseLen(s, hint = 'ft') {
  if (s == null) return null;
  if (typeof s === 'number') return hint === 'in' ? s / 12 : s;
  let t = words2num(s).trim().toLowerCase().replace(/[″”]/g, '"').replace(/[′’]/g, "'").replace(/\s+/g, ' ');
  t = t.replace(/(feet|foot|ft)\b\.?/g, "'").replace(/(inches|inch|in)\b\.?/g, '"').replace(/\s*'\s*/g, "'").replace(/\s*"\s*/g, '"');
  let m = t.match(/^(\d+(?:\.\d+)?)'(?:\s*-?\s*(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?"?)?$/);
  if (m) return Number(m[1]) + (m[2] ? (Number(m[2]) + (m[3] ? m[3] / m[4] : 0)) / 12 : 0);
  m = t.match(/^(\d+(?:\.\d+)?)"$/); if (m) return Number(m[1]) / 12;
  m = t.match(/^(\d+)-(\d+(?:\.\d+)?)$/); if (m) return Number(m[1]) + Number(m[2]) / 12;
  m = t.match(/^(\d+(?:\.\d+)?)$/); if (m) return hint === 'in' ? Number(m[1]) / 12 : Number(m[1]);
  return null;
}
/** Pitch string → rise per 12. Accepts 4/12, 4:12, 4 in 12, 1-1/2 in 12, 1.5:12, four twelve, 4 pitch, 18°, 18 degrees, bare 4. */
export function parsePitch(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const t = words2num(s).toLowerCase().trim();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)/); if (m) return r2(pitchFromDegrees(Number(m[1])));
  m = t.match(/(\d+)\s*[- ]\s*(\d+)\/(\d+)\s*(?:\/|:|in|on|-|\s)\s*12/); if (m) return Number(m[1]) + m[2] / m[3];
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:\/|:|in|on|-|\s)\s*12\b/); if (m) return Number(m[1]);
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:pitch)?$/); if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*pitch/); if (m) return Number(m[1]);
  return null;
}
const pct = (v) => Number(String(v).replace(/[%$,\s]/g, ''));

/** "north"/"back"/"front"/"left"/"house side"/"the long wall"/"w-ext-2" → 'N'|'S'|'E'|'W'|null ('one end' → null). */
export function resolveSide(m, ref) {
  if (!ref) return null; const r = String(ref).toLowerCase();
  const ex = /w-ext-(\d+)/.exec(r); if (ex) return edgeSide(m.footprint, Number(ex[1]));
  if (/house/.test(r) && m.attachToExistingWallId) return edgeSide(m.footprint, Number(m.attachToExistingWallId.split('-')[2]));
  if (/\b(north|back|rear|top)\b|^n$/.test(r)) return 'N';
  if (/\b(south|front|bottom)\b|^s$/.test(r)) return 'S';
  if (/\b(east|right)\b|^e$/.test(r)) return 'E';
  if (/\b(west|left)\b|^w$/.test(r)) return 'W';
  return null;
}
const sideWall = (m, s) => wallIdForSide(m.footprint, s);

/** Compact model summary sent to the proxy each turn (wizard-spec §2.3). */
export function buildSummary(m, est) {
  const b = bbox(m.footprint); const w = r2(b.maxX - b.minX), d = r2(b.maxY - b.minY);
  const W = getLayer(m, 'walls'), R = getLayer(m, 'roof'), F = getLayer(m, 'foundation'), FL = getLayer(m, 'floor');
  const walls = W.objects.filter((o) => o.type === 'wall' && o.props.exterior).map((o) => ({ id: o.id, side: SIDE_WORD[edgeSide(m.footprint, o.geometry.edge)] || '?', len: r2(dist(o.geometry.a, o.geometry.b)) }));
  const sideOf = (id) => { const x = walls.find((q) => q.id === id); return x ? x.side : 'interior'; };
  const openings = W.objects.filter((o) => o.type === 'opening').map((o) => ({ id: o.id, kind: o.props.kind, wall: sideOf(o.geometry.wallId), widthIn: o.props.widthIn, heightIn: o.props.heightIn, t: r2(o.geometry.t) }));
  const rp = R.params, fp = F.params;
  const roof = { shape: rp.shape, pitch: r2(Number(rp.pitch)), overhangIn: rp.overhangIn, rafterSize: rp.rafterSize, rafterOcIn: rp.rafterOcIn, ridgeAlong: rp.computed && rp.computed.ridgeAlongX ? 'east-west' : 'north-south', covering: (rp.roofing && rp.roofing.covering) || 'asphalt_shingle' };
  if (rp.shape === 'shed' && rp.shed) Object.assign(roof, { highSide: SIDE_WORD[edgeSide(m.footprint, Number(String(rp.shed.highWallId).split('-')[2]))], highPlateFt: rp.shed.highPlateFt, lowPlateFt: rp.shed.lowPlateFt });
  const site = getLayer(m, 'site'); const existing = site.objects.filter((o) => o.props && o.props.role === 'existing').map((o) => ({ label: o.props.label || 'Existing' }));
  const s = {
    footprint: { w, d, rect: m.footprint.length === 4 }, walls, plateHeightFt: W.params.plateHeightFt, extSize: W.params.extSize, studOcIn: W.params.studOcIn,
    openings: openings.slice(0, 12), roof,
    foundation: { type: fp.type, pierShape: fp.pierShape || 'round', pierCount: F.objects.filter((o) => o.type === 'pier').length, pierDiaIn: fp.pierDiaIn, pierSpacingIn: fp.pierSpacingIn, frostDepthIn: fp.frostDepthIn },
    floor: { joistSize: FL.params.joistSize, joistOcIn: FL.params.joistOcIn, spanFt: FL.params.computed ? r2(FL.params.computed.spanFt) : null },
    existing, attachToExistingWallId: m.attachToExistingWallId || null,
    selection: m.selection ? m.selection.objectId : null, view: m.view,
  };
  // v5: slot names the app reads (also reaches the v4 proxy's prompt through the summary)
  s.slotNames = 'footprint.resize{width,depth} walls.set_height{height,wall?} openings.add{kind,wall,width?} openings.move{opening:id,wall|direction+distance} openings.remove{opening:id} roof.set_shape{shape} roof.set_pitch{pitch,relative?} roof.set_overhang{overhang} foundation.set_params{pierSpacing|frostDepth}. Values as strings with units, e.g. "9 ft". Questions: answer_question with answer_draft.';
  if (est && est.totals) s.takeoff = { materials: `$${Math.round(est.totals.materials)} EXAMPLE`, byLayer: Object.fromEntries((est.groups || []).map((g) => [g.id, `$${Math.round(g.total)} EXAMPLE`])), snapshotDate: est.snapshotDate };
  return s;
}

/** Phrases handled on the device, no AI call. Returns null if the AI should handle it. */
export function localCommand(text) {
  const t = String(text || '').toLowerCase().trim().replace(/[.!?]+$/, '');
  if (/^(run |do |open )?(a |the )?price ?check$|^check (the )?prices?$/.test(t)) return { kind: 'price' };
  if (/^(undo|undo (that|it|this|the last (change|edit|one|thing))|go back|take (that|it) back|revert( that)?)$/.test(t)) return { kind: 'meta', intent: 'meta.undo' };
  if (/^(redo|redo (that|it|this)|put it back)$/.test(t)) return { kind: 'meta', intent: 'meta.redo' };
  if (/^(yes|yes,? do it|do it|apply|apply it|ok|okay|sure)$/.test(t)) return { kind: 'meta', intent: 'meta.apply' };
  if (/^(cancel|never ?mind|no|nope)$/.test(t)) return { kind: 'meta', intent: 'meta.cancel' };
  if (/\bpiers? only\b|\bjust piers\b|\bno (grade beam|continuous concrete)\b/.test(t)) return { kind: 'edit', edits: [{ intent: 'foundation.set_type', slots: { type: 'piersOnly' } }] };
  let m = t.match(/\b(?:make|use|switch|change|set)?\s*(?:the |all )?(?:piers?|footings?)\s*(?:to |be |are )?\s*square(?:\s*(\d+))?|\bsquare (?:piers?|footings?)(?:\s*(\d+))?/);
  if (m) { const sz = Number(m[1] || m[2] || ((t.match(/\b(12|16)\s*(?:x\s*\1)?\s*(?:in|"|inch)/) || [])[1])) || null; return { kind: 'edit', edits: [{ intent: 'foundation.set_pier_shape', slots: { shape: 'square', size: sz } }] }; }
  if (/\b(round|sonotube)\b.*\bpiers?\b|\bpiers?\b.*\b(round|sonotubes?)\b/.test(t)) return { kind: 'edit', edits: [{ intent: 'foundation.set_pier_shape', slots: { shape: 'round' } }] };
  if (/\b(precast|deck block|pier block)/.test(t) && /\bpiers?|blocks?\b/.test(t)) return { kind: 'edit', edits: [{ intent: 'foundation.set_pier_shape', slots: { shape: 'precast' } }] };
  // slope: "make the roof 3:12", "pitch 2.5/12", "set the slope to 3 in 12", "roof slope 14 degrees"
  m = t.match(/^(?:make |set |change )?(?:the )?(?:roof )?(?:pitch|slope)?\s*(?:to |=|at )?\s*(\d+(?:\.\d+)?(?:\s*[- ]\s*\d+\/\d+)?\s*(?:\/|:|in|on)\s*12|\d+(?:\.\d+)?\s*(?:°|degrees?))(?:\s*(?:pitch|slope|roof))?$/);
  if (m && /pitch|slope|roof|\/|:/.test(t)) return { kind: 'edit', edits: [{ intent: 'roof.set_pitch', slots: { pitch: m[1] } }] };
  // shed by heights: "roof 10 ft at one end to 8 ft at the other", "slope the roof from 10' down to 8'"
  m = t.match(/(\d+(?:\.\d+)?\s*(?:ft|feet|foot|')?(?:\s*\d+\s*(?:in|"))?)\s*(?:(?:at|on) (?:one|the|an?) (?:end|side)\s*|(?:on|at) the (?:north|south|east|west|back|front|left|right|high)(?: (?:wall|end|side))?\s*)?(?:down )?to\s*(\d+(?:\.\d+)?\s*(?:ft|feet|foot|')?(?:\s*\d+\s*(?:in|"))?)/);
  if (m && /roof|shed|slope|end|side/.test(t) && !/wide|long|by|window|door/.test(t)) {
    const sm = t.match(/\b(north|south|east|west|back|front|left|right|house)\b(?=[^\d]*?(?:wall|side|end)?[^\d]*?\d|.*?\bhigh)/);
    return { kind: 'edit', edits: [{ intent: 'roof.make_shed', slots: { highHeight: m[1].trim(), lowHeight: m[2].trim(), highSide: sm ? sm[1] : 'one end', heightMeaning: /ground|grade/.test(t) ? 'ground' : 'wall' } }] };
  }
  // more slope phrases (v4 slope slider)
  m = t.match(/^(?:make |set )?(?:the )?(?:roof )?(?:pitch|slope)\s*(?:to |at |=)?\s*(\d+(?:\.\d+)?)$|^(\d+(?:\.\d+)?)\s*pitch(?: roof)?$/);
  if (m) return { kind: 'edit', edits: [{ intent: 'roof.set_pitch', slots: { pitch: (m[1] || m[2]) + ':12' } }] };
  if (/\b(lowest|minimum|min|flattest)\b.*\b(slope|pitch)\b/.test(t)) return { kind: 'edit', edits: [{ intent: 'roof.set_pitch', slots: { pitch: 'min shingle' } }] };
  m = t.match(/high (?:wall|side|end)\s*(?:at |to |is |=)?\s*([\d.]+\s*(?:ft|feet|foot|')?(?:\s*\d+\s*(?:in|"))?)[, ]*(?:and )?(?:the )?low (?:wall|side|end)\s*(?:at |to |is |=)?\s*([\d.]+\s*(?:ft|feet|foot|')?(?:\s*\d+\s*(?:in|"))?)/);
  if (m) return { kind: 'edit', edits: [{ intent: 'roof.make_shed', slots: { highHeight: m[1].trim(), lowHeight: m[2].trim(), highSide: 'one end', heightMeaning: 'wall' } }] };
  m = t.match(/\b(?:house|existing)(?:'s)? (?:roof )?(?:pitch|slope|roof)\b(?: is| to| =|:)?\s*(.+)$/);
  if (m && !/eave/.test(t)) return { kind: 'edit', edits: [{ intent: 'house.set_roof', slots: { pitch: m[1].trim() } }] };
  m = t.match(/\b(?:house|existing)(?:'s)? (?:roof )?eave(?: height)?\b(?: is| to| =|:| at)?\s*(.+)$/);
  if (m) return { kind: 'edit', edits: [{ intent: 'house.set_roof', slots: { eave: m[1].trim() } }] };
  m = t.match(/^(?:make (?:the |it )?)?(?:roof )?(steeper|flatter|less steep|lower pitch|higher pitch)(?: by (\S+))?$/);
  if (m) return { kind: 'edit', edits: [{ intent: 'roof.set_pitch', slots: { relative: /steeper|higher/.test(m[1]) ? 'steeper' : 'flatter', pitch: m[2] || '1' } }] };
  return null;
}

const asNum = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')) || null);

/** Compile LLM edits to a plan: { steps:[{label, source, apply(m)}], ask?, error?, kept:[] }. Pure: apply() mutates whatever model it gets. */
export function compileEdits(m, edits) {
  const steps = []; const kept = [];
  if (Array.isArray(edits)) edits = edits.map(normalizeEdit);
  if (!Array.isArray(edits) || !edits.length) return { error: 'I didn\u2019t catch a change there. Try "make the walls 9 ft".' };
  if (edits.length > 3) return { error: 'Let\u2019s do these one at a time.' };
  const R = getLayer(m, 'roof').params, W = getLayer(m, 'walls').params, F = getLayer(m, 'foundation').params;
  const b = bbox(m.footprint); const runFor = (s) => (s === 'N' || s === 'S' ? b.maxY - b.minY : b.maxX - b.minX);
  for (const e of edits) {
    const s = e.slots || {}; const it = e.intent;
    const step = (label, source, fn) => steps.push({ label, source, apply: fn });
    const fail = (msg) => ({ error: msg });
    const ask = (question, options, intent) => ({ ask: { question, options, intent: intent || it, slots: s } });
    switch (it) {
      case 'roof.make_shed': {
        let hi = parseLen(s.highHeight), lo = parseLen(s.lowHeight);
        if (hi != null && lo != null && Math.abs(hi - lo) < 1e-6) { hi = null; lo = null; if (s.pitch == null) s.pitch = String(R.shape === 'shed' ? R.pitch : Math.max(2, Number(R.pitch) || 2)); }
        if (hi == null && lo == null && s.pitch == null) return ask('How high at each end? e.g. 10 ft to 8 ft', ['10 ft to 8 ft', '9 ft to 8 ft', '12 ft to 8 ft']);
        if (/ground|grade|ridge/.test(String(s.heightMeaning || ''))) return ask(`${s.highHeight || ''} wall height, or above the ground?`.trim(), ['Wall height (top of wall)', 'Above ground']);
        if (hi != null && lo != null && hi < lo) [hi, lo] = [lo, hi];
        let side = resolveSide(m, s.highSide);
        if (!side && m.attachToExistingWallId) side = edgeSide(m.footprint, Number(m.attachToExistingWallId.split('-')[2]));
        if (!side && R.shape === 'shed' && R.shed && R.shed.highWallId) side = edgeSide(m.footprint, Number(R.shed.highWallId.split('-')[2]));
        if (lo == null) { lo = W.plateHeightFt; kept.push(`low wall ${fmtFtIn(lo)}`); }
        if (!side) {
          const opts = ['N', 'S', 'E', 'W'].map((q) => `${SIDE_WORD[q][0].toUpperCase() + SIDE_WORD[q].slice(1)}${q === 'N' ? ' (back)' : q === 'S' ? ' (front)' : ''} → ${fmtPitch(r2(hi != null ? 12 * (hi - lo) / runFor(q) : parsePitch(s.pitch) || 0))}`);
          return ask(`Which side is the high${hi != null ? ` (${fmtFtIn(hi)})` : ''} side?`, opts);
        }
        if (hi == null) { const p = parsePitch(s.pitch); if (p == null) return fail('I couldn\u2019t read that pitch.'); hi = lo + p * runFor(side) / 12; }
        const p = 12 * (hi - lo) / runFor(side);
        step(`Shed roof: ${SIDE_WORD[side]} wall ${fmtFtIn(hi)} down to ${fmtFtIn(lo)} (${fmtPitch(r2(p))})`, 'roof', (mm) => {
          const rp = getLayer(mm, 'roof').params; rp.shape = 'shed'; rp.shed = Object.assign({}, rp.shed || {}, { highWallId: wallIdForSide(mm.footprint, side), highPlateFt: r2(hi), lowPlateFt: r2(lo) }); rp.pitch = r2(p);
        });
        break;
      }
      case 'roof.set_pitch': {
        let p = parsePitch(s.pitch); const cur = Number(R.pitch);
        if (/min|code|shingle/i.test(String(s.pitch || ''))) { const cov = (R.roofing && R.roofing.covering) || 'asphalt_shingle'; p = (MIN_SLOPE[cov] || MIN_SLOPE.asphalt_shingle).min; s.relative = 'set'; }
        if (s.relative === 'steeper') p = cur + (p == null ? 1 : p); else if (s.relative === 'flatter') p = cur - (p == null ? 1 : p);
        if (p == null || !isFinite(p)) return fail('I couldn\u2019t read that pitch. Try "3:12" or "4 in 12".');
        p = Math.round(p / SLOPE.step) * SLOPE.step;
        step(`Roof pitch ${fmtPitch(cur)} → ${fmtPitch(p)}${R.shape === 'shed' && R.shed ? ' (low wall kept, high wall moves)' : ''}`, 'roof', (mm) => setPitch(mm, p));
        break;
      }
      case 'house.set_roof': {
        const H = houseOf(m); if (!H) return fail('Pick \u201cBuilt against the house\u201d in the Roof card first, then I can set the house roof.');
        let k, v, txt;
        if (s.pitch != null) { k = 'pitch'; v = parsePitch(s.pitch); if (v == null && /^\d+(\.\d+)?$/.test(String(s.pitch))) v = Number(s.pitch); txt = v != null && `House roof pitch ${fmtPitch(H.roof.pitch)} → ${fmtPitch(v)} (entered)`; }
        else { k = 'eaveUndersideFt'; v = parseLen(s.eave, 'ft'); txt = v != null && `House eave height ${H.roof.eaveUndersideFt} ft → ${Math.round(v * 100) / 100} ft (entered)`; }
        if (v == null || !isFinite(v) || v < 0) return fail('I couldn\u2019t read that. Try "house roof is 5/12" or "house eave is 8 ft".');
        step(txt, 'site', (mm) => { const h = houseOf(mm); const er = h.obj.props.existingRoof = h.obj.props.existingRoof || {}; er[k] = Math.round(v * 100) / 100; er.assumed = Object.assign({}, er.assumed, { [k]: false }); });
        break;
      }
      case 'roof.set_shape': {
        const shp = String(s.shape || '').toLowerCase();
        if (shp === 'hip') return fail('Hip roofs aren\u2019t drawn yet. I can do a gable roof or a shed (one-slope) roof. Try \u201cgable roof\u201d or \u201cshed roof\u201d.');
        if (/flat/.test(shp)) return fail('Truly flat roofs aren\u2019t drawn. I can do a low shed roof instead: try \u201cshed roof\u201d then \u201cmake the roof 1:12\u201d (needs metal or membrane).');
        if (/shed|lean|mono|single/.test(shp)) s.shape = 'shed';
        if (/gable|peak|a-frame/.test(shp)) s.shape = 'gable';
        if (s.shape !== 'shed' && s.shape !== 'gable') return fail(`I can\u2019t do a \u201c${shp}\u201d roof. Gable and shed roofs work.`);
        if (s.shape === 'gable' && R.shape === 'gable') return fail('The roof is already a gable. Try \u201cmake the roof steeper\u201d or \u201cshed roof\u201d.');
        if (s.shape === 'shed') return compileEdits(m, [{ intent: 'roof.make_shed', slots: { pitch: String(R.pitch), highSide: s.highSide } }].concat(edits.filter((x) => x !== e)));
        step('Roof shape → gable', 'roof', (mm) => { getLayer(mm, 'roof').params.shape = 'gable'; });
        break;
      }
      case 'roof.set_ridge_direction': {
        let r = s.ridge; const alongX = R.computed && R.computed.ridgeAlongX; const longX = b.maxX - b.minX >= b.maxY - b.minY;
        if (r === 'toggle') r = R.ridge === 'long' ? 'short' : 'long';
        if (r === 'east-west') r = longX ? 'long' : 'short'; if (r === 'north-south') r = longX ? 'short' : 'long';
        if (!['long', 'short'].includes(r)) return fail('Run the ridge which way: east–west or north–south?');
        step(`Ridge along the ${r} side${alongX != null ? '' : ''}`, 'roof', (mm) => { getLayer(mm, 'roof').params.ridge = r; });
        break;
      }
      case 'roof.set_overhang': { const v = parseLen(s.overhang, 'in'); if (v == null) return fail('How big an overhang? e.g. 18 in'); const inch = Math.round(v * 12); step(`Overhang ${R.overhangIn} in → ${inch} in`, 'roof', (mm) => { getLayer(mm, 'roof').params.overhangIn = inch; }); break; }
      case 'roof.set_framing': step(`Rafters ${s.rafterSize || R.rafterSize} @ ${s.rafterOcIn || R.rafterOcIn} in`, 'roof', (mm) => { const rp = getLayer(mm, 'roof').params; if (s.rafterSize) rp.rafterSize = s.rafterSize; if (s.rafterOcIn) rp.rafterOcIn = Number(s.rafterOcIn); }); break;
      case 'roof.set_covering': { const c = s.covering; if (!MIN_SLOPE[c]) return fail(`I don\u2019t know the covering "${c}".`); step(`Roof covering → ${MIN_SLOPE[c].label}`, 'roof', (mm) => { const rp = getLayer(mm, 'roof').params; rp.roofing = Object.assign({}, rp.roofing, { covering: c }); }); break; }
      case 'walls.set_height': {
        const h = parseLen(s.height); if (h == null) return fail('How tall? e.g. 9 ft');
        const side = resolveSide(m, s.wall);
        if (side && R.shape === 'shed' && R.shed) {
          const hs = edgeSide(m.footprint, Number(R.shed.highWallId.split('-')[2])); const isHi = side === hs; const other = isHi ? R.shed.lowPlateFt : R.shed.highPlateFt;
          step(`${SIDE_WORD[side]} wall → ${fmtFtIn(h)} (shed ${isHi ? 'high' : 'low'} side)`, 'roof', (mm) => { const sh = getLayer(mm, 'roof').params.shed; if (isHi) sh.highPlateFt = r2(h); else sh.lowPlateFt = r2(h); syncShedPitch(mm); });
          void other;
        } else if (side) return ask(`Walls are one height on a gable. Make the ${SIDE_WORD[side]} wall the high side of a shed roof?`, [`Shed: ${SIDE_WORD[side]} ${fmtFtIn(h)} to ${fmtFtIn(W.plateHeightFt)}`, `All walls ${fmtFtIn(h)}`], 'walls.set_height');
        else step(`Wall height ${fmtFtIn(W.plateHeightFt)} → ${fmtFtIn(h)}`, 'walls', (mm) => { getLayer(mm, 'walls').params.plateHeightFt = r2(h); });
        break;
      }
      case 'walls.set_framing': step('Wall framing', 'walls', (mm) => { const p = getLayer(mm, 'walls').params; if (s.extSize) p.extSize = s.extSize; if (s.intSize) p.intSize = s.intSize; if (s.studOcIn) p.studOcIn = Number(s.studOcIn); }); break;
      case 'footprint.resize': {
        if (m.footprint.length !== 4) return fail('Resizing by voice works on rectangles. Drag the walls for other shapes.');
        const w0 = b.maxX - b.minX, d0 = b.maxY - b.minY; let w = parseLen(s.width), d = parseLen(s.depth);
        if (w == null && d == null) return fail('What size? e.g. "24 by 16"');
        w = w || w0; d = d || d0;
        step(`Footprint ${fmtFtIn(w0)} × ${fmtFtIn(d0)} → ${fmtFtIn(w)} × ${fmtFtIn(d)} (north-west corner kept)`, 'footprint', (mm) => { const x = b.minX, y = b.minY; mm.footprint = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]; clampOpenings(mm); });
        if (s.width != null && s.depth != null && w !== d) { const sw = { width: String(d), depth: String(w) }; steps[steps.length - 1].swap = { label: `Swap: ${fmtFtIn(d)} wide × ${fmtFtIn(w)} deep`, slots: sw }; }
        break;
      }
      case 'walls.move_exterior': {
        const side = resolveSide(m, s.wall); const dd = parseLen(s.distance); if (!side || dd == null) return ask('Which wall, and how far?', ['East wall out 2 ft', 'North wall out 2 ft']);
        const out = /in|inward|smaller/.test(String(s.direction || '')) ? -dd : dd;
        step(`Move the ${SIDE_WORD[side]} wall ${out >= 0 ? 'out' : 'in'} ${fmtFtIn(Math.abs(out))}`, 'footprint', (mm) => { mm.footprint = mm.footprint.map(([x, y]) => [x + (side === 'E' && x === b.maxX ? out : side === 'W' && x === b.minX ? -out : 0), y + (side === 'S' && y === b.maxY ? out : side === 'N' && y === b.minY ? -out : 0)]); });
        break;
      }
      case 'openings.add': {
        const kind = s.kind === 'door' ? 'door' : 'window'; const side = resolveSide(m, s.wall);
        if (!side) return ask(`Which wall gets the ${kind}?`, ['North', 'South', 'East', 'West']);
        const wid = sideWall(m, side); const wObj = getLayer(m, 'walls').objects.find((o) => o.id === wid); const L = dist(wObj.geometry.a, wObj.geometry.b);
        const wIn = s.width ? Math.round(parseLen(s.width, 'in') * 12) : DEFAULTS.openings[kind].widthIn; const hIn = s.height ? Math.round(parseLen(s.height, 'in') * 12) : DEFAULTS.openings[kind].heightIn;
        step(`Add a ${wIn} in ${kind} centered on the ${SIDE_WORD[side]} wall`, 'walls', (mm) => { getLayer(mm, 'walls').objects.push({ id: uid('op'), type: 'opening', geometry: { wallId: wid, t: r2(L / 2) }, props: Object.assign({ kind }, DEFAULTS.openings[kind], { widthIn: wIn, heightIn: hIn }) }); });
        break;
      }
      case 'openings.move': case 'openings.resize': case 'openings.remove': case 'openings.set_props': {
        const op = findOpening(m, s.opening || s.kind);
        if (op.error) return fail(op.error);
        if (op.ask) { const a = ask(op.ask, op.options); a.ask.optionSlots = op.optionSlots; return a; }
        const o = op.o; const W0 = getLayer(m, 'walls').objects.find((w) => w.id === o.geometry.wallId); const L = dist(W0.geometry.a, W0.geometry.b);
        const name = `${o.props.kind} on the ${op.side ? SIDE_WORD[op.side] : 'interior'} wall`;
        const edit = (fn) => (mm) => { const x = getLayer(mm, 'walls').objects.find((q) => q.id === o.id); if (x) fn(x, mm); };
        if (it === 'openings.remove') { step(`Remove the ${name}`, 'walls', (mm) => { const l = getLayer(mm, 'walls'); l.objects = l.objects.filter((q) => q.id !== o.id); }); break; }
        if (it === 'openings.set_props') { step(`${name}: ${s.swing ? 'swings ' + s.swing : ''}${s.kind ? ' → ' + s.kind : ''}`, 'walls', edit((x) => { if (s.swing) x.props.swing = s.swing; if (s.kind && s.kind !== x.props.kind) Object.assign(x.props, DEFAULTS.openings[s.kind], { kind: s.kind }); })); break; }
        if (it === 'openings.resize') {
          const wi = s.width ? Math.round(parseLen(s.width, 'in') * 12) : null, hi = s.height ? Math.round(parseLen(s.height, 'in') * 12) : null;
          if (!wi && !hi) return fail('What size? e.g. "make the door 36 inches wide"');
          if (wi && wi / 12 > L - 1) return fail(`That ${o.props.kind} won’t fit: the wall is ${fmtFtIn(L)} long.`);
          step(`${name}: ${wi ? `${o.props.widthIn} → ${wi} in wide` : ''}${hi ? ` ${o.props.heightIn} → ${hi} in tall` : ''}${wi && wi > 72 ? ' (header 2-2x12 EXAMPLE, verify — long span)' : ''}`, 'walls', edit((x) => { if (wi) x.props.widthIn = wi; if (hi) x.props.heightIn = hi; }));
          break;
        }
        // move: "3 ft to the left" (as seen from outside), "center"
        let t = o.geometry.t;
        const toSide = s.wall ? resolveSide(m, s.wall) : null;
        if (toSide && toSide !== op.side) {
          const nid = sideWall(m, toSide); const NW = getLayer(m, 'walls').objects.find((w) => w.id === nid); const NL = dist(NW.geometry.a, NW.geometry.b);
          if (o.props.widthIn / 12 > NL - 1) return fail(`That ${o.props.kind} won\u2019t fit on the ${SIDE_WORD[toSide]} wall (${fmtFtIn(NL)} long).`);
          step(`Move the ${name} to the ${SIDE_WORD[toSide]} wall (centered)`, 'walls', edit((x) => { x.geometry.wallId = nid; x.geometry.t = r2(NL / 2); }));
          break;
        }
        if (s.direction === 'center' || (!s.distance && /cent/.test(String(s.direction || s.position || '')))) t = L / 2;
        else if (!s.distance && !s.direction) return fail(`Where should the ${o.props.kind} go? Try \u201cmove the ${o.props.kind} to the east wall\u201d or \u201cmove the ${o.props.kind} 3 ft to the left\u201d.`);
        else {
          const d = parseLen(s.distance); if (d == null) return fail('How far? e.g. "3 ft to the left"');
          const ax = [W0.geometry.b[0] - W0.geometry.a[0], W0.geometry.b[1] - W0.geometry.a[1]].map((v) => v / L);
          const DIRV = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] };
          // left/right as seen from outside the wall: outside normal of side N is -y; viewer faces +y, so their left = east.
          const LEFT = { N: 'east', S: 'west', E: 'north', W: 'south' }, RIGHT = { N: 'west', S: 'east', E: 'south', W: 'north' };
          const dir = s.direction === 'left' ? LEFT[op.side] : s.direction === 'right' ? RIGHT[op.side] : s.direction;
          const v = DIRV[dir]; if (!v) return fail('Which way: left, right, or a compass direction?');
          t = t + d * (ax[0] * v[0] + ax[1] * v[1]);
        }
        const half = o.props.widthIn / 24; t = Math.max(half, Math.min(L - half, t));
        step(`Move the ${name} to ${fmtFtIn(t)} along the wall${s.direction === 'left' || s.direction === 'right' ? ` (${s.direction} as seen from outside)` : ''}`, 'walls', edit((x) => { x.geometry.t = r2(t); }));
        break;
      }
      case 'foundation.add_pier': { const sp = F.pierSpacingIn || 72; const a = Math.max(3, Math.round(sp / 12) - 1), c = Math.max(3, a - 1); return ask(`Piers go under walls and beams, spaced ${fmtFtIn(sp / 12)} apart now. Space them closer, or tap \u25ce Pier in Plan to place one by hand.`, [`Piers ${a} ft apart`, `Piers ${c} ft apart`, '2x12 joists, no mid beam', 'Cancel']); }
      case 'foundation.set_type': {
        const ty = /only/.test(String(s.type)) ? 'piersOnly' : s.type;
        if (!['piersOnly', 'piers', 'crawlspace', 'slab', 'basement'].includes(ty)) return fail('Foundation types: piers only, piers + grade beam, crawlspace, slab, basement.');
        step(ty === 'piersOnly' ? 'Foundation → Piers only (no grade beam, footing, stem wall or slab)' : `Foundation → ${ty}`, 'foundation', (mm) => { getLayer(mm, 'foundation').params.type = ty; });
        break;
      }
      case 'foundation.set_pier_shape': {
        const sh = s.shape; if (!PIER_SHAPES[sh]) return fail('Pier shapes: round Sonotube, square formed, or precast block.');
        const size = sh === 'square' ? ([12, 16].includes(Number(s.size)) ? Number(s.size) : (F.pierSquareIn || 12)) : null;
        const pOnly = F.type !== 'piersOnly' && F.type !== 'piers';
        step(`Piers → ${sh === 'square' ? `square ${size}×${size} in formed` : PIER_SHAPES[sh].label}${pOnly ? ' (and foundation → Piers only)' : ''}`, 'foundation', (mm) => {
          const fp = getLayer(mm, 'foundation').params; fp.pierShape = sh; if (size) fp.pierSquareIn = size; if (pOnly) fp.type = 'piersOnly';
          getLayer(mm, 'foundation').objects.forEach((o) => { if (o.type === 'pier' && o.props) { delete o.props.shape; delete o.props.sizeIn; } });
        });
        break;
      }
      case 'foundation.set_params': {
        const ch = []; const fr = s.frostDepth != null ? parseLen(s.frostDepth, 'in') : null; const sp = s.pierSpacing != null ? parseLen(s.pierSpacing) : null;
        if (fr != null) ch.push(`frost depth ${Math.round(fr * 12)} in`); if (s.pierDia) ch.push(`${s.pierDia} in tubes`); if (sp != null) ch.push(`piers every ${fmtFtIn(sp)}`); if (s.soilType) ch.push(`soil ${s.soilType}`);
        if (!ch.length) return fail('Which foundation setting? e.g. "frost depth is 36 in".');
        step(`Foundation: ${ch.join(', ')}`, 'foundation', (mm) => { const fp = getLayer(mm, 'foundation').params; if (fr != null) fp.frostDepthIn = Math.round(fr * 12); if (s.pierDia) fp.pierDiaIn = Number(s.pierDia); if (sp != null) fp.pierSpacingIn = Math.round(sp * 12); if (s.spacingMode) fp.pierSpacingMode = s.spacingMode; if (s.soilType) fp.soilType = s.soilType; });
        break;
      }
      case 'floor.set_framing': step(`Floor joists ${s.joistSize || ''} ${s.joistOcIn ? '@ ' + s.joistOcIn + ' in' : ''}`.trim(), 'floor', (mm) => { const p = getLayer(mm, 'floor').params; if (s.joistSize) p.joistSize = s.joistSize; if (s.joistOcIn) p.joistOcIn = Number(s.joistOcIn); if (s.direction) p.direction = s.direction; }); break;
      case 'estimate.set': {
        const keys = ['taxRatePct', 'contingencyPct', 'deliveryUsd', 'laborUsd', 'concreteMode', 'iceBarrier'].filter((k) => s[k] != null);
        if (!keys.length) return fail('Which setting? e.g. "tax is 8.81%".');
        step(`Price settings: ${keys.map((k) => `${k} ${s[k]}`).join(', ')}`, null, (mm) => { mm.estimate = mm.estimate || {}; keys.forEach((k) => { mm.estimate[k] = typeof s[k] === 'string' && k !== 'concreteMode' ? pct(s[k]) : s[k]; }); });
        break;
      }
      default: return fail(`I can\u2019t do \u201c${String(it || 'that').replace(/[._]/g, ' ')}\u201d yet. ${CAN_DO}`);
    }
  }
  return { steps, kept };
}

/** Clamp openings to their (resized) walls; drop ones that no longer fit. */
export function clampOpenings(mm) {
  const fp = mm.footprint; const W = getLayer(mm, 'walls');
  W.objects = W.objects.filter((o) => {
    if (o.type !== 'opening') return true; const mt = /^w-ext-(\d+)$/.exec(o.geometry.wallId || ''); if (!mt) return true;
    const i = Number(mt[1]); if (i >= fp.length) return false; const L = dist(fp[i], fp[(i + 1) % fp.length]); const half = (o.props.widthIn || 36) / 24;
    if (half * 2 > L - 1) return false; o.geometry.t = r2(Math.max(half + 0.25, Math.min(L - half - 0.25, o.geometry.t))); return true;
  });
}

/** "the door", "window on the east wall" → { o, side } | { ask, options }. */
export function findOpening(m, ref) {
  const r = String(ref || '').toLowerCase(); const W = getLayer(m, 'walls');
  const sideOfWall = (id) => { const w = W.objects.find((q) => q.id === id); return w && w.props.exterior ? edgeSide(m.footprint, w.geometry.edge) : null; };
  let c = W.objects.filter((o) => o.type === 'opening');
  const byId = c.find((o) => o.id.toLowerCase() === r.trim() || (r.length > 4 && r.includes(o.id.toLowerCase())));
  if (byId) return { o: byId, side: sideOfWall(byId.geometry.wallId) };
  if (/door/.test(r)) c = c.filter((o) => o.props.kind === 'door'); else if (/window/.test(r)) c = c.filter((o) => o.props.kind === 'window');
  const side = resolveSide(m, r.replace(/\b(left|right)\b/g, '')); if (side) c = c.filter((o) => sideOfWall(o.geometry.wallId) === side);
  if (m.selection && /\bthis|that\b/.test(r)) { const sel = c.find((o) => o.id === m.selection.objectId); if (sel) c = [sel]; }
  if (c.length === 1) return { o: c[0], side: sideOfWall(c[0].geometry.wallId) };
  const all = W.objects.filter((o) => o.type === 'opening');
  const label = (o) => `${o.props.kind[0].toUpperCase() + o.props.kind.slice(1)} on the ${SIDE_WORD[sideOfWall(o.geometry.wallId)] || 'interior'} wall (${fmtFtIn(o.geometry.t)} along)`;
  const pick = (list) => { const l = list.slice(0, 5); return { options: l.map(label), optionSlots: Object.fromEntries(l.map((o) => [label(o), { opening: o.id }])) }; };
  if (!all.length) return { error: 'There are no doors or windows yet. Try \u201cadd a door on the south wall\u201d.' };
  if (!c.length) { const k = /door/.test(r) ? 'door' : /window/.test(r) ? 'window' : 'opening'; return Object.assign({ ask: `I couldn\u2019t find that ${k}${side ? ` on the ${SIDE_WORD[side]} wall` : ''}. Which one?` }, pick(all)); }
  return Object.assign({ ask: `Which ${c[0].props.kind}? There are ${c.length}.` }, pick(c));
}

/** Set the pitch on any roof; a shed keeps its low wall and moves the high wall (wizard-spec roof.set_pitch keepSide). */
export function setPitch(mm, p) {
  const rp = getLayer(mm, 'roof').params; rp.pitch = r2(p);
  if (rp.shape === 'shed' && rp.shed) { const f = shedFrame(mm.footprint, rp.shed.highWallId, rp.shed.highPlateFt, rp.shed.lowPlateFt); rp.shed.highPlateFt = Math.round((rp.shed.lowPlateFt + p * f.run / 12) * 1e4) / 1e4; }
}
/** Shed: back-calculate the pitch from the high/low wall heights. */
export function syncShedPitch(mm) {
  const rp = getLayer(mm, 'roof').params; if (rp.shape !== 'shed' || !rp.shed) return;
  const f = shedFrame(mm.footprint, rp.shed.highWallId, rp.shed.highPlateFt, rp.shed.lowPlateFt); rp.pitch = r2(f.pitch);
}

/** Validation over a regenerated model (wizard-spec §8): returns [{severity:'block'|'warn'|'info', msg}]. */
export function validate(mm) {
  const out = []; const rp = getLayer(mm, 'roof').params; const wp = getLayer(mm, 'walls').params;
  const p = Number(rp.pitch);
  if (!(p >= SLOPE.min - 1e-9 && p <= SLOPE.max + 1e-9)) out.push({ severity: 'block', id: 'V-PITCH', msg: `Pitch must be between ${fmtPitch(SLOPE.min)} and ${fmtPitch(SLOPE.max)} (this is ${fmtPitch(r2(p))}).` });
  if (rp.shape === 'shed' && rp.shed && !(rp.shed.highPlateFt > rp.shed.lowPlateFt)) out.push({ severity: 'block', id: 'V-SHED', msg: 'The high wall must be taller than the low wall.' });
  const hs = [wp.plateHeightFt].concat(rp.shape === 'shed' && rp.shed ? [rp.shed.highPlateFt, rp.shed.lowPlateFt] : []);
  if (hs.some((h) => !(h > 0 && h <= 40))) out.push({ severity: 'block', id: 'V-HEIGHT', msg: 'Wall heights must be between 0 and 40 ft.' });
  if (hs.some((h) => h > 10)) out.push({ severity: 'warn', id: 'V-WALL-TALL', msg: 'Studs over 10 ft tall need a height check (IRC R602.3(5)); verify with your building department.' });
  const b = bbox(mm.footprint); if (b.maxX - b.minX <= 0 || b.maxY - b.minY <= 0 || b.maxX - b.minX > 60 || b.maxY - b.minY > 60) out.push({ severity: 'block', id: 'V-FP', msg: 'Footprint must be between 1 and 60 ft on a side.' });
  roofChecks(mm).forEach((c) => { if (!/^RF-SNOW-01$/.test(c.id)) out.push({ severity: c.severity, id: c.id, msg: c.msg }); });
  return out;
}

// ============================================================================
// v5: slot normalization, text tool-call parsing, rule-based parser, local answers
// ============================================================================
export const CAN_DO = 'I can: resize (\u201cmake it 20 by 16\u201d), set wall height (\u201cwalls 9 ft\u201d), add / move / remove doors and windows (\u201cadd a window on the north wall\u201d), change the roof (\u201cgable roof\u201d, \u201cshed roof\u201d, \u201cmake the roof 6:12\u201d, \u201csteeper\u201d), set piers (\u201cpiers 6 ft apart\u201d, \u201cpiers only\u201d), undo / redo, and \u201cprice check\u201d.';
export const SUGGEST = ['make it 20 by 16', 'make the walls 9 ft', 'add a window on the north wall', 'gable roof', 'price check'];

// Slot aliases the model has been seen to use (live run 2026-10-29: {w,d}, {widthFt}, {heightFt}, {overhangIn}, {id}, {pierSpacingIn}).
const ALIAS = {
  width: ['width', 'w', 'wide', 'widthft', 'widthin', 'x', 'length_ew', 'eastwest', 'ew'],
  depth: ['depth', 'd', 'deep', 'depthft', 'depthin', 'y', 'length', 'lengthft', 'long', 'northsouth', 'ns'],
  height: ['height', 'h', 'heightft', 'heightin', 'plateheight', 'plateheightft', 'wallheight', 'wallheightft', 'tall'],
  opening: ['opening', 'id', 'openingid', 'target', 'ref', 'which', 'name', 'object', 'objectid'],
  wall: ['wall', 'side', 'towall', 'newwall', 'wallside', 'location', 'to', 'targetwall', 'onwall'],
  overhang: ['overhang', 'overhangin', 'overhangft', 'eave', 'size'],
  pierSpacing: ['pierspacing', 'pierspacingin', 'pierspacingft', 'spacing', 'spacingin', 'spacingft', 'apart', 'oc'],
  frostDepth: ['frostdepth', 'frostdepthin', 'frostdepthft', 'frost'],
  pitch: ['pitch', 'slope', 'rise', 'value'],
  distance: ['distance', 'distanceft', 'distancein', 'by', 'amount', 'offset'],
};
const SLOTS_FOR = {
  'footprint.resize': ['width', 'depth'], 'walls.set_height': ['height', 'wall'], 'roof.set_overhang': ['overhang'],
  'foundation.set_params': ['pierSpacing', 'frostDepth'], 'roof.set_pitch': ['pitch'],
  'openings.add': ['width', 'height', 'wall'], 'openings.move': ['opening', 'wall', 'distance'], 'openings.remove': ['opening'],
  'openings.resize': ['opening', 'width', 'height'], 'openings.set_props': ['opening'], 'walls.move_exterior': ['wall', 'distance'],
};
const unitOf = (k) => (/in$/i.test(k) ? 'in' : /ft$/i.test(k) ? 'ft' : null);
/** Map whatever slot names / numeric types the AI used onto the names compileEdits reads. */
export function normalizeEdit(e) {
  if (!e || typeof e !== 'object') return e;
  const it = e.intent; const raw = Object.assign({}, e.slots || {}, e.parameters || {}); const out = {}; const want = SLOTS_FOR[it] || [];
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '') continue;
    const kl = k.toLowerCase().replace(/[^a-z]/g, '');
    const canon = want.find((c) => ALIAS[c] && ALIAS[c].includes(kl));
    if (canon && out[canon] == null) { const u = unitOf(k); out[canon] = u && /^\s*\d+(\.\d+)?\s*$/.test(String(v)) ? `${String(v).trim()} ${u}` : v; }
    else if (out[k] == null) out[k] = v;
  }
  if (it === 'footprint.resize' && out.width == null && out.depth == null) { const sz = String(out.size || out.dimensions || out.footprint || ''); const m = sz.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/); if (m) { out.width = m[1]; out.depth = m[2]; } }
  if (it === 'openings.add' && out.kind == null && out.type) out.kind = out.type;
  if (it === 'foundation.set_params' && typeof out.pierSpacing === 'number' && out.pierSpacing > 20) out.pierSpacing = `${out.pierSpacing} in`;
  if (it === 'roof.set_overhang' && typeof out.overhang === 'number') out.overhang = out.overhang > 4 ? `${out.overhang} in` : `${out.overhang} ft`;
  for (const k of ['width', 'height', 'depth', 'distance']) if (typeof out[k] === 'number' && /^openings\./.test(it) && k !== 'distance') out[k] = out[k] > 10 ? `${out[k]} in` : `${out[k]} ft`;
  return { intent: it, slots: out };
}

/** Parse a tool call the model printed as text: `propose_edit(edits=[...])`, `[answer_question(intent=ask.cost, topic="x"),]`, or JSON. */
export function parseToolText(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  try { const j = JSON.parse(t.match(/\{[\s\S]*\}/)[0]); if (j && j.name && (j.arguments || j.parameters)) return { name: j.name, arguments: j.arguments || j.parameters }; } catch (e) { /* not JSON */ }
  const m = t.match(/(answer_question|ask_clarification|propose_edit|meta)\s*\(([\s\S]*)\)/);
  if (!m) return null;
  const body = m[2]; const args = {}; let i = 0;
  const parts = []; let depth = 0, q = null, cur = '';
  for (; i < body.length; i++) {
    const ch = body[i];
    if (q) { cur += ch; if (ch === q && body[i - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ('[{('.includes(ch)) depth++; if (']})'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const val = (v) => {
    v = v.trim(); if (!v) return v;
    try { return JSON.parse(v); } catch (e) { /* */ }
    try { return JSON.parse(v.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')); } catch (e) { /* */ }
    return v.replace(/^["']|["']$/g, '');
  };
  for (const p of parts) { const k = p.indexOf('='); if (k < 0) continue; const key = p.slice(0, k).trim().replace(/^["']|["']$/g, ''); if (/^\w+$/.test(key)) args[key] = val(p.slice(k + 1)); }
  if (m[1] === 'propose_edit' && args.edits && !Array.isArray(args.edits)) args.edits = [args.edits];
  return { name: m[1], arguments: args };
}

const LEN = String.raw`\d+(?:\.\d+)?\s*(?:ft|feet|foot|')?(?:\s*\d+(?:\.\d+)?\s*(?:in|inch|inches|"))?|\d+(?:\.\d+)?\s*(?:in|inch|inches|")`;
const SIDE_RE = String.raw`north|south|east|west|front|back|rear|left|right|house`;
const edit1 = (intent, slots) => ({ name: 'propose_edit', arguments: { edits: [{ intent, slots }] } });
/** Rule-based parser for common homeowner phrasings. Returns a tool call (same shape as the proxy's) or null.
 *  strict = only phrasings we're sure about (used before calling the AI); loose = also guesses (used when the AI fails). */
export function ruleCommand(text, opts = {}) {
  const loose = !!opts.loose;
  const t = words2num(String(text || '').toLowerCase()).replace(/[×]/g, 'x').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const isQ = /^(what|how|why|when|where|which|is|are|can|could|should|do|does|will|would)\b/.test(t) || /\?\s*$/.test(String(text));
  let m;
  // not supported: decks, porches, second floors
  if (/\b(deck|porch|patio|pergola|gazebo)\b/.test(t) && !isQ) return { name: 'say', arguments: { text: `I can\u2019t turn this into a ${t.match(/\b(deck|porch|patio|pergola|gazebo)\b/)[1]} yet: this app plans a framed, roofed addition or shed on piers. ${CAN_DO}` } };
  if (/\b(second|2nd|upper) (floor|story|storey)|\bloft\b|\bstairs?\b/.test(t) && !isQ) return { name: 'say', arguments: { text: `Second floors, lofts and stairs aren\u2019t supported yet (one story only). ${CAN_DO}` } };
  // cost questions → local answer (uses the on-device estimate)
  if (/\b(what|how much)\b.*\b(cost|price|run me|spend)\b|\bhow much (is|will|does|would)\b|^(cost|total|price)\??$|\bwhat'?s (it|this|the total) cost/.test(t)) return { name: 'answer_question', arguments: { intent: 'ask.cost', topic: 'total cost', local: true } };
  if (isQ && !loose) return null;
  m = t.match(new RegExp(String.raw`\bfrost(?: depth| line)?\b\s*(?:is |to |=|at |of )?(${LEN})`));
  if (m) return edit1('foundation.set_params', { frostDepth: m[1].trim().replace(/^(\d+(?:\.\d+)?)$/, '$1 in') });
  // footprint size: "make it 20 by 16", "20x16", "resize to 24' x 24'"
  m = t.match(new RegExp(String.raw`(?:^|\b(?:make|change|resize|set|size)\b.*?)(${LEN})\s*(?:x|by|\*)\s*(${LEN})`));
  if (m && !/\b(door|window|opening|pier|tube|joist|rafter|stud|beam|header|post)\b/.test(t) && !/\d\s*x\s*\d+\b.*\b(lumber|board)/.test(t)) {
    const a = m[1].trim(), b = m[2].trim();
    if (!(/^\d$/.test(a) && /^(4|6|8|10|12)$/.test(b))) return edit1('footprint.resize', { width: a, depth: b });
  }
  // one dimension: "make the addition 24 ft wide", "16 ft deep", "make it wider: 24"
  m = t.match(new RegExp(String.raw`\b(?:it|addition|building|footprint|room|shed|plan|structure|place)\b.*?(${LEN})\s*(wide|deep|long)\b`)) || t.match(new RegExp(String.raw`^(?:make )?(?:it )?(${LEN})\s*(wide|deep)$`));
  if (m && !/\b(door|window|wall)\b/.test(t)) return edit1('footprint.resize', m[2] === 'deep' ? { depth: m[1].trim() } : { width: m[1].trim() });
  m = t.match(new RegExp(String.raw`\b(width|depth|length)\b(?: of (?:it|the \w+))?\s*(?:to|=|is|at|:)?\s*(${LEN})`));
  if (m && !/\b(door|window|wall|pier|joist)\b/.test(t)) return edit1('footprint.resize', m[1] === 'depth' ? { depth: m[2].trim() } : { width: m[2].trim() });
  // move an exterior wall: "move the east wall out 2 ft"
  m = t.match(new RegExp(String.raw`\b(?:move|push|pull|bump)\b (?:the )?(${SIDE_RE}) wall (out|in|outward|inward)\s*(?:by )?(${LEN})`));
  if (m) return edit1('walls.move_exterior', { wall: m[1], direction: m[2], distance: m[3].trim() });
  // doors / windows
  const kindM = t.match(/\b(doors?|windows?|openings?)\b/);
  if (kindM) {
    const kind = /door/.test(kindM[1]) ? 'door' : /window/.test(kindM[1]) ? 'window' : null;
    const sideAfter = (s) => { const x = s.match(new RegExp(String.raw`\b(${SIDE_RE})\b`)); return x ? x[1] : null; };
    if (/\b(add|put|place|insert|need|want|give me|another|new)\b/.test(t) && kind && !/\b(remove|delete|move)\b/.test(t)) {
      const wm = t.match(new RegExp(String.raw`(${LEN})\s*(?:wide\s*)?(?:${kind})`)) || t.match(new RegExp(String.raw`${kind}\s*(?:that'?s |,)?\s*(${LEN})\s*wide`));
      const slots = { kind }; const side = sideAfter(t); if (side) slots.wall = side; if (wm) slots.width = /in|"|inch/.test(wm[1]) || Number(wm[1]) > 10 ? wm[1].trim().replace(/^(\d+(?:\.\d+)?)$/, '$1 in') : wm[1].trim();
      return edit1('openings.add', slots);
    }
    if (/\b(remove|delete|get rid of|take out|drop|lose|no more)\b/.test(t)) {
      const ref = t.replace(/^.*?\b(remove|delete|get rid of|take out|drop|lose|no more)\b\s*/, '');
      return edit1('openings.remove', { opening: ref || kindM[1] });
    }
    if (/\b(move|shift|slide|put|center|relocate)\b/.test(t)) {
      const parts = t.split(/\bto the\b|\bonto the\b|\bover to the\b/);
      const m2 = t.match(new RegExp(String.raw`(${LEN})\s*(?:to the |towards? the |)(left|right|north|south|east|west)`));
      if (parts.length > 1 && !m2) { const to = sideAfter(parts.slice(1).join(' ')); const ref = parts[0].replace(/^.*?\b(move|shift|slide|put|relocate)\b\s*/, ''); if (to) return edit1('openings.move', { opening: ref, wall: to }); }
      if (m2) return edit1('openings.move', { opening: t.replace(/^.*?\b(move|shift|slide)\b\s*/, '').split(/\d/)[0].trim(), distance: m2[1].trim(), direction: m2[2] });
      if (/\bcent(er|re)\b/.test(t)) return edit1('openings.move', { opening: t.replace(/\bcent(er|re)\b|\bthe wall\b/g, '').replace(/^.*?\b(move|put)\b/, '').trim() || kindM[1], direction: 'center' });
    }
    m = t.match(new RegExp(String.raw`\b(?:make|change|set|resize)\b (?:the )?(.*?\b(?:door|window)\b.*?)\s*(?:to |be )?(${LEN})\s*(wide|tall|high)`));
    if (m) return edit1('openings.resize', Object.assign({ opening: m[1] }, m[3] === 'wide' ? { width: m[2].trim() } : { height: m[2].trim() }));
    if (loose) return null;
  }
  // wall height: "make the walls 9 ft", "9 ft walls", "wall height 10'", "raise the walls to 9 feet"
  if (/\bwalls?\b|\bceilings?\b/.test(t) && !/\b(move|add|delete|remove|interior|bearing)\b/.test(t)) {
    m = t.match(new RegExp(String.raw`(${LEN})\s*(?:tall|high)?\s*(?:walls?|ceilings?)\b`)) || t.match(new RegExp(String.raw`\b(?:walls?|ceilings?)\b.*?(?:to |at |=|is |be |of )?(${LEN})\s*(?:tall|high)?$`));
    if (m && /\d/.test(m[1])) { const side = t.match(new RegExp(String.raw`\b(${SIDE_RE})\b wall`)); const slots = { height: m[1].trim() }; if (side) slots.wall = side[1]; return edit1('walls.set_height', slots); }
    if (/\b(taller|higher)\b/.test(t)) return edit1('walls.set_height', { height: 'taller' });
  }
  // roof shape
  m = t.match(/^(?:(?:make|change|switch|turn|set|give)\b.*?\b(?:it|roof|that)\b\s*(?:in)?to\s*(?:a |an )?|(?:i want |use |do )?(?:a |an )?)(gable|shed|lean-to|hip|flat|mono-?pitch|single[- ]slope|a-frame|peaked)(?: roof| style)?(?: roof)?$/) || t.match(/\b(gable|shed|hip|flat|lean-to|single[- ]slope)\b\s*roof\b/);
  if (m) return edit1('roof.set_shape', { shape: m[1] });
  // pitch: "change the roof to a 6/12 pitch", "6 in 12", "steeper", "less steep"
  m = t.match(/(\d+(?:\.\d+)?(?:\s*[- ]\s*\d+\/\d+)?)\s*(?:\/|:|in|on)\s*12\b/);
  if (m && /roof|pitch|slope|make|set|change|^\d/.test(t)) return edit1('roof.set_pitch', { pitch: m[1] + ':12' });
  m = t.match(/\b(steeper|flatter|less steep|more steep|shallower|lower slope|lower pitch|higher pitch|more slope|less slope|more pitch|less pitch)\b/);
  if (m && /roof|pitch|slope|it|steep|flat/.test(t)) return edit1('roof.set_pitch', { relative: /steeper|more|higher/.test(m[1]) ? 'steeper' : 'flatter', pitch: '1' });
  // overhang / eaves
  m = t.match(new RegExp(String.raw`\b(?:overhangs?|eaves?)\b.*?(${LEN})|(${LEN})\s*(?:of )?(?:overhangs?|eaves?)\b`));
  if (m && !/house/.test(t)) return edit1('roof.set_overhang', { overhang: (m[1] || m[2]).trim() });
  // roof covering
  m = t.match(/\b(metal|standing seam|shingles?|asphalt|membrane|epdm|tpo|rolled roofing|roll roofing)\b/);
  if (m && /\b(roof|use|make|switch|change|covering|with)\b/.test(t) && !isQ) return edit1('roof.set_covering', { covering: /metal|seam/.test(m[1]) ? 'metal_standing_seam' : /shingle|asphalt/.test(m[1]) ? 'asphalt_shingle' : /roll/.test(m[1]) ? 'roll_roofing' : 'modified_bitumen' });
  // piers / foundation
  m = t.match(new RegExp(String.raw`\b(?:piers?|footings?|tubes?|sonotubes?)\b.*?(${LEN})\s*(?:apart|o\.?c\.?|on cent(?:er|re)|spacing|between)|\b(?:piers?|tubes?)\s*every\s*(${LEN})|\bspace (?:the )?(?:piers?|tubes?)\s*(?:at |every |to )?(${LEN})|\bpier spacing\b\s*(?:to |=|is |at |of )?(${LEN})`));
  if (m) return edit1('foundation.set_params', { pierSpacing: (m[1] || m[2] || m[3] || m[4]).trim() });
  if (/\b(more|extra|another|add (?:a |an |one )?(?:more )?)\s*piers?\b|\badd (?:a )?pier\b|\bpiers? closer\b/.test(t)) return edit1('foundation.add_pier', {});
  if (/\bfewer piers\b|\bpiers? (?:further|farther) apart\b/.test(t)) return { name: 'say', arguments: { text: 'Say a spacing, e.g. \u201cpiers 7 ft apart\u201d (6 ft is the usual maximum EXAMPLE).' } };
  m = t.match(/\b(slab|crawl ?space|basement|grade beam)\b/);
  if (m && /\b(foundation|make|use|switch|change|on a|want|piers with)\b|^(a )?(slab|crawl ?space|basement)( foundation)?$/.test(t) && !isQ) return edit1('foundation.set_type', { type: /slab/.test(m[1]) ? 'slab' : /crawl/.test(m[1]) ? 'crawlspace' : /basement/.test(m[1]) ? 'basement' : 'piers' });
  m = t.match(/\b(2x(?:6|8|10|12))\s*(?:floor )?joists?\b/);
  if (m) return edit1('floor.set_framing', { joistSize: m[1] });
  if (loose) {
    if (/\bbigger|larger\b/.test(t) && !/door|window/.test(t)) return { name: 'say', arguments: { text: 'How big? Say a size, e.g. \u201cmake it 24 by 16\u201d.' } };
    if (/\bsmaller\b/.test(t) && !/door|window/.test(t)) return { name: 'say', arguments: { text: 'How small? Say a size, e.g. \u201cmake it 12 by 12\u201d.' } };
  }
  return null;
}

/** Plain-words answers from the model itself (used when the AI gives no answer or isn't reachable). */
export function localAnswer(m, est, topic, question) {
  const q = `${topic || ''} ${question || ''}`.toLowerCase();
  const b = bbox(m.footprint); const w = r2(b.maxX - b.minX), d = r2(b.maxY - b.minY);
  const W = getLayer(m, 'walls'), R = getLayer(m, 'roof').params, F = getLayer(m, 'foundation');
  const ops = W.objects.filter((o) => o.type === 'opening');
  if (/cost|price|money|spend|budget|total|expens|cheap/.test(q)) {
    if (est && est.totals) return `Materials come to about $${Math.round(est.totals.materials).toLocaleString('en-US')} (EXAMPLE, Home Depot online snapshot${est.snapshotDate ? ' ' + est.snapshotDate : ''}; not labor, tax or permits). Type \u201cprice check\u201d for the full list.`;
    return 'Type \u201cprice check\u201d (or tap Price check) to price the materials for this plan.';
  }
  if (/wall|tall|height|ceiling/.test(q)) return `The walls are ${fmtFtIn(W.params.plateHeightFt)} tall${R.shape === 'shed' && R.shed ? ` (shed roof: high wall ${fmtFtIn(R.shed.highPlateFt)}, low wall ${fmtFtIn(R.shed.lowPlateFt)})` : ''}, framed ${W.params.extSize} at ${W.params.studOcIn} in on center.`;
  if (/pitch|slope|roof|steep/.test(q)) return `The roof is a ${R.shape} at ${fmtPitch(Number(R.pitch))}, with a ${R.overhangIn} in overhang and ${(MIN_SLOPE[(R.roofing || {}).covering] || MIN_SLOPE.asphalt_shingle).label.toLowerCase()}.`;
  if (/pier|foundation|footing|concrete/.test(q)) { const n = F.objects.filter((o) => o.type === 'pier').length; return `Foundation: ${F.params.type === 'piersOnly' ? 'piers only' : F.params.type}, ${n} piers about ${fmtFtIn((F.params.pierSpacingIn || 72) / 12)} apart (EXAMPLE, verify with your building department).`; }
  if (/door|window|opening/.test(q)) { const nd = ops.filter((o) => o.props.kind === 'door').length; return `There ${nd === 1 ? 'is 1 door' : `are ${nd} doors`} and ${ops.length - nd} window${ops.length - nd === 1 ? '' : 's'}.`; }
  if (/size|big|large|square|sq|area|dimension|wide|deep|long/.test(q)) return `It\u2019s ${fmtFtIn(w)} wide (east\u2013west) by ${fmtFtIn(d)} deep (north\u2013south), about ${Math.round(w * d)} sq ft.`;
  return `I don\u2019t have that in the plan data. It\u2019s ${fmtFtIn(w)} \u00d7 ${fmtFtIn(d)}, ${fmtFtIn(W.params.plateHeightFt)} walls, ${R.shape} roof ${fmtPitch(Number(R.pitch))}. For code questions ask your building department.`;
}
