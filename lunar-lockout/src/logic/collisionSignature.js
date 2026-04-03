// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// D4 direction transforms: maps direction index (0=U,1=D,2=L,3=R)
// under each of the 8 symmetry operations.
const DIR_TRANSFORM = [
  [0, 1, 2, 3], // identity:      U D L R
  [2, 3, 1, 0], // 90° CW:        L R D U
  [1, 0, 3, 2], // 180°:          D U R L
  [3, 2, 0, 1], // 270° CW:       R L U D
  [0, 1, 3, 2], // reflect-H:     U D R L
  [1, 0, 2, 3], // reflect-V:     D U L R
  [2, 3, 0, 1], // reflect-diag:  L R U D
  [3, 2, 1, 0], // reflect-anti:  R L D U
];

const DIR_TO_IDX = { up: 0, down: 1, left: 2, right: 3 };
const IDX_TO_CHAR = ['U', 'D', 'L', 'R'];

/**
 * Compute the D4-canonical collision signature of a solution.
 *
 * A collision signature captures the sequence of "who collides with whom
 * in which direction" with robot labels normalised by order of first
 * appearance. Two puzzles whose solutions have the same canonical
 * collision signature are structurally identical under D4 symmetry.
 *
 * @param {Array<{mover: string, dir: string, blocker: string}>} solution
 * @returns {string} canonical collision signature
 */
export function collisionSignature(solution) {
  if (!solution || solution.length === 0) return '';

  // Normalise robot labels by order of first appearance.
  // Exits get letters A, B, C, …; helpers get digits 1, 2, 3, …
  const labelMap = new Map();
  let nextExit = 0, nextHelper = 0;

  function label(robotId) {
    if (labelMap.has(robotId)) return labelMap.get(robotId);
    const isExit = robotId === 'target' || robotId.startsWith('exit');
    const ch = isExit
      ? String.fromCharCode(65 + nextExit++)  // A, B, C, …
      : String(++nextHelper);                  // 1, 2, 3, …
    labelMap.set(robotId, ch);
    return ch;
  }

  // Encode moves as [moverLabel, dirIndex, blockerLabel]
  const moves = solution.map(step => [
    label(step.mover),
    DIR_TO_IDX[step.dir],
    label(step.blocker),
  ]);

  // Try all 8 D4 direction transforms, pick lexicographically smallest.
  let best = null;
  for (let t = 0; t < 8; t++) {
    const dt = DIR_TRANSFORM[t];
    let sig = '';
    for (const [m, d, b] of moves) {
      sig += m + IDX_TO_CHAR[dt[d]] + b;
    }
    if (best === null || sig < best) best = sig;
  }
  return best;
}

/**
 * Find all puzzles in a list whose solution has the same canonical
 * collision signature as the given signature.
 *
 * @param {string} targetSig - the signature to match
 * @param {Array} puzzles - library puzzles with .solution arrays
 * @returns {Array} matching puzzles
 */
export function findMatchingPuzzles(targetSig, puzzles) {
  if (!targetSig) return [];
  const matches = [];
  for (const p of puzzles) {
    if (!p.solution || p.solution.length === 0) continue;
    if (collisionSignature(p.solution) === targetSig) {
      matches.push(p);
    }
  }
  return matches;
}

// ── D4 spatial position matching (with unused-helper pruning) ───────────────

const M = 6; // 7×7 board, max index = 6

/**
 * Apply D4 spatial transform t to a board position.
 */
function spatialTransform(r, c, t) {
  switch (t) {
    case 0: return [r, c];
    case 1: return [c, M - r];
    case 2: return [M - r, M - c];
    case 3: return [M - c, r];
    case 4: return [r, M - c];
    case 5: return [M - r, c];
    case 6: return [c, r];
    case 7: return [M - c, M - r];
  }
}

/**
 * Return the Set of robot IDs that appear in a solution (as mover or blocker).
 */
export function usedRobotIds(solution) {
  const ids = new Set();
  for (const step of solution) {
    ids.add(step.mover);
    ids.add(step.blocker);
  }
  return ids;
}

