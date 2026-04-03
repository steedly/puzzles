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
 * Find library puzzles whose robot positions (under D4 transforms)
 * match the custom puzzle's active robot positions (exits + used helpers).
 *
 * The custom puzzle may have unused helpers that the solver didn't need.
 * Library puzzles have already been pruned by the C++ pipeline, so we
 * compare the custom puzzle's active robots against the library puzzle's
 * full robot set.
 *
 * @param {Array} solution - the custom puzzle's solution
 * @param {Array} robots - the custom puzzle's robots
 * @param {Array} puzzles - library puzzles
 * @returns {Array} matching puzzles
 */
export function findD4PositionMatches(solution, robots, puzzles) {
  if (!solution?.length || !robots?.length || !puzzles?.length) return [];

  // Prune unused helpers from the custom puzzle using its solution
  const used = usedRobotIds(solution);
  const customKey = canonicalPositionKey(robots, used);
  const numExits = robots.filter(r => r.isExit).length;
  const numUsedHelpers = robots.filter(r => !r.isExit && used.has(r.id)).length;

  const matches = [];
  for (const p of puzzles) {
    if (!p.robots) continue;
    if (p.robots.filter(r => r.isExit).length !== numExits) continue;
    // Library puzzles are pre-pruned; helper count must match our active count
    const pH = p.robots.filter(r => !r.isExit).length;
    if (pH !== numUsedHelpers) continue;

    // Library puzzles use all their robots (already pruned by C++ pipeline)
    const allIds = new Set(p.robots.map(r => r.id));
    const pKey = canonicalPositionKey(p.robots, allIds);
    if (pKey === customKey) matches.push(p);
  }
  return matches;
}
