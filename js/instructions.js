// ============================================================================
// instructions.js — fills Remodel Guide's content-v3/instructions.md template from the model
// and the takeoff, then renders the small markdown subset it uses to HTML.
//   {var}                  → value (variable table at the bottom of instructions.md)
//   [if cond] … [/if]      → inline or block conditional; an [if] with no [/if] on its line runs to end of line
// ============================================================================
import { getLayer } from './model.js';
import { bbox } from './geom.js';

const LUMBER_D = { '2x4': 3.5, '2x6': 5.5, '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 };
const NEXT = { '2x6': '2x8', '2x8': '2x10', '2x10': '2x12', '2x12': '2x12 (verify — consider an engineered joist)' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (x, d = 2) => String(Math.round(x * 10 ** d) / 10 ** d);
/** 25.6576 → "25 ft 7-7/8 in" (nearest 1/8) */
export function ftInFrac(ft) {
  let e = Math.round(ft * 96); const f = Math.floor(e / 96); e -= f * 96;
  const whole = Math.floor(e / 8); let n = e % 8, d = 8; while (n && n % 2 === 0) { n /= 2; d /= 2; }
  const inch = n ? `${whole ? whole + '-' : ''}${n}/${d}` : String(whole);
  return `${f} ft${inch !== '0' ? ` ${inch} in` : ''}`;
}

export function instructionVars(m, est, rules) {
  const fnd = getLayer(m, 'foundation'), fl = getLayer(m, 'floor'), wl = getLayer(m, 'walls'), rf = getLayer(m, 'roof');
  const f = fnd.params, fp = fl.params, wp = wl.params, rp = rf.params;
  const b = bbox(m.footprint); const rep = (est && est.report) || {}; const lines = (est && est.lines) || [];
  const line = (id) => lines.filter((l) => l.id === id);
  const piers = fnd.objects.filter((o) => o.type === 'pier');
  const D = (rules && rules.defaults) || {};
  const bars = D.rebar ? (D.rebar.pierVerticalsEXAMPLE.find((x) => (piers[0] ? piers[0].props.diaIn : 12) <= x.maxDiaIn) || {}).bars : 4;
  const gbLf = fnd.objects.filter((o) => o.props && o.props.role === 'gradeBeam').reduce((s, o) => s + Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]), 0);
  const girders = fl.objects.filter((o) => o.props && o.props.role === 'girder');
  const joists = fl.objects.filter((o) => o.type === 'joist' && !o.props.role);
  const ops = wl.objects.filter((o) => o.type === 'opening');
  const rafters = rf.objects.filter((o) => o.type === 'rafter');
  const ridge = rf.objects.find((o) => o.props && o.props.role === 'ridge');
  const rlen = rafters[0] ? Math.hypot(Math.hypot(rafters[0].geometry.b[0] - rafters[0].geometry.a[0], rafters[0].geometry.b[1] - rafters[0].geometry.a[1]), rafters[0].props.zB - rafters[0].props.zA) : 0;
  const cj = line('roof.ceilingJoists')[0]; const cjSize = cj ? (/(2x\d+)/.exec(cj.desc) || [])[1] : (rp.ceilingJoistSize !== 'auto' ? rp.ceilingJoistSize : null);
  const shingles = line('roof.shingles')[0];
  const frostSet = f.frostDepthIn != null && f.frostDepthIn !== '';
  const depth = frostSet ? Number(f.frostDepthIn) : f.placeholderFrostIn;
  const pierTop = (f.topAboveGradeIn.piers || 0) - f.gradeBeamDepthIn;
  return {
    footprint_w_ft: num(b.w), footprint_d_ft: num(b.h), diagonal_ft_in: ftInFrac(Math.hypot(b.w, b.h)),
    pier_count: piers.length, pier_diameter_in: piers[0] ? piers[0].props.diaIn : f.pierDiaIn, pier_depth_in: depth,
    frost_note: frostSet ? `Frost depth entered: ${f.frostDepthIn} in.` : `Frost depth not entered. This uses a ${f.placeholderFrostIn} in PLACEHOLDER — ask your building department for the real value and enter it.`,
    pier_top_above_grade_in: pierTop, tube_length_in: piers[0] ? Math.round(piers[0].height * 12) + 2 : '—',
    pier_bars: bars, grade_beam_bars: D.rebar ? D.rebar.gradeBeamBarsEXAMPLE.top + D.rebar.gradeBeamBarsEXAMPLE.bottom : 4,
    grade_beam_width_in: f.gradeBeamWidthIn, grade_beam_depth_in: f.gradeBeamDepthIn, grade_beam_lf: num(gbLf, 1),
    concrete_yd: rep.concreteYd != null ? rep.concreteYd : '—', bags80: rep.bags80 != null ? rep.bags80 : '—', anchor_bolt_count: rep.anchorBolts != null ? rep.anchorBolts : '—',
    footing_width_in: f.footingWidthIn, footing_depth_in: f.footingDepthIn, stem_wall_in: f.stemWallIn, slab_in: f.slabIn,
    sill_size: fp.sillSize, joist_size: fp.joistSize, joist_oc_in: fp.joistOcIn, joist_span_ft: num((fp.computed && fp.computed.spanFt) || 0, 1), joist_count: joists.length,
    floor_beam_flag: girders.length ? 'FLAGGED — no supports under it' : 'none in this model',
    floor_beam_desc: girders.length ? `3-ply ${fp.joistSize}, ${num(girders.reduce((s, o) => s + Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]), 0), 1)} ft` : '',
    alt_joist_size: NEXT[fp.joistSize] || '2x12',
    subfloor_sheets: rep.floorSheets != null ? rep.floorSheets : '—', wall_sheets: rep.wallSheets != null ? rep.wallSheets : '—', roof_sheets: rep.roofSheets != null ? rep.roofSheets : '—',
    wall_ext_size: wp.extSize, stud_oc_in: wp.studOcIn, plate_height_ft: wp.plateHeightFt,
    stud_length_in: num(wp.plateHeightFt * 12 - 1.5 * ((wp.bottomPlates || 1) + (wp.topPlates || 2)), 2),
    opening_list: ops.map((o) => `${o.props.kind} ${o.props.widthIn}×${o.props.heightIn} in${o.props.kind === 'window' ? ` (sill ${o.props.sillIn} in)` : ''}`).join('; ') || 'none',
    header_list: ops.map((o) => `${o.props.header || '—'} over the ${o.props.widthIn} in ${o.props.kind}`).join('; ') || 'none',
    pitch: rp.pitch, overhang_in: rp.overhangIn, rafter_size: rp.rafterSize, rafter_oc_in: rp.rafterOcIn, rafter_count: rafters.length, rafter_length_ft: num(rlen, 1),
    ridge_size: ({ '2x4': '2x6', '2x6': '2x8', '2x8': '2x10', '2x10': '2x12', '2x12': '2x12' })[rp.rafterSize], ridge_length_ft: ridge ? num(Math.hypot(ridge.geometry.b[0] - ridge.geometry.a[0], ridge.geometry.b[1] - ridge.geometry.a[1]), 1) : '—',
    ridge_height_ft: num((rp.computed && rp.computed.rise) || 0, 2), ceiling_joist_size: cjSize || '—',
    hurricane_ties: (line('roof.hurricaneTies')[0] || {}).qty || '—',
    roof_squares: rep.roofAreaSqFt != null ? num(rep.roofAreaSqFt / 100, 1) : '—', shingle_bundles: shingles ? shingles.qty : '—',
    // conditions
    _cond: {
      type: f.type, gbAbove: f.type === 'piers' && pierTop > 0, concreteYd: Number(rep.concreteYd) || 0, floorBeam: girders.length > 0,
      hangers: lines.some((l) => l.id === 'floor.hangers'), iceBarrier: !est || !est.raw || est.raw.lines.some((l) => l.id === 'roof.iceBarrier'),
    },
  };
}

