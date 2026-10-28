# Roof takeoff rules (roofing-v1)

Machine version: `roofing-takeoff-rules.json`. Reference code: `reference/roof-reference.mjs`. These rules extend content-v3 `takeoff-rules.json` and keep its buy rules:
- Counted items: `n + round(n·waste)`.
- Area items: `ceil(q·(1+w)/unit)`.
- Lumber stock: 8/10/12/14/16/20 ft; longer pieces split into `ceil(L/16)`.
- All $ EXAMPLE.

## Geometry
- Slope factor `k = √(1+(p/12)²)`. Equal-pitch hip/valley factor `kh = √(2+(p/12)²)` per ft of common run.
- Degrees = `atan(p/12)`. From heights: `p = 12·(hiPlate − loPlate)/run` (outside faces; wizard convention).
- Heel: `HAP = d/cosθ − s·tanθ`. Notch measured perpendicular = `s·sinθ ≤ d/4`. Remaining = `HAP·cosθ ≥ 3.5 in`.
- Plan area by shape:

| Shape | Plan area |
|---|---|
| Gable | (W+2oh)(L+2ohr) |
| Shed | (run+2oh)(L+2ohr) |
| Hip / flat | (W+2oh)(L+2oh) |
| Gable into roof | main + ½·W·aTip overlay |
| Shed into plane | main + W·aTie |

- Sloped area = plan × k (sum per face for unequal pitches).
- Ridge length by shape:

| Shape | Ridge |
|---|---|
| Gable | L+2ohr |
| Hip | L−W |
| Gable into roof | L+ohr+aTip |

- Each hip = (W/2+oh)·kh.
- Valleys: intersection `zNew + u·pn/12 = zExist + a·pe/12` from the governing eave to the ridge tip. Equal pitch gives 45° in plan, true = run·kh.
- Tie-in heights: see roofing-spec §2.

## Items (ids → price_ref)

**Framing**

| id | Quantity rule | price_ref |
|---|---|---|
| roof.rafters | stations `floor(L·12/oc)+1` per slope; cut `(run−ridge/2+oh)·k + plumb overrun` | lumber_{size}_{len} |
| roof.barge | 2 per rake | lumber |
| roof.hips / roof.valleyRafters | 1 per line; 1 size deeper; true len + 1 ft | lumber |
| roof.jacks | stations at oc from the foot; pair long+short into one stock piece | lumber |
| roof.valleyBoards | California overlay: 1 per valley, 2x10 flat | lumber_2x10_* |
| roof.ridge | ridge lf in stock pieces; board 1 size up, beam LVL per engineer | lumber_2x12_*, lvl_175x1178_16/20/24 |
| roof.ceilingJoists / collarTies / ridgeStrap | 1 per pair / every 2nd pair / per pair | lumber, ridge_strap (PRICE NEEDED) |
| roof.hurricaneTies | 1 per rafter per bearing (shed 2) + N8 nails ×10 | hurricane_h25a, tie_h3, nails_connector_n8_150 |
| roof.lookouts | rake overhang >9 in | lumber_2x4_8 |
| roof.ledger (approved only) | L, LedgerLOKs ~2 per 16 in | ledgerlok_5_50 |
| roof.hangers | at ledger, valley and hip | hanger_lru26 / lru210 / lru212 (PRICE NEEDED) / lssj210 |
| roof.trusses | commons + 2 gable ends + girder/valley set; order spec | roof_truss_custom (PRICE NEEDED, quote) |

**Deck and coverings**

| id | Quantity rule | price_ref |
|---|---|---|
| roof.sheathing | `ceil(sloped·1.10/32)`; thickness by Table R503.2.1.1(1) vs snow/oc | osb_716 / osb_1932 / ply_1532 / ply_1932 / zip_roof_58 |
| roof.hClips | ~2 per sheet at 24 in | h_clip_* (19/32 PRICE NEEDED) |
| roof.underlayment | `ceil(sloped·1.10·(2 if shingle 2–4:12)/1000)` | underlayment_synth_1000 |
| roof.iceBarrier | eave lf × courses × 3 ft + valley lf × 3 + sidewall; courses from `(oh+24)·k` | ice_water_150, ice_water_200_granular |
| roof.shingles | `ceil(sq·(1+w)·3)`; w gable/shed .10, valleys/hip .15, dutch .17 | shingles_bundle |
| roof.starter / ridgeCap | (eave+rake)/120 lf / (ridge+hip)/25 lf | starter_bundle, starter_peel_33, ridge_cap_bundle |
| roof.metalPanels | panels per slope = ceil((L+2ohr)/coverage), length ≥ slope length; screws | metal_5v_26x8, metal_smrib_3x*, metal_screw_120, standing_seam_panel (PRICE NEEDED) |
| roof.membrane | `ceil(sloped·1.12/rollSf)` per ply | modbit_sa_cap_100, modbit_sa_base_100 (PRICE NEEDED), tpo_6x50, epdm_10x25 (PRICE NEEDED), roll_roofing_mineral, termination_bar (PRICE NEEDED) |

**Edges, flashing, vents and other items**

| id | Quantity rule | price_ref |
|---|---|---|
| roof.dripEdge | (eave+rake)·1.10/10 | drip_edge_10, eave_flash_ef3_10 |
| roof.valleyMetal | open valleys: lf·1.10/9.5, 24 in wide | w_valley_24_10 (PRICE NEEDED); w_valley_18_10 fails the 24 in minimum |
| roof.stepFlashing | per sidewall `ceil(slopeLf·12/5)+2` | step_flash_4x4x8 |
| roof.kickout / headwall / pitchBreak / counter | 1 per wall end / lf/10 | kickout_flash, l_flash_4x4_10, counter_flash (PRICE NEEDED) |
| roof.ridgeVent / soffitVent / baffles | vented ridge/4; eave/8; 2 per bay | ridge_vent_cobra_snow_4ft, undereave_vent_6x8, soffit_alum_vented_12x12, rafter_baffle_70 |
| roof.pipeBoots / skylight | per object | pipe_boot_lead_2, skylight (PRICE NEEDED) |
| roof.snowGuards | rows × eave/spacing | snow_guard_clear_25, snow_guard_shingle (PRICE NEEDED) |
| roof.gutters / downspouts | 16 ft then 10 ft pieces; hangers every 24 in; 1 downspout per ≤35 ft run | gutter_k5_alum_10/16, gutter_k5_vinyl_10, gutter_hanger_5, gutter_end_outlet_5, gutter_end_cap_5, downspout_2x3_10, downspout_3x4_10, downspout_elbow_flex, downspout_ext_flex |
| roof.fascia / soffit | eave+rake lf | fascia_vinyl (PRICE NEEDED), soffit_alum_vented_12x12 |
| roof.nails / capNails | 2.5 lb/sq; 150/sq | roofing_nails_5lb, cap_nails_2000 |

## Corrections to content-v3
1. The 3 ft ice barrier is too narrow for a 12 in overhang in Montana. Use the courses rule (2 courses at 4:12).
2. 7/16 roof sheathing is rated only 40 psf live load at 24 in o.c. Montana snow needs 15/32+ or 16 in spacing.
3. Shingles from 2:12 to under 4:12 need double underlayment.
