// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { slideRobot } from '../logic/gameEngine';
import { SQUARE_7x7 } from '../logic/boardGeometry';
import Cell from './Cell';
import Robot from './Robot';
import SolutionOverlay from './SolutionOverlay';

/**
 * Compute pixel position for a hex diamond cell.
 *
 * The internal grid is NxN (row r, col c) with 6 neighbor directions:
 *   (±1,0), (0,±1), (-1,+1), (+1,-1)
 *
 * Step 1: Standard axial hex → pixel mapping. This places all 6 neighbors
 *         at equal distance R√3, ensuring hexagons share edges.
 * Step 2: Rotate -60° to turn the parallelogram into a horizontal diamond.
 */
function hexCellPosition(r, c, N, hexR) {
  // Axial hex → pixel (flat-top orientation, all 6 neighbors equidistant)
  const bx = 1.5 * hexR * c;
  const by = Math.sqrt(3) * hexR * (r + c / 2);

  // Center on the grid midpoint
  const mid = (N - 1) / 2;
  const cx = 1.5 * hexR * mid;
  const cy = Math.sqrt(3) * hexR * (mid + mid / 2);
  const dx = bx - cx;
  const dy = by - cy;

  // Rotate -60° to form a horizontal diamond
  const cos60 = 0.5;
  const sin60 = Math.sqrt(3) / 2;
  const x =  cos60 * dx + sin60 * dy;
  const y = -sin60 * dx + cos60 * dy;

  return { x, y };
}

function hexBoardDimensions(N, hexR) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const { x, y } = hexCellPosition(r, c, N, hexR);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const padX = hexR * 1.1;
  const padY = hexR * 1.0;
  return {
    width:   maxX - minX + padX * 2,
    height:  maxY - minY + padY * 2,
    offsetX: -minX + padX,
    offsetY: -minY + padY,
  };
}

function renderHexCells(N, hexR, cellMap, robotMeta, opts) {
  const dims = hexBoardDimensions(N, hexR);
  const cells = [];
  // Flat-top hex: width = 2R, height = R√3
  const cellW = hexR * 2;
  const cellH = hexR * Math.sqrt(3);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const key = `${r},${c}`;
      const { x, y } = hexCellPosition(r, c, N, hexR);
      const robotId = cellMap[key] ?? null;

      cells.push(
        <div
          key={key}
          className={[
            'hex-cell',
            opts.isCenter(r, c)                    ? 'hex-cell--center'  : '',
            opts.isLanding && opts.isLanding(key)   ? 'hex-cell--landing' : '',
            opts.isBuildMode && !robotId && !opts.isCenter(r, c) ? 'hex-cell--placeable' : '',
          ].filter(Boolean).join(' ')}
          style={{
            position: 'absolute',
            left: x + dims.offsetX - cellW / 2,
            top:  y + dims.offsetY - cellH / 2,
            width: cellW,
            height: cellH,
          }}
          onClick={() => opts.onClick(r, c, robotId)}
        >
          {robotId && robotMeta[robotId] && (
            <div className="hex-cell__robot">
              <Robot
                robotId={robotId}
                isExit={robotMeta[robotId].isExit}
                exitIndex={robotMeta[robotId].exitIndex}
                isSelected={robotId === opts.selectedRobotId}
              />
            </div>
          )}
        </div>
      );
    }
  }

  return { cells, dims };
}

export default function Board({ state, dispatch, puzzle, showPaths, variantBlocks, buildMode, buildPieces, onBuildClick, board = SQUARE_7x7 }) {
  const N = board.N;
  const isHex = board.type === 'hex';
  // Match square board's center-to-center spacing (cell-size 62px + gap 5px = 67px).
  // Adjacent hex cells are R√3 apart, so R = 67/√3 ≈ 38.7.
  const hexR = 67 / Math.sqrt(3);

  // ── Build mode ──
  if (buildMode) {
    const cellMap = {};
    const robotMeta = {};
    let exitIdx = 0;
    for (const p of buildPieces) {
      cellMap[`${p.row},${p.col}`] = p.id;
      robotMeta[p.id] = { isExit: p.isExit, exitIndex: p.isExit ? exitIdx++ : -1 };
    }

    if (isHex) {
      const { cells, dims } = renderHexCells(N, hexR, cellMap, robotMeta, {
        isCenter: (r, c) => r === board.centerRow && c === board.centerCol,
        isLanding: null,
        isBuildMode: true,
        selectedRobotId: null,
        onClick: (r, c) => onBuildClick(r, c),
      });
      return (
        <div className="board-container">
          <div className="hex-board" style={{ width: dims.width, height: dims.height, position: 'relative' }}>
            {cells}
          </div>
        </div>
      );
    }

    // Square build mode (unchanged)
    const cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const key = `${r},${c}`;
        const robotId = cellMap[key] ?? null;
        cells.push(
          <Cell key={key} row={r} col={c}
            isCenter={r === board.centerRow && c === board.centerCol}
            robotId={robotId}
            robotMeta={robotId ? robotMeta[robotId] : null}
            selectedRobotId={null} isLandingCell={false}
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

  if (isHex) {
    const { cells, dims } = renderHexCells(N, hexR, cellMap, robotMeta, {
      isCenter: (r, c) => r === board.centerRow && c === board.centerCol,
      isLanding: (key) => landingCells.has(key),
      isBuildMode: false,
      selectedRobotId: state.selectedRobotId,
      onClick: handleCellClick,
    });
    return (
      <div className="board-container">
        <div className="hex-board" style={{ width: dims.width, height: dims.height, position: 'relative' }}>
          {cells}
        </div>
      </div>
    );
  }

  // ── Square board (unchanged) ──
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const key = `${r},${c}`;
      const robotId = cellMap[key] ?? null;
      cells.push(
        <Cell key={key} row={r} col={c}
          isCenter={r === board.centerRow && c === board.centerCol}
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
        <SolutionOverlay puzzle={puzzle} blockedCells={variantBlocks} board={board} />
      )}
    </div>
  );
}