function evalCond(c, C) {
  const s = c.trim();
  let mm;
  if ((mm = /^foundation\.type\s*==\s*'(\w+)'$/.exec(s))) return C.type === mm[1];
  if ((mm = /^foundation\.type\s+in\s*\(([^)]*)\)$/.exec(s))) return mm[1].split(',').map((x) => x.trim().replace(/'/g, '')).includes(C.type);
  if (/^grade beam bottom above grade$/.test(s)) return C.gbAbove;
  if ((mm = /^concrete_yd\s*>\s*([\d.]+)$/.exec(s))) return C.concreteYd > Number(mm[1]);
  if (s === 'floor beam') return C.floorBeam;
  if (s === 'hangers') return C.hangers;
  if (s === 'ice barrier') return C.iceBarrier;
  return true; // unknown condition: show the text rather than hide guidance
}

/** Returns [{ title, html }] — one entry per "## " section of the template. */
export function renderInstructions(md, vars) {
  const C = vars._cond;
  let src = md.split(/\n###\s+Variable table/)[0];
  const out = []; const stack = [];
  src.split('\n').forEach((raw) => {
    const t = raw.trim();
    let mm;
    if ((mm = /^\[if ([^\]]+)\]$/.exec(t))) { stack.push(evalCond(mm[1], C)); return; }
    if (t === '[/if]') { stack.pop(); return; }
    if (stack.some((x) => !x)) return;
    let line = raw.replace(/\[if ([^\]]+)\]([\s\S]*?)\[\/if\]/g, (_, c, body) => (evalCond(c, C) ? body : ''));
    line = line.replace(/\[if ([^\]]+)\](.*)$/, (_, c, body) => (evalCond(c, C) ? body : ''));
    // a block opener at the end of a line ("… [if x]" then lines then "[/if]") is not used by the template
    out.push(line);
  });
  const filled = out.join('\n').replace(/\{([a-z0-9_]+)\}/g, (all, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : all));
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<b>$1</b>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*]+)\*/g, '$1<i>$2</i>').replace(/\{([a-z0-9_]+)\}/g, '<span class="miss">{$1}</span>');
  const sections = []; let cur = null; let list = null;
  const closeList = () => { if (list) { cur.html += `</${list}>`; list = null; } };
  filled.split('\n').forEach((raw) => {
    const t = raw.trim();
    if (/^#\s/.test(t) || t === '---') return;
    if (/^##\s/.test(t)) { if (cur) closeList(); cur = { title: t.replace(/^##\s+/, ''), html: '' }; sections.push(cur); return; }
    if (!cur) { if (/^>\s*\*\*How to use/.test(t)) return; cur = { title: 'Notes', html: '' }; sections.push(cur); }
    if (!t) { closeList(); return; }
    if (/^>\s/.test(t)) { if (/How to use this file/.test(t)) return; closeList(); cur.html += `<blockquote>${inline(t.replace(/^>\s*/, ''))}</blockquote>`; return; }
    let mm;
    if ((mm = /^(\d+)\.\s+(.*)$/.exec(t)) && !/^\s{2,}/.test(raw)) { if (list !== 'ol') { closeList(); cur.html += `<ol start="${mm[1]}">`; list = 'ol'; } cur.html += `<li>${inline(mm[2])}</li>`; return; }
    if ((mm = /^[-*]\s+(.*)$/.exec(t))) {
      if (/^\s{2,}/.test(raw) && list === 'ol') { cur.html = cur.html.replace(/<\/li>$/, '') + `<div class="sub">• ${inline(mm[1])}</div></li>`; return; }
      if (list !== 'ul') { closeList(); cur.html += '<ul>'; list = 'ul'; } cur.html += `<li>${inline(mm[1])}</li>`; return;
    }
    if (/^\s{2,}/.test(raw) && list) { cur.html = cur.html.replace(/<\/li>$/, '') + `<div class="sub">${inline(t)}</div></li>`; return; }
    closeList();
    if (/^\*\*[^*]+\*\*$/.test(t)) cur.html += `<h4>${inline(t)}</h4>`;
    else cur.html += `<p>${inline(t)}</p>`;
  });
  if (cur) closeList();
  return sections.filter((s) => s.html.trim());
}
void LUMBER_D;
