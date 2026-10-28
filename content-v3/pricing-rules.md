# Pricing rules: content-v3

## Formula

```
materials    = Σ line.buy × unit_price          (quantities already include waste; bulk price when qty ≥ min_qty)
tax          = materials × taxRatePct / 100      (default 9.15%, an EXAMPLE Denver rate; verify)
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
- **Tax.**
  - Denver's combined retail rate is **9.15%** (Denver 5.15% + Colorado 2.9% + RTD 1.0% + SCFD 0.1%). That's based on a 2026 web check: the City rate went from 4.81% to 5.15% on 2025-01-01. It's an **EXAMPLE, so verify** at denvergov.org or with your store.
  - Other cities differ, so it's a user setting, `m.estimate.taxRatePct`.
  - Some Colorado cities, Denver included, also collect a **use tax on construction materials at permit time** if sales tax wasn't paid locally. Mention it, but don't add it.
- **Contingency, about 10%.** It covers price changes since the snapshot, mistakes, extra fasteners and small things this list doesn't cover: shims, blades, chalk, string, caulk, foam and so on. Users can turn it off or change it.
- **Delivery.** Lumber delivery fees vary by store and distance, so it's a user-entered line. Nothing is invented here.
- **Labor.** Not included. Optionally the user enters a contractor bid as one line. We don't estimate labor.
- **No markup.** The 12% load in Paracord is an insurance-pricing concept. It is **not** applied here.
- **Estimated prices.** Any line whose price entry has `verified:false` adds to `materials_from_estimated_prices`. Mark those lines with an "est." badge that explains the estimate: ready-mix, the door, some lumber lengths and some tube sizes.
- **Unpriced lines.** Items with no price, such as a door or window size not in the snapshot or a 16 in tube, are listed as "needs a price". Don't add them to the total as $0 without saying so.

## Required disclaimer (show near the total)

> **This is an estimate, not stamped plans.** Material prices come from a homedepot.com snapshot taken **{snapshot_date}** (America/Denver). They were shown for Home Depot's default online store, **not localized to a Denver store**, and they change often and vary by store. Some prices are estimates and are marked "est." Quantities follow general rules of thumb with waste included. Your plans, your local code and your building department decide what's actually required. Structural items (beams, headers, footings, piers, rebar, anything marked FLAGGED) need to be checked by your building department or a licensed engineer. Labor, permits, delivery and tools aren't included unless you add them.

## Example: 20×16 addition on piers (defaults)

Assumptions:

| Part | Assumption |
|---|---|
| Joists | 2x10 @ 16 in |
| Walls | 2x6, 8 ft |
| Roof | 4:12 gable, 12 in overhang, 2x8 rafters @ 24 in |
| Openings | 1 door 36 in, 2 windows 36x48 |
| Piers | 14 × 12 in, 42 in tall; frost-depth placeholder 24 in |
| Ice barrier | on |
| Concrete | ready-mix |

| | $ |
|---|---|
| Site layout | 59.20 |
| Foundation | 2,188.55 |
| Floor | 1,182.34 |
| Walls | 2,389.98 |
| Roof | 2,031.77 |
| Fasteners | 167.91 |
| **Materials** | **8,019.75** (of which $1,325 is from estimated prices: ready-mix $800 + door $525) |
| Tax 9.15% (EXAMPLE) | 733.81 |
| Contingency 10% | 875.36 |
| Delivery / labor | 0 / not included |
| **Total** | **≈ $9,628.92** |

How the total changes:

| Variant | Total | Change |
|---|---|---|
| Frost depth 36 in (piers 54 in) | $9,842.55 | +$213.63 |
| 2x12 joists clear-spanning, no mid beam or hangers (verify span) | $9,434.28 | −$194.64 |
| 200 × 80 lb bags instead of ready-mix | $10,222.04 | +$593.12 |

The full line list is in `reference/example-20x16.takeoff.json`.
