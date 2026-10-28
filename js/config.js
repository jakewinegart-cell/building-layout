// ============================================================================
// config.js — every unconfirmed assumption and every default lives here.
// Change a value here; nothing else in the app hard-codes these.
// ============================================================================

/** Assumptions Jake has NOT confirmed yet (see README "Assumptions"). */
export const ASSUMPTIONS = {
  // (a) Standalone app (not the next version of HomePlan). Only affects branding/README;
  //     HomePlan-derived geometry lives in js/homeplan-derived.js so it can be swapped.
  standaloneApp: true,
  appName: 'Building Layout',
  // (b) Single story in v1. The model already has a `levels` array and each layer a
  //     `levelId`; flip this to true to allow adding "Level 2" (UI not built yet).
  allowMultipleLevels: false,
  // (c) Phone + desktop. Below this width the layer panel is a bottom sheet;
  //     above it is a right-hand sidebar.
  phoneBreakpointPx: 760,
};

export const STORAGE_KEY = 'buildingLayout.model.v1';
export const SCHEMA_VERSION = 1;

/** Plan view */
export const PLAN = {
  cutHeightFt: 4,            // plan cut above the active floor
  snapOptionsIn: [1, 6, 12, 16],
  defaultSnapIn: 6,
  ghostOpacity: 0.3,         // non-active layers fade to ~30%
  dimOffsetFt: 2.5,          // per-segment exterior dimension string offset
  dimOverallOffsetFt: 5,     // overall dimension string offset
};

/** 3D view */
export const VIEW3D = {
  explodeGapFt: 4,           // exploded view: extra vertical gap between layers (spec says "e.g. 2 ft"; 4 reads better on a phone)
};

