# Roofing layer spec (roofing-v1)

Date: 2026-10-28 (America/Denver). Scope: the **Roof** layer of the Building Layout app. It covers homeowner copy, machine fields, defaults, ranges, validation, takeoff, 3D notes and wizard hooks.
Jake asked [pt26u]: *"make the roofing section very robust, I want all sorts of options from pitch to tie in height and valley placements."*

Files in this folder:

| File | What |
|---|---|
| `roofing-spec.md` | This doc. The UI section in step order, with the rules behind each step |
| `roofing-options.json` | Machine schema: options, fields, defaults, ranges, validations, code citations, mapping to the wizard field names |
| `roofing-takeoff-rules.md` / `.json` | Quantity formulas by roof style, plus the new items to price |
| `roofing-price-items.json` | 70 new price refs. 55 were read on homedepot.com on 2026-10-28 (not localized); 15 are PRICE NEEDED |
| `rafter-span-tables.json` | IRC Tables R802.4.1(1)–(8) for SPF/DF-L/HF #2, at 16 and 24 in o.c. |
| `worked-example-20x16.md` / `.json` | Jake's 20x16 worked three ways: shed with the high side at the house, gable tie-in, and a pitch sweep |
| `reference/roof-reference.mjs`, `reference/run-worked-example.mjs` | Pure-JS calculator. `node reference/run-worked-example.mjs` regenerates the example |

Ground rules:
- Guidance only, not engineering.
- Every $ figure is EXAMPLE: homedepot.com, default store, not localized to Florence or Missoula.
- Code sections come from the Montana 2021 IRC text on UpCodes. Montana now enforces the **2024 IRC with Montana amendments** (content-v4/jurisdictions.json).
  - The R905 minimum slopes and the R802.4.1 span values were checked identical in 2024.
  - Re-check other section numbers against 2024 (marked `IRC2024` in `code_citations`).
- Local facts come from content-v4 for zip 59833:
  - ice barrier required statewide
  - minimum design roof snow load 30 psf
  - **ground snow load is site-specific and UNVERIFIED**

## 0. Field names (aligned with wizard-v1)

The existing fields and the wizard's proposed fields are used **unchanged**:
- `roof.params.shape`, `pitch`, `overhangIn`, `rafterOcIn`, `rafterSize`, `ridge ('long'|'short')`, `ceilingJoistSize`, `showSheathing`
- `roof.params.shed {highWallId, highPlateFt, lowPlateFt}`
- `roof.params.roofing {covering, underlayment}`, using the same `roofCovering` enum as `wizard-commands.json`
- `m.attachToExistingWallId`

Conventions also match the wizard:
- Plate height = top of the top plate above the subfloor.
- Shed run is measured between the outside faces.
- For a shed, pitch is derived: `12·(high−low)/run`.

All new fields are additive, and `migrate()` fills their defaults. The full list is in `roofing-options.json → fields`:

| New field | Purpose |
|---|---|
| `roof.ui.ridgeRelativeToHouse` | `parallel` or `perpendicular` (UI only). Converted to `ridge long/short` using the attached wall |
| `roof.params.rakeOverhangIn` | Gable-end overhang (the app uses `overhangIn` for both today) |
| `roof.params.faces{front,back,left,right}.pitch` | Per-face pitch for hip, half-hip, dutch and saltbox |
| `roof.params.saltbox / halfHip / dutch / flat` | Shape-specific inputs |
| `roof.params.eave{soffit,fascia,dripEdge,gutters,downspoutEvery}` | Eave package |
| `roof.params.tieIn{type,existingId,flashingClearIn,framing,bearingAtHouse,manufacturerApproval,cutBackExistingEave,floorDropFt,cricket}` | How the roof meets the house |
| `site.objects[role=existing].props.existingRoof{homeType,pitch,plateHeightFt,eaveUndersideFt,roofTopAtWallFt,fasciaBottomFt,overhangIn,ridgeDistFt,covering,framing,wallSide}` | Measurements of the house roof. Stored on the "+ Existing building" object, which already holds `heightFt` |
| `roof.params.valleys{type,liningWidthIn,metalWidthIn}` | Valley build-up |
| `roof.params.framing`, `ceiling`, `ridgeType`, `ridgeSize`, `ceilingJoistOcIn`, `collarTies`, `seatIn`, `raisedHeelIn`, `upliftConnector`, `lumber{species,grade}`, `sheathing{thickness,edgeSupport}` | Structure |
| `roof.params.snow{groundSnowPsf,source,strengthLevel,minRoofSnowPsf}` | Snow load. Filled from the content-v4 zip lookup, which is `null` for 59833, so the app must ask |
| `roof.params.vent{strategy,ratio,ridgeVent,baffles}` | Ventilation |
| `roof.params.roofing.{iceBarrierCourses,shingleVariant,metalGauge,singlePlyType}` | Covering details (extends the wizard object) |
| `roof.objects[type=skylight|penetration]`, `roof.params.snowGuards` | Other roof items |

