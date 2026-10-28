// ============================================================================
// takeoff.js — quantities from the model. Two halves:
//   measure(m)  → plain numbers / maps measured off the model (code: geometry)
//   takeoff(m, rules, prices) → material lines (data: content/takeoff-rules.json says
//               which metric buys which item, waste %, pack size, rounding)
// Nothing here knows a price; prices come from the price table (placeholder by default).
// ============================================================================
import { LUMBER, LUMBER_T_IN } from './config.js';
import { getLayer } from './model.js';
import { dist, bbox, offsetPolygon, signedArea, pointInPoly, fmtFtIn } from './geom.js';
import { studLayout } from './homeplan-derived.js';

const IN = 1 / 12;
const STOCK = [8, 10, 12, 14, 16, 20];
/** smallest stock length that fits len (ft); longer members split into 16s */
export function stockFor(len, stock = STOCK) {
  const need = len + 0.04;
  const s = stock.find((x) => x >= need);
  if (s) return [{ ft: s, n: 1 }];
  const n = Math.ceil(need / 16); return [{ ft: 16, n }];
}
const addMap = (map, k, n = 1) => { map[k] = (map[k] || 0) + n; };
const r2 = (x) => Math.round(x * 100) / 100;
const polyArea = (pts) => Math.abs(signedArea(pts));
const perim = (pts) => pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0);
const sizeOfHeader = (h) => { const m = String(h || '2-2x8').match(/(\d)-(2x\d+)/); return m ? { plies: Number(m[1]), size: m[2] } : { plies: 2, size: '2x8' }; };
const precutFor = (plateFt) => ({ 8: '92', 9: '104', 10: '116' })[Math.round(plateFt)] || null;

