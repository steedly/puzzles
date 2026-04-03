// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { SQUARE_7x7 } from './boardGeometry.js';

const DIRS = {
  up:    { dr: -1, dc:  0 },
  down:  { dr:  1, dc:  0 },
  left:  { dr:  0, dc: -1 },
  right: { dr:  0, dc:  1 },
  nw:    { dr: -1, dc:  0 },
  se:    { dr:  1, dc:  0 },
  sw:    { dr:  0, dc: -1 },
  ne:    { dr:  0, dc:  1 },
  no:    { dr: -1, dc:  1 },
  so:    { dr:  1, dc: -1 },
};

function occupiedCells(positions, excludeId = null) {
  const cells = new Set();
  for (const [id, pos] of Object.entries(positions)) {
    if (id !== excludeId) cells.add(`${pos.row},${pos.col}`);
  }
  return cells;
}

/**
 * Slide robot `robotId` in `direction`.
 * Returns new positions object only if the robot moves AND is stopped by
 * another robot (not a wall). Moves that would end at a wall are illegal
 * in Lunar Lockout. Returns null for illegal or no-op moves.
 *
 * exitIds: Set of robot IDs that are exit pieces. When an exit piece lands
 * on the center cell it is REMOVED from positions (it exits the board).
 * board: board geometry config (from boardGeometry.js). Defaults to SQUARE_7x7.
 */
export function slideRobot(positions, robotId, direction, exitIds = null, blockedCells = null, board = SQUARE_7x7) {
  const start = positions[robotId];
  if (!start) return null; // robot not on board (already exited)

  const { dr, dc } = DIRS[direction];
  const occupied = occupiedCells(positions, robotId);
  const maxIdx = board.N - 1;
  let { row, col } = start;

  let stoppedByRobot = false;
  while (true) {
    const nextRow = row + dr;
    const nextCol = col + dc;
    if (nextRow < 0 || nextRow > maxIdx || nextCol < 0 || nextCol > maxIdx) break; // wall
    if (blockedCells && blockedCells.has(`${nextRow},${nextCol}`)) break;
    if (occupied.has(`${nextRow},${nextCol}`)) {
      stoppedByRobot = true;
      break;
    }
    row = nextRow;
    col = nextCol;
  }

  // Must be stopped by a robot AND must have actually moved.
  if (!stoppedByRobot || (row === start.row && col === start.col)) return null;

  // Exit piece reaching center: remove it from the board.
  if (exitIds && exitIds.has(robotId) && row === board.centerRow && col === board.centerCol) {
    const newPositions = { ...positions };
    delete newPositions[robotId];
    return newPositions;
  }

  return { ...positions, [robotId]: { row, col } };
}

/**
 * Returns true when all exit pieces have left the board (exited through center).
 * exitIds: Set of robot IDs that are exits. Win = none of them remain in positions.
 */
export function isWon(positions, exitIds) {
  for (const id of exitIds) {
    if (positions[id]) return false; // still on board
  }
  return true;
}

/**
 * Builds a positions map from a puzzle definition.
 */
export function initPositions(puzzle) {
  return Object.fromEntries(
    puzzle.robots.map(r => [r.id, { row: r.row, col: r.col }])
  );
}
