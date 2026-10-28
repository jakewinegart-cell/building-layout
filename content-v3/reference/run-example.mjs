// node run-example.mjs  -> prints the 20x16 example and writes example-20x16.takeoff.json
import fs from 'fs';
import { takeoff } from './takeoff-reference.mjs';
const rules = JSON.parse(fs.readFileSync(new URL('../takeoff-rules.json', import.meta.url)));
const prices = JSON.parse(fs.readFileSync(new URL('../homedepot-prices.json', import.meta.url)));
const load = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url)));
const base = takeoff(load('./example-20x16.model.json'), rules, prices, {});
const frost = takeoff(load('./example-20x16-frost36.model.json'), rules, prices, {});
const clear = takeoff(load('./example-20x16-2x12-clearspan.model.json'), rules, prices, {});
const bags = takeoff(load('./example-20x16.model.json'), rules, prices, { concreteMode: 'bags80' });
const out = { base, deltas: {
  frost36: { total: frost.totals.total, delta: +(frost.totals.total - base.totals.total).toFixed(2), report: frost.report },
  clearSpan2x12NoBeam: { total: clear.totals.total, delta: +(clear.totals.total - base.totals.total).toFixed(2) },
  bagged80lbInsteadOfReadyMix: { total: bags.totals.total, delta: +(bags.totals.total - base.totals.total).toFixed(2) } } };
fs.writeFileSync(new URL('./example-20x16.takeoff.json', import.meta.url), JSON.stringify(out, null, 1));
for (const l of base.lines) console.log(`${l.id.padEnd(22)} ${String(l.buy).padStart(4)} x ${String(l.unit_price).padStart(7)} = ${String(l.ext).padStart(8)} ${l.verified ? ' ' : 'E'} ${l.price_ref}  | ${l.desc}`);
console.log(JSON.stringify(base.groups), '\n', JSON.stringify(base.totals, null, 1), '\n', JSON.stringify(base.report), '\n', JSON.stringify(base.concreteAlternatives), '\n', JSON.stringify(out.deltas, null, 1), '\n', base.flags.join('\n'));