/** Everything the rules and the build steps can refer to. */
export function measure(m) {
  const fnd = getLayer(m, 'foundation'), floor = getLayer(m, 'floor'), walls = getLayer(m, 'walls'), roof = getLayer(m, 'roof');
  const f = fnd.params, fl = floor.params, wp = walls.params, rp = roof.params;
  const fp = m.footprint; const fb = bbox(fp);
  const M = { maps: {} };
  const map = (k) => (M.maps[k] = M.maps[k] || {});
  // ---- general
  M.footprintAreaSf = r2(polyArea(fp));
  M.footprintPerimeterFt = r2(perim(fp));
  M.footprintW = r2(fb.w); M.footprintD = r2(fb.h);
  M.diagonalFt = r2(Math.hypot(fb.w, fb.h));
  M.corners = fp.length;
  M.foundationType = f.type;
  M.frostEntered = f.frostDepthIn != null && f.frostDepthIn !== '';
  M.frostDepthIn = M.frostEntered ? Number(f.frostDepthIn) : f.placeholderFrostIn;

  // ---- foundation
  const piers = fnd.objects.filter((o) => o.type === 'pier');
  M.pierCount = piers.length;
  M.pierConcreteCf = r2(piers.reduce((s, o) => s + Math.PI * Math.pow((o.props.diaIn * IN) / 2, 2) * o.height, 0));
  M.pierRebarLf = r2(piers.reduce((s, o) => s + 4 * Math.max(1, o.height - 3 * IN), 0));   // 4 verticals, 3 in cover
  const tubes = map('sonotubes'); piers.forEach((o) => addMap(tubes, `${o.props.diaIn}`, Math.ceil(o.height / 4 - 1e-6)));
  M.pierDiaList = Array.from(new Set(piers.map((o) => o.props.diaIn))).sort((a, b) => a - b).join(' / ');
  M.pierDepthText = `${fmtFtIn(M.frostDepthIn * IN)}${M.frostEntered ? '' : ' (PLACEHOLDER — enter your frost depth)'}`;
  M.pierManual = piers.filter((o) => !o.derivedFrom).length;
  const gb = fnd.objects.filter((o) => o.type === 'beam' && o.props.role === 'gradeBeam');
  M.gradeBeamLf = r2(gb.reduce((s, o) => s + dist(o.geometry.a, o.geometry.b), 0));
  M.gradeBeamCf = r2(gb.reduce((s, o) => s + dist(o.geometry.a, o.geometry.b) * o.props.widthIn * IN * o.height, 0));
  M.gradeBeamDepthIn = f.gradeBeamDepthIn; M.gradeBeamWidthIn = f.gradeBeamWidthIn;
  const footings = fnd.objects.filter((o) => o.type === 'footing' && o.props.role !== 'stem');
  const stems = fnd.objects.filter((o) => o.type === 'footing' && o.props.role === 'stem');
  M.footingLf = r2(footings.reduce((s, o) => s + dist(o.geometry.a, o.geometry.b), 0));
  M.footingCf = r2(footings.reduce((s, o) => s + dist(o.geometry.a, o.geometry.b) * o.props.widthIn * IN * o.height, 0));
  M.stemLf = r2(stems.reduce((s, o) => s + dist(o.geometry.a, o.geometry.b), 0));
  M.stemCf = r2(stems.reduce((s, o) => s + dist(o.geometry.a, o.geometry.b) * o.props.widthIn * IN * o.height, 0));
  M.stemHeightFt = stems.length ? r2(stems[0].height) : 0;
  M.stemFormSf = r2(M.stemLf * 2 * M.stemHeightFt);
  const slabs = fnd.objects.filter((o) => o.type === 'area' && o.props.role === 'slab');
  M.slabAreaSf = r2(slabs.reduce((s, o) => s + polyArea(o.geometry.pts), 0));
  M.slabCf = r2(slabs.reduce((s, o) => s + polyArea(o.geometry.pts) * o.height, 0));
  M.concreteCf = r2(M.pierConcreteCf + M.gradeBeamCf + M.footingCf + M.stemCf + M.slabCf);
  M.concreteCy = r2(M.concreteCf / 27);
  M.contRebarLf = r2((M.gradeBeamLf * 4 + M.footingLf * 2 + M.stemLf * 2) * 1.1);   // continuous bars + 10% laps
  // anchor bolts: ≤ 6 ft o.c. and within 12 in of each end, on every bearing line
  const lines = walls.objects.filter((o) => o.type === 'wall' && (o.props.exterior || o.props.bearing));
  M.anchorBolts = lines.reduce((s, o) => s + Math.ceil(dist(o.geometry.a, o.geometry.b) / 6) + 1, 0);
  M.formLf = r2(M.gradeBeamLf * 2 + (f.type === 'crawlspace' || f.type === 'basement' ? M.stemLf * 2 : 0) + (f.type === 'slab' ? M.footprintPerimeterFt : 0));

  // ---- floor framing
  const fo = floor.objects;
  const len = (o) => dist(o.geometry.a, o.geometry.b);
  const sills = fo.filter((o) => o.props.role === 'sill');
  const rims = fo.filter((o) => o.props.role === 'rim');
  const girders = fo.filter((o) => o.props.role === 'girder');
  let joists = fo.filter((o) => o.type === 'joist' && o.props.role !== 'rim');
  M.sillLf = r2(sills.reduce((s, o) => s + len(o), 0));
  M.rimLf = r2(rims.reduce((s, o) => s + len(o), 0));
  M.girderLf = r2(girders.reduce((s, o) => s + len(o), 0));
  M.girderPlyLf = r2(M.girderLf * 3);
  M.joistSize = fl.joistSize; M.joistOcIn = fl.joistOcIn; M.sillSize = fl.sillSize;
  M.joistSpanFt = r2((fl.computed && fl.computed.spanFt) || 0);
  // with a mid girder the joists land on it from both sides: two shorter joists + 2 hangers each crossing
  const jStock = map('joistStock'); let jPieces = 0, crossings = 0;
  joists.forEach((o) => {
    const L = len(o);
    const g = girders.find((b) => segCross(o.geometry.a, o.geometry.b, b.geometry.a, b.geometry.b));
    const parts = g ? splitAt(o, g) : [L];
    if (g) crossings++;
    parts.forEach((p) => stockFor(p).forEach((s) => { addMap(jStock, `${fl.joistSize}-${s.ft}`, s.n); jPieces += s.n; }));
  });
  M.joistCount = joists.length; M.joistPieces = jPieces;
  M.joistHangers = crossings * 2;
  M.subfloorAreaSf = r2(fo.filter((o) => o.props.role === 'subfloor').reduce((s, o) => s + polyArea(o.geometry.pts), 0));
  M.hasFloorFraming = joists.length > 0 ? 1 : 0;
  const boards = (size, lf) => (lf > 0 ? { [`${size}-16`]: Math.ceil((lf * 1.05) / 16) } : {});
  M.maps.sillBoards = boards(fl.sillSize, M.sillLf);
  M.maps.rimBoards = boards(fl.joistSize, M.rimLf);
  M.maps.girderBoards = boards(fl.joistSize, M.girderPlyLf);
  M.maps.hangers = M.joistHangers ? { [fl.joistSize]: M.joistHangers } : {};

  // ---- walls
  const wl = walls.objects.filter((o) => o.type === 'wall');
  const ops = walls.objects.filter((o) => o.type === 'opening');
  const plateFt = wp.plateHeightFt; M.plateHeightFt = plateFt;
  M.extWallSize = wp.extSize; M.intWallSize = wp.intSize; M.studOcIn = wp.studOcIn;
  const studs = map('studs'); const plates = map('plates'); const headers = map('headers');
  let studTotal = 0;
  const pre = precutFor(plateFt);
  const studKey = (size) => (pre ? `${size}-precut${pre}` : `${size}-${stockFor(plateFt)[0].ft}`);
  M.extWallLf = 0; M.intWallLf = 0;
  wl.forEach((w) => {
    const L = len(w); const t = w.props.thicknessIn * IN; const ext = w.props.exterior ? t / 2 : 0; const L2 = L + 2 * ext;
    const size = w.props.size || (w.props.exterior ? wp.extSize : wp.intSize);
    if (w.props.exterior) M.extWallLf += L2; else M.intWallLf += L;
    const myOps = ops.filter((o) => o.geometry.wallId === w.id).map((o) => ({ o, center: o.geometry.t + ext, widthFt: o.props.widthIn * IN }));
    const lay = studLayout(L2, (w.props.studOcIn || 16) * IN, myOps);
    let n = lay.studs.length + lay.kings.length + lay.jacks.length;
    myOps.forEach((op) => {
      const cr = Math.max(0, Math.ceil(op.widthFt / ((w.props.studOcIn || 16) * IN)) - 1);
      if (op.o.props.kind === 'window') n += cr + 1;            // sill cripples (cut from studs)
      const hd = sizeOfHeader(op.o.props.header);
      stockFor(op.widthFt + 3 * IN).forEach((s) => addMap(headers, `${hd.size}-${s.ft}`, s.n * hd.plies));
      if (op.o.props.kind === 'window') addMap(plates, size, op.widthFt);   // rough sill
    });
    if (w.props.exterior) n += 2;                                 // corner backers
    else n += 4;                                                  // where it tees into another wall (both ends)
    addMap(studs, studKey(size), n); studTotal += n;
    addMap(plates, size, L2 * ((wp.bottomPlates || 1) + (wp.topPlates || 2)));
  });
  M.extWallLf = r2(M.extWallLf); M.intWallLf = r2(M.intWallLf);
  M.studCount = studTotal;
  Object.keys(plates).forEach((k) => { plates[k] = r2(plates[k]); });
  M.maps.plateBoards = Object.fromEntries(Object.entries(plates).map(([k, lf]) => [`${k}-16`, Math.ceil((lf * 1.05) / 16)]));
  M.plateLf = r2(Object.values(plates).reduce((s, x) => s + x, 0));
  const extOps = ops.filter((o) => { const w = wl.find((x) => x.id === o.geometry.wallId); return w && w.props.exterior; });
  const opArea = extOps.reduce((s, o) => s + o.props.widthIn * o.props.heightIn / 144, 0);
  M.wallSheathSf = r2(Math.max(0, M.footprintPerimeterFt * (plateFt + (M.hasFloorFraming ? (LUMBER[fl.joistSize] + LUMBER_T_IN) * IN : 0)) - opArea));
  M.openingCount = ops.length;
  const doorsExt = map('doorsExt'), doorsInt = map('doorsInt'), wins = map('windows');
  ops.forEach((o) => {
    const w = wl.find((x) => x.id === o.geometry.wallId);
    const k = `${o.props.widthIn}x${o.props.heightIn}`;
    if (o.props.kind === 'door') addMap(w && w.props.exterior ? doorsExt : doorsInt, k); else addMap(wins, k);
  });
  M.doorCount = ops.filter((o) => o.props.kind === 'door').length;
  M.windowCount = ops.filter((o) => o.props.kind === 'window').length;
  M.openingList = ops.map((o) => `${o.props.kind} ${o.props.widthIn}"×${o.props.heightIn}" (RO ${o.props.widthIn + 2}"×${o.props.heightIn + (o.props.kind === 'door' ? 2.5 : 2)}", header ${o.props.header || '—'} EXAMPLE)`).join('; ') || 'none drawn yet';

  // ---- roof
  const rafters = roof.objects.filter((o) => o.type === 'rafter');
  const rStock = map('rafterStock');
  rafters.forEach((o) => { const L = Math.hypot(dist(o.geometry.a, o.geometry.b), o.props.zB - o.props.zA) + 0.5; stockFor(L).forEach((s) => addMap(rStock, `${o.props.size}-${s.ft}`, s.n)); });
  M.rafterCount = rafters.length; M.rafterSize = rp.rafterSize; M.rafterOcIn = rp.rafterOcIn; M.pitch = rp.pitch;
  const ridge = roof.objects.find((o) => o.props && o.props.role === 'ridge');
  M.ridgeLf = ridge ? r2(len(ridge)) : 0;
  const ridgeSize = { '2x6': '2x8', '2x8': '2x10', '2x10': '2x12', '2x12': '2x12' }[rp.rafterSize] || '2x10';
  M.ridgeSize = ridgeSize;
  M.maps.ridgeStock = {}; if (ridge) stockFor(M.ridgeLf).forEach((s) => addMap(M.maps.ridgeStock, `${ridgeSize}-${s.ft}`, s.n));
  const outline = roof.objects.find((o) => o.props && o.props.role === 'outline');
  const slopeK = Math.sqrt(1 + Math.pow(rp.pitch / 12, 2));
  M.roofPlanSf = outline ? r2(polyArea(outline.geometry.pts)) : 0;
  M.roofSf = r2(M.roofPlanSf * slopeK);
  M.roofSquares = r2(M.roofSf / 100);
  M.rafterRiseFt = r2((roof.params.computed && roof.params.computed.rise) || 0);
  const ob = outline ? bbox(outline.geometry.pts) : null;
  const along = roof.params.computed && roof.params.computed.ridgeAlongX;
  M.eaveLf = ob ? r2(2 * (along ? ob.w : ob.h)) : 0;
  M.rakeLf = ob ? r2(2 * (along ? ob.h : ob.w) * slopeK) : 0;
  M.dripEdgeLf = r2(M.eaveLf + M.rakeLf);
  // rafter ties / ceiling joists: one per rafter pair across the building (not drawn in the model)
  const pairs = Math.floor(rafters.length / 2);
  const tieSpan = along ? fb.h : fb.w;
  M.tieCount = pairs; M.tieSpanFt = r2(tieSpan);
  M.maps.tieStock = {}; stockFor(tieSpan).forEach((s) => addMap(M.maps.tieStock, `2x6-${s.ft}`, s.n * pairs));
  M.hurricaneTies = rafters.length;
  // sheathing counts (4x8 sheets, before waste) for fasteners
  M.wallSheets = Math.ceil(M.wallSheathSf / 32); M.roofSheets = Math.ceil(M.roofSf / 32); M.subfloorSheets = Math.ceil(M.subfloorAreaSf / 32);
  M.memberCount = M.studCount + M.joistPieces + M.rafterCount + M.tieCount;
  return M;
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function splitAt(j, g) {
  const a = j.geometry.a, b = j.geometry.b, c = g.geometry.a, d = g.geometry.b;
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const L = dist(a, b); return [L * t, L * (1 - t)];
}

/** Does a rule apply to this model? */
function applies(rule, M) {
  const w = rule.when || {};
  if (w.foundationType && !w.foundationType.includes(M.foundationType)) return false;
  if (w.metricPositive && !(M[w.metricPositive] > 0)) return false;
  return true;
}
const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? (typeof vars[k] === 'number' ? String(Math.round(vars[k] * 100) / 100) : vars[k]) : `{${k}}`));

