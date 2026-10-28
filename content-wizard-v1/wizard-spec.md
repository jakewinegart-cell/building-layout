# Building Layout: "Wizard" chat box, content spec v1

**Status:** content and spec only. No app code was changed.
**Date:** 2026-10-28 (America/Denver).
**For:** App Builder, implementing the wizard in `/workspace/layout-app` (live: https://jakewinegart-cell.github.io/building-layout/).
**Companion files:**
- `wizard-commands.json`: machine-readable intents, slots, model fields touched, validation rules, the IRC min-slope table, and tool/function schemas.
- `wizard-tests.json`: 24 test phrases, each with the expected parsed intent and the expected model change.
- `reference/shed-roof-example.mjs`: the calculation behind §10. It imports `studLayout` from `js/homeplan-derived.js` read-only.

Jake's request [pt24u]: *"Can you build a wizard in to the app that I can ask questions of? Like hey, put the roof higher at one end so it goes from 10ft to 8feet"*

---

## 1. What the wizard is

The wizard is a chat box, a bottom sheet on phones and a side panel on desktop. The homeowner types plain English. For each message the wizard does exactly one of these:

1. **Answers a question.** It uses the current model, the takeoff, and the content files (`content-v3/*`). It never makes up a number.
2. **Asks one short clarifying question.** The question is 12 words or fewer, followed by 2–5 tappable option chips (§6).
3. **Proposes a change.** It shows a **preview** (a ghosted diff in Plan and 3D, plus a takeoff delta and any warnings) with **Apply / Change / Cancel** buttons. Applying calls `regenerate()`, which redraws Plan, 3D and the Home Depot-priced takeoff. Every apply can be undone.

### Recommended architecture

```
user text ──► LLM call (system prompt §1.1 + model summary §2.3 + tools from wizard-commands.json)
                 │   returns ONE tool call: answer_question | ask_clarification | propose_edit
                 ▼
          app code (deterministic, no LLM):
            1. resolve references  (wall "north"/"back"/"the long wall" → w-ext-0; "one end" → candidates)
            2. normalize units      (ft/in strings → ft or in, using parseFtIn from js/piers.js)
            3. build ops[]          (typed patch ops on real model paths, §4)
            4. validate             (rules V-* in §8 → block | warn | info)
            5. dry-run on a clone   (structuredClone(model) → apply ops → regenerate(clone, source) → takeoff)
            6. preview              (diff model vs clone, show warnings + takeoff delta)
          user taps Apply ──► push undo snapshot → apply ops to the real model → app.commit(source)
```

- **The LLM only parses and explains. It never writes the model.** Code does all the geometry, all the code checks, and all the math. If the LLM returns an out-of-range or unknown value, validation blocks it and the wizard asks again.
- **Use one LLM call per user turn**, with tool/function calling, temperature 0. Send the tool schemas in `wizard-commands.json → llm_tools`.
- **No network means no wizard.** Without an LLM endpoint, the wizard shows "Wizard needs a connection." A small regex fallback for `undo`, `what's the pitch` and `what does it cost` is optional.
- **Key handling:** the app is a static GitHub Pages site. App Builder must not ship an API key in the client. Use a user-supplied key stored in localStorage, or a small proxy (for example a Cloudflare Worker or Vercel function). Jake has to choose which. That decision is open in §12.

### 1.1 System prompt (content; App Builder may tighten it)

> You are the Building Layout wizard for a homeowner designing a small one-story addition. Pick exactly one tool. Use `propose_edit` only for changes the user asked for. Copy the numbers and units exactly as the user said them; app code converts and checks them. If something needed is missing or could mean two things (which wall, which end is high, inches vs feet, wall height vs roof height), call `ask_clarification` with 2–5 short options. Don't guess. Questions use `answer_question`. Answer from the MODEL SUMMARY and TAKEOFF SUMMARY you are given. Never invent prices, code values or span sizes. If a value isn't in the data, say so and point to the building department. Plain words, 1–3 sentences, US units (ft-in). Structural sizes (headers, beams, rafters, footings, piers) are EXAMPLES that must be verified. Say so whenever you mention one.

---

## 2. The building model the wizard edits (real field names)

These are read from `js/model.js`, `js/config.js` (`DEFAULTS`), `js/generate.js`, `js/piers.js`, `js/edit-ops.js` and `js/takeoff.js`, and checked against `content-v3/takeoff-rules.json → model_paths`.

### 2.1 Existing fields (v3)

| Area | Path | Values / notes |
|---|---|---|
| Footprint | `m.footprint` | `[[x,y],…]` ft, the **outside face of framing**. Plan coords: **x → east, y → south** (`geom.js`). Default sample 32×24; the content example uses 20×16 `[[0,0],[20,0],[20,16],[0,16]]`. |
| Units | `m.units` | `'ft-in'` |
| Layers | `m.layers[]`, `getLayer(m,id)` | ids `site, foundation, floor, walls, roof, sheathing(stub), mep(stub)` |
| Site | `site.params.setbacksFt {front, rear, side}`, `grade {type:'flat'|'slope', slopePct, downhill:'N'|'S'|'E'|'W'}`, `lot` | front = **south (+y)** edge, rear = north |
| Existing buildings | site objects `{type:'area', props:{role:'existing', label, heightFt}}` | e.g. the "Existing shed" button. This is where "the house" lives on the site plan. |
| Foundation | `foundation.params.type` | `'slab'|'crawlspace'|'basement'|'piers'` |
| | `frostDepthIn` (null = not entered → `placeholderFrostIn` 24), `topAboveGradeIn.{type}`, `footingWidthIn`, `footingDepthIn`, `stemWallIn`, `basementWallFt`, `slabIn` | |
| | `pierSpacingMode 'max'|'exact'`, `pierSpacingIn` (72), `pierDiaIn` (12), `deletedAutoSlots[]`, `placeDiaIn`, `placeTopIn`, `placeDepthIn`, `gradeBeamDepthIn` (12), `gradeBeamWidthIn` (12), `soilType 'unknown'|'normal'|'expansive'` | |
| Pier objects | `{type:'pier', geometry:{c:[x,y]}, z, height, props:{diaIn, auto|manual, topIn, depthIn, onWall, autoSlot, flags}}` | auto piers have `derivedFrom: wallId`; manual piers have none |
| Grade beams | `{type:'beam', props:{role:'gradeBeam', widthIn}}` on every **bearing line** (`bearingLines()` = exterior + interior `bearing:true`) | |
| Floor | `floor.params.sill`, `sillSize`, `joistSize` ('2x10'), `joistOcIn` (16), `direction 'auto'|'x'|'y'`, `subfloorIn`, `subfloor`, `beamFlagSpanFt` (14), `showSubfloor`; `computed {runAxis, spanFt}` | span > 14 ft → flagged mid beam `role:'girder'` |
| Walls (layer) | `walls.params.extSize` ('2x6'), `intSize` ('2x4'), `studOcIn` (16), **`plateHeightFt` (8)**, `bottomPlates` (1), `topPlates` (2) | one plate height for the whole level today |
| Wall objects | `{id:'w-ext-<i>', type:'wall', geometry:{a,b,edge:i}, props:{exterior, bearing, size, thicknessIn, studOcIn}}` | exterior wall `i` = footprint edge `i→i+1` on the centerline. Interior: `uid('w')`, `exterior:false`, `bearing` toggle. |
| Openings | `{type:'opening', geometry:{wallId, t}, props:{kind:'door'|'window', widthIn, heightIn, sillIn, swing:'in'|'out', header, headerFlag}}` | `t` = center, ft along the wall from `a`. Defaults: door 36×80 sill 0; window 36×48 sill 30. `header` comes from `HEADER_EXAMPLE` (`config.js`): ≤36 in 2-2x6, ≤60 in 2-2x8, ≤72 in 2-2x10, else "2-2x12 (verify — long span)". |
| Roof | `roof.params.shape 'gable'|'shed'|'hip'`. **Only `gable` is generated in v3.** `generate.js` flags "Only gable is generated in v1; shed and hip are coming." | |
| | `pitch` (4, rise in 12), `overhangIn` (12), `rafterOcIn` (24), `rafterSize` ('2x8'), `ridge 'long'|'short'`, `showSheathing`, `ceilingJoistSize 'auto'`; `computed {ridgeAlongX, rise, ridgeZ}` | rafters: `{type:'rafter', geometry:{a,b}, props:{zA, zB, size}}`; ridge: `beam role:'ridge'`; outline: `area role:'outline'`; pitch label `label` |
| Estimate | `m.estimate {taxRatePct, contingencyPct, deliveryUsd, laborUsd, concreteMode 'auto'|'readymix'|'bags80'|'bags60', iceBarrier}` | |
| View | `m.view 'plan'|'3d'`, `m.selection {layerId, objectId}`, `m.activeLayerId`, `m.snapIn` | the wizard may set `selection` to highlight |

Write path: change the model, then call `app.commit(source)` with `source ∈ footprint|walls|foundation|floor|roof|site`. That runs `regenerate(m, source)`, marks downstream layers "Updated from …", saves, refreshes Plan and 3D, and marks the price report stale (`reportCtl.markStale()`).

### 2.2 Proposed fields the wizard needs (App Builder adds them; not in v3)

| Proposed path | Purpose | Notes |
|---|---|---|
| `roof.params.shed = { highWallId, highPlateFt, lowPlateFt }` | Shed / single-slope roof | `highWallId` is an exterior wall id (`w-ext-i`). The low wall is the opposite parallel exterior wall. **`roof.params.pitch` is then derived**: `(highPlateFt − lowPlateFt) / run × 12`, where `run` = the footprint distance between the outside faces of the high and low walls. Keep `pitch` filled so `takeoff.js` `slopeK` keeps working. |
| wall `props.plateHeightFt` (at `a`) and `props.plateHeightEndFt` (at `b`) | Per-wall heights: tall wall + two rake (sloped-top) walls | Null = use `walls.params.plateHeightFt`. A rake wall has different values at `a` and `b`. |
| `roof.params.roofing = { covering, underlayment }` | Roofing material, needed for the min-slope rule | Already listed in `content-v3/takeoff-rules.json → missing_fields` ("roof.params.roofing {underlayment, shingleProduct}"). Covering enum in `wizard-commands.json → enums.roofCovering`. Default `'asphalt_shingle'`, which matches the v3 takeoff. |
| `m.attachToExistingWallId` + `ledger {size, fastener}` | The addition is built against the house | Already listed in `missing_fields`. Drives "slope away from house", ledger/flashing lines, and the engineer trigger in `instructions.md` §"When to bring in an engineer". |
| `m.wizard = { log: [...] }` (optional) | Chat transcript for this device | Keep the **undo stack out of the saved model** (§7). |
| `m.jurisdiction` (from content-v4 zip pop-up, being written concurrently) | Ground snow load, frost depth, adopted IRC edition | If it exists, the wizard quotes it; if not, it says "ask your building department". Don't depend on its exact shape yet. |

**Shed generation (needed before the roof intents can apply):** add a `shedGeometry(runFt, lowTopZ, highTopZ, overhangIn)` next to `gableGeometry` in `homeplan-derived.js`.
- `p = (highTopZ − lowTopZ)/runFt`; `eaveLowZ = lowTopZ − oh·p`; `eaveHighZ = highTopZ + oh·p`.
- Generate one rafter per station (`rafterOcIn`) running low-eave-tip → high-eave-tip, with `props.zA=eaveLowZ`, `props.zB=eaveHighZ`. The two end stations are barge/fly rafters.
- No ridge beam. Add an outline `area role:'outline'` and a pitch label with an arrow pointing downslope.
- Set walls `o.height` per wall: the high wall is `highPlateFt`. The rake walls go from `highPlateFt` at the high end to `lowPlateFt` at the low end.
- `computed = { shedAxis:'x'|'y', highEdge, rise, highZ, lowZ, runFt }`.
- Until this exists, the wizard must **not** apply shed intents. Reply: "Shed roofs aren't drawn yet in this version. I can show you the numbers." Then answer with the math only (§10) and nothing changes.

### 2.3 Model summary sent to the LLM each turn (built by app code, compact)

```json
{"footprint":{"w":20,"d":16,"rect":true},"walls":[{"id":"w-ext-0","side":"north","len":20},{"id":"w-ext-1","side":"east","len":16},{"id":"w-ext-2","side":"south","len":20},{"id":"w-ext-3","side":"west","len":16}],
 "plateHeightFt":8,"extSize":"2x6","studOcIn":16,
 "openings":[{"id":"d1","kind":"door","wall":"south","widthIn":36,"heightIn":80,"t":10},{"id":"win1","kind":"window","wall":"north","widthIn":36,"heightIn":48,"t":10}],
 "roof":{"shape":"gable","pitch":4,"overhangIn":12,"rafterSize":"2x8","rafterOcIn":24,"ridgeAlong":"east-west","covering":"asphalt_shingle"},
 "foundation":{"type":"piers","pierCount":14,"pierDiaIn":12,"pierSpacingIn":72,"frostDepthIn":null},
 "floor":{"joistSize":"2x10","joistOcIn":16,"spanFt":16,"midBeamFlagged":true},
 "existing":[{"label":"House","side":"north","touching":true}],"attachToExistingWallId":null,
 "takeoff":{"materials":"$… EXAMPLE","byLayer":{"roof":"$… EXAMPLE"},"snapshotDate":"2026-10-28","flags":["…"]},
 "selection":null,"view":"plan"}
```

---

## 3. Conventions the wizard uses

- **Heights:** "wall height" = `plateHeightFt` = **top of the top plate above the subfloor**. Today 8 ft. A bare "10 ft" said about a roof end means **wall height at that end**, not height above the ground. If the user says "off the ground", "above grade" or "ridge", the wizard asks. The ground-to-plate offset is `walls.zBase` = top of floor framing. For the 20×16 example on piers that is 3.46 ft.
- **Slope run:** measured **between the outside faces** of the high and low walls, i.e. the footprint dimension. That gives Jake's 16 ft and 20 ft. The centerline value is shown as a footnote (§10).
- **Pitch** is written `X:12` (inches of rise per foot). Also show it in degrees, and the percent when it's under 2:12.
- **Directions** use plan view with north up: north = back = top of screen = −y; south = front = bottom = +y (site `setbacksFt.front` is south); east = right = +x; west = left = −x.
  - In **3D view**, "left/right/front/back" depend on the camera. The wizard resolves them from the camera, **always highlights the wall it picked** in the preview, and says "the west wall (on your left)".
- **Wall references:** exterior walls are matched by compass side (from each wall's outward normal), by length ("the long wall" = the longest pair; if two are equally long, ask which side), by contents ("the wall with the door"), by the current `m.selection` ("this wall"), or by `attachToExistingWallId` ("the house side"). Interior walls are matched by selection, or by "the wall between …" if rooms ever get labels; otherwise ask.
- **Units:** accept `10ft, 10 ft, 10', 10 feet, ten feet, 8'6", 8 ft 6 in, 8-6, 102", 102 in, 1.5:12, 1-1/2 in 12, 3/12, 3 in 12, 14°`. Normalize with `parseFtIn()` (js/piers.js). Rules:
  - A bare number with no unit, said about a length or height, is ft if it's ≥ 4 and in if the slot is an opening width/height ("make the window 48" = 48 in). Otherwise ask.
  - `"` / `in` / `inch` = inches; `'` / `ft` / `foot` / `feet` = feet.
  - A pitch given in degrees is converted (`12·tan θ`) and shown as X:12.
  - "a foot higher" or "2 ft more" = relative: add to the current value.

---

## 4. Intent catalog

The full schema is in `wizard-commands.json → intents`. Each edit intent compiles to typed **ops**: `set(path, value)`, `setWall(wallId, props)`, `moveEdge(edgeIndex, offsetFt)`, `setFootprint(points)`, `addOpening(...)`, `removeObject(layerId, id)`, `moveOpening(id, t)`. These are applied by code that reuses `edit-ops.js` helpers: `placeOpeningAt`, `addInteriorWall`, the `applyDrag` edge-move math, and `piers.js` `dropPier` / `snapPier` / `deletePier`.

| Intent id | Example | Touches | Regen source |
|---|---|---|---|
| `roof.make_shed` | "put the roof higher at one end so it goes from 10 ft to 8 ft" | `roof.params.shape='shed'`, `roof.params.shed{highWallId,highPlateFt,lowPlateFt}`, derived `roof.params.pitch`, wall `props.plateHeightFt/EndFt` | `roof` (and `walls` for the heights) |
| `roof.set_pitch` | "make the roof 6/12" | `roof.params.pitch`. For a shed, this re-derives `highPlateFt` and asks which end moves. | `roof` |
| `roof.set_shape` | "make it a gable again" | `roof.params.shape` (`hip` is refused: not generated) | `roof` |
| `roof.set_ridge_direction` | "run the ridge the other way" | `roof.params.ridge 'long'|'short'` | `roof` |
| `roof.set_overhang` | "18 inch overhangs" | `roof.params.overhangIn` | `roof` |
| `roof.set_framing` | "use 2x10 rafters at 16 inches" | `roof.params.rafterSize`, `rafterOcIn` | `roof` |
| `roof.set_covering` | "use metal roofing" | `roof.params.roofing.covering` (proposed) | `roof` (takeoff only) |
| `walls.set_height` | "make the walls 9 feet" / "raise the north wall to 10'" | `walls.params.plateHeightFt`, or wall `props.plateHeightFt` | `walls` |
| `walls.move_exterior` | "move the east wall out 2 feet" | `m.footprint` (edge offset along the inward normal, same as the `edge` drag) | `walls` |
| `footprint.resize` | "make it 24 by 16" / "make it 2 ft deeper" | `m.footprint` (rect: keep the anchor corner; ask which side grows if unclear) | `footprint` |
| `walls.add_interior` | "add a wall across the middle, north to south" | new wall via `addInteriorWall` | `walls` |
| `walls.move_interior` / `walls.delete` | "move that wall 3 ft west" / "delete this wall" | wall `geometry.a/b`, or removal + its openings | `walls` |
| `walls.set_bearing` | "make that a bearing wall" | wall `props.bearing` (adds a grade beam + piers on that line) | `walls` |
| `walls.set_framing` | "2x4 exterior walls", "studs at 24 o.c." | `walls.params.extSize`, `intSize`, `studOcIn` | `walls` |
| `openings.add` | "add a 36 inch window on the west wall" | new opening (`kind`, `widthIn`, `heightIn`, `sillIn`, `geometry.wallId`, `t`) | `walls` |
| `openings.remove` | "remove the window on the east wall" | remove opening | `walls` |
| `openings.move` | "move the door 3 ft to the left" / "center the door" | opening `geometry.t`, or `geometry.wallId` | `walls` |
| `openings.resize` | "make the door 6 ft wide" | opening `props.widthIn`, `heightIn`, `sillIn`; `header` re-derived | `walls` |
| `openings.set_props` | "door swings out" | `props.swing`, `props.kind` | `walls` |
| `foundation.set_type` | "switch to a slab" | `foundation.params.type` | `foundation` |
| `foundation.set_params` | "frost depth is 36 inches", "12 inch tubes every 6 ft" | `frostDepthIn`, `pierDiaIn`, `pierSpacingIn`, `pierSpacingMode`, `topAboveGradeIn.piers`, `gradeBeamDepthIn/WidthIn`, `soilType` | `foundation` |
| `foundation.add_pier` | "add a pier under the middle of the floor" | **blocked by V-FND-01** if not on a wall line; otherwise `dropPier` at `snapPier` | `foundation` |
| `floor.set_framing` | "2x12 joists so I don't need the middle beam" | `floor.params.joistSize`, `joistOcIn`, `direction` | `floor` |
| `site.set_existing` / `site.attach` | "the house is on the north side" / "it's attached to the house" | site existing object placement; `m.attachToExistingWallId` (proposed) | `site` |
| `estimate.set` | "tax is 8.81%", "add $150 delivery" | `m.estimate.taxRatePct`, `deliveryUsd`, `contingencyPct`, `laborUsd`, `concreteMode`, `iceBarrier` | none (re-price only) |
| `ask.value` | "what pitch is that?", "how tall is the high wall?" | read only | none |
| `ask.cost` | "what does this cost?", "what did that change cost?" | read takeoff (EXAMPLE) | none |
| `ask.why` | "why do I need a grade beam?", "why is that flagged?" | read flags + content | none |
| `ask.code` | "can I use shingles on this?" | min-slope table §8.2 | none |
| `ask.howto` | "how do I set the piers?" | `instructions.md` sections | none |
| `meta.undo` / `meta.redo` / `meta.apply` / `meta.cancel` / `meta.show` | "undo", "yes do it", "never mind", "show me" | undo stack, pending preview | — |

**Multi-step requests** like "make it 24×16 and put a door on the south wall" become one preview with several op groups, applied and undone as a single step. The limit is 3 groups. Beyond that the wizard says "Let's do these one at a time" and previews the first.

---

## 5. Slot extraction

| Slot | Accepts | Resolver (code) |
|---|---|---|
| `length` / `height` | ft/in strings (§3) | `parseFtIn`; reject ≤ 0 or > 40 ft |
| `heightPair` | "from 10 ft to 8 ft", "10 down to 8", "8 on one side 10 on the other", "high side 10, low side 8" | high = max, low = min, whatever order they're said in. If one equals the current `plateHeightFt` (8), say "keeping the low wall at 8 ft". |
| `pitch` | "4/12", "4:12", "4 in 12", "four twelve", "4 pitch", "18°" | → number (rise per 12) |
| `end` / `side` | "one end", "the back", "north", "the house side", "left", "the long side", "the short end" | `resolveWallSide()`: list candidate exterior walls. "One end" / "one side" = **all 4 candidates → ask** (§6), unless `attachToExistingWallId` is set. Then propose high = house side and ask only to confirm. |
| `wallRef` | "north wall", "this wall", "wall with the door", "back wall", "the long wall" | compass → `w-ext-i` by outward normal; "this" → `m.selection`; ties → ask |
| `openingRef` | "the door", "the window on the east wall", "the left window" | match by kind + wall + order along the wall; several matches → ask with chips that name the wall and position ("North window, 10 ft from the west corner") |
| `position` | "3 ft from the corner", "centered", "in the middle", "next to the door", "move it 2 ft left" | → `t` along the wall. "Left/right" on a wall = as seen **from outside** that wall (state this in the preview). Snap to `m.snapIn`. |
| `size` (opening) | "36 inch", "3 ft", "36 by 48", "3-0 6-8" (door trade size = 36×80) | `widthIn`, `heightIn` |
| `material` | "metal", "standing seam", "corrugated", "rubber roof / EPDM", "TPO", "rolled roofing", "shingles", "2x10" | enums in `wizard-commands.json` |
| `direction` | "north–south", "east–west", "the short way" | floor `direction 'x'|'y'|'auto'`; roof `ridge 'long'|'short'` |
| `money` / `percent` | "$150", "8.81 %" | `m.estimate` fields; tax is never assumed |

---

## 6. Clarification policy

- Ask **only** when a required slot is missing, or when two readings would give different models. Ask **one** question per turn, in 12 words or fewer, with **2–5 option chips**. Each chip carries its consequence where it's cheap to compute (pitch, cost direction). Free text is always allowed.
- When a clarification comes back, merge it with the earlier slots. Don't re-ask anything already answered.
- **Never ask about things with safe defaults.** Keep the current overhang, rafter spacing, etc. List those in the preview as "kept: …".
- Templates (content):

| Situation | Question | Chips |
|---|---|---|
| Shed "one end", rectangle 20×16 | "Which side is the high (10 ft) side?" | `North (back) → 1.5:12` · `South (front) → 1.5:12` · `East → 1.2:12` · `West → 1.2:12` |
| Shed, existing house touching a wall | "High side against the house, sloping away?" | `Yes, high at house (recommended)` · `No, pick another side` |
| Height meaning unclear ("roof at 10 ft") | "10 ft wall height, or 10 ft above the ground?" | `Wall height (top of wall)` · `Above ground` |
| Pitch too low for the covering (V-ROOF-01) | "Shingles need 2:12 or more. What would you like?" | `Metal panels` · `Membrane (EPDM/TPO/mod-bit)` · `Steeper: high side to 10' 8"` · `Keep & show warning` (only when the rule says warn; for block rules, this chip is missing) |
| Two equal long walls | "Which long wall, north or south?" | `North` · `South` |
| Footprint grows | "Which way should it grow?" | `East` · `West` · `Both sides evenly` |
| Opening ambiguous | "Which window?" | `North window (10 ft in)` · `East window (8 ft in)` |
| Pier mid-span (V-FND-01) | "Piers only go under walls. Want one of these instead?" | `2x12 joists, no mid beam` · `Add a bearing wall there` · `Cancel` |

---

## 7. Preview → Apply → Undo

1. **Preview** (nothing saved yet):
   - Run the ops on `structuredClone(model)` and call `regenerate(clone, source)`. Run `takeoff()` / the reference engine on the clone.
   - **Plan:** changed objects drawn in the accent color, with removed ones dashed, and new dimension strings (e.g. wall heights at both ends, pitch arrow).
   - **3D:** show the clone. For about 1.5 s, ghost the before-roof at 30% (`PLAN.ghostOpacity`).
   - **Card text:** one-line summary, a "what changes" list (max 6 bullets), warnings (red = block, amber = warn), and a **takeoff delta** grouped by layer: lines added, removed and changed, with qty and EXAMPLE $. The card ends with "Prices: Home Depot online snapshot 2026-10-28, not a Denver store, EXAMPLE".
   - **Buttons:** `Apply` · `Change…` (re-opens the chips) · `Cancel`. Typing "yes", "do it" or "apply" = Apply.
2. **Apply:**
   - Push `{label, before: JSON.stringify(model minus view state), at}` onto `undoStack`. Keep the last 20 in memory, mirrored in `sessionStorage`.
   - Apply the same ops to the real model and call `app.commit(source)`. Toast: "Roof changed to shed 10' → 8' (1.5:12). Undo".
   - A **block** rule disables Apply. Warnings need no extra confirmation, but they stay visible on the layer as `flags`.
3. **Undo / redo:** "undo", the toast button, or Ctrl/Cmd-Z restores the snapshot, then `regenerate(model,'init')` and `refresh({all:true})`. Redo is available until the next new edit. Undo covers **wizard edits and manual edits** if App Builder hooks `app.commit` (recommended). At minimum, it covers wizard edits.
4. **Stale report:** after Apply the price report shows "out of date". The wizard's own cost answer always re-runs the takeoff on the current model.

---

## 8. Validation and safety rules

Severities:
- **block** = can't apply.
- **warn** = applies, the warning stays.
- **info** = shown only.

Every message carries its source. All of these are code checks over the clone after regeneration (`wizard-commands.json → validations`).

### 8.1 Foundation (Jake's rule, from content-v3)

- **V-FND-01 (block): piers only under wall lines and at corners, never mid-span.** A grade beam runs on those same lines.
  - Sources: `content-v3/README.md` §6 "Jake's foundation rule"; `instructions.md` §piers step 5; `homeplan-derived.js` `piersAlongLines` ("Piers only under wall edges, never mid-span").
  - Code: a pier whose center is farther than `PIERS.offWallTolFt` (0.5 ft) from every wall in `bearingLines()` is blocked.
  - Offer instead: deeper joists to clear-span (e.g. 2x12; the content example shows the −$194.64 EXAMPLE alternative), or mark/add a bearing wall (adds a grade beam + auto piers on that line).
- **V-FND-02 (warn):** moving or reshaping walls can leave manual piers off a line. `regenerate()` already flags these ("FLAGGED … kept, not deleted"). The wizard repeats the flag and offers "Move them back under the walls" (snap with `snapPier`) or "Reset to auto".
- **V-FND-03 (warn):** `floor.computed.spanFt > beamFlagSpanFt` (14) → flagged mid beam with unsupported ends. This conflicts with V-FND-01. Suggest the 2x12 clear-span check ("verify span table").
- **V-FND-04 (info):** frost depth not entered → footings and piers sit at the 24 in placeholder. "Ask your building department." If content-v4 has a jurisdiction value, quote it with its source.
- **V-FND-05 (warn):** `soilType:'expansive'` → engineered piers / soils report (`instructions.md` engineer triggers).
- **V-FND-06 (info):** grade beam bottom above grade (`topAboveGradeIn.piers − gradeBeamDepthIn > 0`) → suspended forms and shoring (takeoff-rules.md).

### 8.2 Roof covering vs slope: IRC R905 minimums

The wizard compares `roof.params.pitch` to `roof.params.roofing.covering`. "Min" means the slope must be ≥ the value.

| Covering (enum) | Min slope | Extra rule | IRC section | Verified |
|---|---|---|---|---|
| `asphalt_shingle` | **2:12** | **2:12 up to 4:12 → double underlayment** per R905.1.1 / Table R905.1.1(2) | R905.2.2 | yes (2021 + 2024 text) |
| `clay_concrete_tile` | 2-1/2:12 | 2-1/2:12 to 4:12 → double underlayment | R905.3.2 | yes (2024) |
| `metal_shingle` | 3:12 | — | R905.4.2 | yes (2024) |
| `roll_roofing` (mineral-surfaced) | 1:12 | — | R905.5.2 | yes (2021 + 2024) |
| `slate` | 4:12 | — | R905.6.2 | yes (2024) |
| `wood_shingle` / `wood_shake` | 3:12 | — | R905.7.2 / R905.8.2 | yes (2024) |
| `built_up` | 1/4:12 (coal-tar 1/8:12) | — | R905.9.1 | yes (2024) |
| `metal_panel_lapped` (exposed-fastener, ribbed/corrugated, **no** lap sealant) | **3:12** | — | R905.10.2 item 1 | yes (2021 + 2024) |
| `metal_panel_lapped_sealant` (lapped, nonsoldered, with applied lap sealant) | **1/2:12** | sealant per manufacturer | R905.10.2 item 2 | yes |
| `metal_standing_seam` | **1/4:12** | — | R905.10.2 item 3 | yes |
| `modified_bitumen` | 1/4:12 | — | R905.11.1 | yes (2021 + 2024) |
| `single_ply` (EPDM thermoset / TPO-PVC thermoplastic) | 1/4:12 | — | 2021: R905.12.1 (thermoset), R905.13.1 (thermoplastic); 2024: R905.12.1 (single-ply) | yes |
| `liquid_applied` | 1/4:12 | — | R905.14.1 (2024) | yes (2024) |

Sources (read 2026-10-28):
- 2021 IRC as adopted in the 2022 Connecticut State Building Code: https://up.codes/viewer/connecticut/irc-2021/chapter/9/roof-assemblies
- 2024 IRC (GSA): https://up.codes/viewer/general-services-administration/irc-2024/chapter/9/roof-assemblies
- Cross-check: https://buildingcodetrainer.com/minimum-roof-slopes-required-by-roofing-material/
- codes.iccsafe.org returned 403 to this fetch, so the ICC site itself was not read.

Rules:
- **V-ROOF-01 (block):** pitch < covering minimum. Message: "{covering} needs at least {min}:12 (IRC {section}). This roof is {pitch}:12." Offer chips: covering options that pass at this pitch, or the smallest height change that reaches the minimum.
- **V-ROOF-02 (warn):** `asphalt_shingle` with 2 ≤ pitch < 4 → "Needs two layers of underlayment (IRC R905.2.2, Table R905.1.1(2))." The takeoff should double the underlayment quantity; App Builder should add a rule variant.
- **V-ROOF-03 (warn), metal panels:** "Your panel's own instructions can require more slope than code. Many exposed-fastener panels need 3:12 unless the laps are sealed. Check the product sheet." Code minimums are not product approvals; the manufacturer, local code and warranty can be stricter.
- **V-ROOF-04 (info):** pitch < 2:12 → treat as **low-slope**. Mention ice barrier/underlayment per manufacturer (R905.1.2 ice barrier applies where the jurisdiction designates ice damming, Table R301.2), snow drift, and drainage off the low edge (R903.4: roofs must drain over the edges or to drains).
- **V-ROOF-05 (warn), rafter span:** the wizard shows the **horizontal** rafter span (IRC R802.4.1 measures spans on the horizontal projection) and says "Check this rafter size against the IRC rafter span tables for your snow load (R802.4.1), or ask your engineer." **The wizard never sizes rafters.**
- **V-ROOF-06 (warn):** rafter length + trim > the longest priced stock (20 ft in `homedepot-prices.json`) → "No single board that long in the price list. Rafters can't be spliced mid-span without support. Options: LVL / special-order length, or a supported beam." A beam needs a bearing line, so V-FND-01 applies to it.
- **V-ROOF-07 (info):** going gable → shed removes the ridge, ridge cap, collar ties and gable-end framing. Ceiling joists are **typically** not needed as rafter ties when every rafter bears on a wall at both ends (no ridge thrust). Keep them if you want a flat ceiling. Verify. The wording follows R802.5.2 / R802.3: ties or a designed ridge are required for rafters meeting at a ridge.
- **V-ROOF-08 (block):** `shape:'hip'` → "Hip roofs aren't generated yet."

### 8.3 Walls, openings, headers

- **V-WALL-01 (warn): stud height.** IRC Table R602.3(5) allows a **10 ft laterally unsupported stud height** for 2x4 and 2x6 bearing walls; R602.3.1 exceptions allow taller studs in limited cases. Source: https://up.codes/viewer/connecticut/irc-2021/chapter/6/wall-construction (verified).
  - Stud length = `plateFt×12 − 1.5×(bottomPlates+topPlates)`.
  - Warn when a wall's stud length > 120 in, i.e. a plate height above about 10' 4". A 10 ft plate gives 115.5 in studs: OK, no warning.
- **V-WALL-02 (warn), header / opening span:** headers come from `HEADER_EXAMPLE` (config.js) and are always "EXAMPLE header — verify".
  - Opening `widthIn > 72` → "2-2x12 (verify — long span)". The wizard adds "a wide opening like this usually needs an engineered header".
  - In a 2x6 wall, a 2-ply header is 3 in thick in a 5.5 in wall: add a 3rd ply or filler (`instructions.md` walls step).
- **V-WALL-03 (block), opening fit:** the opening must fit inside its wall.
  - `widthIn/12 + 2×(1.5 in jack + 1.5 in king)/12 ≤ wall length − 0.6 ft` (regen clamps `t` to 0.3 ft from each end).
  - Openings must not overlap (rough openings + king/jack studs).
  - `sillIn + heightIn` must leave room for the header under the plate. On a rake wall, use the plate height at that `t`.
- **V-WALL-04 (warn):** an opening within about 2 ft of a corner → corner bracing / shear note ("verify with your building department").
- **V-WALL-05 (info):** moving or reshaping the footprint drops openings whose wall no longer exists. `regenerate()` reports "N opening(s) removed". The wizard lists them in the preview **before** apply.
- **V-SITE-01 (warn):** the footprint crosses a setback line (`regenerate` flag "Footprint crosses a setback line.").
- **V-ATTACH-01 (warn):** `attachToExistingWallId` set, or "tie into the house" → engineer / permit trigger (`instructions.md`: "The addition attaches to the existing house: ledger, new opening in an existing wall, or tying into the existing roof").

### 8.4 Money and wording (from pricing-rules.md)

- Every dollar figure the wizard says is an **EXAMPLE** from the 2026-10-28 homedepot.com snapshot (HD's default online store, **not Denver**).
  - A `verified:false` price is called an "estimate", never "Home Depot's price".
  - A missing price is "needs a price". It's never $0 silently.
- When the wizard talks about the total, it quotes the required disclaimer (short form): "Estimate, not stamped plans. Prices from a Home Depot online snapshot 2026-10-28 (not localized). Structural items need your building department or an engineer."
- Tax: only if `m.estimate.taxRatePct` is set. Never assume it.

---

## 9. Question answering (what the wizard says)

| Question | Answer source | Example answer (20×16 defaults) |
|---|---|---|
| "what pitch is that?" | `roof.params.pitch` (+ `computed`) | "4:12 (about 18.4°). The roof rises 2' 8" from the walls to the ridge, which runs east–west." |
| "how tall is the roof?" | `roof.computed.ridgeZ`, `walls.zBase` | "The ridge is about 14' 1-1/2" above the ground, 10' 8" above the floor." |
| "what does this cost?" | `takeoff()` totals by layer | "About $X materials (EXAMPLE, HD online snapshot 2026-10-28, not Denver). Roof $Y, walls $Z… Tax isn't included until you enter your rate." |
| "what did that change cost?" | takeoff delta from the last undo snapshot | "+$… EXAMPLE: 116-5/8 in studs replace 92-5/8 in on 3 walls; the shingles are gone and the metal roofing needs a price." |
| "why do I need a grade beam?" | `instructions.md` piers + Jake's rule | "Your piers only sit under walls, so the grade beam ties them together and carries the wall between piers." |
| "why is the middle beam flagged?" | floor flag + README §6 | "The floor spans 16 ft, past the 14 ft the app allows without a beam. That beam has no piers under it, and piers only go under walls, so 2x12 joists that clear-span are usually better. Verify the span table." |
| "can I use shingles on this?" | §8.2 | "Not at 1.5:12. Asphalt shingles need 2:12 or more (IRC R905.2.2), with double underlayment up to 4:12." |
| "how do I frame a rake wall?" | `instructions.md` walls + §10 | step list. The app's instructions template needs a rake-wall step: content gap, see §12. |

If the data doesn't hold the answer: "I don't have that in the plan data. Your building department or a pro can answer it." **No outside facts get invented.** Code facts are limited to `wizard-commands.json → code_facts`.

---

## 10. Worked example: Jake's command

> **"put the roof higher at one end so it goes from 10ft to 8feet"**

The model is the content-v3 example 20×16 addition on piers, from `content-v3/reference/example-20x16.model.json`:
- Footprint `[[0,0],[20,0],[20,16],[0,16]]`; walls `w-ext-0` N (20 ft), `w-ext-1` E (16 ft), `w-ext-2` S (20 ft), `w-ext-3` W (16 ft).
- 2x6 @ 16 in, `plateHeightFt 8`; floor top / `walls.zBase` = 3.458 ft above grade.
- Roof gable 4:12, 2x8 @ 24 in, 12 in overhang, ridge E–W.
- Openings: door `d1` on S, `win1` on N, `win2` on E.

### 10.1 Parse

```json
{"tool":"propose_edit","intent":"roof.make_shed",
 "slots":{"heightPair":{"high":"10ft","low":"8feet"},"end":"one end","heightMeaning":"wall"}}
```

- The code normalizes high = 10 ft and low = 8 ft. The low height equals the current `plateHeightFt`, so the low wall stays as built and the high wall is raised 2 ft. The drop is 2 ft.
- `end:"one end"` doesn't name a side, so the wizard must ask.
- **Against the existing house, a shed roof normally slopes *away* from the house:** the high side is at the house wall and water runs off the far edge, not into the joint between the buildings.
  - If `attachToExistingWallId` is set, or a site `role:'existing'` object touches one wall, the wizard pre-selects that wall as high and asks only "High side against the house, sloping away? [Yes, recommended] [No, pick another side]".
  - Otherwise it asks:

> **Which side is the high (10 ft) side?**
> `North (back) · 1.5:12` · `South (front) · 1.5:12` · `East · 1.2:12` · `West · 1.2:12`
> *Tip: if this is against your house, the high side usually goes at the house so water runs away from it.*

### 10.2 Resulting pitch, both ways

| | A. High side on a **20 ft** wall (N or S); slopes across the **16 ft** depth | B. High side on a **16 ft** wall (E or W); slopes along the **20 ft** length |
|---|---|---|
| Pitch (outside faces) | **2 ft / 16 ft = 0.125 → 1.5:12** (7.13°, 12.5%) | **2 ft / 20 ft = 0.10 → 1.2:12** (5.71°, 10%) |
| Pitch on wall centerlines (15.54 / 19.54 ft) | 1.544:12 | 1.228:12 |
| Rafters (24 in o.c. incl. 2 barge) | **12** (10 bearing) | **10** (8 bearing) |
| Rafter horizontal run incl. 2 × 12 in overhang | 18 ft | 22 ft |
| Rafter length (`hypot`) | **18.14 ft** (18' 1-11/16"); +0.5 ft trim = 18.64 → **20 ft stock** | **22.11 ft** (22' 1-5/16"); +0.5 = 22.61 → **longer than any priced stock** (V-ROOF-06) |
| Horizontal clear span between bearing walls | ≈ 15.54 ft centerline → **check R802.4.1 tables** (V-ROOF-05) | ≈ 19.54 ft → almost certainly beyond sawn 2x at 24 in o.c. Engineer / LVL. |
| Eave tips (overhang along slope) | low tip 1.5 in below the low plate; high tip 1.5 in above the high plate | 1.2 in below / above |
| Roof surface (plan × slope) | 18.14 × 22 = **399.1 sq ft** (3.99 sq) | 22.11 × 18 = **398.0 sq ft** |
| Rake-wall triangles (infill above 8 ft) | 2 × (16 × 2 / 2) = **2 × 16 sq ft** | 2 × (20 × 2 / 2) = **2 × 20 sq ft** |

**Recommendation the wizard gives:** option A. It has the shorter rafters that fit 20 ft stock and the steeper pitch, and it puts no new beam or pier line inside the footprint. Option B's 22 ft rafters need special lengths or a mid-support, and any mid-support needs its own bearing line under Jake's pier rule.

### 10.3 Model diff (option A, high side = north `w-ext-0`, e.g. against the house)

```diff
 roof.params.shape:            'gable'  →  'shed'
+roof.params.shed:             { highWallId:'w-ext-0', highPlateFt:10, lowPlateFt:8 }
 roof.params.pitch:            4        →  1.5          (derived; 1.544 on centerlines)
 roof.params.ridge:            'long'   (unused for shed; kept for switching back)
+roof.params.roofing.covering: 'asphalt_shingle' → requires change (V-ROOF-01), see 10.5
 walls.params.plateHeightFt:   8        (unchanged = low wall + default)
+w-ext-0 (N, 20 ft) props.plateHeightFt: 10            tall wall
+w-ext-1 (E, a=N→b=S) props.plateHeightFt: 10, plateHeightEndFt: 8   rake wall
+w-ext-3 (W, a=S→b=N) props.plateHeightFt: 8,  plateHeightEndFt: 10  rake wall
 w-ext-2 (S, 20 ft): 8 (default)                        low wall
 roof.objects: rafter-0…rafter-23 (24, gable pairs)  →  rafter-0…rafter-11 (12, x = −1,1,…,19,21)
     each geometry a=[x,17] (low eave tip, S) b=[x,−1] (high eave tip, N)
     zA = 3.458+8−0.125 = 11.333 ft,  zB = 3.458+10+0.125 = 13.583 ft (above grade)
 roof.objects: ridge (beam role ridge, 22 ft)  →  removed
 roof.objects: roof-outline 22×18 (unchanged plan), roof-pitch label "1.5:12" arrow → south
 roof.computed: {ridgeAlongX, rise 2.667, ridgeZ 14.125} → {shedAxis:'y', highEdge:0, rise:2, highZ:13.458, lowZ:11.458, runFt:16}
 walls.zTop: 11.458 → 13.458 (max); layer roof.zBase follows the low wall
 openings: unchanged; win2 on the E rake wall at t = 8 ft has plate ≈ 9 ft there: OK (V-WALL-03)
```

**Stud lengths** (2x6, 16 in o.c., 1 bottom + 2 top plates = 4.5 in):

| Wall | Plate | Stud length | Studs (o.c. positions, before kings/jacks/corners) | Stock |
|---|---|---|---|---|
| N `w-ext-0`, tall | 10 ft | **115-1/2 in** (was 91-1/2) | 16 | 116-5/8 in precut (`lumber_2x6_stud116`) |
| E / W, rake walls (each 16 ft) | 10 → 8 ft | **115.4 → 91.6 in**, dropping 2 in per 16 in (1.5 in 12). At 16 in o.c.: 115.4, 113.5, 111.5, 109.5, 107.5, 105.5, 103.5, 101.5, 99.5, 97.5, 95.5, 93.5, 91.6. Each top is cut at 7.1°. | 13 each, ≈ 112 lf each | cut from 116-5/8 in precut |
| S `w-ext-2`, low | 8 ft | 91-1/2 in (unchanged) | 16 | 92-5/8 in precut |

- The rake top plates run on the slope: 16 × 1.0078 = **16.12 ft**, which no longer fits 16 ft stock. Use 20 ft or splice over a stud.
- These walls are **rake walls**: full-height studs following the slope. The alternative is an 8 ft wall with a separate triangular infill (gable-style) on top. The wizard offers the rake wall by default because it's stiffer and is what the takeoff counts. The triangles are 16 sq ft each, up to 2 ft tall.
- Option B (high side E or W) is the same pattern with 20 ft rake walls: 16 studs each, 115.4 → 93.1 in, triangles 20 sq ft. The tall wall is 16 ft with 13 o.c. studs.

### 10.4 Takeoff changes (option A vs the v3 gable example)

All $ are **EXAMPLE** unit prices from `content-v3/homedepot-prices.json` (homedepot.com snapshot 2026-10-28, default online store, **not Denver**; "est." = `verified:false`). The app must re-run the engine; these hand numbers show the direction only.

| Line (`content-v3` rule id) | Gable (v3 example) | Shed 10'→8', 1.5:12 | EXAMPLE effect |
|---|---|---|---|
| `roof.rafters` | 24 rafters 2x8, 9.49 ft → 26 × 2x8×10 | 12 rafters, 18.14 ft → ≈13 × 2x8×20 (est. $26.40) | ≈ +$10 (est.). **Size not checked:** at 2x10×20 ($30.92) ≈ +$69 |
| `roof.ridge` | 2 × 2x10×12 | none | −$38.24 |
| `roof.ridgeCap` | 1 bundle | none | −$62.97 |
| `roof.collarTies` | 6 × 2x4×8 | none | −$25.50 |
| `roof.ceilingJoists` | 11 × 2x8×16 (EXAMPLE size) | typically not needed as ties (V-ROOF-07); optional if you want a flat ceiling | −$232.32 if dropped |
| `roof.gableFraming` | 5 × 2x6×8 | none (it's the rake walls now) | −$43.10 |
| `roof.hurricaneTies` | 20 (1 per bearing rafter) | **20** (10 bearing rafters × 2 walls). The rule needs a shed variant: 2 per bearing rafter. | $0 |
| `roof.sheathing` (7/16 OSB) | 417.4 sq ft → 15 sheets | 399.1 sq ft → 14 sheets | −$13.63 |
| `roof.underlayment` | 1 roll | 1 roll; check the covering's required underlayment (some low-slope systems want full self-adhered) | $0 / needs a price |
| `roof.iceBarrier` | 2 eaves × 22 lf × 3 ft = 132 sq ft → 1 roll | 1 low eave × 22 × 3 = 66 sq ft → 1 roll | $0 |
| `roof.dripEdge` | 81.95 lf → 10 pcs | 80.28 lf → 9 pcs (if the high edge butts the house, that edge gets wall flashing instead: 58.3 lf → 7 pcs) | −$6.48 (to −$19.44) |
| `roof.shingles` + `roof.starter` + `roof.nails` | 14 bundles + starter + 3 boxes | **not allowed at 1.5:12** → replaced by the chosen low-slope covering | −$601.58 − $54.97 − $47.94; **new covering: needs a price** (not in the v3 snapshot) |
| `walls.studs` | 81 × 92-5/8 in (bulk $6.14) | ≈ 53 move to 116-5/8 in precut (N wall + 2 rake walls incl. corners, +10%), ≈ 28 stay | ≈ +$208 |
| `walls.plates` | 16 ft stock | rake top plates (2 walls × 2 plies) to 20 ft | ≈ +$2 |
| `walls.sheathing` / `walls.wrap` | perimeter × 8 + 42.7 sq ft gables | perimeter × 8 + 40 sq ft (tall wall +2 ft) + 32 sq ft (triangles) = +29.3 sq ft | +1 sheet ≈ +$13.63; wrap stays 1 roll |
| Lookouts (rakes) | 4 rakes × 9.49 ft | 2 rakes × 18.14 ft | ≈ $0 |

**Net (EXAMPLE, materials before tax and contingency):**
- About **−$660** with ceiling joists kept, or **−$890** with them dropped, **plus the new roof covering, which isn't priced yet.**
- The wizard must say: "Cheaper framing, but the metal or membrane roofing isn't priced yet, so the total isn't comparable until you choose one."

### 10.5 Warnings the preview shows (exact content)

1. 🔴 **V-ROOF-01 (block until resolved):**
   > "Asphalt shingles need a slope of at least **2:12** (IRC R905.2.2). Between 2:12 and 4:12 they also need **two layers of underlayment**. This roof would be **1.5:12**."
   >
   > Chips:
   > - `Metal standing seam (OK to 1/4:12, IRC R905.10.2)`
   > - `Metal panels with sealed laps (OK to 1/2:12)`
   > - `Membrane: EPDM / TPO / mod-bit (OK to 1/4:12, R905.11–13)`
   > - `Rolled roofing (OK to 1:12, R905.5.2)`
   > - `Steeper for shingles: high wall 10' 8" → 2:12`
   >
   > - To reach **2:12 over 16 ft**, the drop has to be **2' 8"** (10' 8" → 8', or 10' → 7' 4"). Over 20 ft it's 3' 4".
   > - **4:12** (single underlayment) needs 5' 4" over 16 ft. That would mean stud heights over the 10 ft limit (V-WALL-01).
   > - Exposed-fastener ribbed or corrugated panels **without** sealed laps need **3:12** (R905.10.2 item 1), so they don't work at 1.5:12.
2. 🟠 **V-ROOF-05:** "Rafters now span about 15' 6" between walls, double the gable's half-span. 2x8 @ 24 in was picked for the gable. Check the rafter size against the IRC span tables for your snow load (R802.4.1), or ask your engineer."
3. 🟠 **V-ROOF-03** (if metal is chosen): "Check your panel's minimum slope. The product sheet can be stricter than code."
4. ℹ️ **V-ROOF-04:** "Low-slope roof: make sure the low edge drains away from the house and walkways (IRC R903.4). Snow sits longer on a low slope."
5. ℹ️ **V-ROOF-07:** "Ridge, ridge cap, collar ties and gable framing removed. Ceiling joists aren't needed as rafter ties when rafters sit on walls at both ends. Verify."
6. ℹ️ **Option B only, V-ROOF-06:** "22 ft rafters are longer than any board in the price list and can't be spliced mid-span without support."
7. ℹ️ **V-ATTACH-01** (if against the house): "Building against the house (ledger, flashing, tying in) is a permit / engineer trigger."
8. ✅ V-WALL-01 passes: a 10 ft plate gives 115.5 in studs, within the IRC Table R602.3(5) 10 ft limit.

### 10.6 Wizard reply (final wording)

> Here's a shed roof: **10 ft at the north (house) wall, 8 ft at the south wall**. That's **1.5:12** (about 7°). The north wall gets 116-5/8" studs, the east and west walls become sloped "rake" walls, and the ridge and gable framing go away. Rafters are now 12 × 2x8, 18 ft 2 in long. **Shingles don't work at 1.5:12** (code minimum 2:12), so pick metal standing seam or a membrane, or raise the high wall to 10' 8" to keep shingles. Framing materials come out about $660 lower (EXAMPLE, HD online snapshot 10/28/2026), not counting the new roofing. **[Apply] [Change…] [Cancel]**

---

## 11. Tests

`wizard-tests.json` has 24 phrases. Each records:
- the model context
- the expected tool and intent
- the expected slots after normalization
- the expected clarification (if any)
- the expected ops / model change
- the expected validations

App Builder should run them twice:
1. Through the LLM with the tool schema, to check that parsing matches.
2. Through the deterministic layer with the parse fixed, to check that ops and validations match.

---

## 12. Open items / gaps (for Jake or App Builder)

1. **Shed (and hip) roof generation doesn't exist in v3.** `generate.js` only builds gables, and the roof panel lists "Shed (later)". The roof intents depend on §2.2 (`shedGeometry`, per-wall heights in `regenerate`, `plan.js`, `view3d.js`, `sheets.js`, `takeoff.js` + the reference engine).
2. **The takeoff rules need shed variants:** sheathing area = rafter length × eave length (not ×2), drip edge (2 eaves + 2 rakes, or a flashing edge at the house), hurricane ties (2 per bearing rafter), rake-wall studs, no ridge/ridge cap/collar ties, optional ceiling joists, and a double-underlayment rule from 2:12 to 4:12.
3. **Low-slope coverings have no prices** in `homedepot-prices.json`: standing seam, sealed-lap panels, EPDM, TPO, mod-bit, roll roofing, and their underlayments and edge trims. The price content worker needs to add them before the wizard can give a comparable total.
4. **The LLM key / proxy decision** is Jake's (§1).
5. **Rafter span tables** (R802.4.1) by snow load aren't in the content, so the wizard can only warn. A future content task could add an EXAMPLE table with sources, flagged verify.
6. `instructions.md` needs a **rake-wall / shed-roof framing step** (plus a ledger step if attached).
7. **The local adopted code edition** (Denver and other Colorado jurisdictions adopt the IRC with amendments) should come from content-v4 jurisdictions once it's done. The wizard should say "IRC (model code); your city's adopted version governs."
