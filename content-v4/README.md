# content-v4: "I'm done" estimate, blueprint and build-guide content

These are content files only. No app code was changed. Price snapshot: **2026-10-28 (America/Denver)**.

| File | What it is |
|---|---|
| `takeoff-rules.json` | Machine rules. Contains `model_paths`, `defaults` (waste, stock lengths, concrete, rebar EXAMPLE, anchor bolts, nailing EXAMPLE, roof), `items[]` (each has `id, layer, formula, params, unit, waste, price_ref`) and `missing_fields[]`. |
| `takeoff-rules.md` | The same rules in plain English, including how waste is rounded and the stock-length rule. |
| `homedepot-prices.json` | 88 Home Depot price entries (v4 fasteners added 2026-10-28: 16d common, 8d HDG common, 8d gun nail, 1-3/4 roofing nail, 2 PRICE NEEDED) keyed by `price_ref`: name, internet #, model, unit, pack_qty, price, bulk_price, URL, date, `verified`, `denver_localized`, estimate_source, notes. 76 verified, 9 estimated or unconfirmed, 3 PRICE NEEDED (price null). |
| `jurisdictions.json` | **New.** Zip → place, code jurisdiction(s), code edition, frost depth, snow-load status, ice barrier, permits, who to call, sales tax and nearest store. Every value has a source and a `verified` flag. Seed entry: 59833 (Florence, MT). Includes the unknown-zip `fallback`. |
| `zip-popup-spec.md` | **New.** Startup "Where are you building?" modal: copy, validation, county picker, what it writes into the model, data flow (pier depth = max(frost + margin, 12)), tax, fallback. |
| `pricing-rules.md` | Total formula (materials + tax + contingency + delivery + optional labor), the reasoning, the required disclaimer, and the worked 20×16 example. |
| `instructions.md` | Plain-language build guide template with `{variables}` and `[if …]` blocks. Covers layout → piers → sill → joists → subfloor → walls → roof → dry-in, plus inspections, safety, and permit/engineer triggers. Includes a variable-source table. |
| `fastener-schedule.json` | **New (fasteners).** Per piece type: connections, IRC 2024 (MT) item, fastener type/size, count rule, nails-vs-screws flag, sources; fastener types → `homedepot-prices.json` box options; heel-joint table; UNVERIFIED list. |
| `fastener-schedule.md` | **New (fasteners).** Plain-English schedule, per-piece counts, example change, **hover-copy format for $ inspect**, unverified items. |
| `reference/takeoff-reference.mjs` | Working reference engine: `takeoff(model, rules, prices, opts)`. Pure JS, imports nothing from the app. With `opts.fastenerSchedule` it returns `pieces[]` ({pieceId, type, length, price, fasteners[{type, count, unitPrice, subtotal}], total, hover[]}) and `fasteners` totals. |
| `reference/run-example.mjs` | `node reference/run-example.mjs` prints the example and rewrites `example-20x16.takeoff.json`. |
| `reference/example-20x16*.model.json` | Models produced by the app's own `regenerate()`: defaults (24 in placeholder); frost 36 in (the 59833 base); 2x12 clear-span at frost 36 in. |
| `reference/example-20x16.takeoff.json` | Full line list, totals and deltas for the example. |
| `reference/example-20x16.pieces.json` | **New.** All 318 piece records with fasteners and hover copy, plus aggregate fastener totals (EXAMPLE). |

## How App Builder should use them

1. **On "I'm done":** run `regenerate(m)`, then `takeoff(m, rules, prices, m.estimate || {})`. You can port the reference engine or import it as an ES module, since it's DOM-free. Any field the model lacks falls back to `rules.defaults`.
2. **Estimate panel:**
   - Group lines by `layer`.
   - Each line shows: description, buy qty, unit price, extended price, a link (`prices[price_ref].url`), and an **"est."** badge when `verified:false`.
   - Show `totals` exactly as in pricing-rules.md, plus `concreteAlternatives` (bags vs ready-mix) and every entry in `flags[]`.
   - Put the disclaimer from pricing-rules.md right beside the total.
3. **Settings** (proposed `m.estimate`): `taxRatePct` (default null = use the zip lookup; 59833 → 0%; unknown → 0% + flag), `contingencyPct` (10), `deliveryUsd` (0), `laborUsd` (null = not included), `concreteMode` (`auto|readymix|bags80|bags60`), `iceBarrier` (true).
4. **Blueprint and instructions:**
   - Fill `instructions.md` placeholders using the variable table at its bottom and `takeoff.report`.
   - Keep the "EXAMPLE, verify" and FLAGGED wording.
   - Never present header or beam sizes as engineered.
5. **Prices:**
   - Never show a non-verified price as Home Depot's price.
   - `verified:true` only means it was shown on homedepot.com on 2026-10-28 for HD's default online store. That store is **not** the user's local store (`denver_localized:false`, `store_localized:false` everywhere). For 59833 the nearest store is Home Depot Missoula #3102. Localizing prices to it was attempted and **blocked**: homedepot.com returned 403 to automated store-specific requests, and fetched pages carried no price. Check prices in the store or with the Pro Desk (406) 523-9924.
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

## What changed in v4

- **Location from ZIP:** tax, frost depth, ice barrier, code and permit notes now come from `jurisdictions.json` via the startup pop-up. Denver defaults are removed.
- **Engine** (`reference/takeoff-reference.mjs`): adds `resolveJurisdiction()` and `requiredPierDepthIn()`. New flags: frost not applied, pier too shallow, ZIP spans multiple jurisdictions, snow load unverified, tax unknown. Adds `totals.taxSource`.
- **Example rerun for 59833:** materials $8,197.68, tax $0 (0%), contingency $819.77, **total $9,017.45**. That's −$611.47 vs v3's $9,628.92 (all EXAMPLE).
- **Fasteners ($ inspect, 2026-10-28):** `fastener-schedule.json/.md` + engine `pieces[]`. Example total **$9,066.74** (+$49.29 vs $9,017.45; fastener lines $360.18 → $404.99). Floor/roof groups drop because their nail lines moved to `all`.
- **Rule kept:** piers go only under wall lines and corners with the grade beam, never mid-span.