## 1. UI: step order

The Roof panel is a vertical stepper. Each step shows live numbers (pitch, heights, warnings), and the 3D view updates as values change. Steps 6 and 11 are automatic: they show results and need no input.

### Step 1: Shape
Cards with thumbnails:

| id | Card copy |
|---|---|
| `gable` | Two slopes meeting at a ridge, triangle walls at the ends. Simple, sheds snow both ways, easy to vent. |
| `shed` | One slope from a tall wall to a short wall. Cheapest framing. Against a house it normally slopes away from the house. |
| `hip` | Slopes on all four sides, no gable walls. Stronger in wind; more cuts and hip rafters. |
| `half_hip` | Gable with the tip of each end clipped by a small hip (jerkinhead). |
| `dutch_gable` | Hip roof with a small gable on top. |
| `saltbox` | Gable with one long low slope and one short steep slope. |
| `flat` | Nearly flat (≥1/4 in per ft). Membrane only. Snow sits on it. |

- Only `gable` is generated today.
- `shed` is generated once wizard-v1's `shedGeometry` lands.
- The other shapes show a "numbers only" badge (RF-HIP-01 = wizard V-ROOF-08) until their generators exist (see §9).

### Step 2: Tie-in to the house
This step is shown when a site `existing` object touches the footprint or `m.attachToExistingWallId` is set.

1. **Which wall touches the house?** Sets `m.attachToExistingWallId` (wizard `wallRef` "house side").
2. **What kind of home is it?** Sets `homeType`: HUD manufactured (red HUD label / data plate), state modular (state insignia), site-built, or not sure.
3. **Measure your house roof.** A diagram shows each measurement:
   - existing pitch: hold a level out 12 in, then measure down to the roof
   - floor-to-underside-of-eave at the wall
   - floor-to-roof-surface above the wall (or the eave underside plus 6–10 in)
   - overhang
   - distance from the wall to the ridge
   - whether the addition is on the eave side or the gable end of the house
4. **Tie-in type.** Cards with live feasibility:

| `tieIn.type` | Card copy | Live check shown |
|---|---|---|
| `none` | Freestanding. Only flashing where it meets the wall. | Does the new roof clear the eave? |
| `shed_under_eave` | Shed's high edge tucks under the house eave. No work on the old roof. | Max high-wall height and max pitch (RF-TIE-01) |
| `shed_into_roof_plane` | Old eave is cut back and the new flatter roof runs up onto the old roof. More height, more work. | Tie line X ft up the old roof (RF-TIE-02, RF-TIE-05) |
| `extend_plane` | Continue the house roof slope down over the addition. | Outer wall height (RF-TIE-03) |
| `gable_into_roof` | New gable runs out from the house, ridge perpendicular. Two valleys form where it meets the house roof. | Ridge height, how far up the old roof it ties in, valley lengths |
| `gable_parallel_cricket` | Ridge along the house. The back slope drains toward the house, so it needs a cricket. | RF-DRAIN-01 |
| `hip_into_roof` | Hip addition whose back corners form valleys. | numbers only |

