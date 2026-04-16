// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useMemo } from 'react';
import { slideRobot } from '../logic/gameEngine';
import { SQUARE_7x7 } from '../logic/boardGeometry';
import { computeReachableCells } from '../logic/reachabilityBounds';
import Cell from './Cell';

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

export default function Board({ state, dispatch, puzzle, variantBlocks, buildMode, buildPieces, onBuildClick, board = SQUARE_7x7, nextMove, cellShading = 'bbox' }) {
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

  // ── Shared: reachable cells (cells outside are dimmed) ──
  const positions = state?.positions;
  const reachable = useMemo(() => {
    if (buildMode || !positions || cellShading === 'none') return null;
    return computeReachableCells(positions, cellShading, board.type === 'hex', board.N);
  }, [positions, cellShading, buildMode, board]);

  // Center unreachable under current bound → puzzle is unwinnable from this state
  const centerUnwinnable = reachable !== null && !reachable.has(`${board.centerRow},${board.centerCol}`);

  // ── Shared: landing cells ──
  // Highlight the clicked robot if there is one; otherwise fall back to the
  // hovered robot for desktop preview (Option A: hover-when-idle only).
  const highlightedRobotId = buildMode
    ? null
    : (state.selectedRobotId || state.hoveredRobotId);
  const landingCells = new Set();
  if (highlightedRobotId && state.positions[highlightedRobotId]) {
    for (const dir of board.dirs) {
      const newPositions = slideRobot(
        state.positions, highlightedRobotId, dir.name, state.exitIds ?? null, variantBlocks ?? null, board
      );
      if (!newPositions) continue;
      const newPos = newPositions[highlightedRobotId];
      if (newPos) {
        landingCells.add(`${newPos.row},${newPos.col}`);
      } else {
        landingCells.add(`${board.centerRow},${board.centerCol}`);
      }
    }
  }

  // ── Compute the next-target cell for solution stepping ──
  let nextTargetKey = null;
  if (!buildMode && nextMove && state.positions[nextMove.mover]) {
    const newPositions = slideRobot(
      state.positions, nextMove.mover, nextMove.dir, state.exitIds ?? null, variantBlocks ?? null, board
    );
    if (newPositions) {
      const newPos = newPositions[nextMove.mover];
      if (newPos) nextTargetKey = `${newPos.row},${newPos.col}`;
      else nextTargetKey = `${board.centerRow},${board.centerCol}`;
    }
  }

  // ── Shared: click handler ──
  function handleCellClick(row, col, robotId) {
    if (buildMode) {
      onBuildClick(row, col);
      return;
    }
    if (robotId) {
      if (robotId === state.selectedRobotId) {
        dispatch({ type: 'DESELECT' });
      } else {
        dispatch({ type: 'SELECT_ROBOT', robotId });
      }
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

  // ── Hover handlers (desktop preview; suppressed in build mode and once a
  // robot has been clicked, per Option A). The reducer also guards against
  // hover-while-selected, but we skip the dispatch entirely to avoid noise. ──
  const hoverEnabled = !buildMode && !state.selectedRobotId;
  const handleHoverEnter = hoverEnabled
    ? (robotId) => { if (robotId) dispatch({ type: 'HOVER_ROBOT', robotId }); }
    : undefined;
  const handleHoverLeave = hoverEnabled
    ? (robotId) => { if (robotId) dispatch({ type: 'UNHOVER' }); }
    : undefined;

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
          left: x + hexDims.offsetX - cellW / 2 + 10,
          top:  y + hexDims.offsetY - cellH / 2 + 10,
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
          isCenterUnwinnable={r === board.centerRow && c === board.centerCol && centerUnwinnable}
          robotId={robotId}
          robotMeta={robotId ? robotMeta[robotId] : null}
          highlightedRobotId={highlightedRobotId}
          isLandingCell={landingCells.has(key)}
          isNextTarget={key === nextTargetKey}
          isVariantBlocked={variantBlocks && variantBlocks.has(key)}
          isUnreachable={reachable !== null && !reachable.has(`${r},${c}`)}
          isBuildMode={buildMode}
          onClick={handleCellClick}
          onHoverEnter={handleHoverEnter}
          onHoverLeave={handleHoverLeave}
        />
      );
    }
  }

  // ── Render: board container ──
  if (isHex) {
    const boardPad = 20; // 10px padding on each side, matching .board--hex CSS
    return (
      <div className="board-container">
        <ScaledBoard naturalWidth={hexDims.width + boardPad} naturalHeight={hexDims.height + boardPad}>
          <div className="board board--hex" style={{ width: hexDims.width + boardPad, height: hexDims.height + boardPad, position: 'relative' }}>
            {cells}
          </div>
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
      </ScaledBoard>
    </div>
  );
}
