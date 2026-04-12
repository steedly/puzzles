// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';
import { slideRobot } from '../logic/gameEngine';
import { SQUARE_7x7 } from '../logic/boardGeometry';
import Cell from './Cell';
import SolutionOverlay from './SolutionOverlay';

// ── Hex geometry helpers ──────────────────────────────────────────────────────

/**
 * Compute pixel position for a hex diamond cell.
 * Axial hex → pixel, then rotate -60° to form a horizontal diamond.
 */
function hexCellPosition(r, c, N, hexR) {
  const bx = 1.5 * hexR * c;
  const by = Math.sqrt(3) * hexR * (r + c / 2);
  const mid = (N - 1) / 2;
  const cx = 1.5 * hexR * mid;
  const cy = Math.sqrt(3) * hexR * (mid + mid / 2);
  const dx = bx - cx;
  const dy = by - cy;
  const cos60 = 0.5;
  const sin60 = Math.sqrt(3) / 2;
  return {
    x:  cos60 * dx + sin60 * dy,
    y: -sin60 * dx + cos60 * dy,
  };
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

// ── Responsive scaling wrapper ────────────────────────────────────────────────

/**
 * Scales its children to fit within the parent container width.
 * Used by both square and hex boards so responsive behavior is consistent.
 */
function ScaledBoard({ naturalWidth, naturalHeight, children }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function measure() {
      if (!containerRef.current) return;
      const parentWidth = containerRef.current.parentElement?.clientWidth ?? naturalWidth;
      setScale(prev => {
        const next = Math.min(1, parentWidth / naturalWidth);
        return next === prev ? prev : next;
      });
    }
    const parent = containerRef.current?.parentElement;
    const ro = new ResizeObserver(measure);
    if (parent) ro.observe(parent);
    return () => ro.disconnect();
  }, [naturalWidth]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: naturalWidth,
        height: naturalHeight * scale,
        overflow: 'hidden',
      }}
    >
      <div style={{
        width: naturalWidth,
        height: naturalHeight,
        position: 'relative',
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Board component ───────────────────────────────────────────────────────────

export default function Board({ state, dispatch, puzzle, showPaths, scoreMode, variantBlocks, buildMode, buildPieces, onBuildClick, board = SQUARE_7x7 }) {
  const N = board.N;
  const isHex = board.type === 'hex';
  // Adjacent hex cells are R√3 apart; match square spacing (cell-size 62 + gap 5 = 67).
  const hexR = 67 / Math.sqrt(3);

  // ── Shared: build cellMap + robotMeta from pieces or state ──
  const cellMap = {};
  const robotMeta = {};
  let exitIdx = 0;

  if (buildMode) {
    for (const p of buildPieces) {
      cellMap[`${p.row},${p.col}`] = p.id;
      robotMeta[p.id] = { isExit: p.isExit, exitIndex: p.isExit ? exitIdx++ : -1 };
    }
  } else {
    for (const [id, pos] of Object.entries(state.positions)) {
      cellMap[`${pos.row},${pos.col}`] = id;
    }
    for (const r of puzzle.robots) {
      robotMeta[r.id] = { isExit: r.isExit, exitIndex: r.isExit ? exitIdx++ : -1 };
    }
  }

  // ── Shared: bounding box of current positions (cells outside are unreachable) ──
  let minR = N, maxR = -1, minC = N, maxC = -1;
  if (!buildMode && state.positions) {
    for (const pos of Object.values(state.positions)) {
      if (pos.row < minR) minR = pos.row;
      if (pos.row > maxR) maxR = pos.row;
      if (pos.col < minC) minC = pos.col;
      if (pos.col > maxC) maxC = pos.col;
    }
  }

  // ── Shared: landing cells ──
  const landingCells = new Set();
  if (!buildMode && state.selectedRobotId && state.positions[state.selectedRobotId]) {
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

  // ── Shared: click handler ──
  function handleCellClick(row, col, robotId) {
    if (buildMode) {
      onBuildClick(row, col);
      return;
    }
    if (robotId) {
      dispatch({ type: 'SELECT_ROBOT', robotId });
      return;
    }
    if (!state.selectedRobotId || !state.positions[state.selectedRobotId]) {
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

  // ── Shared: generate cell elements ──
  const hexDims = isHex ? hexBoardDimensions(N, hexR) : null;
  const cellW = hexR * 2;
  const cellH = hexR * Math.sqrt(3);

  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const key = `${r},${c}`;
      const robotId = cellMap[key] ?? null;

      // Hex cells need absolute positioning via inline style
      let style;
      if (isHex) {
        const { x, y } = hexCellPosition(r, c, N, hexR);
        style = {
          position: 'absolute',
          left: x + hexDims.offsetX - cellW / 2,
          top:  y + hexDims.offsetY - cellH / 2,
          width: cellW,
          height: cellH,
        };
      }

      cells.push(
        <Cell
          key={key}
          row={r}
          col={c}
          hex={isHex}
          style={style}
          isCenter={r === board.centerRow && c === board.centerCol}
          robotId={robotId}
          robotMeta={robotId ? robotMeta[robotId] : null}
          selectedRobotId={buildMode ? null : state.selectedRobotId}
          isLandingCell={landingCells.has(key)}
          isVariantBlocked={variantBlocks && variantBlocks.has(key)}
          isUnreachable={!buildMode && maxR >= 0 && (r < minR || r > maxR || c < minC || c > maxC)}
          isBuildMode={buildMode}
          onClick={handleCellClick}
        />
      );
    }
  }

  // ── Render: board container ──
  if (isHex) {
    return (
      <div className="board-container">
        <ScaledBoard naturalWidth={hexDims.width} naturalHeight={hexDims.height}>
          {cells}
        </ScaledBoard>
      </div>
    );
  }

  // Square board: compute natural size for ScaledBoard
  const squareNatural = N * 62 + (N - 1) * 5 + 20; // cell-size + gaps + padding
  return (
    <div className="board-container">
      <ScaledBoard naturalWidth={squareNatural} naturalHeight={squareNatural}>
        <div className="board">
          {cells}
        </div>
        {showPaths && (
          <SolutionOverlay puzzle={puzzle} blockedCells={variantBlocks} board={board} scoreMode={scoreMode} />
        )}
      </ScaledBoard>
    </div>
  );
}
