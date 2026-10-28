// ============================================================================
// homeplan-derived.js — logic adapted from HomePlan (/workspace/homeplan-publish,
// view3d.js). Kept in one module so the "reuse HomePlan" assumption is easy to
// swap out. Adapted, not imported: HomePlan's functions are closures inside
// createView3D() and depend on its scene state, so the math was lifted here.
//
//  - piersAlongLines   ← addPierFoundation(): corner + o.c. placement along wall
//                        segments with a dedupe map (keyPt). "Piers only under
//                        wall edges, never mid-span." Changed: spacing is a MAX
//                        (ceil) so gaps never exceed the spec's 6–8 ft.
//  - studLayout        ← buildStudWall(): end studs + 16 in o.c. run, skipping
//                        opening spans; king/jack + header per opening.
//  - gableGeometry     ← addRoofGable(): rise from BUILDING half-span (not
//                        eave-to-eave), overhang tip drops along the same pitch.
//  - lumberAlong       ← lumberAlong(): box member along a plan segment.
// ============================================================================

const keyPt = (x, y) => `${Math.round(x * 100)}|${Math.round(y * 100)}`;

/** segments: [{a:[x,y], b:[x,y], wallId}] → [{c:[x,y], wallId}] */
export function piersAlongLines(segments, maxSpacingFt) {
  const sp = Math.max(2, Math.min(20, maxSpacingFt || 6));
  const map = new Map();
  const add = (x, y, wallId) => { const k = keyPt(x, y); if (!map.has(k)) map.set(k, { c: [x, y], wallId }); };
  segments.forEach(({ a, b, wallId }) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const n = Math.max(2, Math.ceil(len / sp) + 1);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      add(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, wallId);
    }
  });
  return Array.from(map.values());
}

/**
 * Stud positions (distance from wall start, ft) for a wall of length len.
 * openings: [{center, widthFt}]. Returns { studs:[d], kings:[d], jacks:[d] }.
 */
export function studLayout(len, ocFt, openings, studT = 1.5 / 12) {
  const cuts = (openings || []).map((o) => ({ a: o.center - o.widthFt / 2, b: o.center + o.widthFt / 2 }));
  const blocked = (d) => cuts.some((c) => d + studT / 2 >= c.a - 2 * studT && d - studT / 2 <= c.b + 2 * studT);
  const studs = [];
  const place = (d) => { if (d >= 0 && d <= len && !blocked(d)) studs.push(d); };
  place(studT / 2);
  place(len - studT / 2);
  for (let d = ocFt; d < len - studT; d += ocFt) place(d);
  const kings = [], jacks = [];
  cuts.forEach((c) => {
    jacks.push(c.a - studT / 2, c.b + studT / 2);
    kings.push(c.a - studT * 1.5, c.b + studT * 1.5);
  });
  return { studs, kings, jacks };
}

/** Gable rise etc. spanFt = building span across the ridge. pitch = rise per 12. */
export function gableGeometry(spanFt, pitch, overhangIn, plateZ) {
  const p = pitch / 12;
  const oh = overhangIn / 12;
  const rise = Math.max(0.15, (spanFt / 2) * p);
  return { rise, ridgeZ: plateZ + rise, eaveTipZ: plateZ - oh * p, oh, p };
}

/** Box member along plan segment a→b (plan y → world z). */
export function lumberAlong(THREE, a, b, widthFt, zBot, zTop, material, ud, extendFt = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.02 || zTop - zBot < 0.01) return null;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + extendFt * 2, zTop - zBot, widthFt), material);
  mesh.position.set((a[0] + b[0]) / 2, (zBot + zTop) / 2, (a[1] + b[1]) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (ud) mesh.userData = Object.assign({}, ud);
  return mesh;
}
