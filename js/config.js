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
    type: 'crawlspace',                // slab | crawlspace | basement | piers
    footingWidthIn: 16,
    footingDepthIn: 8,
    frostDepthIn: null,                // user enters it; app never guesses local code
    placeholderFrostIn: 24,            // DRAWING ONLY until frost depth is entered
    topAboveGradeIn: { slab: 8, crawlspace: 24, basement: 8, piers: 30 }, // spec min 8 in
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
  },
  openings: {
    door: { widthIn: 36, heightIn: 80, sillIn: 0 },
    window: { widthIn: 36, heightIn: 48, sillIn: 30 },
  },
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
