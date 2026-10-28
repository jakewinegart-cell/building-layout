// Wizard core (pure, no DOM): model summary (wizard-spec §2.3), unit parsing, local commands,
// edit compilation (LLM slots → ops on a model), and validation. The LLM only parses; this code
// converts units, resolves walls, builds ops and checks them. Nothing here writes the real model.
import { getLayer } from './model.js';
import { bbox, dist } from './geom.js';
import { edgeSide, wallIdForSide, shedFrame, fmtPitch, roofChecks, r2, MIN_SLOPE, pitchFromDegrees } from './roof-calc.js';
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
  if (est && est.totals) s.takeoff = { materials: `$${Math.round(est.totals.materials)} EXAMPLE`, byLayer: Object.fromEntries((est.groups || []).map((g) => [g.id, `$${Math.round(g.total)} EXAMPLE`])), snapshotDate: est.snapshotDate };
  return s;
}

/** Phrases handled on the device, no AI call. Returns null if the AI should handle it. */
export function localCommand(text) {
  const t = String(text || '').toLowerCase().trim().replace(/[.!?]+$/, '');
  if (/^(run |do |open )?(a |the )?price ?check$|^check (the )?prices?$/.test(t)) return { kind: 'price' };
  if (/^(undo|undo that|go back)$/.test(t)) return { kind: 'meta', intent: 'meta.undo' };
  if (/^redo$/.test(t)) return { kind: 'meta', intent: 'meta.redo' };
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
  m = t.match(/^(?:make (?:the |it )?)?(?:roof )?(steeper|flatter|less steep|lower pitch|higher pitch)(?: by (\S+))?$/);
  if (m) return { kind: 'edit', edits: [{ intent: 'roof.set_pitch', slots: { relative: /steeper|higher/.test(m[1]) ? 'steeper' : 'flatter', pitch: m[2] || '1' } }] };
  return null;
}

const asNum = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')) || null);

/** Compile LLM edits to a plan: { steps:[{label, source, apply(m)}], ask?, error?, kept:[] }. Pure: apply() mutates whatever model it gets. */
export function compileEdits(m, edits) {
  const steps = []; const kept = [];
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
        if (/min|code|shingle/i.test(String(s.pitch || ''))) { const cov = (R.roofing && R.roofing.covering) || 'asphalt_shingle'; p = Math.max(cur, (MIN_SLOPE[cov] || MIN_SLOPE.asphalt_shingle).min); s.relative = 'set'; }
        if (s.relative === 'steeper') p = cur + (p == null ? 1 : p); else if (s.relative === 'flatter') p = cur - (p == null ? 1 : p);
        if (p == null || !isFinite(p)) return fail('I couldn\u2019t read that pitch. Try "3:12" or "4 in 12".');
        p = Math.round(p / SLOPE.step) * SLOPE.step;
        step(`Roof pitch ${fmtPitch(cur)} → ${fmtPitch(p)}${R.shape === 'shed' && R.shed ? ' (low wall kept, high wall moves)' : ''}`, 'roof', (mm) => setPitch(mm, p));
        break;
      }
      case 'roof.set_shape': {
        if (s.shape === 'hip') return fail('Hip roofs aren\u2019t drawn yet. Gable and shed are.');
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
        step(`Footprint ${fmtFtIn(w0)} × ${fmtFtIn(d0)} → ${fmtFtIn(w)} × ${fmtFtIn(d)} (north-west corner kept)`, 'footprint', (mm) => { const x = b.minX, y = b.minY; mm.footprint = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]; });
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
        const op = findOpening(m, s.opening);
        if (op.ask) return ask(op.ask, op.options);
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
        if (s.direction === 'center') t = L / 2;
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
      case 'foundation.add_pier': return ask('Piers only go under walls. Want one of these instead?', ['2x12 joists, no mid beam', 'Add a bearing wall there', 'Cancel']);
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
      default: return fail(`The wizard can\u2019t do "${String(it || '').replace(/\./g, ' ')}" yet. You can do it by hand in Plan or 3D.`);
    }
  }
  return { steps, kept };
}

/** "the door", "window on the east wall" → { o, side } | { ask, options }. */
export function findOpening(m, ref) {
  const r = String(ref || '').toLowerCase(); const W = getLayer(m, 'walls');
  const sideOfWall = (id) => { const w = W.objects.find((q) => q.id === id); return w && w.props.exterior ? edgeSide(m.footprint, w.geometry.edge) : null; };
  let c = W.objects.filter((o) => o.type === 'opening');
  if (/door/.test(r)) c = c.filter((o) => o.props.kind === 'door'); else if (/window/.test(r)) c = c.filter((o) => o.props.kind === 'window');
  const side = resolveSide(m, r.replace(/\b(left|right)\b/g, '')); if (side) c = c.filter((o) => sideOfWall(o.geometry.wallId) === side);
  if (m.selection && /\bthis|that\b/.test(r)) { const sel = c.find((o) => o.id === m.selection.objectId); if (sel) c = [sel]; }
  if (c.length === 1) return { o: c[0], side: sideOfWall(c[0].geometry.wallId) };
  if (!c.length) return { ask: 'I couldn’t find that opening. Which one?', options: W.objects.filter((o) => o.type === 'opening').slice(0, 5).map((o) => `${o.props.kind} on the ${SIDE_WORD[sideOfWall(o.geometry.wallId)] || 'interior'} wall`) };
  return { ask: `Which ${c[0].props.kind}?`, options: c.slice(0, 5).map((o) => `${o.props.kind} on the ${SIDE_WORD[sideOfWall(o.geometry.wallId)] || 'interior'} wall, ${fmtFtIn(o.geometry.t)} in`) };
}

/** Set the pitch on any roof; a shed keeps its low wall and moves the high wall (wizard-spec roof.set_pitch keepSide). */
export function setPitch(mm, p) {
  const rp = getLayer(mm, 'roof').params; rp.pitch = r2(p);
  if (rp.shape === 'shed' && rp.shed) { const f = shedFrame(mm.footprint, rp.shed.highWallId, rp.shed.highPlateFt, rp.shed.lowPlateFt); rp.shed.highPlateFt = r2(rp.shed.lowPlateFt + p * f.run / 12); }
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
