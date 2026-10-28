# Building Layout app: layers + plan/3D toggle, content spec v1
Owner: Remodel Guide (construction content). The UI is built by App Builder, coordinated by App Lead. Default sizes are typical US residential practice, not engineering. Anything structural should be checked by a local engineer or the building department.

## 1. Core idea
- One building model, many layers, two views. Plan view and 3D view are two ways of looking at the same data, so an edit in one shows up in the other.
- The user starts with a footprint, and each layer is generated from it with sensible defaults, then edited.
- Toggle: a **Plan / 3D** switch, always visible. It keeps the current selection and the active layer.

## 2. Layer stack (bottom to top)

| # | Layer | What it holds | Plan view shows | 3D view shows |
|---|---|---|---|---|
| 0 | **Site / Ground** | Lot boundary, setbacks, existing buildings, grade (flat or a slope direction plus % slope), north arrow, utilities (water, sewer, power, gas) as lines | Lot outline, dashed setback lines, hatched existing buildings, utility lines with labels | Ground plane with slope, existing buildings as grey boxes |
| 1 | **Foundation** | Type (slab / crawlspace / basement / piers), footing lines, pier positions, grade beam, slab outline, frost depth | Footings as dashed double lines, piers as circles, slab as a hatched area | Concrete grey footings, piers/sonotubes, grade beam, slab |
| 2 | **Floor framing** | Sill plate, rim joist, joists (size, spacing, direction), beams/girders, subfloor | Joists as thin lines at spacing with a direction arrow, beams bold, labels like "2x10 @ 16 in o.c." | Wood framing members on top of the foundation, subfloor toggle |
| 3 | **Walls / Wall framing** | Exterior + interior walls (thickness, height), studs, plates, headers, openings (doors/windows: width, height, sill height) | Walls as double lines, door swings, window breaks, dimension strings | Stud framing or solid-wall mode, with openings and headers |
| 4 | **Roof framing** | Roof shape (gable / shed / hip), pitch, overhang, ridge, rafters or trusses (spacing), ridge direction | Roof outline dashed past the walls, ridge line, rafter direction arrow, pitch label "4:12" | Rafters/trusses, ridge, fascia, sheathing toggle |
| 5 | *(later)* Sheathing / envelope | Wall and roof sheathing, house wrap, roofing, siding | Off by default | Skin over the framing |
| 6 | *(later)* MEP | Electrical, plumbing, HVAC runs | Symbols | Simple lines/boxes |

Layers 0-4 are v1. 5-6 are stubs so the list can grow ("as many layers as needed").

## 3. Layer controls (per layer)
- **Show / hide** (eye icon)
- **Lock** (no accidental edits)
- **Active layer**: new drawing goes here. Only one is active at a time.
- **Opacity / ghost**: layers other than the active one fade to about 30%, so you can trace framing over the foundation.
- **Isolate**: show only this layer.
- **Add layer**: a custom layer such as "Deck", "Porch" or "Notes", with a name, z-range and color.
- Order is fixed for the construction layers 0-4. Custom layers sit between them by z-height.

## 4. Plan view rules
- Top-down, drawn to scale. Units are ft-in, with a toggle for metric later.
- Snap to grid (default 6 in, options 1 in / 12 in / 16 in o.c.), and snap to wall ends and corners.
- **Cut height**: plan cuts at 4 ft above the active floor, like a real floor plan. Things above (roof, upper cabinets) are drawn dashed.
- Dimension strings on exterior walls are automatic. Overall and per-segment.
- Each layer has its own symbols (column "Plan view shows" above). Hidden layers aren't drawn.

## 5. 3D view rules
- Orbit / pan / zoom, plus preset cameras (front, side, top, 3/4 aerial).
- Layers stack by real elevation: grade at 0, then foundation top, then floor framing, top of subfloor, wall plate height, roof.
- **Exploded view** toggle: spreads layers apart vertically (e.g. 2 ft gaps) so you can see each one.
- The same show/hide/ghost state as plan view.
- Click a member in 3D and it selects the same object in plan.

## 6. Defaults (auto-generated from the footprint)

| Item | Default |
|---|---|
| Foundation | Crawlspace on a perimeter footing. Piers option: piers only under wall lines (corners plus every 6-8 ft along exterior/bearing walls), with a grade beam on those lines, not mid-span |
| Footing | 16 in wide x 8 in deep, bottom below frost depth (user enters it; the app doesn't guess the local code) |
| Foundation top above grade | 8 in minimum |
| Sill plate | 2x6 pressure-treated |
| Floor joists | 2x10 @ 16 in o.c., spanning the short direction. Add a mid beam if the span is over about 14 ft (flag it, don't size it) |
| Subfloor | 3/4 in tongue-and-groove |
| Walls | Exterior 2x6 @ 16 in o.c., interior 2x4 @ 16 in o.c., 8 ft plate height |
| Plates | Single bottom, double top |
| Headers | Flagged on every opening. The size comes from a simple table as an EXAMPLE, so verify it |
| Roof | Gable, 4:12, 12 in overhang, rafters/trusses @ 24 in o.c., ridge along the long side |

When the user changes something upstream (e.g. moves a wall), the layers that depend on it update: footing under the wall, joist layout and roof outline. They get a small "updated from walls" note, so changes aren't silent.

## 7. Data model (for App Builder)
```
Building
  footprint: polygon (ft)
  layers: [Layer]
Layer
  id, name, kind (site|foundation|floor|walls|roof|custom)
  zBase, zTop (ft from grade)
  visible, locked, opacity
  params: { ...kind-specific defaults from section 6 }
  objects: [Object]
Object
  id, type (wall|opening|pier|footing|joist|beam|rafter|line|area|label)
  geometry (2D plan coords) + height/elevation
  props (size, spacing, material)
  derivedFrom (optional: parent object id, for auto-generated items)
```
Plan view renders the 2D geometry. 3D extrudes it using zBase, height and the member sizes.

## 8. v1 build order (suggested)
1. Footprint drawing, plan view, grid/snap, dimensions
2. Layer panel (show/hide/lock/active/ghost)
3. Walls + openings in plan
4. Plan / 3D toggle with walls as solid boxes
5. Foundation layer (plan + 3D)
6. Floor framing, wall studs, roof framing generated from defaults
7. Exploded view, custom layers

## 9. Out of scope for v1
- Structural sizing or engineering (the app flags items, it doesn't certify them)
- Permit drawings
- Cost/materials (can reuse the remodel app's materials content later)

## 10. Open questions for Jake
- Is this a new standalone app, or the next version of the remodel/addition app, which already has a plan view and 3D? This spec assumes standalone and reuses those pieces.
- Single story only for v1, or a second floor layer from the start?
- Phone first, or desktop/tablet first? This changes how the layer panel and plan editing should work.
