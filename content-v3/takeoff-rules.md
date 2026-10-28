# Takeoff rules: content-v3

This is the human-readable companion to **`takeoff-rules.json`**. The JSON is the source of truth. **`reference/takeoff-reference.mjs`** is a working implementation of it: pure JS with no DOM and no app imports, and it has been tested against the 20×16 example.

Input: the saved model **after** `regenerate()` (`m.layers[*].params`, `.objects`, `.params.computed`).
Output: lines `{id, layer, desc, qty_calc, unit, buy, price_ref, unit_price, ext, verified}`, plus `groups`, `totals`, `flags` and `report`.

## General rules

**Waste** (`defaults.waste`): framing 10%, sheathing 10%, concrete 10%, shingles 10% (raise it to 15% for hips/valleys or cut-up roofs), rebar 10%.
- **Counted members** (joists, rafters, studs, plates, ridge, rim, sill) are bought as `n + round(n × waste)`. Example: 24 rafters → 26.
- **Area, volume and length quantities** are bought as `ceil(q × (1 + waste) / unit_size)`.

**Stock-length rule** (for one run of length L ft):
- If L ≤ 20 ft, use one piece: the smallest priced stock length ≥ L.
- If L > 20 ft, split it into `ceil(L/16)` equal pieces and choose stock for each piece.
- If a length has no price in the snapshot, use the next length up.
- Short pieces (cripples, headers, rough sills, collar ties, lookouts) are **packed first-fit-decreasing** into stock lengths.

**Prices:** `price_ref` → `homedepot-prices.json`. Use `bulk_price` when buy ≥ `min_qty`. For pack sizes (nails), buy the cheapest mix of the big and small packs.

## Foundation

- **Concrete volume:**
  - Piers: Σ π·r²·h, using the full pier height including the part above grade.
  - Grade beam: len × width × depth.
  - Footings: len × w × h.
  - Slab: area × thickness.
  - Then add 10%.
- **Concrete units:** show cu ft, **cu yd**, **80 lb bags** (0.60 cu ft each) and **60 lb bags** (0.45 cu ft each).
- **Bags vs ready-mix:** in `auto` mode, above **1 yd** recommend **ready-mix**. Order in 0.5 yd steps and add a short-load fee. Both of those prices are estimates. Always show the bag alternative too.
- **Form tubes:** one per pier, each needing (pier height + 2 in) of tube.
  - If that's more than 48 in, use full tubes plus the leftover pieces packed together (taped extensions), or suggest 10–12 ft tubes from a lumber yard.
  - Sizes: 12 in → `form_tube_12x48`; 8 in and 10 in tubes are mapped too.
- **Rebar #4 (EXAMPLE, the engineer or plans govern):**
  - Piers: 4 verticals for piers ≤ 16 in diameter, each (pier height − 3 in cover + 9 in dowel into the grade beam).
  - Grade beam: 2 top + 2 bottom continuous bars, with 24 in laps (one every 20 ft).
  - Corners: one L-bar per bar line, legs 24 in each way.
  - Bought as 20 ft bars at +10%.
- **Tie wire:** about 1 roll per 100 ties.
- **Anchor (J) bolts, 1/2 × 10 in:** for each sill (or bottom-plate) run, `max(2, ceil((L − 2 ft)/6) + 1)`. That means ≤ 6 ft o.c. and ≤ 12 in from each end. On a slab, add 2 per door.
- **Grade-beam forms:** 2 sides + bottom of 2x12 (reusable), plus stakes at 1 per 2 ft per side.
  - The engine **flags an elevated beam** when the beam bottom is above grade (`topAboveGradeIn.piers − gradeBeamDepthIn > 0`). The default model's beam bottom is 18 in in the air.
- **Layout:** 3 stakes + 2 2x4x8 ledgers per corner for batter boards.
- **Slab / crawlspace:** 6 mil poly (+10% or +15%).

## Floor (not on slab)

