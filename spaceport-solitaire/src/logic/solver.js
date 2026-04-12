// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { initPositions, isWon } from './gameEngine.js';
import { SQUARE_7x7 } from './boardGeometry.js';

/**
 * Slide robot `robotId` in direction `dirIdx` using the board geometry.
 * Returns { newPositions, blockerId, dirName } or null.
 * Exported for reuse by stateGraph.js.
 */
export function slideWithBlocker(positions, robotId, dirIdx, exitIds, blockedCells, board) {
  const start = positions[robotId];
  if (!start) return null;

  const { dr, dc, name: dirName } = board.dirs[dirIdx];
  const maxIdx = board.N - 1;
  let row = start.row, col = start.col;

  const cellToId = {};
  for (const [id, pos] of Object.entries(positions)) {
    if (id !== robotId) cellToId[`${pos.row},${pos.col}`] = id;
  }

  let blockerId = null;
  while (true) {
    const nr = row + dr, nc = col + dc;
    if (nr < 0 || nr > maxIdx || nc < 0 || nc > maxIdx) break;
    if (blockedCells && blockedCells.has(`${nr},${nc}`)) break;
    const blocker = cellToId[`${nr},${nc}`];
    if (blocker !== undefined) { blockerId = blocker; break; }
    row = nr; col = nc;
  }

  if (blockerId === null) return null;
  if (row === start.row && col === start.col) return null;

  const newPositions = { ...positions };
  if (exitIds.has(robotId) && row === board.centerRow && col === board.centerCol) {
    delete newPositions[robotId];
  } else {
    newPositions[robotId] = { row, col };
  }

  return { newPositions, blockerId, dirName };
}

/**
 * Canonical state key: exit positions in fixed ID order, then helper
 * positions sorted. Exited robots encoded as 'X'.
 */
function stateKey(positions, exitOrder, helperOrder) {
  const parts = [];
  for (const id of exitOrder) {
    const p = positions[id];
    parts.push(p ? `${p.row},${p.col}` : 'X');
  }
  const hParts = [];
  for (const id of helperOrder) {
    const p = positions[id];
    if (p) hParts.push(`${p.row},${p.col}`);
  }
  hParts.sort();
  parts.push(...hParts);
  return parts.join('|');
}

/**
 * Solve a puzzle using 0-1 BFS on augmented state (board, lastMoverCell),
 * returning the solution with minimum grouped moves (allowing any number
 * of raw slides). This matches the C++ solve_min_grouped() algorithm.
 *
 * @param {Object} puzzle - Puzzle object with .robots and robot metadata
 * @param {Set} blockedCells - Set of blocked cell keys
 * @param {Object} board - Board geometry config (from boardGeometry.js)
 * @returns {Array} Solution as [{mover, dir, blocker}, ...] or []
 */
export function solvePuzzle(puzzle, blockedCells, board = SQUARE_7x7) {
  const positions = initPositions(puzzle);
  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));
  const robotIds = puzzle.robots.map(r => r.id);
  const numDirs = board.dirs.length;

  const exitOrder = puzzle.robots.filter(r => r.isExit).map(r => r.id);
  const helperOrder = puzzle.robots.filter(r => !r.isExit).map(r => r.id);

  if (isWon(positions, exitIds)) return [];

  const startSK = stateKey(positions, exitOrder, helperOrder);

  // ── 0-1 BFS on augmented state (board_state, last_mover_cell) ──
  // Cost 0 edge: same robot continues sliding (mover's current cell = last landing)
  // Cost 1 edge: different robot starts sliding
  // This finds minimum grouped moves, allowing any number of raw slides.

  const SENTINEL = 'S'; // last_mover_cell for start state (no previous mover)
  const startKey = startSK + '~' + SENTINEL;

  // visited: augKey → { cost, parentKey, move }
  const visited = new Map();
  visited.set(startKey, { cost: 0, parentKey: null, move: null, positions });

  // Deque: frontStack (LIFO for cost-0 edges) + backQueue (FIFO for cost-1 edges)
  const frontStack = [startKey];
  const backQueue = [];
  let backHead = 0;

  let bestGoalKey = null;
  let bestGoalCost = Infinity;

  while (frontStack.length > 0 || backHead < backQueue.length) {
    const key = frontStack.length > 0
      ? frontStack.pop()
      : backQueue[backHead++];

    const node = visited.get(key);
    if (!node || node.cost >= bestGoalCost) continue;

    const { positions: pos, cost } = node;
    const lastCell = key.slice(key.lastIndexOf('~') + 1);

    for (const rid of robotIds) {
      if (!pos[rid]) continue;
      const moverCell = `${pos[rid].row},${pos[rid].col}`;

      for (let d = 0; d < numDirs; d++) {
        const result = slideWithBlocker(pos, rid, d, exitIds, blockedCells, board);
        if (!result) continue;

        const edgeCost = (moverCell === lastCell) ? 0 : 1;
        const newCost = cost + edgeCost;
        if (newCost >= bestGoalCost) continue;

        // Determine landing cell for augmented key
        const landingCell = pos[rid] && exitIds.has(rid)
          && !result.newPositions[rid]
          ? 'X'  // robot exited
          : `${result.newPositions[rid].row},${result.newPositions[rid].col}`;

        const nsk = stateKey(result.newPositions, exitOrder, helperOrder);
        const nk = nsk + '~' + landingCell;

        const existing = visited.get(nk);
        if (existing && existing.cost <= newCost) continue;

        const move = { mover: rid, dir: result.dirName, blocker: result.blockerId };
        visited.set(nk, { cost: newCost, parentKey: key, move, positions: result.newPositions });

        // Check if goal
        if (isWon(result.newPositions, exitIds)) {
          if (newCost < bestGoalCost) {
            bestGoalCost = newCost;
            bestGoalKey = nk;
          }
          continue; // don't expand goal states
        }

        if (edgeCost === 0) {
          frontStack.push(nk);
        } else {
          backQueue.push(nk);
        }
      }
    }
  }

  if (bestGoalKey === null) return [];

  // Backtrack to reconstruct solution
  const solution = [];
  let cur = bestGoalKey;
  while (cur !== startKey) {
    const node = visited.get(cur);
    solution.push(node.move);
    cur = node.parentKey;
  }
  solution.reverse();
  return solution;
}