/**
 * Compute the D4-canonical position key for a set of robots.
 * Only includes exits and helpers whose IDs are in `usedIds`.
 * Returns the lexicographically smallest encoding across all 8 D4 transforms.
 *
 * Format: "numExits:exitPositions|helperPositions" where positions are sorted.
 */
function canonicalPositionKey(robots, usedIds) {
  const exits = robots.filter(r => r.isExit);
  const helpers = robots.filter(r => !r.isExit && usedIds.has(r.id));
  const numExits = exits.length;
  const numHelpers = helpers.length;

  let best = null;
  for (let t = 0; t < 8; t++) {
    // Transform and sort exits
    const te = exits.map(r => spatialTransform(r.row, r.col, t))
                     .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // Transform and sort helpers
    const th = helpers.map(r => spatialTransform(r.row, r.col, t))
                      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    let key = numExits + ':' + numHelpers;
    for (const [r, c] of te) key += ',' + r + '.' + c;
    key += '|';
    for (const [r, c] of th) key += ',' + r + '.' + c;

    if (best === null || key < best) best = key;
  }
  return best;
}

/**
 * Compute canonical position keys for a set of robots with various
 * helper subsets removed. Returns a Set of canonical keys.
 *
 * Generates keys for:
 * - All robots (no removals)
 * - Each single helper removed
 * - Each pair of helpers removed (if maxDrop >= 2)
 *
 * This brute-force approach catches matches regardless of which solution
 * path determined "used" vs "unused" helpers (C++ greedy vs JS DP).
 */
function canonicalKeysAllDrops(robots, maxDrop) {
  const helpers = robots.filter(r => !r.isExit);
  const allIds = new Set(robots.map(r => r.id));
  const keys = new Set();

  // 0 removals
  keys.add(canonicalPositionKey(robots, allIds));

  const n = helpers.length;
  // Single removals
  if (maxDrop >= 1) {
    for (let i = 0; i < n; i++) {
      const subset = new Set(allIds);
      subset.delete(helpers[i].id);
      keys.add(canonicalPositionKey(robots, subset));
    }
  }
  // Pair removals
  if (maxDrop >= 2) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const subset = new Set(allIds);
        subset.delete(helpers[i].id);
        subset.delete(helpers[j].id);
        keys.add(canonicalPositionKey(robots, subset));
      }
    }
  }
  return keys;
}

/**
 * Find library puzzles whose robot positions (under D4 transforms, with
 * up to 2 helpers removed) match the custom puzzle's positions (also
 * with up to 2 helpers removed).
 *
 * This catches dedup equivalents that collision signature matching misses,
 * because the C++ pipeline prunes unused helpers before D4-canonical dedup,
 * and may use a different solution path (greedy vs DP) to determine which
 * helpers are "unused".
 *
 * @param {Array} solution - the custom puzzle's solution (unused here, kept for API compat)
 * @param {Array} robots - the custom puzzle's robots
 * @param {Array} puzzles - library puzzles
 * @returns {Array} matching puzzles
 */
export function findD4PositionMatches(solution, robots, puzzles) {
  if (!robots?.length || !puzzles?.length) return [];

  const customKeys = canonicalKeysAllDrops(robots, 2);
  const numExits = robots.filter(r => r.isExit).length;

  const customHelpers = robots.filter(r => !r.isExit).length;

  const matches = [];
  for (const p of puzzles) {
    if (!p.robots) continue;
    if (p.robots.filter(r => r.isExit).length !== numExits) continue;
    // Helper count must be within ±2 to possibly match after drops
    const pH = p.robots.filter(r => !r.isExit).length;
    if (Math.abs(pH - customHelpers) > 2) continue;

    const pKeys = canonicalKeysAllDrops(p.robots, 2);

    // Check for any key overlap
    let found = false;
    for (const k of customKeys) {
      if (pKeys.has(k)) { found = true; break; }
    }
    if (found) matches.push(p);
  }
  return matches;
}