/** Nominal lumber → actual depth (in). Width of all 2x stock = 1.5 in. */
export const LUMBER = { '2x4': 3.5, '2x6': 5.5, '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 };
export const LUMBER_T_IN = 1.5;

/** Section 6 defaults (typical US residential practice — NOT engineering). */
export const DEFAULTS = {
  footprint: [[0, 0], [32, 0], [32, 24], [0, 24]],  // first-run sample, ft
  site: {
    lotMarginFt: 25,
    setbacksFt: { front: 20, rear: 10, side: 5 },    // front = south (+y) edge
    grade: { type: 'flat', slopePct: 0, downhill: 'S' },
  },
  foundation: {
    type: 'piersOnly',                 // hotfix: piersOnly (individual piers, NO continuous concrete) | piers (piers + grade beam) | crawlspace | slab | basement
    footingWidthIn: 16,
    footingDepthIn: 8,
    frostDepthIn: null,                // from the startup ZIP lookup (verified only) or the user; never guessed
    placeholderFrostIn: 48,            // v4: unknown/skipped ZIP → conservative 48 in, DRAWING ONLY + FLAGGED (content-v4 fallback)
    frostMarginIn: 0,                  // optional user margin ("dig 3 in extra"); code adds none
    topAboveGradeIn: { slab: 8, crawlspace: 24, basement: 8, piers: 30, piersOnly: 24 }, // spec min 8 in; piersOnly = top of pier (the floor framing sits on it)
    stemWallIn: 8,
    basementWallFt: 8,
    slabIn: 4,
    // Auto piers (Sonotubes) along exterior + bearing wall lines (spec: corners + every 6–8 ft).
    pierSpacingMode: 'max',            // 'max' = equal gaps no larger than pierSpacingIn | 'exact' = every pierSpacingIn o.c. from each corner
    pierSpacingIn: 72,                 // 6 ft, entered in ft + in in the UI
    pierDiaIn: 12,                     // auto pier tube diameter
    deletedAutoSlots: [],              // auto pier slots the user deleted (kept out of regeneration)
    // "Place pier" tool defaults for new manual piers (null = follow the layer default)
    placeDiaIn: 12,
    placeTopIn: null,                  // top of tube above grade, in (null = under grade beam / foundation top)
    placeDepthIn: null,                // bottom below grade, in (null = frost depth, or the placeholder)
    gradeBeamDepthIn: 12,
    gradeBeamWidthIn: 12,
    // hotfix (piers-only): pier shape, global default + per-pier override (props.shape / props.sizeIn)
    pierShape: 'round',                // 'round' Sonotube (default) | 'square' formed square concrete pier | 'precast' precast concrete pier/deck block
    pierSquareIn: 12,                  // side of a formed square pier (in): 12 or 16
    deletedContinuous: [],             // keys ("gradeBeam:w-ext-0", "stem:…", "footing:…", "slab:footprint") of continuous concrete the user deleted
    soilType: 'unknown',               // v3 (Remodel Guide missing_fields): 'unknown' | 'normal' | 'expansive' — expansive → engineered piers
  },
  floor: {
    sill: '2x6 PT', sillSize: '2x6',
    joistSize: '2x10', joistOcIn: 16,
    direction: 'auto',                 // auto = span the short direction
    subfloorIn: 0.75, subfloor: '3/4 in T&G',
    beamFlagSpanFt: 14,                // flag (don't size) a mid beam past this span
    showSubfloor: true,
  },
  walls: {
    extSize: '2x6', intSize: '2x4', studOcIn: 16,
    plateHeightFt: 8, bottomPlates: 1, topPlates: 2,
  },
  roof: {
    shape: 'gable', pitch: 4, overhangIn: 12, rafterOcIn: 24, rafterSize: '2x8',
    ridge: 'long', showSheathing: false,
    ceilingJoistSize: 'auto',          // v3: rafter ties / ceiling joists ('auto' = EXAMPLE table by span)
    // ---- v4 roofing (Remodel Guide roofing-v1/roofing-options.json; additive, migrate() fills them) ----
    shed: null,                        // { highWallId, highPlateFt, lowPlateFt, slopeAwayFromHouse } when shape = 'shed'
    rakeOverhangIn: 12,
    roofing: { covering: 'asphalt_shingle', underlayment: 'auto', shingleVariant: 'architectural', metalGauge: 29, singlePlyType: 'tpo' },
    tieIn: { type: 'auto', flashingClearIn: 5, framing: 'california_overlay', bearingAtHouse: 'freestanding_wall', manufacturerApproval: 'unknown', floorDropFt: 0, cricket: false },
    valleys: { type: 'closed_cut', liningWidthIn: 36, metalWidthIn: 24 },
    framing: 'rafters',                // rafters | trusses
    lumber: { species: 'Spruce-pine-fir', grade: '#2' },
    ceiling: 'flat_attic',             // flat_attic | cathedral | scissor_truss
    ridgeType: 'auto',                 // auto = board (flat_attic) / beam (cathedral)
    collarTies: 'every_2nd_pair',
    seatIn: 3.5, raisedHeelIn: 0, upliftConnector: 'H2.5A',
    sheathing: { thickness: 'auto', edgeSupport: 'h_clips' },
    snow: { groundSnowPsf: null, source: 'zip_lookup', strengthLevel: false, minRoofSnowPsf: 30 },
    vent: { strategy: 'vented_ridge_soffit', ratio: '1/150', ridgeVent: 'shingle_over_rigid', baffles: true },
    eave: { soffit: 'vented_aluminum', fascia: 'aluminum_wrap', dripEdge: 'standard', gutters: '5in_aluminum_k' },
    snowGuards: { enabled: 'auto', rows: 1, spacingIn: 24 },
    penetrations: { ventPipes: 1, bathFans: 0, skylights: 0 },
    takeoffV4: false,                  // true = Price check uses the full roofing-v1 roof takeoff (always on for a shed)
  },
  openings: {
    door: { widthIn: 36, heightIn: 80, sillIn: 0 },
    window: { widthIn: 36, heightIn: 48, sillIn: 30 },
  },
};

/** v3 estimate settings (m.estimate). Tax is blank until the user enters their own rate — the app never assumes a location. */
export const ESTIMATE_DEFAULTS = {
  taxRatePct: null,       // null = not set: total shows "tax not included"
  contingencyPct: 10,     // optional, per Remodel Guide pricing-rules.md
  deliveryUsd: 0,         // user-entered; never invented
  laborUsd: null,         // null = not included
  concreteMode: 'auto',   // auto | readymix | bags80 | bags60
  iceBarrier: null,      // v4: null = from the ZIP lookup (engine default ON)
};

/** Sonotube / pier editing (v2). */
export const PIERS = {
  diametersIn: [8, 10, 12, 16],      // tube sizes offered in the UI
  offWallTolFt: 0.5,                 // a manual pier that was on a wall line is FLAGGED if it ends up farther than this
  snapPx: 18,                        // snap radius (screen px) for mouse
  snapPxTouch: 26,                   // snap radius for a finger
  duplicateOffsetFt: 2,              // Duplicate puts the copy this far along the wall (or east)
  mergeFt: 1,                        // an auto slot within this distance of a manual pier is not generated (no overlaps)
};

/** Pier shapes (hotfix). Square sizes are the formed pier's side. Precast blocks have no Home Depot
 *  price in content-v3/content-v4 homedepot-prices.json → "needs a price" (never invented). */
export const PIER_SHAPES = {
  round: { label: 'Round Sonotube', short: 'Sonotube' },
  square: { label: 'Square formed concrete pier', short: 'Square pier', sizesIn: [12, 16] },
  precast: { label: 'Precast concrete pier / deck block', short: 'Precast block', sizeIn: 11, heightIn: 8 },
};
export const FOUNDATION_TYPES = [
  ['piersOnly', 'Piers only (no continuous concrete)'], ['piers', 'Piers + grade beam'],
  ['crawlspace', 'Crawlspace (perimeter footing + stem wall)'], ['slab', 'Slab on grade'], ['basement', 'Basement'],
];
export const isPierType = (t) => t === 'piers' || t === 'piersOnly';
/** Effective shape of one pier: its own override, else the layer default. → { shape, sizeIn, diaIn, halfFt } */
export function pierShapeOf(o, f) {
  const shape = (o && o.props && o.props.shape) || (f && f.pierShape) || 'round';
  if (shape === 'square') { const s = Number((o && o.props && o.props.sizeIn) || (f && f.pierSquareIn) || 12); return { shape, sizeIn: s, halfFt: s / 24 }; }
  if (shape === 'precast') { const s = PIER_SHAPES.precast.sizeIn; return { shape, sizeIn: s, heightIn: PIER_SHAPES.precast.heightIn, halfFt: s / 24 }; }
  const d = Number((o && o.props && o.props.diaIn) || (f && f.pierDiaIn) || 12); return { shape: 'round', diaIn: d, halfFt: d / 24 };
}
export function pierShapeLabel(o, f) {
  const s = pierShapeOf(o, f);
  return s.shape === 'square' ? `Square pier ${s.sizeIn}×${s.sizeIn} in` : s.shape === 'precast' ? 'Precast pier block' : `Sonotube Ø${s.diaIn} in`;
}
/** Frost warning for precast blocks on the surface (null when not applicable). */
export function precastFrostWarning(f) {
  const fr = frostKnown(f) ? `${Number(f.frostDepthIn)} in` : 'unknown';
  return `NOT FROST-PROTECTED: a precast block sits on the surface, but the frost depth here is ${fr}. Frost heave can lift and shift it. IRC R403.1.4 wants footings below frost depth; small detached accessory buildings may be exempt (R403.1.4.1) — ask your building department before you use blocks.`;
}

/** EXAMPLE header table — verify with your building department / engineer. */
export const HEADER_EXAMPLE = [
  { maxIn: 36, size: '2-2x6' },
  { maxIn: 60, size: '2-2x8' },
  { maxIn: 72, size: '2-2x10' },
  { maxIn: 9999, size: '2-2x12 (verify — long span)' },
];

export const LAYER_COLORS = {
  site: '#5d8a4e', foundation: '#8b8f94', floor: '#c08a4a', walls: '#d9a45b',
  roof: '#a5553a', sheathing: '#6d7fa3', mep: '#7a5ea8', custom: '#2f8fb0',
};

/** v4 pier/footing bottom depth below grade (in): max(frost + margin, 12) when the frost depth is known
 *  (IRC R403.1.4 / R403.1.4.1), else the flagged unknown-ZIP placeholder (48 in). */
export const MIN_PIER_DEPTH_IN = 12;
export function frostKnown(f) { return f.frostDepthIn != null && f.frostDepthIn !== '' && Number(f.frostDepthIn) > 0; }
export function pierDepthIn(f) {
  return frostKnown(f) ? Math.max(Number(f.frostDepthIn) + (Number(f.frostMarginIn) || 0), MIN_PIER_DEPTH_IN) : (Number(f.placeholderFrostIn) || 48);
}

/** v4: the house roof until Jake measures it (roofing-v1 worked example; every value labelled ASSUMED in the UI). */
export const EXISTING_ROOF_ASSUMED = { homeType: 'unknown', pitch: 4, eaveUndersideFt: 7.9, roofTopAtWallFt: 8.5, overhangIn: 12, ridgeDistFt: 14, covering: 'asphalt_shingle', framing: 'unknown', wallSide: 'eave_side' };
/** Roof slope control (Jake: "Make variable slope"): any x:12 in 0.25 steps. */
export const SLOPE = { min: 0.5, max: 12, step: 0.25, inputMin: 0.25 };
