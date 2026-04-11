// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Square (D4): 8 direction transforms for {U=0,D=1,L=2,R=3}
const SQUARE_DIR_TRANSFORM = [
  [0, 1, 2, 3], // identity
  [2, 3, 1, 0], // 90° CW
  [1, 0, 3, 2], // 180°
  [3, 2, 0, 1], // 270° CW
  [0, 1, 3, 2], // reflect-H
  [1, 0, 2, 3], // reflect-V
  [2, 3, 0, 1], // reflect-diag
  [3, 2, 1, 0], // reflect-anti
];

const SQUARE_DIR_TO_IDX = { up: 0, down: 1, left: 2, right: 3 };
const SQUARE_IDX_TO_CHAR = ['U', 'D', 'L', 'R'];

// Hex: 6 symmetry direction transforms for {nw=0,se=1,sw=2,ne=3,no=4,so=5}
// Klein four-group + two diagonal reflections
const HEX_DIR_TRANSFORM = [
  [0, 1, 2, 3, 4, 5], // identity
  [1, 0, 3, 2, 5, 4], // 180°
  [0, 1, 3, 2, 5, 4], // H-flip
  [1, 0, 2, 3, 5, 4], // V-flip
  [2, 3, 0, 1, 5, 4], // diag-reflect (swap r↔c: NW↔SW, SE↔NE, N↔S)
  [3, 2, 1, 0, 4, 5], // anti-diag (NW↔NE, SE↔SW, N=N, S=S)
];

const HEX_DIR_TO_IDX = { nw: 0, se: 1, sw: 2, ne: 3, no: 4, so: 5 };
const HEX_IDX_TO_CHAR = ['Nw', 'Se', 'Sw', 'Ne', 'No', 'So'];

// Symmetry transform indices for spatial transforms (into the sym() switch)
// Square: all 8 D4.  Hex: 6 transforms = {0, 2, 4, 5, 6, 7}.
const SQUARE_SYM_INDICES = [0, 1, 2, 3, 4, 5, 6, 7];
const HEX_SYM_INDICES = [0, 2, 4, 5, 6, 7];

function isHexDir(dir) {
  return dir in HEX_DIR_TO_IDX;
}

/**
 * Compute the symmetry-canonical collision signature of a solution.
 * Detects hex vs square from direction names in the solution.
 */
export function collisionSignature(solution) {
  if (!solution || solution.length === 0) return '';

  const hex = solution.some(s => isHexDir(s.dir));
  const dirToIdx = hex ? HEX_DIR_TO_IDX : SQUARE_DIR_TO_IDX;
  const idxToChar = hex ? HEX_IDX_TO_CHAR : SQUARE_IDX_TO_CHAR;
  const dirTransforms = hex ? HEX_DIR_TRANSFORM : SQUARE_DIR_TRANSFORM;

  const labelMap = new Map();
  let nextExit = 0, nextHelper = 0;

  function label(robotId) {
    if (labelMap.has(robotId)) return labelMap.get(robotId);
    const isExit = robotId === 'target' || robotId.startsWith('exit');
    const ch = isExit
      ? String.fromCharCode(65 + nextExit++)
      : String(++nextHelper);
    labelMap.set(robotId, ch);
    return ch;
  }

  const moves = solution.map(step => [
    label(step.mover),
    dirToIdx[step.dir],
    label(step.blocker),
  ]);

  let best = null;
  for (const dt of dirTransforms) {
    const parts = [];
    for (const [m, d, b] of moves) {
      parts.push(m + idxToChar[dt[d]] + b);
    }
    const sig = parts.join(' ');
    if (best === null || sig < best) best = sig;
  }
  return best;
}

/**
 * Find all puzzles whose solution has the same canonical collision signature.
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

// ── Spatial position matching ────────────────────────────────────────────────

/**
 * Apply spatial symmetry transform t to a board position.
 * Works for any board size via the m parameter (N-1).
 */
function spatialTransform(r, c, t, m) {
  switch (t) {
    case 0: return [r, c];
    case 1: return [c, m - r];
    case 2: return [m - r, m - c];
    case 3: return [m - c, r];
    case 4: return [r, m - c];
    case 5: return [m - r, c];
    case 6: return [c, r];
    case 7: return [m - c, m - r];
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
 * Compute the symmetry-canonical position key for a set of robots.
 * Uses D4 (8 transforms) for square, Klein (4 transforms) for hex.
 */
function canonicalPositionKey(robots, usedIds, boardN = 7, isHex = false) {
  const exits = robots.filter(r => r.isExit);
  const helpers = robots.filter(r => !r.isExit && usedIds.has(r.id));
  const numExits = exits.length;
  const numHelpers = helpers.length;
  const m = boardN - 1;
  const symIndices = isHex ? HEX_SYM_INDICES : SQUARE_SYM_INDICES;

  let best = null;
  for (const t of symIndices) {
    const te = exits.map(r => spatialTransform(r.row, r.col, t, m))
                     .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const th = helpers.map(r => spatialTransform(r.row, r.col, t, m))
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
 * Find library puzzles whose robot positions match the custom puzzle's.
 */
export function findD4PositionMatches(solution, robots, puzzles, boardN = 7, isHex = false) {
  if (!solution?.length || !robots?.length || !puzzles?.length) return [];

  const numExits = robots.filter(r => r.isExit).length;
  const allIds = new Set(robots.map(r => r.id));
  const numHelpers = robots.filter(r => !r.isExit).length;

  // Key 1: all robots — matches when library kept all helpers (C++ used them all)
  const allKey = canonicalPositionKey(robots, allIds, boardN, isHex);

  // Key 2: only JS-solution-used robots — matches when library pruned the same helpers
  const used = usedRobotIds(solution);
  const numUsedHelpers = robots.filter(r => !r.isExit && used.has(r.id)).length;
  const prunedKey = numUsedHelpers < numHelpers
    ? canonicalPositionKey(robots, used, boardN, isHex)
    : null; // identical to allKey when all helpers used

  const matches = [];
  for (const p of puzzles) {
    if (!p.robots) continue;
    if (p.robots.filter(r => r.isExit).length !== numExits) continue;
    const pH = p.robots.filter(r => !r.isExit).length;
    if (pH !== numHelpers && pH !== numUsedHelpers) continue;

    const pIds = new Set(p.robots.map(r => r.id));
    const pKey = canonicalPositionKey(p.robots, pIds, boardN, isHex);
    if (pKey === allKey || (prunedKey && pKey === prunedKey)) matches.push(p);
  }
  return matches;
}