5. **How is the roof held up at the house side?** (`tieIn.bearingAtHouse`)
   - **Default: a new bearing wall** (or a beam on posts) right next to the house wall.
   - A ledger is allowed only after `manufacturerApproval = yes`. Copy: *"Modular and manufactured homes often can't carry a ledger. Confirm with the manufacturer or an engineer."* (RF-LEDGER-01)
   - Basis, HUD 24 CFR 3282.8(j)(1) and 3285.903(c): add-ons must be structurally independent unless the home was designed for the load.
   - Posts and beams must land on piers under walls or corners only (Jake's rule).
6. **Valley framing** (shown for tie-ins with valleys):
   - `california_overlay` (default): valley boards laid on the old roof.
   - `cut_in`: open the old roof. If the house has trusses this is blocked until a truss engineer's repair is on file (RF-TIE-06, R802.7.2).
   - Overlay warns RF-TIE-05: it adds weight and valley snow to the home's roof. Older HUD homes in Montana were built for a 30 psf roof load (24 CFR 3280.305).
7. **Step the floor down?** `tieIn.floorDropFt`, chips 0 / 1 step / 2 steps. Each step is at most 7-3/4 in (IRC riser limit, UNVERIFIED section number).

### Step 3: Pitch and heights
- **Input modes** (one control, three tabs). All round to 1/4:12 and are stored as `pitch`:
  - `x:12`
  - degrees (`12·tan θ`)
  - heights: high wall, low wall and run (shed); or ridge height (gable)
- **Always shown:** pitch as X:12, degrees, percent when under 2:12, rise, and ridge or high-side height above the floor and above grade.
- **Presets:** 1/4, 1, 2 (shingle minimum), 3, 4 (typical modular), 5, 6, 8, 12.
- **Per-face pitch** (hip family): toggle "same pitch all around" off to edit `faces.*`. Unequal pitches move the hips and valleys off 45° (warns ROOF_UNEQUAL_HIP).
- **Tie-in readout:**
  - "Your new ridge meets the house roof 10' 9-1/2" up from the wall, at 12' 1-1/4" above the floor."
  - "Valleys: 2 × 16' 0"."
  - Shed under eave: "Highest your house-side wall can be: X. That gives a Y:12 pitch."
- **Headroom check** (R305.1): ceiling at the low wall and at the house side, plus the sloped-ceiling 50%-at-7-ft rule (RF-HEAD-01).
- **Covering check** runs live (V-ROOF-01…04).

### Step 4: Overhangs, eaves, gutters
| Field | Default | Range | Notes |
|---|---|---|---|
| `overhangIn` (eave) | 12 | 0–24 | Over 24 in, or a tail notch leaving less than 3-1/2 in, triggers RF-TAIL-01 (R802.7.1.1) |
| `rakeOverhangIn` | 12 | 0–24 | Over 9 in, lookouts are added (R803.2.3, RF-RAKE-01) |
| `eave.soffit` | vented_aluminum | vented aluminum / vented vinyl / plywood + vents / open tails / none | Vented soffit feeds the low half of the vent area |
| `eave.fascia` | 2x6 sub-fascia + aluminum wrap | | |
| `eave.dripEdge` | standard | standard / heavy galvanized | Required at eaves and rakes (R905.2.8.5) |
| `eave.gutters` | 5 in aluminum K | none / 5 or 6 in aluminum / 5 in vinyl | Vinyl is warned against in snow (guidance). Hangers every 24 in; 16 in suggested in snow |
| downspouts | 1 per eave run ≤35 ft (guidance, UNVERIFIED) | | Low-slope roofs need a low edge with a gutter, or drains (R903.4) |

### Step 5: Structure
| Field | Default | Options | Rule |
|---|---|---|---|
| `framing` | rafters | rafters / trusses | Trusses show the order spec instead of sizes (span, pitch, heel, overhang, snow, spacing, ceiling) and price as PRICE NEEDED (quote) |
| `ceiling` | flat_attic | flat_attic / cathedral / scissor_truss | Cathedral uses the "ceiling attached" tables and needs a ridge **beam** (RF-RIDGE-01, R802.3) |
| `ridgeType` | board (attic), beam (cathedral) | | Board must be at least as deep as the plumb cut (R802.3), so the rule is one size up. Beam is LVL; plies per engineer (`lvl_175x1178_*` priced EXAMPLE) |
| `rafterSize` | `auto` (recommended) | 2x6–2x12 | `auto` picks the smallest size that meets `rafter-span-tables.json` for snow, spacing, species and dead load (V-ROOF-05) |
| `rafterOcIn` | 24 | 12 / 16 / 19.2 / 24 | |
| `ceilingJoistSize` | auto | | content-v3 EXAMPLE table (verify against R802.5) |
| `collarTies` | every 2nd pair | every pair / ridge strap / none | Upper third, ≤4 ft o.c. (R802.4.6) |
| `seatIn` | 3.5 | 1.5–5.5 | Bearing ≥1.5 in (R802.6); notch ≤1/4 depth |
| `raisedHeelIn` | 0 | 0–24 | HC/HR >1/3 needs engineering (R802.5.2); Table R802.4.1(9) factors |
| `upliftConnector` | H2.5A | H2.5A / H3 | R802.11 |
| heel nails | auto | | 16d per heel from Table R802.5.2(1). Example: 4:12, 24 in, 24 ft column, 50 psf → 13 |
| hips/valleys | auto | | ≥2 in nominal, depth ≥ the cut end (R802.4.3). Under 3:12, ridges, hips and valleys are designed beams (RF-LOWPITCH-01, R802.4.4) |

Heel and seat, shown in the side-section diagram:
- `HAP = d/cosθ − s·tanθ`. This is the height of the rafter top above the plate at the outside face of the wall.
- Example: 2x10 at 4:12 with a 3.5 in seat gives HAP 8.58 in, a notch 1.11 in deep and 8.14 in remaining. All OK.

### Step 6: Snow and sheathing (automatic)
- **Snow input:** `snow.groundSnowPsf`.
  - content-v4 returns `null` for 59833, so RF-SNOW-01 asks with chips 30 / 50 / 70 / "Look it up".
  - Copy: *"Ground snow load for your exact site. Look it up at snowload.montana.edu, or ask the Montana Building Codes Bureau or a local engineer."*
  - If the value comes from the ASCE 7 Hazard Tool (strength level), the app multiplies it by 0.7 (RF-SNOW-04).
  - The design roof snow load is never below 30 psf (MT R301.6).
  - Above 70 psf the roof must be engineered (RF-SNOW-02, R301.2.3).
- **Drift and sliding snow:** RF-SNOW-03 fires whenever the new roof sits below the house roof or has valleys. The IRC tables are uniform-load only.
- **Rafter tables:** values are rounded **up** to the next table (20/30/50/70).
- **Sheathing** comes from Table R503.2.1.1(1), allowable live load:

| Panel | at 16 in o.c. | at 24 in o.c. |
|---|---|---|
| 7/16 (24/16) | 100 psf | 40 psf |
| 15/32 (32/16) | 180 psf | 70 psf |
| 19/32 (40/20) | 305 psf | 130 psf |

  - Edge support is H-clips or blocking (RF-SHEATH-01).
  - In this example, 19/32 OSB ($22.77) is cheaper than 15/32 plywood ($27.81), so it is suggested.

### Step 7: Ventilation and insulation
- **Strategy:**
  - `vented_ridge_soffit` (default)
  - `vented_gable_louvers`
  - `unvented_spray_foam`: closed-cell foam under the deck. Must be a Class II vapor retarder in CZ5–8 (R806.5).
  - `unvented_rigid_above`: rigid foam above the deck, R-25 minimum in CZ6 (Table R806.5). Raises the roof surface, and that thickness is added to the tie-in heights.
- **Vent area:** net free area = attic floor ÷ 150. ÷300 is allowed only in CZ6 (assumed 6B, UNVERIFIED for Ravalli) with a warm-side Class I/II vapor retarder **and** 40–50% of the vent area high (R806.2). Shown as "Need 307 sq in; ridge vent gives X, soffit gives Y" (RF-VENT-01).
- **Baffles:** keep 1 in of air space at the eaves (R806.3).
- **Attic access:** 22x30 when the attic is ≥30 in high over ≥30 sf (RF-ATTIC-01).
- **Shed under an eave** has no ridge to vent from, so the app defaults to unvented spray foam.
- **Overlay triangle** over the old roof: unvented dead space. Warn that it should be vented or filled, per the engineer or manufacturer.

### Step 8: Covering and underlayment
The enum matches wizard `roofCovering`. The common choices are shown; the rest sit under "More".

| id | Min pitch | Weight (UNVERIFIED) | Snow behavior | HD category / refs |
|---|---|---|---|---|
| asphalt_shingle (architectural default, 3-tab) | 2:12; double underlayment below 4:12 | ~2.5–4.5 psf | Holds snow, ice dams → ice barrier required in MT | Roof Shingles: `shingles_bundle` $42.97, starter, ridge cap |
| metal_panel_lapped (5V, ribbed) | 3:12 | ~1–1.5 psf | Sheds suddenly → snow guards | Metal Roofing: `metal_5v_26x8` $29.98, `metal_smrib_3x*` $39.98–79.98 |
| metal_panel_lapped_sealant | 1/2:12 | | | |
| metal_standing_seam | 1/4:12 | | Best shedding; needs snow guards | Not stocked at HD, PRICE NEEDED |
| metal_shingle | 3:12 | | | |
| roll_roofing | 1:12 | ~0.9 psf | Short life | `roll_roofing_mineral` $50.47/100 sf |
| modified_bitumen | 1/4:12 | | | `modbit_sa_cap_100` $139 + base (PRICE NEEDED) |
| single_ply (EPDM/TPO) | 1/4:12 | | | `tpo_6x50` $285; EPDM special order |
| built_up, liquid_applied, tile, slate, wood | per R905 | | | hidden by default |

Minimums are from IRC R905.2.2, R905.4.2, R905.5.2, R905.10.2 and R905.9.1/.11.1/.12.1/.13.1; tile, slate and wood are in `code_citations`.

Underlayment (`roofing.underlayment`):
- Synthetic by default.
- `double_synthetic` is forced for shingles from 2:12 up to 4:12 (V-ROOF-02).
- `self_adhered_full` is offered for low slopes.

**Ice barrier** (Montana R905.1.2, required for shingles, metal shingles, roll roofing, slate and wood):
- Coverage runs from the eave edge to 24 in inside the exterior wall line.
- At 4:12 with a 12 in overhang that is 36 in level, which is **37.95 in up the slope**. One 36 in roll is short, so the app uses **2 courses** (RF-ICE-01).
- At ≥8:12, coverage must also be at least 36 in measured along the slope.
- This corrects content-v3's 3 ft assumption.

### Step 9: Valleys and flashing
**Where valleys form** (computed, not drawn): wherever two planes meet at an inside corner. That means a gable tie-in into the house roof, L- or T-shaped footprints, dormers, and the back corners of a hip tie-in. The user "places" valleys indirectly:
- Pitch moves the tie point up or down the old roof and swings the valley angle. Equal pitches give 45°.
- Ridge height and wall height shift the valley foot.
- Ridge direction decides whether valleys exist at all.
- The plan shows the valley lines and the tie point with dimensions. Dragging the ridge end in plan changes the pitch (inverse calculation).

**Placement rules (warnings):**
- No skylights, vents or chimneys within 18 in of a valley (guidance, UNVERIFIED).
- Never end a valley into a wall without a cricket.
- The valley foot must land on an eave edge (the new or the old eave), not mid-slope.
- If the tie point is within 1 ft of the existing ridge, RF-TIE-02 blocks.

**Valley types** (`valleys.type`):

| id | Copy | Lining | Notes |
|---|---|---|---|
| `closed_cut` (default) | Shingles from one side run through; the other side is cut 2 in back. | 36 in self-adhered (ASTM D1970) | Best fit for snow and HD stock (R905.2.8.2) |
| `woven` | Both sides lapped across. | 36 in self-adhered | Many architectural shingles prohibit weaving. Check the product (UNVERIFIED) |
| `open_metal` | Exposed W-metal channel. | Metal ≥24 in wide over 36 in ice & water | HD in-stock W-valley is **18 in**, which does not comply. 24 in is special order (RF-VALLEY-01) |

**Valley framing:**
- Overlay (California): 2x10 valley boards laid flat, with jacks from the boards to the ridge.
- Cut-in: valley rafters one size deeper than the jacks (R802.4.3), with a header. Not allowed through trusses without a truss engineer.

**Crickets / saddles:**
- Required behind any penetration wider than 30 in (R903.2.2).
- Auto-proposed for `gable_parallel_cricket`.
- Proposed wherever a roof slopes into a wall.

**Flashing pieces** (auto-added in the takeoff):

| Piece | Where | Rule |
|---|---|---|
| Step | Slope meets a sidewall | One 4x4x8 per course (R905.2.8.3) |
| Kick-out | Bottom of each roof-to-wall line at an eave | One each (R903.2.1, RF-KICK-01) |
| Headwall / apron | Top of a shed against the house | Continuous L flashing, 4 in up the wall under the siding (R905.2.8.4) |
| Counter flashing | Masonry, or where the siding can't lap | Continuous |
| Pitch-break | `shed_into_roof_plane` transition | Continuous transition metal, with ice & water on both sides |
| Drip edge | Eaves and rakes | R905.2.8.5 |
| Pipe boot | Each vent pipe | One each |

### Step 10: Skylights, penetrations, snow guards
- **Skylight objects:** size, curb or deck mount, face, distance from ridge.
  - A ≥4 in curb is required below 3:12 (R308.6.8).
  - Double the rafters each side when more than one rafter is cut (guidance).
  - Price: PRICE NEEDED.
- **Penetrations:** plumbing vent, bath fan, stove pipe, chimney. Rules: cricket over 30 in wide, keep clear of valleys, boot per pipe.
- **Snow guards:** default on for metal coverings over doors, walkways or lower roofs.
  - Metal: `snow_guard_clear_25` $59.99 for 25.
  - Shingle guards: PRICE NEEDED.

### Step 11: Review
All warnings are grouped as block, warn or info, with chips that fix them, using the same severity model as wizard §8. Block items stop "I'm done" until they are resolved or acknowledged, per wizard rules.

## 2. Tie-in math (summary; formulas in `roofing-takeoff-rules.md`)
Heights are top of roof sheathing above the **addition floor**. When the floors are flush this equals the house floor; otherwise add `floorDropFt`.

- **Roof surface over a wall:** `plate + (HAP + sheathingIn + foamAboveIn)/12`.
- **Shed under the eave:**
  - Highest possible roof top at the house: `eaveUnderside + floorDrop − flashingClearIn/12` (default 5 in = the 4 in flashing leg + 1 in).
  - Max pitch = `12·(that − lowRoofTop)/run`.
  - If that comes out ≤0, or below the covering minimum, RF-TIE-01 offers: lower the high wall, step the floor down, tie into the roof slope, or switch to a gable tie-in.
- **Shed into the roof plane:** the tie distance up the old roof is `a = (zNewAtWall − zExistAtWall)/((pe − pn)/12)`.
- **Extend plane:** `zOuter = zExistAtWall − run·pe/12`.
- **Gable into roof:**
  - `zRidge = zEaveLine + (W/2)·pn/12`
  - tie point `aTip = (zRidge − zExistAtWall)·12/pe`
  - the valley follows `zNew + u·pn/12 = zExist + a·pe/12` from the governing eave edge to the tip
  - with equal pitches and heights: plan angle 45° and true length = run × √(2 + (p/12)²)

## 3. Rendering notes (view3d.js / generate.js)
- **Coordinates:** plan (x, y) maps to 3D (x, z), with 3D y up. This matches `buildRoof`. Keep the existing objects (`rafter {a,b,zA,zB,size}`, `beam role ridge`, `area role outline`, pitch label) and add:
  - `{type:'rafter', props:{role:'hip'|'valley'|'jack'|'barge'|'common', ...}}`
  - `{type:'beam', props:{role:'valleyBoard'|'ledger'|'ridgeBeam'}}`
  - `{type:'area', props:{role:'roofFace', faceId, poly3d:[[x,y,z]...]}}`, one per plane, used for sheathing, covering and the takeoff
  - `{type:'line', props:{role:'valley'|'hip'|'ridge'|'eave'|'rake'|'tieLine', a3, b3}}`
- **Gable:** as today. Add gable-end infill triangles (studs) and barge rafters.
- **Shed:** wizard `shedGeometry`: one plane, rafters from the low eave tip to the high eave tip, no ridge. A high-side wall that rises (rake walls) uses `plateHeightEndFt`.
- **Hip:**
  - Ridge length `L − W` (equal pitch); hips run from the ridge ends to the eave corners.
  - Faces: two trapezoids and two triangles.
  - Jacks every `oc`, cut where they meet the hip. Hip members are boxes along the 3D hip line, `rotation.y = −atan2(dy, dx)` and `rotation.z = atan2(dz, hz)`, the same as rafters.
  - Unequal pitches: compute the ridge position from per-face runs and draw the hips as plane-plane intersection lines.
- **Half-hip / dutch / saltbox:** gable faces plus the clip triangle, the hip plus a gable-cap triangle, and an offset ridge respectively.
- **Flat:** one plane at `slopeInPerFt`, drawn with a 2 in-thick membrane color.
- **Valleys / tie-in:**
  - Build each new roof face as a polygon. Clip it against the existing roof plane using a half-space test on `zExist(a)`, keeping the part above the existing surface.
  - The clipped edge is the valley line; draw it as a darker line and, in "framing" view, as a valley board.
  - The existing house mesh (site `existing` box, `heightFt`) needs an **existing roof prism** built from `existingRoof.pitch`, `roofTopAtWallFt`, `ridgeDistFt` and `overhangIn`, so the intersection is visible.
  - Render it semi-transparent (`PLAN.ghostOpacity`), and remove or cut back the existing eave over the addition when `cutBackExistingEave`.
- **Overlay triangle:** draw it on top of the old roof. Show a dashed outline of the old roof underneath.
- **Under-eave shed:** draw the eave underside line on the house wall and a red clearance band (`flashingClearIn`) when RF-TIE-01 fires.
- **Labels:** pitch arrows point downslope on each face. Show the tie-point height and valley lengths as dimension strings in plan and 3D.

## 4. Wizard hooks (extends wizard-v1 intents; same tool and preview flow)
| Example command | Intent | Fields set |
|---|---|---|
| "put the roof higher at one end so it goes from 10 ft to 8 ft" | `roof.make_shed` (wizard) | `shape='shed'`, `shed{highWallId,highPlateFt:10,lowPlateFt:8}`, derived `pitch`. **New:** run RF-TIE-01/02 against `existingRoof` before preview |
| "make the roof 6/12" / "make it 22 degrees" | `roof.set_pitch` | `pitch` (degrees→X:12) |
| "high side against the house" | `roof.make_shed` | `shed.highWallId = attachToExistingWallId`, `slopeAwayFromHouse:true` |
| "tie the roof into the house roof" | **new** `roof.set_tie_in` | `tieIn.type` (auto by shape), asks for `existingRoof.pitch` if missing (RF-TIE-04) |
| "tuck the shed under the eave" | `roof.set_tie_in` | `tieIn.type='shed_under_eave'` → reports the max pitch |
| "how high does the new roof meet the house roof?" | `ask.value` | reads tie height and tie distance |
| "where do the valleys go?" / "how long are the valleys?" | `ask.value` | valley foot, tip and true lengths |
| "my house roof is 4/12 and the eave is 7 ft 11 in off the floor" | **new** `roof.set_existing` | `existingRoof.pitch`, `eaveUndersideFt` |
| "it's a manufactured home" | `roof.set_existing` | `homeType='hud_manufactured'` → ledger is blocked by default |
| "use an open metal valley" | **new** `roof.set_valley` | `valleys.type` |
| "run the ridge toward the yard" | `roof.set_ridge_direction` | `ui.ridgeRelativeToHouse='perpendicular'` → `ridge` |
| "make it a hip roof" | `roof.set_shape` | refused (V-ROOF-08) until generated. Numbers only |
| "vaulted ceiling" | **new** `roof.set_ceiling` | `ceiling='cathedral'`, `ridgeType='beam'` → RF-RIDGE-01 |
| "use trusses" | `roof.set_framing` | `framing='trusses'` |
| "2x10 rafters at 16 inches" | `roof.set_framing` | `rafterSize`, `rafterOcIn` |
| "18 inch overhangs, 12 at the gable ends" | `roof.set_overhang` | `overhangIn`, `rakeOverhangIn` |
| "our snow load is 60 psf" | **new** `roof.set_snow` | `snow.groundSnowPsf=60, source='user'` (rounded up to the 70 table) |
| "add gutters" / "no gutters" | **new** `roof.set_eave` | `eave.gutters` |
| "add a skylight over the middle" | **new** `roof.add_skylight` | `roof.objects += skylight` |
| "add snow guards" | **new** `roof.set_snow_guards` | `snowGuards.enabled` |
| "step the floor down two steps" | `roof.set_tie_in` (+ floor layer) | `tieIn.floorDropFt=1.29` |
| "use metal roofing" | `roof.set_covering` (wizard) | `roofing.covering='metal_panel_lapped'` → V-ROOF-01 at <3:12 |

Wizard clarification chips (≤12 words):
- "Your house eave is lower than that. Pick one:" `Lower high wall to X (Y:12)` · `Step floor down` · `Tie into house roof` · `Gable instead`
- "Is your home HUD-manufactured or modular?" `HUD (red label)` · `Modular` · `Site-built` · `Not sure`

## 5. Issue for wizard-v1 (cross-check)
wizard-spec §10 recommends Jake's **10 ft → 8 ft shed with the high side at the house** (1.5:12). The roof top over a 10 ft high wall is about **10.96 ft** above the floor, so the house eave would need to be **≥11.4 ft** above the floor for the shed to tuck under it. Older modular eaves are usually about 8 ft.

The wizard should run RF-TIE-01 before previewing that shed once `existingRoof` is known. Until then it should ask for the eave height. See worked-example §A.

## 6. Open questions for Jake
1. Is the home HUD-code manufactured (HUD label and data plate) or state modular? Can you get the manufacturer's add-on or ledger guidance?
2. House roof pitch, plus the height from the house floor to the underside of the eave at the wall where the addition goes.
3. Does the addition attach on the long (eave) side or at a gable end? How far is it from that wall to the ridge?
4. Does the house have trusses or rafters? What covering is on it now (and its color, for matching at the valleys)?
5. Will the addition floor be flush with the house floor, or a step or two down?
6. Vaulted ceiling or a flat ceiling with an attic? What covering do you want (shingles to match, or metal)?
7. Site ground snow load. Florence elevation is about 3,250 ft (UNVERIFIED). Use snowload.montana.edu or the Building Codes Bureau.
