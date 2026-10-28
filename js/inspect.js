// ============================================================================
// inspect.js — "$" price inspect. Point at (desktop hover) or tap (phone) one part and get
// what that piece costs: the board it is cut from (prorated), the fasteners/connectors that
// place it (count × per-unit price = box price ÷ box count) and a total.
// Same content + engine run as Price check (js/estimate.js), so unit prices (incl. bulk) and the
// concrete mode match the report. Nothing here edits the model.
// ============================================================================
import { getContentCached } from './content.js';
import { runEstimate } from './estimate.js';
import { getLayer, findObject } from './model.js';
import { LUMBER } from './config.js';

const r2 = (x) => Math.round(x * 100) / 100;
const plen = (o) => Math.hypot(o.geometry.b[0] - o.geometry.a[0], o.geometry.b[1] - o.geometry.a[1]);
const polyArea = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const usd = (x) => (x == null ? '—' : '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** per-unit money: cents under $1 ("2.6¢"), dollars above */
export const each = (x) => (x == null ? '—' : x < 1 ? `${(x * 100).toFixed(x * 100 < 10 ? 1 : 0)}¢` : usd(x));
const FRACS = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];
/** 7.625 → "7 ft 7-1/2 in", 6 → "6 ft", 0.9 → "10-7/8 in" */
export function fmtLen(ft) {
  let e = Math.round(ft * 96); const f = Math.floor(e / 96); e -= f * 96; const i = Math.floor(e / 8), fr = FRACS[e % 8];
  const ins = i || fr ? `${i ? i : ''}${i && fr ? '-' : ''}${fr} in` : '';
  return f ? `${f} ft${ins ? ' ' + ins : ''}` : (ins || '0 in');
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (d) => { const [y, mo, da] = String(d).split('-').map(Number); return `${MONTHS[mo - 1]} ${da}, ${y}`; };

const FASTENER_LABEL = {
  nails_framing_16d: '3-1/4 in framing nails (16d)',
  nails_sheathing: '2-3/8 in ring-shank sheathing nails',
  nails_connector_n8_150: 'N8 connector nails',
  nails_connector_10d3_250: '0.148 × 3 in hanger nails',
  screws_structural_12pk: 'structural screws',
  anchor_bolt_50pk: '1/2 × 10 in anchor bolts',
  h_clip_716_50: 'H-clips',
  hurricane_h25a: 'H2.5A hurricane tie',
};
const TYPICAL = 'typical nailing: takeoff-rules framingNailsPerPieceEXAMPLE, matches IRC Table R602.3(1) — verify';

/** Context shared by every part lookup: content, engine run, price helpers. */
export function makeCtx(m, C, est) {
  const D = C.rules.defaults, P = C.prices.prices, NP = D.framingNailsPerPieceEXAMPLE;
  const has = (ref) => !!(P[ref] && P[ref].price != null);
  const line = (pred) => est.lines.find(pred);
  // unit price for ref exactly as Price check bought it (bulk price when the run qualifies)
  const unit = (ref) => { const l = line((x) => x.priceRef === ref && x.unitPrice != null); return l ? l.unitPrice : (has(ref) ? P[ref].price : null); };
  const verified = (ref) => !!(P[ref] && P[ref].verified);
  function stock(prefix, size, L) {
    const lens = D.stock.lengthsFt.filter((x) => has(`${prefix}_${size}_${x}`));
    const n = L <= D.stock.maxSinglePieceFt + 1e-6 ? 1 : Math.ceil(L / D.stock.splitPieceFt);
    const need = L / n;
    let len = lens.find((x) => x + 1e-6 >= need); if (len == null) len = lens[lens.length - 1];
    return { n, len, ref: `${prefix}_${size}_${len}` };
  }
  // per-nail price from the box Price check picked (bigger box first)
  function perUnitFrom(lineId, fallbackRef) {
    const l = line((x) => x.id === lineId && x.priceRef);
    const ref = l ? l.priceRef : fallbackRef;
    const up = l ? l.unitPrice : unit(ref);
    return { ref, per: up != null && P[ref] ? up / (P[ref].pack_qty || 1) : null, box: up, boxQty: P[ref] && P[ref].pack_qty };
  }
  return { m, C, est, D, P, NP, has, unit, verified, stock, perUnitFrom };
}

// ---------- rows
function lumberRow(X, prefix, size, L, label) {
  const s = X.stock(prefix, size, L); const up = X.unit(s.ref);
  if (up == null) return { label: `${label}`, detail: `no price for ${size} stock`, amount: null, est: true };
  const share = r2(up * s.n * Math.min(1, L / (s.n * s.len)));
  const pt = prefix === 'pt' ? 'PT ' : '';
  return { label, detail: `cut from ${s.n > 1 ? `${s.n} × ` : ''}${s.len} ft ${pt}${size} at ${usd(up)}${s.n > 1 ? ' each' : ''} — this piece's share`, amount: share, est: !X.verified(s.ref), ref: s.ref };
}
function wholeRow(X, ref, label, detail, qty = 1) {
  const up = X.unit(ref);
  return { label, detail: detail || (qty !== 1 ? `${qty} × ${usd(up)}` : `${usd(up)} each`), amount: up == null ? null : r2(up * qty), est: !X.verified(ref), ref };
}
function fastenerRow(X, count, pu, label, note) {
  if (!count) return null;
  const c = Math.round(count * 10) / 10;
  return { label: `${c} ${label}`, detail: `${each(pu.per)} each (${usd(pu.box)} box of ${pu.boxQty})${note ? ' · ' + note : ''}`, amount: pu.per == null ? null : r2(c * pu.per), est: !X.verified(pu.ref), ref: pu.ref, fastener: true };
}
const framingNails = (X) => X.perUnitFrom('fast.framingNails', 'nails_framing_16d_1000');
const sheathingNails = (X) => X.perUnitFrom('fast.sheathingNails', 'nails_sheathing_2000');
const connector = (X, ref) => ({ ref, per: X.unit(ref) != null ? X.unit(ref) / (X.P[ref].pack_qty || 1) : null, box: X.unit(ref), boxQty: X.P[ref] && X.P[ref].pack_qty });
const nailLabel = (pu) => FASTENER_LABEL[pu.ref.replace(/_\d+$/, '')] || FASTENER_LABEL[pu.ref] || pu.ref;

function studInfo(X, w, kind) {
  const wl = getLayer(X.m, 'walls'); const wp = wl.params; const size = w.props.size;
  const H = wp.plateHeightFt, studLenIn = H * 12 - ((wp.bottomPlates || 1) + (wp.topPlates || 2)) * 1.5;
  const suf = X.D.stock.precutStuds[String(H)];
  const pre = suf && X.has(`lumber_${size}_${suf}`) ? `lumber_${size}_${suf}` : null;
  const nails = { stud: X.NP.stud, king: X.NP.king, jack: X.NP.jack }[kind] || X.NP.stud;
  const pieceFt = studLenIn / 12;
  const rows = [];
  if (pre) {
    const nm = X.P[pre].name || ''; const all = [...nm.matchAll(/(\d+(?:-\d+\/\d+)?)\s*in\./g)]; const mm = all.length ? all[all.length - 1] : null;
    rows.push(wholeRow(X, pre, `${size} precut stud${mm ? ` (${mm[1]} in)` : ''}`, `1 stud at ${usd(X.unit(pre))}${kind === 'jack' ? ' — jack cut from a full precut stud' : studLenIn < 92.6 ? ` — trimmed to ${fmtLen(pieceFt)}` : ''}`));
  } else rows.push(lumberRow(X, 'lumber', size, pieceFt, `${size} stud`));
  const pu = framingNails(X);
  rows.push(fastenerRow(X, nails, pu, nailLabel(pu), TYPICAL));
  const title = `${fmtLen(pieceFt)} ${size} ${kind === 'king' ? 'king stud' : kind === 'jack' ? 'jack stud' : 'stud'}`;
  return { title, rows, typical: true, pieceFt };
}
function nearestStud(X, w, world) {
  const L = plen(w), a = w.geometry.a, b = w.geometry.b;
  const t = Math.max(0, Math.min(L, ((world[0] - a[0]) * (b[0] - a[0]) + (world[1] - a[1]) * (b[1] - a[1])) / L));
  const oc = (w.props.studOcIn || getLayer(X.m, 'walls').params.studOcIn || 16) / 12, T = 1.5 / 12;
  const ops = getLayer(X.m, 'walls').objects.filter((o) => o.type === 'opening' && o.geometry.wallId === w.id).map((o) => ({ center: o.geometry.t, widthFt: o.props.widthIn / 12 }));
  const cand = [];
  const cuts = ops.map((o) => ({ a: o.center - o.widthFt / 2, b: o.center + o.widthFt / 2 }));
  const blocked = (d) => cuts.some((c) => d + T / 2 >= c.a - 2 * T && d - T / 2 <= c.b + 2 * T);
  [T / 2, L - T / 2].concat(Array.from({ length: Math.max(0, Math.ceil((L - T) / oc)) }, (_, i) => (i + 1) * oc).filter((d) => d < L - T)).forEach((d) => { if (!blocked(d)) cand.push({ d, k: 'stud' }); });
  cuts.forEach((c) => { cand.push({ d: c.a - T / 2, k: 'jack' }, { d: c.b + T / 2, k: 'jack' }, { d: c.a - 1.5 * T, k: 'king' }, { d: c.b + 1.5 * T, k: 'king' }); });
  let best = cand[0]; cand.forEach((c) => { if (Math.abs(c.d - t) < Math.abs(best.d - t)) best = c; });
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, hw = (w.props.thicknessIn / 12) / 2;
  const p = [a[0] + ux * best.d, a[1] + uy * best.d];
  return { kind: best.k, mark: { seg: [[p[0] - uy * hw, p[1] + ux * hw], [p[0] + uy * hw, p[1] - ux * hw]], wFt: 1.5 / 12 } };
}
function wallSummary(X, w) {
  // the whole wall at Price-check rules: studs + plates + their nails (no sheathing)
  const wp = getLayer(X.m, 'walls').params; const L = plen(w), size = w.props.size, oc = (w.props.studOcIn || wp.studOcIn) / 12;
  const ops = getLayer(X.m, 'walls').objects.filter((o) => o.type === 'opening' && o.geometry.wallId === w.id);
  const s = studInfo(X, w, 'stud'); const studEach = s.rows.reduce((a, r) => a + (r.amount || 0), 0);
  let n = 1 + Math.max(0, Math.ceil((L - 1.5 / 12) / oc)); n += ops.length * 4; // studs + kings/jacks (approx, same rule as engine)
  const pl = lumberRow(X, 'lumber', size, L, ''); const plN = (wp.bottomPlates || 1) + (wp.topPlates || 2);
  return r2(n * studEach + plN * ((pl.amount || 0) + L * X.NP.plateLf * framingNails(X).per));
}

/** hit = { layerId, objectId, part, view, world } → popup data, or { none: reason } */
export function inspectInfo(X, hit) {
  if (X.C.mode !== 'hd') return { none: 'Home Depot price content (content-v4/v3) is not loaded — only placeholder prices are available, so nothing is priced here.' };
  const m = X.m; const o = findObject(m, hit); const l = getLayer(m, hit.layerId);
  if (!o || !l) return { none: 'Nothing priced here' };
  const part = hit.part || {}; let k = part.k; let mark = null;
  const out = (title, rows, extra = {}) => Object.assign({ title, rows: rows.filter(Boolean), layer: l.name, layerId: l.id, objectId: o.id, mark }, extra);
  if (l.kind === 'site' || o.type === 'label') return { none: `${o.props.label || 'Site'} — not a priced part`, layer: l.name };
  if (l.kind === 'custom') return { none: `${o.props.label || l.name}: custom layers have no price rule yet (not in takeoff-rules)`, layer: l.name };

  // ---- walls
  if (o.type === 'wall') {
    if (k === 'bottomPlate' || k === 'topPlate') {
      const L = plen(o); const ftype = getLayer(m, 'foundation').params.type;
      const pt = k === 'bottomPlate' && ftype === 'slab';
      const pu = framingNails(X);
      return out(`${fmtLen(L)} ${o.props.size} ${k === 'bottomPlate' ? 'bottom plate' : 'top plate'}`, [
        lumberRow(X, pt ? 'pt' : 'lumber', o.props.size, L, `${o.props.size} plate, ${fmtLen(L)}`),
        fastenerRow(X, L * X.NP.plateLf, pu, nailLabel(pu), `${X.NP.plateLf} per ft · ${TYPICAL}`),
      ], { typical: true, piece: [{ types: k === 'bottomPlate' ? ['bottom_plate'] : ['top_plate_lower', 'top_plate_upper'], size: o.props.size, lengthFt: L }], sub: `wall ${fmtLen(L)} · plates priced at the wall's centerline length, like Price check` });
    }
    let kind = k === 'king' || k === 'jack' ? k : 'stud';
    if (hit.view === 'plan' && hit.world) { const ns = nearestStud(X, o, hit.world); kind = ns.kind; mark = ns.mark; }
    const s = studInfo(X, o, kind);
    return out(s.title, s.rows, { typical: true, piece: [{ types: [{ king: 'king_stud', jack: 'jack_stud' }[kind] || 'stud'], size: o.props.size, lengthFt: s.pieceFt }], sub: `${o.props.exterior ? 'Exterior' : 'Interior'} wall, ${fmtLen(plen(o))}${k === 'wallSolid' ? ' · solid view: switch to Studs to point at single pieces' : ''}`, wallTotal: wallSummary(X, o) });
  }
  if (o.type === 'opening') {
    const w = l.objects.find((x) => x.id === o.geometry.wallId); const size = w ? w.props.size : '2x4';
    const D = X.D; const pr = o.props;
    if (k === 'header') {
      const mm = /(\d)-(2x\d+)/.exec(pr.header || '2-2x6'); const plies = +mm[1], hs = mm[2];
      const hLen = (pr.widthIn + 2 * D.walls.headerBearingIn) / 12;
      const row = lumberRow(X, 'lumber', hs, hLen, `${plies} × ${fmtLen(hLen)} ${hs}`); const per = row.amount;
      row.amount = per == null ? null : r2(per * plies); row.detail = row.detail.replace("this piece's share", `${plies} plies' share`).replace(/^cut from (\d+) ft/, 'cut from 8 ft');
      // headers come from 8 ft stock in the engine
      const up8 = X.unit(`lumber_${hs}_8`); if (up8 != null) { row.amount = r2(plies * up8 * hLen / 8); row.detail = `cut from 8 ft ${hs} at ${usd(up8)} — ${plies} plies' share`; row.est = !X.verified(`lumber_${hs}_8`); }
      const pu = framingNails(X);
      return out(`${fmtLen(hLen)} header ${pr.header || '2-2x6'} (EXAMPLE size, verify)`, [row, fastenerRow(X, plies * X.NP.headerPly, pu, nailLabel(pu), TYPICAL)], { typical: true, piece: [{ types: ['header_ply_first'], size: hs, lengthFt: hLen }, { types: ['header_ply_added'], size: hs, lengthFt: hLen, n: plies - 1 }], sub: `over the ${pr.widthIn} in ${pr.kind}` });
    }
    if (k === 'roughSill') {
      const L = pr.widthIn / 12; const up8 = X.unit(`lumber_${size}_8`);
      const pu = framingNails(X);
      return out(`${fmtLen(L)} ${size} rough sill`, [
        { label: `${size} rough sill, ${fmtLen(L)}`, detail: `cut from 8 ft ${size} at ${usd(up8)} — this piece's share`, amount: up8 == null ? null : r2(up8 * L / 8), est: !X.verified(`lumber_${size}_8`) },
        fastenerRow(X, X.NP.cripple, pu, nailLabel(pu), TYPICAL),
      ], { typical: true, piece: [{ types: ['rough_sill'], size, lengthFt: L }] });
    }
    const ref = `${pr.kind === 'door' ? 'door_ext' : 'window'}_${pr.widthIn}x${pr.heightIn}`;
    const ftLf = (pr.kind === 'door' ? (2 * pr.heightIn + pr.widthIn) : 2 * (pr.widthIn + pr.heightIn)) / 12 * D.envelope.flashingTapeFactor;
    const tape = X.unit('flashing_tape_4x75');
    const rows = [
      X.has(ref) ? wholeRow(X, ref, pr.kind === 'door' ? `Prehung exterior door ${pr.widthIn}×${pr.heightIn}` : `Window ${pr.widthIn}×${pr.heightIn}`) : { label: `${pr.kind} ${pr.widthIn}×${pr.heightIn}`, detail: 'no price for this size — pick a product', amount: null, est: true },
      { label: `${ftLf.toFixed(1)} ft flashing tape`, detail: `${usd(tape)} per 75 ft roll — this opening's share`, amount: tape == null ? null : r2(tape * ftLf / 75), est: !X.verified('flashing_tape_4x75') },
    ];
    return out(`${pr.widthIn}×${pr.heightIn} in ${pr.kind}`, rows, { sub: 'framing (header, jacks, kings) prices separately — point at those pieces' });
  }

  // ---- floor
  if (l.kind === 'floor') {
    const fp = l.params; const js = fp.joistSize; const role = o.props.role;
    if (role === 'sill') {
      const L = plen(o); const AB = X.D.anchorBolts;
      const bolts = Math.max(AB.minPerPlate, Math.ceil((L - 2 * AB.maxFromEndIn / 12) / AB.maxOcFt) + 1);
      const gas = X.unit('sill_gasket_2pk'); const gq = X.P.sill_gasket_2pk && X.P.sill_gasket_2pk.pack_qty;
      return out(`${fmtLen(L)} PT ${fp.sillSize} sill plate`, [
        lumberRow(X, 'pt', fp.sillSize, L, `PT ${fp.sillSize} sill, ${fmtLen(L)}`),
        fastenerRow(X, bolts, connector(X, 'anchor_bolt_50pk'), FASTENER_LABEL.anchor_bolt_50pk, `≤ ${AB.maxOcFt} ft o.c., ≤ ${AB.maxFromEndIn} in from ends (rules)`),
        { label: `${fmtLen(L)} sill gasket`, detail: `${usd(gas)} per ${gq ? '100 ft' : 'pack'} — this run's share`, amount: gas == null ? null : r2(gas * L / 100), est: !X.verified('sill_gasket_2pk'), keep: true },
      ], { piece: [{ types: ['sill_plate'], size: fp.sillSize, lengthFt: L }] });
    }
    if (role === 'rim') {
      const L = plen(o); const pu = framingNails(X);
      return out(`${fmtLen(L)} ${js} rim joist`, [lumberRow(X, 'lumber', js, L, `${js} rim, ${fmtLen(L)}`), fastenerRow(X, L * X.NP.rim_lf, pu, nailLabel(pu), `${X.NP.rim_lf} per ft · ${TYPICAL}`)], { typical: true, piece: [{ types: ['rim_joist'], size: js, lengthFt: L }] });
    }
    if (role === 'girder') {
      const L = plen(o); const plies = Math.round(o.props.widthIn / 1.5); const row = lumberRow(X, 'lumber', js, L, `${plies} × ${fmtLen(L)} ${js}`);
      if (row.amount != null) row.amount = r2(row.amount * plies);
      const scr = Math.ceil(L * 12 / 16) * 2;
      return out(`${fmtLen(L)} ${plies}-ply ${js} mid beam — FLAGGED, size by engineer`, [row, fastenerRow(X, scr, connector(X, 'screws_structural_12pk'), FASTENER_LABEL.screws_structural_12pk, '2 every 16 in (rules)')], { piece: [{ types: ['beam_ply_first'], size: js, lengthFt: L }, { types: ['beam_ply_added'], size: js, lengthFt: L, n: plies - 1 }], sub: 'Supports/posts not priced' });
    }
    if (o.type === 'joist') {
      const L = plen(o); const girders = l.objects.filter((x) => x.props && x.props.role === 'girder');
      const flush = girders.length && Math.abs(girders[0].z - o.z) < 0.1;
      const pieces = flush ? [(L - girders[0].props.widthIn / 12) / 2, (L - girders[0].props.widthIn / 12) / 2] : [L];
      const rows = pieces.map((p) => lumberRow(X, 'lumber', js, p, `${js} joist, ${fmtLen(p)}`));
      const pu = framingNails(X);
      rows.push(fastenerRow(X, pieces.length * X.NP.joist, pu, nailLabel(pu), TYPICAL));
      if (flush) {
        const href = `hanger_lus${js.replace('2x', '2')}`;
        if (X.has(href)) rows.push(wholeRow(X, href, `2 joist hangers (${href.replace('hanger_', '').toUpperCase()})`, `${usd(X.unit(href))} each`, 2));
        rows.push(fastenerRow(X, 24, connector(X, 'nails_connector_10d3_250'), FASTENER_LABEL.nails_connector_10d3_250, '12 per hanger (rules)'));
      }
      const tube = X.unit('subfloor_adhesive_28oz');
      rows.push({ label: `${fmtLen(L)} adhesive bead`, detail: `${usd(tube)} tube covers ~${X.D.floor.adhesiveLfPerTube} ft — share`, amount: tube == null ? null : r2(tube * L / X.D.floor.adhesiveLfPerTube), est: !X.verified('subfloor_adhesive_28oz') });
      return out(`${fmtLen(L)} ${js} floor joist${flush ? ' (cut at the mid beam)' : ''}`, rows, { typical: true, piece: [{ types: ['floor_joist'], size: js, lengthFt: pieces[0], n: pieces.length }] });
    }
    if (o.props.role === 'subfloor') {
      const area = polyArea(o.geometry.pts); const sheets = Math.ceil(area * (1 + (X.D.waste.sheathing || 0)) / X.D.floor.subfloorSheetSqFt);
      const pu = sheathingNails(X);
      const rows = [wholeRow(X, 'subfloor_2332_tg', '4×8 sheet 23/32 T&G subfloor'), fastenerRow(X, X.D.floor.sheathingNailsPerSheet, pu, nailLabel(pu), 'per sheet (rules)')];
      const per = rows.reduce((s, r) => s + (r.amount || 0), 0);
      return out('4×8 subfloor panel', rows, { piece: [{ types: ['subfloor_sheet'] }], sheets, sub: `whole floor: ${sheets} sheets ≈ ${usd(r2(per * sheets))}` });
    }
  }

  // ---- foundation
  if (l.kind === 'foundation') {
    const D = X.D; const mode = (X.est.report && X.est.report.concreteMode) || 'bags80';
    const concreteRow = (cuft, what) => {
      const v = cuft * (1 + (D.waste.concrete || 0));
      if (mode === 'readymix') { const up = X.unit('readymix_cy'); return { label: `${v.toFixed(2)} cu ft ready-mix concrete (${what}, +${(D.waste.concrete || 0) * 100}% waste)`, detail: `${usd(up)} per cu yd — share`, amount: up == null ? null : r2(up * v / 27), est: !X.verified('readymix_cy') }; }
      const ref = mode === 'bags60' ? 'concrete_60lb' : 'concrete_80lb'; const y = D.concrete.bagYieldCuFt[mode === 'bags60' ? '60' : '80']; const up = X.unit(ref);
      const bags = v / y;
      return { label: `${bags.toFixed(2)} bags ${mode === 'bags60' ? '60' : '80'} lb concrete`, detail: `${v.toFixed(2)} cu ft (${what}, +${(D.waste.concrete || 0) * 100}% waste) · ${usd(up)} per bag`, amount: up == null ? null : r2(up * bags), est: !X.verified(ref) };
    };
    const rebarRow = (lf, what) => { const up = X.unit('rebar_4_20'); return { label: `${lf.toFixed(1)} ft #4 rebar (EXAMPLE)`, detail: `${what} · ${usd(up)} per 20 ft bar — share`, amount: up == null ? null : r2(up * lf / D.rebar.stockFt), est: !X.verified('rebar_4_20') }; };
    if (o.type === 'pier') {
      const dia = o.props.diaIn, h = o.height; const vol = Math.PI * (dia / 24) ** 2 * h;
      const tref = D.formTube.diameterPriceRef[dia]; const need = h * 12 + D.formTube.extraIn; const tup = tref ? X.unit(tref) : null;
      const bars = D.rebar.pierVerticalsEXAMPLE.find((x) => dia <= x.maxDiaIn).bars; const blf = bars * (h * 12 - D.rebar.coverIn + D.rebar.pierDowelIntoBeamIn) / 12;
      const tie = X.unit('tie_wire_roll');
      const rows = [
        { label: `${need.toFixed(0)} in of ${dia} in Sonotube`, detail: tup == null ? `no price for a ${dia} in tube` : `${D.formTube.stockLengthIn} in tube at ${usd(tup)} — ${need > D.formTube.stockLengthIn ? 'needs an extension' : 'this pier\'s share'}`, amount: tup == null ? null : r2(tup * need / D.formTube.stockLengthIn), est: tref ? !X.verified(tref) : true },
        concreteRow(vol, `Ø${dia} in × ${fmtLen(h)}`),
        rebarRow(blf, `${bars} verticals × ${((h * 12 - D.rebar.coverIn + D.rebar.pierDowelIntoBeamIn) / 12).toFixed(2)} ft`),
        { tie: true, label: '2 rebar ties', detail: `tie-wire roll ${usd(tie)} / ~${D.rebar.tiesPerRollEstimate} ties`, amount: tie == null ? null : r2(tie * 2 / D.rebar.tiesPerRollEstimate), est: !X.verified('tie_wire_roll') },
      ];
      mark = { circle: [o.geometry.c, (dia / 12) / 2] };
      const fo = l.params;
      const site = (X.est.raw && X.est.raw.report) || {};
      const depthNote = X.depthNote ? X.depthNote(o) : (fo.frostDepthIn ? `bottom ${Math.round(-o.z * 12)} in below grade · frost ${fo.frostDepthIn} in${site.frostSource ? ` (${site.frostSource})` : ''}` : `frost depth unknown — drawn at the ${fo.placeholderFrostIn} in conservative placeholder (FLAGGED)`);
      return out(`Ø${dia} in Sonotube pier, ${fmtLen(h)} tall`, rows, { piece: [{ types: ['pier'], lengthFt: h }], sub: `${o.props.manual ? 'Manual' : 'Auto'} pier · ${depthNote}` });
    }
    if (o.type === 'beam' && o.props.role === 'gradeBeam') {
      const L = plen(o); const wIn = o.props.widthIn, dIn = l.params.gradeBeamDepthIn; const bars = D.rebar.gradeBeamBarsEXAMPLE.top + D.rebar.gradeBeamBarsEXAMPLE.bottom;
      const f2 = X.unit('lumber_2x12_16');
      return out(`${fmtLen(L)} grade beam ${wIn}×${dIn} in`, [concreteRow(L * wIn / 12 * dIn / 12, `${fmtLen(L)} × ${wIn}×${dIn} in`), rebarRow(bars * L, `${bars} bars × ${fmtLen(L)} (laps not shown)`),
        { label: `${(3 * L).toFixed(1)} ft 2x12 forms (reusable)`, detail: `16 ft 2x12 at ${usd(f2)} — share`, amount: f2 == null ? null : r2(f2 * 3 * L / 16), est: !X.verified('lumber_2x12_16') }], { piece: [{ types: ['grade_beam'], lengthFt: L }], sub: 'EXAMPLE section — engineer/plans govern' });
    }
    if (o.type === 'footing') {
      const L = plen(o); const vol = L * (o.props.widthIn / 12) * o.height;
      return out(`${fmtLen(L)} ${o.props.role === 'stem' ? 'stem wall' : 'footing'}`, [concreteRow(vol, `${fmtLen(L)} × ${o.props.widthIn} in × ${fmtLen(o.height)}`)], { sub: 'rebar/forms for footings are in Price check' });
    }
    if (o.type === 'area' && o.props.role === 'slab') {
      const a = polyArea(o.geometry.pts);
      return out(`${a.toFixed(0)} sq ft slab, ${fmtLen(o.height)} thick`, [concreteRow(a * o.height, `${a.toFixed(0)} sq ft`)]);
    }
  }

  // ---- roof
  if (l.kind === 'roof') {
    const rp = l.params; const rafters = l.objects.filter((x) => x.type === 'rafter');
    if (o.type === 'rafter') {
      const len = Math.hypot(plen(o), o.props.zB - o.props.zA); const idx = rafters.indexOf(o);
      const barge = idx < 2 || idx >= rafters.length - 2;
      const pu = framingNails(X);
      const rows = [lumberRow(X, 'lumber', rp.rafterSize, len, `${rp.rafterSize} rafter, ${fmtLen(len)}`), fastenerRow(X, X.NP.rafter, pu, nailLabel(pu), TYPICAL)];
      if (!barge) {
        rows.push(wholeRow(X, 'hurricane_h25a', '1 H2.5A hurricane tie', `${usd(X.unit('hurricane_h25a'))} each`));
        rows.push(fastenerRow(X, 10, connector(X, 'nails_connector_n8_150'), FASTENER_LABEL.nails_connector_n8_150, '10 per tie (rules)'));
      }
      return out(`${fmtLen(len)} ${rp.rafterSize} ${barge ? 'barge rafter' : 'rafter'}`, rows, { typical: true, piece: [{ types: barge ? ['rafter_barge', 'rafter'] : ['rafter'], size: rp.rafterSize, lengthFt: len }], sub: `pitch ${rp.pitch}:12, overhang ${rp.overhangIn} in${barge ? ' · barge/rake rafter: no hurricane tie' : ''}` });
    }
    if (o.props.role === 'ridge') {
      const L = plen(o); const rs = X.D.roof.ridgeOneSizeUp[rp.rafterSize]; const pu = framingNails(X);
      return out(`${fmtLen(L)} ${rs} ridge board`, [lumberRow(X, 'lumber', rs, L, `${rs} ridge, ${fmtLen(L)}`), fastenerRow(X, L * X.NP.ridge_lf, pu, nailLabel(pu), `${X.NP.ridge_lf} per ft · ${TYPICAL}`)], { typical: true, piece: [{ types: ['ridge_board'], size: rs, lengthFt: L }], sub: 'one size up from the rafters (rules)' });
    }
    if (o.props.role === 'outline') {
      const pu = sheathingNails(X); const R = X.D.roof;
      const rows = [wholeRow(X, 'osb_716_4x8', '4×8 sheet 7/16 OSB'), fastenerRow(X, R.sheathingNailsPerSheet, pu, nailLabel(pu), 'per sheet (rules)'), fastenerRow(X, R.sheathingClipsPerSheet, connector(X, 'h_clip_716_50'), FASTENER_LABEL.h_clip_716_50, 'per sheet (rules)')];
      const sheets = (X.est.report && X.est.report.roofSheets) || 0; const per = rows.reduce((s, r) => s + ((r && r.amount) || 0), 0);
      mark = { poly: o.geometry.pts };
      return out('4×8 roof sheathing panel', rows, { piece: [{ types: ['roof_sheet'] }], sheets, sub: sheets ? `whole roof: ${sheets} sheets ≈ ${usd(r2(per * sheets))} (${Math.ceil(sheets / 2)} per side)` : '' });
    }
  }
  return { none: `${o.props.label || o.type} — no per-piece price rule`, layer: l.name };
}

// ---------- Remodel Guide's fastener schedule: rebuild the popup from the engine's pieces[] (fastener-schedule.json
// counts + its hover copy). Engine pieces carry no app ids, so match by type + size + closest length.
function findPiece(X, spec) {
  const P = (X.est.pieces || []).filter((p) => spec.types.includes(p.type) && (!spec.size || !p.size || p.size === spec.size));
  if (!P.length) return null;
  const byType = spec.types.map((t) => P.filter((p) => p.type === t)).find((a) => a.length) || P;
  if (spec.lengthFt == null) return byType[0];
  let best = byType[0]; byType.forEach((p) => { if (Math.abs((p.length || 0) - spec.lengthFt) < Math.abs((best.length || 0) - spec.lengthFt)) best = p; });
  return best;
}
const lineEst = (X, id) => { const l = X.est.lines.find((x) => x.id === id); return !l || l.status !== 'hd'; };
function scheduleRows(X, piece, n) {
  return (piece.fasteners || []).map((f) => {
    const c = Math.round(f.count * n * 10) / 10;
    const per = f.kind === 'lf' || /\(lf\)/.test(f.label) ? '/lf' : ' each';
    return { label: `${c} x ${f.label}`, detail: `@ ${f.unitPrice == null ? 'PRICE NEEDED' : (f.unitPrice < 1 ? '$' + f.unitPrice.toFixed(3) : usd(f.unitPrice)) + per} — fastener-schedule.json`, amount: f.subtotal == null ? null : r2(f.subtotal * n), est: f.unitPrice == null || lineEst(X, f.bought_on), fastener: true, sched: true };
  });
}
export function applySchedule(X, info) {
  if (!info.piece || !(X.est.pieces && X.est.pieces.length)) return info;
  const specs = info.piece.filter((sp) => (sp.n == null ? 1 : sp.n) > 0);
  const found = specs.map((sp) => ({ sp, n: sp.n == null ? 1 : sp.n, p: findPiece(X, sp) }));
  if (found.some((f) => !f.p)) return info;
  let rows;
  if (found.every((f) => f.p.price != null)) {
    rows = [];
    found.forEach(({ p, n }) => {
      const len = p.length && p.type !== 'subfloor_sheet' && p.type !== 'roof_sheet' ? `, ${fmtLen(p.length)}` : '';
      const name = X.P[p.price_ref] ? X.P[p.price_ref].name : p.price_ref;
      rows.push({ label: `${n > 1 ? n + ' × ' : ''}${p.size ? p.size + ' ' : ''}${p.label.replace(/\s*\(.*\)$/, '')}${len}`, detail: `${n > 1 ? `${n} × ${usd(p.price)} · ` : ''}${p.priceBasis || 'one purchased unit'}${name ? ` — ${name}` : ''}`, amount: r2(p.price * n), est: !X.verified(p.price_ref), ref: p.price_ref });
      rows.push(...scheduleRows(X, p, n));
    });
    rows = rows.concat(info.rows.filter((r) => r.keep));
  } else {
    // concrete pieces: the engine prices concrete/rebar on the foundation lines; keep this pier's share rows, swap ties for the schedule
    rows = info.rows.filter((r) => !r.fastener && !r.tie);
    found.forEach(({ p, n }) => rows.push(...scheduleRows(X, p, n)));
    // The engine's hover copy for these pieces only totals the fasteners ("total $0.20"); finishInfo() rebuilds it
    // as material lines → fastener lines → the full per-piece total.
    info.sharedHover = found.map(({ p, n }) => ({ head: (n > 1 ? `${n} × ` : '') + (p.hover[0] || p.label), fast: p.hover.slice(2, -1) }));
  }
  info.rows = rows;
  info.hover = found.map(({ p, n }) => (n > 1 ? `${n} × ` : '') + p.hover.join(' · '));
  info.schedule = true; info.typical = false;
  if (info.sheets && info.sub) { const per = rows.reduce((s, r) => s + (r.amount || 0), 0); info.sub = info.sub.replace(/≈ \$[0-9,]+\.\d\d/, `≈ ${usd(r2(per * info.sheets))}`); }
  return info;
}

export function finishInfo(X, info) {
  if (info.none) return info;
  applySchedule(X, info);
  info.total = r2(info.rows.reduce((s, r) => s + (r.amount || 0), 0));
  info.est = info.rows.some((r) => r.est) || info.rows.some((r) => r.amount == null);
  if (info.sharedHover) { // materials priced on shared (foundation) lines: show this piece's share of each, then fasteners, then the full total
    const mats = info.rows.filter((r) => !r.fastener).map((r) => `${r.label} = ${r.amount == null ? 'PRICE NEEDED' : usd(r.amount)}${r.est ? ' est.' : ''}`);
    const fast = info.sharedHover.flatMap((h) => h.fast);
    info.hover = [[info.sharedHover.map((h) => h.head).join(' + '), ...mats, ...fast, `total ${usd(info.total)}${info.est ? ' est.' : ''}`].join(' · ')];
  }
  const g = X.est.groups.find((x) => x.id === info.layerId);
  if (g) info.layerSubtotal = { name: g.name, total: g.total };
  const T = X.est.totals || {};
  info.taxNote = T.taxSet ? `Before sales tax (${T.taxRatePct}%, ${T.taxSource === 'user' ? 'your rate' : T.taxSource})` : 'Before sales tax (rate unknown — enter your ZIP)';
  info.snapshot = X.C.snapshotDate ? `Home Depot online price, checked ${niceDate(X.C.snapshotDate)}, not localized` : 'PLACEHOLDER prices — not real Home Depot prices';
  return info;
}

export function infoHTML(info) {
  if (info.loading) return '<div class="ip-none">Loading prices…</div>';
  if (info.none) return `<div class="ip-none">${esc(info.none)}</div>`;
  const rows = info.rows.map((r) => `<div class="ip-row${r.fastener ? ' ip-fast' : ''}"><div class="ip-l"><b>${esc(r.label)}</b><span>${esc(r.detail || '')}</span></div><div class="ip-v">${usd(r.amount)}${r.est ? ' <span class="ph est">est.</span>' : ''}</div></div>`).join('');
  return `<div class="ip-head"><div class="ip-title">${esc(info.title)}</div>${info.sub ? `<div class="ip-sub">${esc(info.sub)}</div>` : ''}</div>
<div class="ip-rows">${rows}</div>
<div class="ip-total"><span>Total for this piece</span><b data-total="${info.total}">${usd(info.total)}${info.est ? ' <span class="ph est">est.</span>' : ''}</b></div>
${info.wallTotal != null ? `<div class="ip-meta">This whole wall's studs + plates + nails ≈ ${usd(info.wallTotal)}</div>` : ''}
${info.layerSubtotal ? `<div class="ip-meta">${esc(info.layerSubtotal.name)} in Price check: ${usd(info.layerSubtotal.total)}</div>` : ''}
${info.typical ? '<div class="ip-meta">Nail counts are typical (EXAMPLE schedule, cf. IRC Table R602.3(1)) — verify.</div>' : ''}
${info.schedule ? '<div class="ip-meta ip-sched">Fastener counts: Remodel Guide fastener-schedule.json (2024 IRC as adopted in MT, Table R602.3(1) + manufacturer instructions) — EXAMPLE, verify.</div>' : ''}
${info.hover && info.hover.length ? `<div class="ip-hover" data-hover>${info.hover.map((h) => `<div>${esc(h)}</div>`).join('')}</div>` : ''}
<div class="ip-src">${esc(info.snapshot)}. Fasteners: box price ÷ count.${info.taxNote ? ' ' + esc(info.taxNote) + '.' : ''}</div>`;
}

// ---------- UI controller
export function createInspector({ app, plan, v3, stage, button }) {
  let on = false, C = null, est = null, X = null, lastHit = null, lastEv = null, pinned = false;
  const pop = document.createElement('div'); pop.id = 'inspectPop'; pop.className = 'inspectPop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-live', 'polite');
  document.body.appendChild(pop);
  async function ctx() {
    if (!C) C = await getContentCached();
    if (!est) { est = runEstimate(app.getModel(), C, app.estimateOverride ? app.estimateOverride() : {}); X = makeCtx(app.getModel(), C, est); if (app.decorateInspect) app.decorateInspect(X); }
    return X;
  }
  function place(ev) {
    const pad = 8, vw = window.innerWidth, vh = window.innerHeight;
    pop.style.left = '0px'; pop.style.top = '0px'; pop.style.maxWidth = Math.min(360, vw - 2 * pad) + 'px';
    const r = pop.getBoundingClientRect();
    const touch = ev && ev.pointerType && ev.pointerType !== 'mouse';
    const x0 = ev ? ev.clientX : vw / 2, y0 = ev ? ev.clientY : vh / 2;
    let x = touch ? x0 - r.width / 2 : x0 + 18, y = touch ? y0 - r.height - 24 : y0 + 18;
    if (!touch && x + r.width > vw - pad) x = x0 - r.width - 14;
    if (!touch && y + r.height > vh - pad) y = y0 - r.height - 14;
    if (touch && y < pad) y = y0 + 28;
    x = Math.max(pad, Math.min(vw - r.width - pad, x)); y = Math.max(pad, Math.min(vh - r.height - pad, y));
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
  }
  async function show(hit, ev) {
    if (!hit) { if (!pinned) { lastHit = null; pop.hidden = true; plan.setInspectMark(null); } return; } // a touch pointerleave must not cancel a pinned tap
    lastHit = hit; lastEv = ev && { clientX: ev.clientX, clientY: ev.clientY, pointerType: ev.pointerType };
    pinned = !!(ev && ev.pointerType && ev.pointerType !== 'mouse') || (ev && ev.type === 'pointerup');
    if (!X) { pop.innerHTML = infoHTML({ loading: true }); pop.hidden = false; place(lastEv); }
    let info;
    try { const x = await ctx(); if (lastHit !== hit) return; info = finishInfo(x, inspectInfo(x, hit)); }
    catch (err) { console.error(err); info = { none: 'Could not load prices: ' + (err && err.message || err) }; }
    if (!on) return;
    pop.innerHTML = infoHTML(info) + (pinned ? '<button class="ip-x" aria-label="Close">×</button>' : '');
    const x = pop.querySelector('.ip-x'); if (x) x.addEventListener('click', (e) => { e.stopPropagation(); pinned = false; pop.hidden = true; plan.setInspectMark(null); v3.clearInspect && v3.clearInspect(); });
    pop.dataset.objectId = hit.objectId || ''; pop.dataset.kind = (hit.part && hit.part.k) || '';
    pop.hidden = false; place(lastEv);
    if (hit.view === 'plan') plan.setInspectMark(info.mark || markFor(hit)); else plan.setInspectMark(null);
    window.__lastInspect = info;
  }
  function markFor(hit) {
    const o = findObject(app.getModel(), hit); if (!o || !o.geometry) return null;
    const g = o.geometry;
    if (g.c && o.type === 'pier') return { circle: [g.c, (o.props.diaIn / 12) / 2] };
    if (g.a && g.b) return { seg: [g.a, g.b], wFt: (o.props.widthIn || (o.props.thicknessIn) || 1.5) / 12 };
    if (g.pts) return { poly: g.pts };
    if (o.type === 'opening') { const w = getLayer(app.getModel(), 'walls').objects.find((x) => x.id === g.wallId); if (w) { const L = plen(w), t0 = (g.t - o.props.widthIn / 24) / L, t1 = (g.t + o.props.widthIn / 24) / L; const P = (t) => [w.geometry.a[0] + (w.geometry.b[0] - w.geometry.a[0]) * t, w.geometry.a[1] + (w.geometry.b[1] - w.geometry.a[1]) * t]; return { seg: [P(t0), P(t1)], wFt: w.props.thicknessIn / 12 }; } }
    return null;
  }
  function set(v) {
    if (!!v === on) return;
    on = !!v; pinned = false;
    document.body.classList.toggle('inspecting', on);
    if (app.onInspect) app.onInspect(on); // park / restore selection, tool and 3D add mode
    button.setAttribute('aria-pressed', on); button.classList.toggle('on', on);
    button.title = on ? 'Price inspect on — point at a part (Esc or $ to exit)' : 'Price inspect: point at any part to see what it costs';
    if (!on) { pop.hidden = true; plan.setInspectMark(null); v3.clearInspect && v3.clearInspect(); lastHit = null; }
    plan.render(); if (v3.setInspecting) v3.setInspecting(on); // hide / restore edit handles + gizmos
    else { est = null; X = null; ctx().catch(() => {}); app.toast('$ Price inspect on — ' + (matchMedia('(pointer: coarse)').matches ? 'tap' : 'point at') + ' any part. Esc or $ to exit'); }
  }
  button.addEventListener('click', (e) => { e.stopPropagation(); set(!on); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) { e.stopPropagation(); set(false); } }, true);
  return {
    isOn: () => on, set, show,
    invalidate() { est = null; X = null; if (on && lastHit) show(lastHit, lastEv); },
    current: () => (pop.hidden ? null : { html: pop.innerHTML, rect: pop.getBoundingClientRect().toJSON() }),
  };
}
