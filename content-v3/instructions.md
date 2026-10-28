# Build instructions (template): content-v3

> **How to use this file (App Builder):** this is a template. `{curly_names}` are filled from the model or from the takeoff (`reference/takeoff-reference.mjs` → `report` and `lines`). The variable table at the bottom says where each one comes from. Blocks that start with `[if …]` show only when the condition is true. Keep the tone as is: plain language, like a friend who builds for a living walking you through it. These are **general** steps, not your local code. Your building department and your approved plans always win.

---

## Before you start

- **This is an estimate and a guide, not stamped plans.** Most additions need a building permit. A lot of jurisdictions also want drawings, and some want an engineer's letter. Call or visit your building department **before** you buy anything. Ask them for the frost depth, required footing and pier size, snow load, wind/seismic requirements, and the inspections you'll need to schedule.
- **Call 811 at least a few business days before you dig.** It's free, and it marks buried gas, power, water and data lines.
- **When to bring in an engineer** (typical triggers):
  - The addition **attaches to the existing house**: ledger, new opening in an existing wall, or tying into the existing roof.
  - Any beam or header **longer than the example table** covers, or anything the app marks **FLAGGED**. That includes the mid floor beam: `{floor_beam_flag}`.
  - **Expansive (swelling) clay soils.** They're common along the Colorado Front Range, so you may need a soils report and drilled or engineered piers.
  - Piers **taller than about 3 ft above grade**, elevated grade beams, heavy snow loads, steep slopes, or anything you can't find in the code's tables.
- **Safety basics, all the way through:** eye and ear protection, gloves, and a dust mask when cutting OSB or PT lumber. Lift with your legs, and get help for sheets, beams and long boards. Use fall protection or guardrails when you work over 6 ft, and work off a ladder that's set right (4:1 angle, extending 3 ft past the edge). Keep the saw guard on and unplug the saw before changing blades. Don't work on the roof when it's wet, windy or icy.

---

## 1. Layout: batter boards and square

1. Drive **batter boards** about 2–4 ft outside each corner: 3 stakes and 2 horizontal boards forming an "L". Set the board tops level with each other.
2. Stretch mason's line between the batter boards to mark the **outside face of the framing**. The footprint is `{footprint_w_ft}` ft × `{footprint_d_ft}` ft.
3. **Square it with 3-4-5.** From a corner, mark 3 ft along one line and 4 ft along the other. The diagonal between the marks must be exactly 5 ft. For more accuracy, use a multiple: 12-16-20 ft.
4. **Check the diagonals.** Both corner-to-corner measurements should equal **{diagonal_ft_in}**. Adjust the lines until they match within about 1/4 in.
5. Mark the pier centers from the plan (`{pier_count}` piers). Piers only go **under the wall lines and at corners, never mid-span**, and a grade beam runs along those same lines.

**Inspection:** some departments want to check setbacks and footing locations before you dig. Ask.

## 2. Foundation

