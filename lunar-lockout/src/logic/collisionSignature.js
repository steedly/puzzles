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
