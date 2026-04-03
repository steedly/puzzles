// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useReducer, useCallback } from 'react';
import { solvePuzzle } from '../logic/solver';
import { computeStableId } from './usePuzzleLibrary';

const HELPER_IDS = ['r1', 'r2', 'r3', 'r4', 'r5'];
const MAX_HELPERS = 5;

const INITIAL_STATE = {
  pieces: [],            // [{ id, row, col, isExit }]
  phase: 'placing',      // 'placing' | 'solved' | 'error'
  solvedPuzzle: null,
  errorMsg: null,
};

function nextHelperId(pieces) {
  const used = new Set(pieces.filter(p => !p.isExit).map(p => p.id));
  return HELPER_IDS.find(id => !used.has(id)) || null;
}

function countGroupedMoves(solution) {
  let count = 0, lastMover = null;
  for (const step of solution) {
    if (step.mover !== lastMover) { count++; lastMover = step.mover; }
  }
  return count;
}

function reducer(state, action) {
  switch (action.type) {
    case 'CLICK_CELL': {
      const { row, col, blockedCells } = action;
      if (state.phase !== 'placing') return state;
      const key = `${row},${col}`;
      if (blockedCells && blockedCells.has(key)) return state;
      if (row === 3 && col === 3) return state; // can't place on center

      const existing = state.pieces.find(p => p.row === row && p.col === col);
      if (existing) {
        // Remove the piece
        return { ...state, pieces: state.pieces.filter(p => p !== existing) };
      }

      const hasExit = state.pieces.some(p => p.isExit);
      if (!hasExit) {
        // Place the exit piece
        return {
          ...state,
          pieces: [...state.pieces, { id: 'target', row, col, isExit: true }],
        };
      }

      // Place a helper
      const helperCount = state.pieces.filter(p => !p.isExit).length;
      if (helperCount >= MAX_HELPERS) return state;
      const id = nextHelperId(state.pieces);
      if (!id) return state;
      return {
        ...state,
        pieces: [...state.pieces, { id, row, col, isExit: false }],
      };
    }

    case 'CLEAR':
      return { ...INITIAL_STATE };

    case 'EDIT':
      return { ...INITIAL_STATE, pieces: state.solvedPuzzle?.robots ?? state.pieces };

    case 'SOLVE_COMPLETE':
      return { ...state, phase: 'solved', solvedPuzzle: action.puzzle, errorMsg: null };

    case 'SOLVE_ERROR':
      return { ...state, phase: 'error', errorMsg: action.msg };

    case 'LOAD_POSITIONS': {
      // Load pieces from decoded stableId positions: [[row,col], ...]
      // First position is exit, rest are helpers.
      const { positions } = action;
      const pieces = positions.map((pos, i) => ({
        id: i === 0 ? 'target' : HELPER_IDS[i - 1],
        row: pos[0],
        col: pos[1],
        isExit: i === 0,
      }));
      return { ...INITIAL_STATE, pieces };
    }

    default:
      return state;
  }
}

export function useBuildMode() {
  const [buildState, buildDispatch] = useReducer(reducer, INITIAL_STATE);

  const solve = useCallback((blockedCells) => {
    const { pieces } = buildState;
    const exit = pieces.find(p => p.isExit);
    if (!exit) {
      buildDispatch({ type: 'SOLVE_ERROR', msg: 'Place the exit piece (A) first.' });
      return;
    }
    const helpers = pieces.filter(p => !p.isExit);
    if (helpers.length === 0) {
      buildDispatch({ type: 'SOLVE_ERROR', msg: 'Place at least one helper piece.' });
      return;
    }

    const robots = pieces.map(p => ({
      id: p.id, row: p.row, col: p.col, isExit: p.isExit,
    }));
    const syntheticPuzzle = {
      id: 'custom',
      stableId: 'custom',
      exits: 1,
      helpers: helpers.length,
      minMoves: 0,
      solution: [],
      robots,
    };

    const solution = solvePuzzle(syntheticPuzzle, blockedCells);
    if (!solution || solution.length === 0) {
      buildDispatch({ type: 'SOLVE_ERROR', msg: 'No solution exists for this configuration.' });
      return;
    }

    const grouped = countGroupedMoves(solution);
    const posStr = robots.map(r => `${r.row},${r.col}`).join(' ');
    const stableId = computeStableId(1, posStr);
    const solvedPuzzle = {
      ...syntheticPuzzle,
      stableId,
      minMoves: grouped,
      rawSlides: solution.length,
      minRawSlides: solution.length,
      solution,
    };
    buildDispatch({ type: 'SOLVE_COMPLETE', puzzle: solvedPuzzle });
  }, [buildState]);

  return { buildState, buildDispatch, solve };
}