[if foundation.type == 'piers']
1. Dig `{pier_count}` holes, each `{pier_diameter_in}` in diameter (a little wider than the tube) and **{pier_depth_in} in below grade**. The bottom must be **below your frost depth** on firm, undisturbed soil. `{frost_note}`
2. Put 2–3 in of compacted gravel in the bottom if your plans call for it. Set the **{pier_diameter_in} in form tubes (Sonotubes)**. Each pier needs about **{tube_length_in} in** of tube. Cut the tubes so the tops all sit at **{pier_top_above_grade_in} in above grade**, which is the bottom of the grade beam. Brace each tube plumb with stakes and 2x4s, then backfill around it in layers.
3. Set the rebar (EXAMPLE: {pier_bars} #4 verticals per pier). Leave the bars sticking up about 9 in so they tie into the grade beam.
4. Form the **grade beam**: `{grade_beam_width_in}` in wide × `{grade_beam_depth_in}` in deep along every wall line (`{grade_beam_lf}` lf). Run {grade_beam_bars} continuous #4 bars (EXAMPLE), lapped 24 in at splices, with L-bars at the corners. Use chairs so the bars have 3 in of cover.
   [if grade beam bottom above grade] **Heads up:** in this model the grade beam's bottom is **{pier_top_above_grade_in} in above the ground**. A suspended beam needs a supported bottom form and shoring, which is a lot of formwork for a DIY job. Ask your engineer or inspector whether you can cast it at grade instead.
5. **Pre-pour inspection.** Most departments inspect the holes, tubes and steel **before** concrete goes in. Don't pour until it's signed off.
6. **Pour.** You need about **{concrete_yd} cu yd** (≈ {bags80} × 80 lb bags). [if concrete_yd > 1] That much is a lot to mix by hand, so order **ready-mix** and line up helpers, a wheelbarrow or chute, and a vibrator or rod. Fill the piers first, then the grade beam, rodding as you go so you don't get voids.
7. While it's wet, set **{anchor_bolt_count} anchor (J) bolts**, 1/2 in × 10 in, along the center of the grade beam. Put one **within 12 in of each end** of every sill board and space the rest **no more than 6 ft apart**. Leave about 2.5 in sticking up, enough for the sill, washer and nut. Check them against a string line.
8. Keep the concrete damp and covered for several days, and protect it from freezing. Wait at least 3–7 days before loading it with framing.
[/if]
[if foundation.type == 'slab'] Excavate, compact the base, add gravel, and lay 6 mil poly. Form the thickened edge (`{footing_width_in}` in wide). Place the rebar, get the pre-pour inspection, then pour the `{slab_in}` in slab. Set the anchor bolts as above (plus one on each side of every door), then cure. [/if]
[if foundation.type in ('crawlspace','basement')] Dig and pour the footings (`{footing_width_in}` × `{footing_depth_in}` in) below frost. Footing inspection. Then the stem/foundation walls (`{stem_wall_in}` in), with anchor bolts as above, waterproofing/drainage per plans, and a foundation inspection before backfill. [/if]

**Safety:** wet concrete is caustic, so wear gloves, long sleeves and eye protection, and rinse off splashes right away. Bags are 60–80 lb, so lift carefully.

## 3. Sill and beams

1. Roll out **sill gasket** on the concrete.
2. Lay the **pressure-treated {sill_size} sill** on the gasket. Mark the bolt locations, drill, and drop it over the bolts. Add washers and nuts and snug them. Check it's level and square, and shim under with non-shrink grout, never wood shims.
3. [if floor beam] The app added a **mid beam ({floor_beam_desc}) that is FLAGGED**: it hasn't been sized and its supports aren't drawn. Under the rule that piers go only under walls, the better choice is usually **deeper joists that clear-span the width** (for example {alt_joist_size} @ {joist_oc_in} in; verify against the span tables). If you keep the beam, an engineer sizes it and its supports before you build. [/if]
4. Use **ZMAX/HDG connectors and fasteners** anywhere they touch PT lumber.

## 4. Floor joists

1. Stand the **{joist_size} rim joists** on edge at the outside edge of the sill. Toenail them to the sill.
2. Mark the joist layout on the rims at **{joist_oc_in} in on center**, measured from the same end on both sides. Put an X on the side of the line where each joist goes.
3. Install **{joist_count} joists**, spanning {joist_span_ft} ft. Crown up: sight down each board and put the hump on top. End-nail through the rim (3 × 16d) and toenail to the sill. [if hangers] At the flush beam, hang the joists in **face-mount hangers** and fill every nail hole with the specified nails. [/if]
4. Add doubled joists under any wall that runs parallel to the joists, and around floor openings.
5. **Framing inspection** of the floor system may be required before you sheathe it if the underside will be closed off. Ask.

## 5. Subfloor

1. Snap a line 48-1/8 in in from the edge for the first row. Run **{subfloor_sheets} sheets of 3/4 (23/32) T&G** with the long side **across** the joists, groove side toward you, and stagger the end joints by at least 2 joists.
2. Put a **bead of subfloor adhesive** on every joist under the sheet. Only lay as much glue as you'll cover in about 10 minutes.
3. Leave a 1/8 in gap at the panel ends; T&G edges get no gap. Nail with 2-3/8 in ring-shank nails at 6 in along the edges and 12 in in the field, or screw it down.

## 6. Walls

**Layout**
1. Snap chalk lines for the inside of each wall. The exterior walls are **{wall_ext_size}**, framed **{plate_height_ft} ft** tall overall.
2. Tack the bottom plate and one top plate together and mark the studs at **{stud_oc_in} in on center**, plus the corners, intersections and openings. Openings: {opening_list}.

**Framing** (build each wall flat on the deck)
3. Studs are **{stud_length_in} in** long. For an 8 ft wall, buy 92-5/8 precuts and trim 1-1/8 in (or build the wall 97-1/8 in tall). Nail through the plates with 2 × 16d per end.
4. At each opening:
   - **King studs** run full height.
   - **Jack (trimmer) studs** carry the header.
   - **Headers:** {header_list}. These come from the app's **EXAMPLE table — verify**. In a 2x6 wall, two 2x plies are only 3 in thick, so add a third ply or 2-1/2 in of rigid foam to fill the depth.
   - **Cripples** go above the header and below the window rough sill.
5. Build the **corners** with a backer stud or ladder blocking so there's nailing for drywall.

**Sheathe while it's flat** (optional, but faster and squarer)
6. Square the wall: the diagonals must match. Then nail on the **7/16 OSB**: 8d (2-3/8) at 6 in on the edges and 12 in in the field, with 1/8 in gaps. The house needs **{wall_sheets} sheets**. Cut out the openings after nailing.

**Raise, plumb, brace**
7. Raise the long walls first, with at least two people per 10 ft of wall. Nail the bottom plate to the rim and joists (16d at 16 in).
8. **Plumb** each corner with a level or plumb bob and hold it with temporary **diagonal braces** (2x4s staked or nailed to the deck). Keep the braces in until the roof is sheathed.
9. Add the **second top plate**, overlapping the corners and lapping the splices at least 4 ft from the joints below.

**Safety:** wind catches a raised wall like a sail, so brace as you go and don't raise walls in high wind.

## 7. Roof framing ({pitch}:12 gable, {overhang_in} in overhang)

1. **Ceiling joists / rafter ties:** **{ceiling_joist_size}** at 24 in (EXAMPLE, verify the span table). Lay them across the walls next to each rafter location. They keep the walls from spreading, so they're required unless an engineer designs a structural ridge beam.
2. **Ridge:** **{ridge_size}**, {ridge_length_ft} ft long including overhangs. The ridge sits about **{ridge_height_ft} ft above the top plate**. Hold it up on temporary posts that are braced plumb.
3. **Rafters:** **{rafter_count} × {rafter_size}** at **{rafter_oc_in} in on center**, each about **{rafter_length_ft} ft** long. Make **one pattern rafter**, test it at both ends of the building, then cut the rest from it. Cut a bird's-mouth seat about 1/3 of the rafter depth, no deeper. Install them in opposing pairs so you don't push the ridge out of line.
4. **Collar ties:** 2x4s in the upper third, on every other pair.
5. **Hurricane ties:** one **H2.5A** at every rafter-to-wall connection (**{hurricane_ties}**), with every nail hole filled.
6. **Gable ends:** frame the studs at {stud_oc_in} in under the end rafters. *The app doesn't draw these yet.* Add 2x4 lookouts for the barge (fly) rafters at the {overhang_in} in rake overhang.
7. **Roof sheathing:** **{roof_sheets} sheets of 7/16 OSB**. Check the stamp says 24/16 for rafters at 24 in, or use 1/2 in. Run the long side across the rafters, stagger the joints, use H-clips between rafters, leave 1/8 in gaps, and nail 6/12.
8. **Framing inspection:** walls, roof framing, connectors and shear nailing. This is usually before the wrap and roofing go on. Ask.

**Safety:** this is the most dangerous stage. Use fall protection, toe boards or roof jacks, a stable scaffold, and no one working alone.

## 8. Dry-in

1. **Drip edge at the eaves first**, with underlayment going over it.
2. **Ice & water barrier** [if ice barrier] along the eaves, at least 24 in inside the warm wall line. That's typical in cold climates like the Denver area, so check locally. [/if]
3. **Synthetic underlayment** over the whole deck, lapped as printed on the roll and fastened with cap nails. Then **drip edge on the rakes**, which goes on top of the underlayment.
4. **House wrap** on the walls, lapped shingle-style (upper over lower), with seams taped. Cut the openings in an I or modified-I pattern so you can fold the flaps in.
5. **Windows and doors:** sill pan or flashing first, then set the unit. Shim it plumb, level and square, and fasten through the nail fin or frame per the instructions. Then flash: **sides first, then the head**, with the wrap flap folded down over the head flashing. Shingle-lap everything so water always runs out and down. Check that the door's **jamb depth matches the {wall_ext_size} wall**.
6. **Shingles:** about **{roof_squares} squares (~{shingle_bundles} bundles)**. Put starter strip at the eaves (and rakes). Follow the manufacturer's offset and nail line, with 4 nails per shingle (6 in high wind). Finish with ridge cap.
7. **Final inspection** comes later, after mechanical, insulation and finishes, but the building is now weather-tight.

---

### Variable table (where each value comes from)

| Variable | Source |
|---|---|
| footprint_w_ft / footprint_d_ft | bbox of `m.footprint` |
| diagonal_ft_in | `hypot(w, d)` formatted ft-in (20×16 → 25 ft 7-7/8 in) |
| pier_count, pier_diameter_in | count/`props.diaIn` of foundation objects `type:'pier'` |
| pier_depth_in | `foundation.params.frostDepthIn ?? placeholderFrostIn` (or the pier's `props.depthIn` when set) |
| frost_note | if `frostDepthIn` is null: "Frost depth not entered. This uses a 24 in placeholder; Denver-area codes commonly use ~36 in, so verify." |
| pier_top_above_grade_in | `topAboveGradeIn.piers − gradeBeamDepthIn` |
| tube_length_in | `round(pier.height*12) + 2` |
| pier_bars, grade_beam_bars | `takeoff-rules.json` defaults.rebar (EXAMPLE) |
| grade_beam_width_in / depth_in / lf | `gradeBeamWidthIn`, `gradeBeamDepthIn`, Σ len of `role:'gradeBeam'` |
| concrete_yd, bags80, anchor_bolt_count | takeoff `report` |
| sill_size, joist_size, joist_oc_in | `floor.params.sillSize/joistSize/joistOcIn` |
| joist_span_ft, joist_count | `floor.params.computed.spanFt`, count of joists (no role) |
| floor_beam_flag / floor_beam_desc | present when a `role:'girder'` object exists |
| alt_joist_size | next size up from `joistSize` (EXAMPLE) |
| subfloor_sheets, wall_sheets, roof_sheets | takeoff `report` |
| wall_ext_size, stud_oc_in, plate_height_ft | `walls.params.extSize/studOcIn/plateHeightFt` |
| stud_length_in | `plateHeightFt*12 − 1.5*(bottomPlates+topPlates)` |
| opening_list, header_list | `opening.props` (kind, widthIn×heightIn, sillIn, header) |
| pitch, overhang_in, rafter_size, rafter_oc_in | `roof.params` |
| rafter_count, rafter_length_ft | count of `rafter` objects; `hypot(planLen, zB−zA)` |
| ridge_size, ridge_length_ft, ridge_height_ft | one size up from rafters; len of `role:'ridge'`; `roof.params.computed.rise` |
| ceiling_joist_size, hurricane_ties | takeoff lines `roof.ceilingJoists`, `roof.hurricaneTies` |
| roof_squares, shingle_bundles | takeoff `report.roofAreaSqFt/100`, `roof.shingles` line |

**Filled example (20×16 defaults):** "Set **14** Sonotubes, **12** in diameter, **24** in deep (placeholder frost depth), each about **44** in of tube, with tops at **18** in above grade." Diagonals 25 ft 7-7/8 in. 4.43 yd concrete (≈ 200 × 80 lb bags), so ready-mix. 16 anchor bolts. 2x10 joists @ 16 in spanning 16 ft, plus a FLAGGED mid beam. 92-5/8 in precut 2x6 studs trimmed to 91-1/2 in. 24 rafters, 2x8 @ 24 in, each ≈ 9 ft 6 in. Ridge 2x10, 22 ft. Ceiling joists 2x8 @ 24 in (EXAMPLE). 20 H2.5A ties. 4.2 squares ≈ 14 bundles.
