// node reference/run-example.mjs -> prints the 20x16 example for ZIP 59833 and writes example-20x16.takeoff.json
// v4: frost depth + tax come from ../jurisdictions.json (zip 59833). The base model is the app's regenerate()
// output with foundation.params.frostDepthIn = 36 (example-20x16-frost36.model.json).
// v4 fasteners: ../fastener-schedule.json is passed as opts.fastenerSchedule -> per-piece records ($ inspect hover data)
// in example-20x16.pieces.json and code-count fastener purchase lines. "legacyFasteners" = same run without the schedule.
import fs from 'fs';
import { takeoff, resolveJurisdiction } from './takeoff-reference.mjs';
const rd = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url)));
const rules = rd('../takeoff-rules.json'), prices = rd('../homedepot-prices.json'), jdoc = rd('../jurisdictions.json'), fastenerSchedule = rd('../fastener-schedule.json');
const J = resolveJurisdiction(jdoc, '59833');
const O = { jurisdiction: J, fastenerSchedule };
const base = takeoff(rd('./example-20x16-frost36.model.json'), rules, prices, O);
const legacy = takeoff(rd('./example-20x16-frost36.model.json'), rules, prices, { jurisdiction: J });
const clear = takeoff(rd('./example-20x16-2x12-clearspan-frost36.model.json'), rules, prices, O);
const bags = takeoff(rd('./example-20x16-frost36.model.json'), rules, prices, { ...O, concreteMode: 'bags80' });
// v3 baseline for comparison: 24 in placeholder piers + 9.15% EXAMPLE Denver tax, v3 (legacy) fasteners
const v3 = takeoff(rd('./example-20x16.model.json'), rules, prices, { taxRatePct: 9.15 });
const d = (a, b) => +(a - b).toFixed(2);
// lines whose cost the schedule replaces (legacy) vs the new fast.* lines
const legacyFastIds = (l) => l.id.startsWith('fast.') || l.id === 'roof.nails' || (l.id === 'roof.underlayment' && l.price_ref === 'cap_nails_2000') || (l.id === 'floor.hangers' && l.price_ref.startsWith('nails_')) || (l.id === 'roof.hurricaneTies' && l.price_ref.startsWith('nails_')) || (l.id === 'floor.girder' && l.price_ref.startsWith('screws_'));
const sum = (ls) => +ls.reduce((s, l) => s + (l.ext || 0), 0).toFixed(2);
const fastCmp = { legacy_lines: legacy.lines.filter(legacyFastIds).map((l) => ({ id: l.id, price_ref: l.price_ref, buy: l.buy, ext: l.ext })), legacy_cost: sum(legacy.lines.filter(legacyFastIds)),
  schedule_lines: base.lines.filter((l) => l.id.startsWith('fast.')).map((l) => ({ id: l.id, price_ref: l.price_ref, buy: l.buy, ext: l.ext })), schedule_cost: sum(base.lines.filter((l) => l.id.startsWith('fast.'))) };
fastCmp.delta_fastener_cost = d(fastCmp.schedule_cost, fastCmp.legacy_cost);
const out = { zip: '59833', jurisdiction: J.jurisdiction.id, EXAMPLE: 'all dollar amounts are EXAMPLE (HD default online store, not localized to Missoula #3102)', base: { ...base, pieces: `see example-20x16.pieces.json (${base.pieces.length} pieces)` },
  fastenersVsLegacy: { legacy_total: legacy.totals.total, total: base.totals.total, delta_total: d(base.totals.total, legacy.totals.total), delta_materials: d(base.totals.materials, legacy.totals.materials), delta_contingency: d(base.totals.contingency, legacy.totals.contingency), groups_legacy: legacy.groups, ...fastCmp },
  vsV3: { v3_total: v3.totals.total, v3_materials: v3.totals.materials, v3_tax: v3.totals.tax, v3_contingency: v3.totals.contingency,
    delta_total: d(base.totals.total, v3.totals.total), delta_materials: d(base.totals.materials, v3.totals.materials),
    delta_tax: d(base.totals.tax, v3.totals.tax), delta_contingency: d(base.totals.contingency, v3.totals.contingency) },
  deltas: {
    clearSpan2x12NoBeam: { total: clear.totals.total, delta: d(clear.totals.total, base.totals.total) },
    bagged80lbInsteadOfReadyMix: { total: bags.totals.total, delta: d(bags.totals.total, base.totals.total) } } };
fs.writeFileSync(new URL('./example-20x16.takeoff.json', import.meta.url), JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('./example-20x16.pieces.json', import.meta.url), JSON.stringify({ EXAMPLE: out.EXAMPLE, schedule: fastenerSchedule.version, fasteners: base.fasteners, pieces: base.pieces }, null, 1));
for (const l of base.lines) console.log(`${l.id.padEnd(22)} ${String(l.buy).padStart(4)} x ${String(l.unit_price).padStart(7)} = ${String(l.ext).padStart(8)} ${l.verified ? ' ' : 'E'} ${l.price_ref}  | ${l.desc}`);
console.log(JSON.stringify(base.groups), '\n', JSON.stringify(base.totals, null, 1), '\n', JSON.stringify(base.report), '\n', JSON.stringify(base.concreteAlternatives), '\n', JSON.stringify(out.fastenersVsLegacy, null, 1), '\n', JSON.stringify(out.vsV3, null, 1), '\n', JSON.stringify(out.deltas, null, 1), '\n', base.flags.join('\n'));
