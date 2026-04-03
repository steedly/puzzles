// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { slideRobot } from '../logic/gameEngine';
import { SQUARE_7x7 } from '../logic/boardGeometry';
import Cell from './Cell';
import SolutionOverlay from './SolutionOverlay';

export default function Board({ state, dispatch, puzzle, showPaths, variantBlocks, buildMode, buildPieces, onBuildClick, board = SQUARE_7x7 }) {
  const N = board.N;
  const isHex = board.type === 'hex';

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
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const key = `${r},${c}`;
        const robotId = cellMap[key] ?? null;
        cells.push(
          <Cell
            key={key}
            row={r}
            col={c}
            isCenter={r === board.centerRow && c === board.centerCol}
            robotId={robotId}
            robotMeta={robotId ? robotMeta[robotId] : null}
            selectedRobotId={null}
            isLandingCell={false}
            isVariantBlocked={variantBlocks && variantBlocks.has(key)}
            isBuildMode
            isHex={isHex}
            onClick={(row, col) => onBuildClick(row, col)}
          />
        );
      }
    }
    return (
      <div className="board-container">
        <div className={`board ${isHex ? 'board--hex board--hex-' + N : ''}`}
             style={isHex ? { '--hex-n': N } : undefined}>
          {cells}
        </div>
      </div>
    );
  }

  // ── Normal play mode ──
  const cellMap = {};
  for (const [id, pos] of Object.entries(state.positions)) {
    cellMap[`${pos.row},${pos.col}`] = id;
  }

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
    for (const dir of board.dirs) {
      const newPositions = slideRobot(
        state.positions, state.selectedRobotId, dir.name, state.exitIds ?? null, variantBlocks ?? null, board
      );
      if (!newPositions) continue;
      const newPos = newPositions[state.selectedRobotId];
      if (newPos) {
        landingCells.add(`${newPos.row},${newPos.col}`);
      } else {
        landingCells.add(`${board.centerRow},${board.centerCol}`);
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

    // Find which direction (if any) connects the selected robot to this cell.
    // Try all directions and see if sliding lands on the clicked cell.
    for (const dir of board.dirs) {
      const newPositions = slideRobot(
        state.positions, state.selectedRobotId, dir.name, state.exitIds ?? null, variantBlocks ?? null, board
      );
      if (!newPositions) continue;
      const newPos = newPositions[state.selectedRobotId];
      const landRow = newPos ? newPos.row : board.centerRow;
      const landCol = newPos ? newPos.col : board.centerCol;
      if (landRow === row && landCol === col) {
        dispatch({ type: 'SLIDE', direction: dir.name, blockedCells: variantBlocks, board });
        return;
      }
    }
    dispatch({ type: 'DESELECT' });
  }

  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const key = `${r},${c}`;
      const robotId = cellMap[key] ?? null;
      cells.push(
        <Cell
          key={key}
          row={r}
          col={c}
          isCenter={r === board.centerRow && c === board.centerCol}
          robotId={robotId}
          robotMeta={robotId ? robotMeta[robotId] : null}
          selectedRobotId={state.selectedRobotId}
          isLandingCell={landingCells.has(key)}
          isVariantBlocked={variantBlocks && variantBlocks.has(key)}
          isHex={isHex}
          onClick={handleCellClick}
        />
      );
    }
  }

  return (
    <div className="board-container">
      <div className={`board ${isHex ? 'board--hex board--hex-' + N : ''}`}
           style={isHex ? { '--hex-n': N } : undefined}>
        {cells}
      </div>
      {showPaths && (
        <SolutionOverlay puzzle={puzzle} blockedCells={variantBlocks} board={board} />
      )}
    </div>
  );
}
