// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { slideRobot } from '../logic/gameEngine';
import Cell from './Cell';
import SolutionOverlay from './SolutionOverlay';

export default function Board({ state, dispatch, puzzle, showPaths, variantBlocks, buildMode, buildPieces, onBuildClick }) {
  // ── Build mode: simpler rendering with click-to-place ──
  if (buildMode) {
    const cellMap = {};
    const robotMeta = {};
    let exitIdx = 0;
    for (const p of buildPieces) {
      cellMap[`${p.row},${p.col}`] = p.id;
      robotMeta[p.id] = { isExit: p.isExit, exitIndex: p.isExit ? exitIdx++ : -1 };
    }

    const cells = [];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const key = `${r},${c}`;
        const robotId = cellMap[key] ?? null;
        cells.push(
          <Cell
            key={key}
            row={r}
            col={c}
            isCenter={r === 3 && c === 3}
            robotId={robotId}
            robotMeta={robotId ? robotMeta[robotId] : null}
            selectedRobotId={null}
            isLandingCell={false}
            isVariantBlocked={variantBlocks && variantBlocks.has(key)}
            isBuildMode
            onClick={(row, col) => onBuildClick(row, col)}
          />
        );
      }
    }
    return (
      <div className="board-container">
        <div className="board">{cells}</div>
      </div>
    );
  }

  // ── Normal play mode ──
  // Build reverse lookup: "row,col" → robotId
  const cellMap = {};
  for (const [id, pos] of Object.entries(state.positions)) {
    cellMap[`${pos.row},${pos.col}`] = id;
  }

  // Build robotMeta lookup: id → { isExit, exitIndex }
  const robotMeta = {};
  let exitIdx = 0;
  for (const r of puzzle.robots) {
    robotMeta[r.id] = {
      isExit:    r.isExit,
      exitIndex: r.isExit ? exitIdx++ : -1,
    };
  }

  const selectedRobotPos = state.selectedRobotId
    ? state.positions[state.selectedRobotId]
    : null;

  // Compute the valid landing cell for each direction the selected robot can move.
  const landingCells = new Set();
  if (state.selectedRobotId && selectedRobotPos) {
    for (const dir of ['up', 'down', 'left', 'right']) {
      const newPositions = slideRobot(
        state.positions, state.selectedRobotId, dir, state.exitIds ?? null, variantBlocks ?? null
      );
      if (!newPositions) continue;
      const newPos = newPositions[state.selectedRobotId];
      if (newPos) {
        landingCells.add(`${newPos.row},${newPos.col}`);
      } else {
        landingCells.add('3,3');
      }
    }
  }

  function handleCellClick(row, col, robotId) {
    if (robotId) {
      dispatch({ type: 'SELECT_ROBOT', robotId });
      return;
    }
    if (!state.selectedRobotId || !selectedRobotPos) {
      dispatch({ type: 'DESELECT' });
      return;
    }
    if (row === selectedRobotPos.row && col !== selectedRobotPos.col) {
      dispatch({ type: 'SLIDE', direction: col > selectedRobotPos.col ? 'right' : 'left', blockedCells: variantBlocks });
    } else if (col === selectedRobotPos.col && row !== selectedRobotPos.row) {
      dispatch({ type: 'SLIDE', direction: row > selectedRobotPos.row ? 'down' : 'up', blockedCells: variantBlocks });
    } else {
      dispatch({ type: 'DESELECT' });
    }
  }

  const cells = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const key = `${r},${c}`;
      const robotId = cellMap[key] ?? null;
      cells.push(
        <Cell
          key={key}
          row={r}
          col={c}
          isCenter={r === 3 && c === 3}
          robotId={robotId}
          robotMeta={robotId ? robotMeta[robotId] : null}
          selectedRobotId={state.selectedRobotId}
          isLandingCell={landingCells.has(key)}
          isVariantBlocked={variantBlocks && variantBlocks.has(key)}
          onClick={handleCellClick}
        />
      );
    }
  }

  return (
    <div className="board-container">
      <div className="board">{cells}</div>
      {showPaths && (
        <SolutionOverlay puzzle={puzzle} blockedCells={variantBlocks} />
      )}
    </div>
  );
}
