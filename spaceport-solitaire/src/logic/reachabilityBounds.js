// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Compute the set of cells reachable under a given bound.
 *
 * @param {Object} positions  - { id: {row, col}, ... } current game state
 * @param {'none'|'bbox'|'convex'|'och'} mode
 * @param {boolean} isHex     - true for hex boards (adds diagonal connectivity for OCH)
 * @param {number} N          - board size (7)
 * @returns {Set<string>|null} - Set of "r,c" keys, or null for 'none'
 */
export function computeReachableCells(positions, mode, isHex, N) {
  if (mode === 'none') return null;
  const points = Object.values(positions).map(p => [p.row, p.col]);
  if (points.length === 0) return null;

  if (mode === 'bbox') return bboxCells(points, N);
  if (mode === 'convex') return convexHullCells(points, N);
  if (mode === 'och') return ochCells(points, N, isHex);
  return null;
}

/** Bounding box: all cells within min/max row and column. */
function bboxCells(points, N) {
  let minR = N, maxR = -1, minC = N, maxC = -1;
  for (const [r, c] of points) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  const cells = new Set();
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      cells.add(r + ',' + c);
  return cells;
}

/** Convex hull: compute hull polygon, then point-in-polygon for each cell. */
function convexHullCells(points, N) {
  const hull = convexHullPolygon(points);
  if (hull.length < 2) {
    // Degenerate: all points collinear or single point — fall back to OCH
    return ochCells(points, N, false);
  }
  const cells = new Set();
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (pointInConvexPolygon(r, c, hull))
        cells.add(r + ',' + c);
  return cells;
}

/**
 * Orthogonal convex hull: iteratively fill gaps along rows, columns,
 * and (for hex) rising diagonals (r+c = const).
 */
function ochCells(points, N, isHex) {
  const cells = new Set(points.map(([r, c]) => r + ',' + c));
  let changed = true;
  while (changed) {
    changed = false;
    // Fill rows
    const rows = {};
    for (const k of cells) {
      const [r, c] = k.split(',').map(Number);
      if (!rows[r]) rows[r] = { min: c, max: c };
      else { rows[r].min = Math.min(rows[r].min, c); rows[r].max = Math.max(rows[r].max, c); }
    }
    for (const [r, { min, max }] of Object.entries(rows))
      for (let c = min; c <= max; c++) {
        const k = r + ',' + c;
        if (!cells.has(k)) { cells.add(k); changed = true; }
      }
    // Fill columns
    const cols = {};
    for (const k of cells) {
      const [r, c] = k.split(',').map(Number);
      if (!cols[c]) cols[c] = { min: r, max: r };
      else { cols[c].min = Math.min(cols[c].min, r); cols[c].max = Math.max(cols[c].max, r); }
    }
    for (const [c, { min, max }] of Object.entries(cols))
      for (let r = min; r <= max; r++) {
        const k = r + ',' + c;
        if (!cells.has(k)) { cells.add(k); changed = true; }
      }
    // Fill rising diagonals (r+c = const) for hex boards
    if (isHex) {
      const diags = {};
      for (const k of cells) {
        const [r, c] = k.split(',').map(Number);
        const d = r + c;
        if (!diags[d]) diags[d] = { min: r, max: r };
        else { diags[d].min = Math.min(diags[d].min, r); diags[d].max = Math.max(diags[d].max, r); }
      }
      for (const [d, { min, max }] of Object.entries(diags))
        for (let r = min; r <= max; r++) {
          const c = d - r;
          if (c >= 0 && c < N && r >= 0 && r < N) {
            const k = r + ',' + c;
            if (!cells.has(k)) { cells.add(k); changed = true; }
          }
        }
    }
  }
  return cells;
}

// ── Convex hull helpers ─────────────────────────────────────────────────────

/** Cross product of vectors (o→a) and (o→b). Positive = counter-clockwise. */
function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Compute convex hull of a set of points using Andrew's monotone chain. */
function convexHullPolygon(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 1) return pts;
  // Remove duplicates
  const unique = [pts[0]];
  for (let i = 1; i < pts.length; i++)
    if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1])
      unique.push(pts[i]);
  if (unique.length <= 1) return unique;
  if (unique.length === 2) return unique;

  // Lower hull
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  // Upper hull
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  // Remove last point of each half (it's the first point of the other)
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Test if point (r, c) is inside or on the boundary of a convex polygon.
 * Uses cross-product sign test against each edge.
 */
function pointInConvexPolygon(r, c, hull) {
  const n = hull.length;
  if (n < 2) return false;
  if (n === 2) {
    // Collinear check: point on line segment
    const [r0, c0] = hull[0], [r1, c1] = hull[1];
    const cp = cross(hull[0], hull[1], [r, c]);
    if (cp !== 0) return false;
    return Math.min(r0, r1) <= r && r <= Math.max(r0, r1) &&
           Math.min(c0, c1) <= c && c <= Math.max(c0, c1);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (cross(hull[i], hull[j], [r, c]) < 0) return false;
  }
  return true;
}
