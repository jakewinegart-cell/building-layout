# Pricing rules: content-v4

## Formula

```
materials    = Σ line.buy × unit_price          (quantities already include waste; bulk price when qty ≥ min_qty)
tax          = materials × taxRatePct / 100      (taxRatePct = user value ?? zip lookup ?? unknown → 0% + FLAG)
contingency  = (materials + tax) × contingencyPct / 100   (optional, default 10%)
delivery     = user-entered, default $0          (we never invent a delivery fee)
labor        = not included, or an optional user-entered amount
TOTAL        = materials + tax + contingency + delivery + labor
```

Show these lines in the UI:

- materials by layer (site / foundation / floor / walls / roof / fasteners)
- the "from estimated prices" subtotal
- tax
- contingency
- delivery
- labor
- total

## Why it's built this way

- **Waste goes into quantities, not dollars.** You can't buy 0.3 of a stud, so waste is rounded up to whole pieces, sheets and bags. That's what you'll actually pay for at the register.
- **Tax comes from the startup zip lookup** (`jurisdictions.json → zips[zip].tax`, see `zip-popup-spec.md`).
  - Order of precedence: the user's `m.estimate.taxRatePct`, then the verified zip value, then *unknown*. Unknown is priced at 0% with a "tax rate unknown, enter yours" flag. We never default to a made-up rate. The v3 9.15% Denver default is gone.
  - **ZIP 59833 (Florence, MT) = 0%.** Montana has no general sales tax (https://revenue.mt.gov/taxes/general-sales-tax). The resort tax only applies in designated resort communities and areas, and Florence and Ravalli County aren't among them (https://mtresorttax.org/communities-overview/; MCA 7-6-1503). Verified 2026-10-28.
  - `totals.taxSource` says where the rate came from ("zip 59833 lookup", "user", "unknown"). The UI shows it next to the tax line.
  - Shopping across a state line (e.g., online orders shipped from out of state) doesn't change this. Montana has no sales or use tax on the purchase.
- **Contingency, about 10%.** It covers price changes since the snapshot, mistakes, extra fasteners and small things this list doesn't cover: shims, blades, chalk, string, caulk, foam and so on. Users can turn it off or change it.
- **Delivery.** Lumber delivery fees vary by store and distance, so it's a user-entered line. Nothing is invented here.
- **Labor.** Not included. Optionally the user enters a contractor bid as one line. We don't estimate labor.
- **No markup.** The 12% load in Paracord is an insurance-pricing concept. It is **not** applied here.
- **Estimated prices.** Any line whose price entry has `verified:false` adds to `materials_from_estimated_prices`. Mark those lines with an "est." badge that explains the estimate: ready-mix, the door, some lumber lengths and some tube sizes.
- **Unpriced lines.** Items with no price, such as a door or window size not in the snapshot or a 16 in tube, are listed as "needs a price". Don't add them to the total as $0 without saying so.

## Required disclaimer (show near the total)

> **This is an estimate, not stamped plans.** Material prices come from a homedepot.com snapshot taken **{snapshot_date}** (America/Denver). They were shown for Home Depot's default online store, **not localized to {store_name}** (for 59833: Home Depot Missoula #3102, 2725 Radio Way, (406) 523-0901). They change often and vary by store, so check them in the store or with the Pro Desk. Some prices are estimates and are marked "est." Tax is **{tax_rate}%** ({tax_source}). Quantities follow general rules of thumb with waste included. Frost depth, code edition and permit info come from public sources for **{jurisdiction_label}**, checked {checked_date}. Your plans, your local code and your building official decide what's actually required. Structural items (beams, headers, footings, piers, rebar, rafters for your snow load, anything marked FLAGGED) need to be checked by your building department or a licensed engineer. Labor, permits, delivery and tools aren't included unless you add them.

## Example: 20×16 addition on piers, ZIP 59833 (Florence, MT)

All dollar figures are **EXAMPLE** values from the 2026-10-28 snapshot. They are not localized to the Missoula store.

Assumptions:

| Part | Assumption |
|---|---|
| Location | ZIP 59833 → Ravalli County outside city limits (State of Montana jurisdiction) |
| Frost depth | **36 in** from the zip lookup (ARM 24.301.142(9), 1-story wood frame) |
| Joists | 2x10 @ 16 in (16 ft span → FLAGGED mid beam, as in v3) |
| Walls | 2x6, 8 ft |
| Roof | 4:12 gable, 12 in overhang, 2x8 rafters @ 24 in (EXAMPLE; **not checked against the site snow load**, which is UNVERIFIED) |
| Openings | 1 door 36 in, 2 windows 36x48 |
| Piers | 14 × 12 in, **54 in tall** (36 in below grade + 18 in above), perimeter and wall lines only, on the grade beam |
| Ice barrier | on (required in Montana) |
| Concrete | ready-mix: 4.87 yd → order 5 yd + short-load fee (≈ 220 × 80 lb bags as the alternative) |
| Tax | 0% (zip lookup) |

| | $ (EXAMPLE) |
|---|---|
| Site layout | 59.20 |
| Foundation | 2,366.48 |
| Floor | 1,182.34 |
| Walls | 2,389.98 |
| Roof | 2,031.77 |
| Fasteners | 167.91 |
| **Materials** | **8,197.68** (of which $1,400 is from estimated prices: ready-mix 5 yd $750 + short-load fee $125 + door $525) |
| Tax 0% (MT, zip 59833 lookup) | 0.00 |
| Contingency 10% | 819.77 |
| Delivery / labor | 0 / not included |
| **Total** | **≈ $9,017.45** |

**Change from v3** (v3: Denver 9.15% tax, 24 in placeholder piers, total $9,628.92):

| | v3 | v4 (59833) | Change |
|---|---|---|---|
| Materials | 8,019.75 | 8,197.68 | **+177.93** (piers 42 → 54 in: more concrete, tube and rebar) |
| Tax | 733.81 (9.15%) | 0.00 (0%) | **−733.81** |
| Contingency 10% | 875.36 | 819.77 | −55.59 |
| **Total** | **9,628.92** | **9,017.45** | **−611.47** |

How the 59833 total changes:

| Variant | Total | Change |
|---|---|---|
| 2x12 joists clear-spanning, no mid beam or hangers (verify span) | $8,839.14 | −$178.31 |
| 80 lb bags (220) instead of ready-mix | $9,620.69 | +$603.24 |

The full line list is in `reference/example-20x16.takeoff.json`. To regenerate it, run `node reference/run-example.mjs`.