- **Sill:** PT `sillSize` along each sill object (stock rule), plus sill gasket (100 lf per 2-pack).
- **Rim:** `joistSize` along each rim object.
- **Joists:** one per joist object.
  - If a girder sits **flush** with the joists (same z), each joist is cut into 2 pieces and gets **2 face-mount hangers** (LUS2x), with 12 × 0.148×3 nails per hanger.
- **Girder (flagged):** the ply count comes from `props.widthIn/1.5` and is bought by the stock rule, plus structural screws at 2 per 16 in. **Supports are not priced.**
  - This conflicts with Jake's rule that piers go only under walls. The engine flags it and points to a deeper clear-span joist.
- **Subfloor:** 23/32 T&G, ceil(area × 1.10 / 32).
- **Adhesive:** total lf of joists + rims + beams ÷ 40 lf per 28 oz tube.

## Walls

- **Studs:** for each wall, `studLayout(len, oc, openings)` (the same logic as the app's homeplan-derived.js) gives the end studs and o.c. studs, skipping studs inside openings. Then add:
  - **2 king + 2 jack per opening**
  - **2 extra per exterior corner** (backers)
  - **cripples** above headers and below window sills, packed into studs
  - framing waste (+10%)
- **Stud length:** `plateHeightFt×12 − 1.5×(bottomPlates + topPlates)`. For an 8 ft wall that's 91.5 in, from a 92-5/8 precut.
- **Plates:** 1 bottom + 2 top per wall length (stock rule). The bottom plate is **PT when it sits on concrete** (slab).
- **Headers:** `opening.props.header`, e.g. "2-2x6" from the app's **EXAMPLE header table, flagged verify**.
  - Each ply is width + 2 × 1.5 in bearing long.
  - Plus a 2x rough sill per window.
  - Packed into 8 ft stock.
- **Wall sheathing (7/16 OSB):** (perimeter × (plate height + floor band) + gable triangles − openings) × 1.10 / 32.
- **House wrap:** gross wall area × 1.10 laps, in 9×150 rolls.
- **Seam tape:** 1 roll per ~400 sq ft.
- **Flashing tape:** opening perimeter (doors without the sill) × 1.15.
- **Doors and windows:** `price_ref = door_ext_{w}x{h}` or `window_{w}x{h}`. If no price exists, the line is unpriced and the user picks a product.

## Roof (gable)

- **Rafters:** one per rafter object (the barge rafters are included). Length = hypot(plan length, zB − zA), so it already includes the overhang.
- **Ridge:** one lumber size deeper than the rafters, overhang to overhang.
- **Ceiling joists / rafter ties:** one per bearing rafter pair, sized from the EXAMPLE span table, flagged verify.
- **Collar ties:** 2x4 on every 2nd pair, ⅓ of the span long.
- **Hurricane ties:** 1 H2.5A per bearing rafter end, with 10 N8 nails each.
- **Gable-end studs:** Σ triangle stud lf at wall o.c. The app doesn't model these yet.
- **Rake lookouts:** 2x4 × 2 ft at 24 in along each rake.
- **Roof sheathing:** 2 × rafter length × ridge length × 1.10 / 32, with H-clips at 4 per sheet. Panels must be rated for 24 in o.c. (the "16/0" OSB in the snapshot is flagged).
- **Underlayment:** area × 1.10 / 1000 sq ft roll.
- **Ice barrier:** eaves × 3 ft, default ON, which is typical for cold climates.
- **Shingles:** area/100 = squares; × 1.10 × **3 bundles per square**.
- **Drip edge:** (eaves + rakes) × 1.10 / 10 ft.
- **Starter:** eaves + rakes. **Ridge cap:** ridge lf × 1.05.
- **Roofing nails:** about 2.5 lb per square.
- **Cap nails:** for the underlayment and house wrap.

## Fasteners

- **Framing nails:** EXAMPLE nail counts per piece (stud, joist, rafter, plate lf, …) +15%, bought as the cheapest mix of 1000 and 4000 boxes.
- **Sheathing nails:** about 60 per subfloor sheet, 50 per wall sheet and 40 per roof sheet.

## Missing model fields (the engine uses defaults until these exist)

See `takeoff-rules.json → missing_fields` and the README.
