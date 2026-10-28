# content-v3: "I'm done" estimate, blueprint and build-guide content

These are content files only. No app code was changed. Price snapshot: **2026-10-28 (America/Denver)**.

| File | What it is |
|---|---|
| `takeoff-rules.json` | Machine rules. Contains `model_paths`, `defaults` (waste, stock lengths, concrete, rebar EXAMPLE, anchor bolts, nailing EXAMPLE, roof), `items[]` (each has `id, layer, formula, params, unit, waste, price_ref`) and `missing_fields[]`. |
| `takeoff-rules.md` | The same rules in plain English, including how waste is rounded and the stock-length rule. |
| `homedepot-prices.json` | 82 Home Depot price entries keyed by `price_ref`: name, internet #, model, unit, pack_qty, price, bulk_price, URL, date, `verified`, `denver_localized`, estimate_source, notes. 73 verified, 9 estimated. |
| `pricing-rules.md` | Total formula (materials + tax + contingency + delivery + optional labor), the reasoning, the required disclaimer, and the worked 20×16 example. |
| `instructions.md` | Plain-language build guide template with `{variables}` and `[if …]` blocks. Covers layout → piers → sill → joists → subfloor → walls → roof → dry-in, plus inspections, safety, and permit/engineer triggers. Includes a variable-source table. |
| `reference/takeoff-reference.mjs` | Working reference engine: `takeoff(model, rules, prices, opts)`. Pure JS, imports nothing from the app. |
| `reference/run-example.mjs` | `node reference/run-example.mjs` prints the example and rewrites `example-20x16.takeoff.json`. |
| `reference/example-20x16*.model.json` | Models produced by the app's own `regenerate()`: defaults; frost 36 in; 2x12 clear-span. |
| `reference/example-20x16.takeoff.json` | Full line list, totals and deltas for the example. |

## How App Builder should use them

1. **On "I'm done":** run `regenerate(m)`, then `takeoff(m, rules, prices, m.estimate || {})`. You can port the reference engine or import it as an ES module, since it's DOM-free. Any field the model lacks falls back to `rules.defaults`.
2. **Estimate panel:**
   - Group lines by `layer`.
   - Each line shows: description, buy qty, unit price, extended price, a link (`prices[price_ref].url`), and an **"est."** badge when `verified:false`.
   - Show `totals` exactly as in pricing-rules.md, plus `concreteAlternatives` (bags vs ready-mix) and every entry in `flags[]`.
   - Put the disclaimer from pricing-rules.md right beside the total.
3. **Settings** (proposed `m.estimate`): `taxRatePct` (default 9.15, EXAMPLE Denver), `contingencyPct` (10), `deliveryUsd` (0), `laborUsd` (null = not included), `concreteMode` (`auto|readymix|bags80|bags60`), `iceBarrier` (true).
4. **Blueprint and instructions:**
   - Fill `instructions.md` placeholders using the variable table at its bottom and `takeoff.report`.
   - Keep the "EXAMPLE, verify" and FLAGGED wording.
   - Never present header or beam sizes as engineered.
5. **Prices:**
   - Never show a non-verified price as Home Depot's price.
   - `verified:true` only means it was shown on homedepot.com on 2026-10-28 for HD's default online store. That store is **not Denver** (`denver_localized:false` everywhere).
   - Show the snapshot date and suggest the user re-check at their own store.
   - To refresh, re-read each `url`, update `price`, `date_checked` and `verified`, and keep the keys stable.
6. **Jake's foundation rule:** piers go only under wall lines and corners, never mid-span, with a grade beam on those lines. The default 20×16 has a 16 ft joist span, so the app adds a flagged mid beam with no supports. The engine flags it and shows the 2x12 clear-span alternative (−$194.64). You may want the app to offer that switch.

## Known gaps / missing model fields

`takeoff-rules.json → missing_fields` lists:

- ceiling joist size/oc
- collar ties
- ridge size
- gable framing objects
- ice barrier and roofing products
- sheathing params
- rebar params
- girder plies/size/supports
- header plies or filler
- stud precut choice
- opening product, swing, handing and jamb depth
- attach-to-existing-house + ledger
- `m.estimate` settings
- interior wall intersections (tee studs aren't counted yet)
- soil type (expansive)
