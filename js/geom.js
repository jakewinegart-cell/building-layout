// Small 2D geometry helpers (plan coords in ft; x → east, y → south/down).
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Unit inward normal for edge i of polygon. */
export function inwardNormal(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const L = dist(a, b) || 1;
  const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
  return signedArea(poly) > 0 ? [-dy, dx] : [dy, -dx];
}

/** Offset polygon inward by d (negative = outward). Miter joins. */
export function offsetPolygon(poly, d) {
  const n = poly.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const nn = inwardNormal(poly, i);
    lines.push([[a[0] + nn[0] * d, a[1] + nn[1] * d], [b[0] + nn[0] * d, b[1] + nn[1] * d]]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    out.push(intersectLines(L1[0], L1[1], L2[0], L2[1]) || L2[0]);
  }
  return out;
}

export function intersectLines(p1, p2, p3, p4) {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

/** Segments of the vertical line x=c (axis 'x') or horizontal y=c inside polygon. */
export function scanline(poly, axis, c) {
  const hits = [];
  const n = poly.length;
  const ax = axis === 'x' ? 0 : 1, other = 1 - ax;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a[ax] <= c) !== (b[ax] <= c)) {
      const t = (c - a[ax]) / (b[ax] - a[ax]);
      hits.push(a[other] + t * (b[other] - a[other]));
    }
  }
  hits.sort((p, q) => p - q);
  const segs = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    const s0 = hits[i], s1 = hits[i + 1];
    if (s1 - s0 < 0.05) continue;
    segs.push(axis === 'x' ? [[c, s0], [c, s1]] : [[s0, c], [s1, c]]);
  }
  return segs;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

export function isAxisRect(poly) {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6) return false;
  }
  return true;
}

/** ft → 32' 6" style (nearest 1/2 in). */
export function fmtFtIn(ft) {
  const sign = ft < 0 ? '-' : '';
  let inches = Math.round(Math.abs(ft) * 24) / 2;
  const f = Math.floor(inches / 12);
  let i = inches - f * 12;
  const iStr = Number.isInteger(i) ? String(i) : i.toFixed(1);
  if (f === 0) return `${sign}${iStr}"`;
  return i === 0 ? `${sign}${f}'` : `${sign}${f}' ${iStr}"`;
}
