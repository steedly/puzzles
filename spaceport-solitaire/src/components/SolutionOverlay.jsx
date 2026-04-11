// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo, useRef, useEffect, useState } from 'react';
import { solvePuzzle } from '../logic/solver.js';

const DR = { up: -1, down: 1, left: 0, right: 0, nw: -1, se: 1, sw: 0, ne: 0, no: -1, so: 1 };
const DC = { up: 0, down: 0, left: -1, right: 1, nw: 0, se: 0, sw: -1, ne: 1, no: 1, so: -1 };

// Robot color palette (matches CSS variables)
const ROBOT_COLORS = {
  target: '#e63946',
  exit1:  '#22c55e',
  exit2:  '#06b6d4',
  exit3:  '#a855f7',
  exit4:  '#f97316',
};
const HELPER_COLOR = '#457b9d';
const CONFLICT_COLOR = '#f44336';

function robotColor(id) {
  return ROBOT_COLORS[id] ?? HELPER_COLOR;
}

function robotLabel(id) {
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

/**
 * Check if a slide path from (sr,sc) in direction crosses any blocked cell.
 */
function pathCrossesBlock(sr, sc, dir, endR, endC, blockedCells) {
  if (!blockedCells || blockedCells.size === 0) return false;
  const dr = DR[dir], dc = DC[dir];
  let r = sr + dr, c = sc + dc;
  // Walk from start+1 to end (inclusive — end is the landing cell)
  while (r !== endR + dr || c !== endC + dc) {
    if (blockedCells.has(`${r},${c}`)) return true;
    r += dr;
    c += dc;
  }
  return false;
}

/**
 * Replay solution from initial positions, producing arrow segments.
 */
function computeArrows(solution, puzzle, blockedCells, board) {
  if (!solution || solution.length === 0 || !puzzle) return [];

  // Build positions map from puzzle
  const positions = {};
  for (const r of puzzle.robots) {
    positions[r.id] = { row: r.row, col: r.col };
  }
  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));

  const arrows = [];
  for (let i = 0; i < solution.length; i++) {
    const move = solution[i];
    const pos = positions[move.mover];
    if (!pos) continue;

    const dr = DR[move.dir], dc = DC[move.dir];
    let r = pos.row, c = pos.col;

    // Slide until hitting another robot or wall
    while (true) {
      const nr = r + dr, nc = c + dc;
      const maxIdx = (board ? board.N : 7) - 1;
      if (nr < 0 || nr > maxIdx || nc < 0 || nc > maxIdx) break;
      let hit = false;
      for (const [id, p] of Object.entries(positions)) {
        if (id !== move.mover && p.row === nr && p.col === nc) { hit = true; break; }
      }
      if (hit) break;
      r = nr;
      c = nc;
    }

    const crossesBlock = pathCrossesBlock(pos.row, pos.col, move.dir, r, c, blockedCells);

    arrows.push({
      startRow: pos.row, startCol: pos.col,
      endRow: r, endCol: c,
      mover: move.mover,
      step: i + 1,
      crossesBlock,
    });

    // Update positions
    const ctrR = board ? board.centerRow : 3;
    const ctrC = board ? board.centerCol : 3;
    if (exitIds.has(move.mover) && r === ctrR && c === ctrC) {
      delete positions[move.mover];
    } else {
      positions[move.mover] = { row: r, col: c };
    }
  }
  return arrows;
}

export default function SolutionOverlay({ puzzle, blockedCells, board }) {
  const boardRef = useRef(null);
  const [dims, setDims] = useState(null);

  // Measure the board element to get exact pixel positions
  useEffect(() => {
    const board = document.querySelector('.board');
    if (!board) return;
    boardRef.current = board;

    function measure() {
      const rect = board.getBoundingClientRect();
      const style = getComputedStyle(board);
      const cellSize = parseFloat(style.getPropertyValue('--cell-size')) || 62;
      const cellGap = parseFloat(style.getPropertyValue('--cell-gap')) || 5;
      const padding = parseFloat(style.paddingLeft) || 10;
      setDims({ width: rect.width, height: rect.height, cellSize, cellGap, padding });
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  // Get solution — use embedded when no blocks, compute otherwise
  const hasBlocks = blockedCells && blockedCells.size > 0;
  const blockKey = hasBlocks ? [...blockedCells].sort().join(';') : '';
  const solution = useMemo(() => {
    if (!puzzle) return [];
    if (!hasBlocks && puzzle.solution && puzzle.solution.length > 0) return puzzle.solution;
    return solvePuzzle(puzzle, blockedCells) || [];
  }, [puzzle, hasBlocks, blockKey]);

  const arrows = useMemo(
    () => computeArrows(solution, puzzle, blockedCells, board),
    [solution, puzzle, blockedCells, board]
  );

  if (!dims || arrows.length === 0) return null;

  const { width, height, cellSize, cellGap, padding } = dims;

  // Convert grid (row, col) to pixel center within the board
  function cx(col) { return padding + col * (cellSize + cellGap) + cellSize / 2; }
  function cy(row) { return padding + row * (cellSize + cellGap) + cellSize / 2; }

  // Shorten arrows so they don't overlap robot circles
  const INSET = cellSize * 0.38;

  return (
    <svg
      className="solution-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        {/* Arrowhead markers — one per color */}
        {arrows.map((a, i) => {
          const color = a.crossesBlock ? CONFLICT_COLOR : robotColor(a.mover);
          return (
            <marker
              key={`marker-${i}`}
              id={`arrow-${i}`}
              markerWidth="8" markerHeight="6"
              refX="7" refY="3"
              orient="auto"
            >
              <path d="M0,0 L8,3 L0,6 Z" fill={color} />
            </marker>
          );
        })}
      </defs>

      {arrows.map((a, i) => {
        const x1 = cx(a.startCol), y1 = cy(a.startRow);
        const x2 = cx(a.endCol), y2 = cy(a.endRow);
        const color = a.crossesBlock ? CONFLICT_COLOR : robotColor(a.mover);

        // Compute shortened endpoints
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) return null;
        const ux = dx / len, uy = dy / len;
        const sx = x1 + ux * INSET, sy = y1 + uy * INSET;
        const ex = x2 - ux * INSET, ey = y2 - uy * INSET;

        // Midpoint for step label
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

        return (
          <g key={i}>
            <line
              x1={sx} y1={sy} x2={ex} y2={ey}
              stroke={color}
              strokeWidth={a.crossesBlock ? 4 : 3}
              strokeOpacity={a.crossesBlock ? 0.9 : 0.6}
              strokeDasharray={a.crossesBlock ? '6,4' : 'none'}
              markerEnd={`url(#arrow-${i})`}
            />
            <circle cx={mx} cy={my} r={9} fill="#0d0d1a" fillOpacity={0.85} stroke={color} strokeWidth={1.5} />
            <text x={mx} y={my} textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize="10" fontWeight="700" fontFamily="monospace"
            >{a.step}</text>
          </g>
        );
      })}
    </svg>
  );
}
