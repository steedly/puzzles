// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { solvePuzzle } from './solver.js';
import { SQUARE_7x7 } from './boardGeometry.js';

/**
 * Check if a slide path passes through any blocked cell.
 * Replays one move: robot at (sr,sc) slides in direction until stopped.
 */
function slidePassesBlocked(sr, sc, dr, dc, blockedCells, maxIdx) {
  let r = sr + dr, c = sc + dc;
  while (r >= 0 && r <= maxIdx && c >= 0 && c <= maxIdx) {
    if (blockedCells.has(`${r},${c}`)) return true;
    r += dr;
    c += dc;
  }
  return false;
}

/**
 * Check if the stored solution avoids all blocked cells.
 * Replays each move, checking if the slide path crosses a blocked cell.
 * Returns true if solution is clean (no conflicts).
 */
function solutionAvoidsCells(puzzle, blockedCells, board) {
  if (!puzzle.solution || puzzle.solution.length === 0) return false;

  const maxIdx = board.N - 1;
  const dirLookup = {};
  for (const d of board.dirs) dirLookup[d.name] = d;

  const positions = {};
  for (const r of puzzle.robots) {
    positions[r.id] = { row: r.row, col: r.col };
  }

  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));

  for (const move of puzzle.solution) {
    const pos = positions[move.mover];
    if (!pos) continue;

    const dir = dirLookup[move.dir];
    if (!dir) return false;

    if (slidePassesBlocked(pos.row, pos.col, dir.dr, dir.dc, blockedCells, maxIdx)) return false;

    const { dr, dc } = dir;
    let r = pos.row + dr, c = pos.col + dc;
    let landR = pos.row, landC = pos.col;
    while (r >= 0 && r <= maxIdx && c >= 0 && c <= maxIdx) {
      if (blockedCells.has(`${r},${c}`)) break;
      let hit = false;
      for (const [id, p] of Object.entries(positions)) {
        if (id !== move.mover && p.row === r && p.col === c) { hit = true; break; }
      }
      if (hit) break;
      landR = r; landC = c;
      r += dr; c += dc;
    }

    if (exitIds.has(move.mover) && landR === board.centerRow && landC === board.centerCol) {
      delete positions[move.mover];
    } else {
      positions[move.mover] = { row: landR, col: landC };
    }
  }

  return true;
}

function reSolveWithBlocks(puzzle, blockedCells, board) {
  const newSolution = solvePuzzle(puzzle, blockedCells, board);
  if (!newSolution || newSolution.length === 0) return null;

  let groupedMoves = 0, lastMover = null;
  for (const move of newSolution) {
    if (move.mover !== lastMover) { groupedMoves++; lastMover = move.mover; }
  }

  return {
    ...puzzle,
    solution: newSolution,
    minMoves: groupedMoves,
    resolvedWithBlocks: true,
  };
}

/**
 * Filter puzzles based on blocked cells using a multi-tier pipeline.
 */
export function filterPuzzles(puzzles, blockedCells, board = SQUARE_7x7) {
  if (!blockedCells || blockedCells.size === 0) {
    return { kept: puzzles, removed: 0 };
  }

  const kept = [];
  let removed = 0;

  for (const puzzle of puzzles) {
    let conflict = false;
    for (const r of puzzle.robots) {
      if (blockedCells.has(`${r.row},${r.col}`)) { conflict = true; break; }
    }
    if (conflict) { removed++; continue; }

    if (puzzle.bbox) {
      let overlaps = false;
      for (const cell of blockedCells) {
        const [cr, cc] = cell.split(',').map(Number);
        if (cr >= puzzle.bbox.minR && cr <= puzzle.bbox.maxR &&
            cc >= puzzle.bbox.minC && cc <= puzzle.bbox.maxC) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) { kept.push(puzzle); continue; }
    }

    if (solutionAvoidsCells(puzzle, blockedCells, board)) {
      kept.push(puzzle);
    } else {
      kept.push({ ...puzzle, needsResolve: true });
    }
  }

  return { kept, removed };
}

export function resolvePuzzle(puzzle, blockedCells, board = SQUARE_7x7) {
  if (!puzzle.needsResolve) return puzzle;
  return reSolveWithBlocks(puzzle, blockedCells, board);
}
