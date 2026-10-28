# Building Layout — first draft

One building model, two views: a to-scale **Plan** (2D, cut at 4 ft) and a **3D** view of the construction layers stacked at their real elevations, with an **Exploded** mode. Built from `layers-spec-v1.md` (§7 data model, §8 build order).

## Run
```
python3 -m http.server 8850 --bind 127.0.0.1   # then open http://localhost:8850/
```
Static HTML/JS (ES modules), no build step. Three.js r170 + OrbitControls are vendored in `vendor/three/` (MIT). The model is saved in `localStorage` (`buildingLayout.model.v1`); use ⋯ → Reset to start over.

## Assumptions (easy to change)
| | Assumption | Where to change it |
|---|---|---|
| a | Standalone app that reuses HomePlan pieces (HomePlan itself is untouched) | `js/config.js` `ASSUMPTIONS`; ported logic is in `js/homeplan-derived.js` |
| b | Single story, but the model has a `levels: [{id:'L1'}]` array and `ASSUMPTIONS.allowMultipleLevels` | `js/model.js`, `js/config.js` |
| c | Phone first (390×844: touch pan, pinch zoom, bottom-sheet layer panel), plus desktop (right sidebar at ≥760 px) | `ASSUMPTIONS.phoneBreakpointPx`, `styles.css` |

All construction defaults from spec §6 (lumber, spacing, heights, pitch, overhangs, pier spacing, header table) are in `js/config.js` `DEFAULTS`.

## What works
- **Footprint:** a rectangle or polygon (L-shapes and so on), snap 1/6/12/16 in, drag a corner or edge, automatic exterior dimensions (overall plus per side). A 32×24 sample house is loaded.
- **Layers:** Site/Ground, Foundation, Floor framing, Walls, Roof framing, each with show/hide, lock, active, ghost and isolate controls. There is also a global "ghost non-active layers" option and custom layers (Deck, Porch and Notes presets, or your own z range) that you draw on with the Line tool.
- **Walls:** 2x6 exterior walls are derived from the footprint. You can draw 2x4 interior walls (mark them bearing) and place doors and windows. Headers are flagged with an EXAMPLE-only size.
- **Foundation:** crawlspace (default), slab, basement, or piers + grade beam. Piers are only under exterior walls and bearing interior walls, at the corners and at most 6 ft apart. Frost depth is blank until you enter it (flagged).
- **Floor:** PT sill, rim, 2x10 joists at 16 in o.c. across the short span (clipped to the shape), a flagged mid beam past 14 ft, and subfloor.
- **Roof:** 4:12 gable, 12 in overhang, 2x rafters at 24 in o.c., ridge on the long axis, optional sheathing in 3D.
- **Regeneration:** an upstream edit regenerates the layers that depend on it. Each changed layer gets a timestamped "Updated from …" note, and a banner lists them.
- **3D:** 3/4, Front, Side and Top cameras, Exploded mode, wall studs or solid walls, tap to select. **Plan ↔ 3D keeps the selection and the active layer** (both are stored in the model).
- **Properties:** a parameter form for each layer and an editor for the selected object (opening size, bearing wall toggle, delete).

## Stubs / not yet
- The Sheathing/envelope and MEP layers are listed under "Coming later" and are hidden and locked.
- Shed and hip roofs, gable-end framing, and a real roof over non-rectangular footprints. The gable spans the bounding box and is flagged.
- No posts or footings under the mid beam (flagged only), no stair, no undo, no second floor UI, no export or print.
- The header table is EXAMPLE only and is not a span calculator. Everything structural needs local code or engineer review.

## HomePlan reuse
`js/homeplan-derived.js` adapts four pieces of `/workspace/homeplan-publish/view3d.js`:
- pier placement (corners plus spacing, deduped)
- stud layout along a wall
- gable rafter geometry
- the `lumberAlong` mesh helper

The 2D plan, the layer system, the regen engine and the UI are new.

## Judgment calls (spec was open)
- The footprint is the outside face of the framing, and exterior walls are offset inward by t/2. Footprint edits count as Walls edits, so they need Walls active and unlocked.
- Studs and plates are computed when drawn and are not stored. Joists, rafters, piers and footings are stored as objects with `derivedFrom`.
- Foundation top above grade: crawlspace 24 in, piers 30 in, slab/basement 8 in. With a placeholder 24 in frost depth, the drawing shows footings until the real value is entered.
- Pier spacing is treated as a maximum of 6 ft (the low end of the spec's 6–8 ft).
- The exploded gap is 4 ft (the spec says "e.g. 2 ft"; 4 reads better on a phone).
- A slab foundation means no floor framing layer content.
- Choosing a tool switches the active layer to the one it draws on (Wall/Door/Window → Walls, Line → the active custom or Site layer).
- Selecting something opens the Properties tab.
- Regen notes stay on each layer (with a time) until the next change.

## Verify
```
python3 tests/verify.py   # 50 checks, phone 390x844 + desktop 1280x800, writes screenshots/
python3 tests/extras.py   # L-shape, bearing interior wall + piers, door, custom layer, solid walls
```
Needs Playwright plus Chrome (`/usr/bin/google-chrome`). `screenshots/` is git-ignored.