/**
 * Apply the rules. Each rule (see content/takeoff-rules.json):
 *  - terms: [{metric, factor}]  → raw = Σ M[metric]·factor   (one item: rule.item)
 *  - or map: "joistStock"       → one line per key, item = itemTemplate with {key}
 *  qty = round( raw · (1 + wastePct/100) / (packSize || 1) )
 */
export function takeoff(m, rules, prices) {
  const M = measure(m);
  const lines = [];
  const missing = [];
  rules.rules.forEach((r) => {
    if (!applies(r, M)) return;
    const rows = [];
    if (r.map) {
      Object.entries(M.maps[r.map] || {}).forEach(([key, n]) => rows.push({ item: fill(r.itemTemplate, { key }), raw: n, key }));
    } else {
      const raw = (r.terms || []).reduce((s, t) => s + (Number(M[t.metric]) || 0) * (t.factor == null ? 1 : t.factor), 0);
      rows.push({ item: r.item, raw });
    }
    rows.forEach((row) => {
      if (!(row.raw > 0)) return;
      let q = row.raw * (1 + (r.wastePct || 0) / 100) / (r.packSize || 1);
      q = r.round === 'none' ? Math.round(q * 100) / 100 : Math.ceil(q - 1e-9);
      if (r.min) q = Math.max(q, r.min);
      const p = prices.items[row.item] || prices.items[row.item.replace(/-[^-]+$/, '-*')];
      if (!p) missing.push(row.item);
      const unitPrice = p ? p.price : 0;
      lines.push({
        ruleId: r.id, layer: r.layer, item: row.item, qty: q, unit: (p && p.unit) || r.unit || 'ea',
        name: p ? fill(p.name, { key: row.key || '' }) : row.item,
        unitPrice, total: Math.round(unitPrice * q * 100) / 100,
        placeholder: !p || p.placeholder !== false, source: p && p.source, sourceDate: p && p.sourceDate,
        search: p && p.search ? p.search : (p ? p.name : row.item),
        basis: fill(r.basis, Object.assign({ raw: Math.round(row.raw * 100) / 100, key: row.key || '' }, M)),
        flag: r.flag || null,
      });
    });
  });
  const LAYERS = rules.layers || [{ id: 'foundation', name: 'Foundation' }, { id: 'floor', name: 'Floor framing' }, { id: 'walls', name: 'Walls' }, { id: 'roof', name: 'Roof' }];
  const byLayer = LAYERS.map((L) => { const ls = lines.filter((x) => x.layer === L.id); return { id: L.id, name: L.name, lines: ls, total: Math.round(ls.reduce((s, x) => s + x.total, 0) * 100) / 100 }; }).filter((g) => g.lines.length);
  const total = Math.round(byLayer.reduce((s, g) => s + g.total, 0) * 100) / 100;
  return { M, lines, byLayer, total, missing: Array.from(new Set(missing)), allPlaceholder: lines.every((x) => x.placeholder), anyPlaceholder: lines.some((x) => x.placeholder) };
}
export { fill };
