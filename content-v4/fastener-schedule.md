# Fastener schedule: content-v4 ($ inspect)

**`fastener-schedule.json`** is the source of truth and this file explains it. It lists what fastens each piece the takeoff produces, how many fasteners that takes, and what one fastener costs, so a hover can show something like *"2x6 stud, 7 ft 7.5 in · $6.14 · 6 × 3-1/4×.131 nail @ $0.026 = $0.16 · total $6.30"*.

**All dollar amounts are EXAMPLE.** They come from Home Depot product pages (default online store) read on 2026-10-28 (America/Denver). **They are not localized to the Missoula store (#3102).** To get local prices, call the Missoula Pro Desk.

## Code basis

- **2024 IRC as adopted by Montana** (DLI Building Codes Bureau, effective 2026-09-26). Text was read on UpCodes because codes.iccsafe.org blocked the fetch. Full Table R602.3(1) text: `reference/sources/irc2024-mt-table-R602.3-1.txt`.
  - **Table R602.3(1)**: wood framing fastening schedule (items 1–32 plus footnotes).
  - **Table R602.3(3)**: wall sheathing nails vs. wind speed.
  - **Table R802.5.2(1)**: rafter-heel nails.
  - **R905.1.1, R905.2.5, R905.2.6, R905.2.8.5**: underlayment, shingle nails, 4 nails per shingle, drip edge at 12 in o.c.
  - **R703.2 and Table R703.3(1)**: WRB and siding.
  - **R403.1.6**: anchor bolts.
- **Manufacturer instructions, where the IRC defers to them:**
  - Simpson H2.5A and LUS
  - GAF Timberline HDZ, Pro-Start and Seal-A-Ridge
  - Stinger EXO underlayment
  - DuPont Tyvek
- URLs are in `fastener-schedule.json → sources`.
- **Nails vs. screws:** common nails are the code fastener. A screw counts only where code allows it (R104.2.2 alternate, or an ICC-ES report) or where the connector maker lists it, such as Simpson SD screws in H2.5A and LUS. Every screw option is flagged and **none are priced**. v3's HeadLOK screws on the girder are replaced by the code nailing in item 28.
- **Counts are minimums.** Purchases add `extra_pct`: 10% for framing and sheathing nails, 5% for roofing and connector nails.

## Fastener types → products (unit price = box price ÷ box count, EXAMPLE)

| id | Code fastener | Product (`price_ref`) | Box | Unit |
|---|---|---|---|---|
| `gun_3x131` | 3 × 0.131 nail (most framing rows) | `nails_framing_16d_4000` 3-1/4×.131 (or `_1000`) | 4000 / $105.94 | $0.026 |
| `common_16d` | 16d common 3-1/2×0.162 (headers, item 10; heels, R802.5.2) | `nails_common_16d_5lb` PRO-FIT 0053195 | 230 / $25.98 | $0.113 |
| `common_8d_hdg` | 8d common 2-1/2×0.131 HDG (H2.5A 10/tie; header toe-nail, item 11) | `nails_common_8d_hdg_5lb` Grip-Rite 8HGC5 | 449 / $26.98 | $0.060 |
| `roof_sheath_8d` | 8d common 2-1/2×0.131×0.281 head (roof, item 31) | 8HGC5 (shared box) or `nails_gun_8d131_4000` | 449 / $26.98 | $0.060 |
| `ring_238x113` | deformed 2-3/8×0.113×0.266 (subfloor item 32; wall R602.3(3)) | `nails_sheathing_2000` / `_5000` | 2000 / $46.75 | $0.023 |
| `connector_148x3` | Simpson 0.148×3 (LUS hangers) | `nails_connector_10d3_250` | 250 / $23.23 | $0.093 |
| `roofing_114` | ≥12 ga, 3/8 head roofing nail (R905.2.5) | `roofing_nails_5lb` PRO-FIT 0132075, 11 ga | 1045 / $15.98 | $0.015 |
| `roofing_134` | same, longer for ridge cap | `roofing_nails_134_5lb` Everbilt 1-3/4 | 740 / $21.00 | $0.028 (page not confirmed) |
| `cap_1in` | 1 in ring-shank cap nail (Stinger EXO, Tyvek) | `cap_nails_2000` | 2000 / $19.98 | $0.010 |
| connectors | anchor bolt, LUS210, H2.5A, H-clip, adhesive (per lf), rebar tie | their existing takeoff lines | — | $1.25, $1.98, $0.93, $0.24, $0.19/lf, $0.098 |

**PRICE NEEDED, not used:**
- Simpson-branded 0.131×2-1/2 connector nail. HD carries only the 1-1/2 in N8; 8HGC5 is the same size.
- Simpson SD9212 connector screws.

## Per-piece counts (20×16 example, 2x6 walls @16, 2x10 floor @16, 2x8 rafters @24, 4:12)

| Piece | Connection: IRC item, count | Count |
|---|---|---|
| Stud | plates: item 17, 3 end nails each end | 6 gun |
| King stud | + header: item 12, 4 end nails | 10 gun |
| Jack stud | bottom plate 3 + face to king @16 in (item 8) | 3 + floor(L/16)+1 → 8 |
| Corner/backer stud | plates 6 + face @12 in (item 9) | 14 |
| Cripple above / below | 3 end + 4 toe / 3 end + 3 end (item 17 by analogy, flagged) | 7 / 6 |
| Rough sill | 3 end nails each end (by analogy) | 6 |
| Bottom plate (exterior) | item 16: 4 nails every 16 in | 4 × ceil(L/16) → 60 for 19.5 ft |
| Lower top plate | stud nails are counted on the studs | 0 |
| Upper top plate | item 13 @12 in + 3 at the corner lap (item 18) + 24 per splice (item 14) | 20 + 3 |
| Header ply 1 / added ply | item 11: 4 toe nails each end (8d) / item 10: 16d @16 in each edge | 8 × 8d / 6 × 16d (39 in) |
| PT sill | R403.1.6: max(2, ceil((L − 2 ft)/6)+1) bolts **per piece** | 4 |
| Rim | item 23: toe nail @6 in + adhesive | 40 gun + 19.9 lf |
| Floor joist (half at flush beam) | sill 3 toe (item 22) + rim 4 end (item 27) + 1 LUS210 + 12 × 0.148×3 + adhesive | 7 gun |
| Beam added ply | item 28: @24 in top and bottom + 3 each end | 26 gun |
| Subfloor sheet | item 32: 6 in at supported ends, 12 in at intermediate joists (T&G edges unblocked, footnote h) | 43 ring |
| Wall sheet (vertical) | 6 in edges and plates, 12 in at intermediate studs | 62 ring |
| Roof sheet | item 31 roof: **6 in edges, 6 in field** + 4 H-clips | 45 × 8d |
| Bearing rafter | plate 2 toe (item 6 + footnote i) + ridge 4 toe (item 7) + 1 H2.5A + 10 × 8d HDG | 6 gun |
| Barge rafter | ridge 4 toe (lookouts carry the rest) | 4 |
| Ridge board | nails counted on the rafters; splice not tabulated (flag) | 0 |
| Ceiling joist | plate 3 toe each end (item 2) + heel joint 17 × 16d each end (R802.5.2(1)) | 6 gun + 34 × 16d |
| Collar tie | item 5: 4 face nails each rafter | 8 |
| Lookout / gable stud | 3 + 3 (item 1 analog) / 4 toe + 3 (item 17 analog) | 6 / 7 |
| Shingle bundle | GAF: 64 shingles per 3 bundles × 4 nails | 85.33 |
| Starter | GAF Pro-Start: 1 nail per 10–12 in (12 used) | 1 per lf |
| Ridge cap bundle | GAF: 2 per piece at 6-2/3 in exposure, + 1 starter piece | 82 for 22 ft |
| Drip edge 10 ft | R905.2.8.5: ≤12 in o.c. | 11 |
| Underlayment roll | Stinger: 12 in on lap lines, 24 in on the roll centerline | 256 |
| House wrap | Tyvek: stud lines, ≤18 in o.c. | 356 |
| Pier / grade beam | rebar ties (takeoff estimate, not code) | 2 / per lf |
| Ice barrier | self-adhered | 0 |
| Blocking, siding, trim | **schedule only**: rows given, not in the model | — |

Sheet formula (`sheet_rule`): `2 × (w/edge + 1) + (supports − 2) × (w/field + 1)` for panels laid across supports. A vertical wall panel instead gets both long edges and both plates at edge spacing and the studs between at field spacing, with corners not double counted.

## Example: what changed (20×16, ZIP 59833, EXAMPLE)

| | Legacy tally | Schedule | Change |
|---|---|---|---|
| Fastener purchase lines | $360.18 (7 lines: framing 87.96, sheathing 79.95, girder screws 62.61, hanger nails 46.46, roofing 47.94, cap 19.98, N8 15.28) | $404.99 (8 lines: 3-1/4 gun 105.94, 8d HDG 80.94, 16d common 51.96, 2-3/8 ring 46.75, hanger nails 46.46, roofing 1-1/4 31.96, 1-3/4 21.00, cap 19.98) | **+$44.81** |
| Contingency 10% | 819.77 | 824.25 | +4.48 |
| **Total** | **$9,017.45** | **$9,066.74** | **+$49.29** |

- **Groups:** floor 1,182.34 → 1,073.27 and roof 2,031.77 → 1,948.57, because their nail and screw lines moved to `all`. `all` (fasteners) 167.91 → 404.99.
- **Main changes:** heel joints (340 × 16d, which v3 did not count), roof sheathing at 6/6 with 8d instead of ring nails, H2.5A nails corrected to 2-1/2 in, and the screw line dropped.
- **Value vs. purchase:** the fasteners actually used are worth $239.06 (nails only $125.77); the rest is leftover in boxes.
- **2x12 clear-span variant:** $8,937.52 (−$129.22 vs. the base).

## Hover copy format (for App Builder)

The engine already builds this for every piece as `pieces[i].hover` (an array of lines). `hoverCopy()` and `money()` are exported from `reference/takeoff-reference.mjs`.

```
{size} {label}, {length ft-in}            ← no length for sheets / bundles / rolls
${price} EXAMPLE                          ← or "PRICE NEEDED" / "concrete + rebar priced on the foundation lines"
{count} x {fastener short name} @ ${unit} each = ${subtotal}     ← one row per fastener type (rows merged)
total ${total} EXAMPLE  [(+ PRICE NEEDED items)]
```

Rules:
- Money under $0.10 shows **3 decimals** ($0.026, $0.080); everything else shows 2.
- A count with a fraction (shingle bundle 85.3) shows 1 decimal.
- Connectors such as the LUS hanger and H2.5A appear as fastener rows with their own unit price. They are bought on their own lines, given in `fasteners[i].bought_on`.
- Never show a dollar figure without "EXAMPLE". If `unitPrice` is null, show "PRICE NEEDED", and the total says "+ PRICE NEEDED items".
- Details panel, optional: `pieces[i].fasteners[]` gives `to` (what it fastens to), `code` (IRC item), `alt` (code alternatives), `flag` (interpretation to confirm) and `source`. Show `flag` with a ⚠.
- `price` is the share of the purchased unit: a full stock piece, or length ÷ stock length for packed short pieces (`priceBasis`). Piece prices are allocations for display; **the line totals govern the estimate**.

Examples from `reference/example-20x16.pieces.json`:
- `2x6 Common stud, 7 ft 7.5 in · $6.14 EXAMPLE · 6 x 3-1/4x.131 nail @ $0.026 each = $0.16 · total $6.30 EXAMPLE`
- `2x8 Common rafter, 9 ft 5.875 in · $12.82 EXAMPLE · 6 x 3-1/4x.131 nail @ $0.026 each = $0.16 · 1 x H2.5A tie @ $0.93 each = $0.93 · 10 x 8d common HDG @ $0.060 each = $0.60 · total $14.51 EXAMPLE`
- `2x8 Ceiling joist / rafter tie, 16 ft · $21.12 EXAMPLE · 6 x 3-1/4x.131 nail @ $0.026 each = $0.16 · 34 x 16d common @ $0.11 each = $3.84 · total $25.12 EXAMPLE`
- `7/16 OSB roof sheet · $13.63 EXAMPLE · 45 x 8d (2-1/2x.131) nail @ $0.060 each = $2.70 · 4 x H-clip @ $0.24 each = $0.98 · total $17.31 EXAMPLE`

Piece record: `{pieceId, type, label, size, length (ft), lengthIn, price, price_ref, priceBasis, line, fasteners:[{type, label, kind, count, unitPrice, subtotal, to, code, source, alt, flag, bought_on}], fastenersTotal, total, hover[], ctx, EXAMPLE:true}`. Aggregate totals are in `fasteners.byType[id] = {installed, toBuy, boxes[], unitPrice, usedValue, boughtOn}`, plus `purchasedCost` and `usedValueNailsOnly`.

## UNVERIFIED: confirm before relying on it

Who to call: the **Montana Building Codes Bureau (406) 841-2056** for the code and site items, and the **Missoula Home Depot Pro Desk (#3102)** for local prices.

1. **Ground snow load.** Heel nails use the 70 psf column (17 × 16d at a 24 ft span column). Above 70 psf the table does not apply and the heel must be engineered.
2. **Wind speed and exposure.** These decide 4 in roof-edge nailing (footnote f), the high-wind Stinger pattern, 6-nail shingles, and whether the wall-sheathing nail meets R602.3(3).
3. **Seismic Design Category.** Plate washers (R602.11.1, D0–D2) are not priced.
4. **3-1/4 in vs. the tabulated 3 in × 0.131 gun nail.** This is usually accepted, but confirm with the building official.
5. **Roof nail head ≥ 0.281** on the gun-nail option. Also check whether the 2-3/8 ring box is RSRS-01; if so it can do the roof. Framing specific gravity 0.35–0.42 requires RSRS-03.
6. **Grip-Rite 8HGC5 count:** the page shows both 505 and ~449; 449 is used.
7. **Rows priced by analogy:** cripples, rough sill, lookouts and gable studs. Ridge splice nailing is not tabulated and is not counted.
8. **Ridge-cap nail length (1-3/4 in)** is our choice, and the Everbilt 740-ct product page and URL were not captured. It is `verified:false`.
9. **Siding and trim:** no product chosen, so these are schedule rows only (PRICE NEEDED).
10. **Prices:** HD default online store, not localized to Missoula.
