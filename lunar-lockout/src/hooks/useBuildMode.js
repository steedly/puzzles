// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useReducer, useCallback } from 'react';
import { solvePuzzle } from '../logic/solver';
import { computeStableId } from './usePuzzleLibrary';

const EXIT_IDS = ['target', 'exit1', 'exit2', 'exit3'];
const HELPER_IDS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];
const MAX_EXITS = 4;
const MAX_HELPERS = 9;

const INITIAL_STATE = {
  pieces: [],            // [{ id, row, col, isExit }]
  placingType: 'exit',   // 'exit' | 'helper'
  phase: 'placing',      // 'placing' | 'solved'
  solvedPuzzle: null,
  errorMsg: null,        // shown during 'placing' phase, cleared on next piece change
};

function nextExitId(pieces) {
  const used = new Set(pieces.filter(p => p.isExit).map(p => p.id));
  return EXIT_IDS.find(id => !used.has(id)) || null;
}

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
      const { row, col, blockedCells, board } = action;
      if (state.phase === 'solved') return state;
      const key = `${row},${col}`;
      if (blockedCells && blockedCells.has(key)) return state;
      const ctrR = board ? board.centerRow : 3;
      const ctrC = board ? board.centerCol : 3;
      if (row === ctrR && col === ctrC && state.placingType === 'exit') return state;

      const existing = state.pieces.find(p => p.row === row && p.col === col);
      if (existing) {
        return { ...state, phase: 'placing', errorMsg: null, pieces: state.pieces.filter(p => p !== existing) };
      }

      if (state.placingType === 'exit') {
        const exitCount = state.pieces.filter(p => p.isExit).length;
        if (exitCount >= MAX_EXITS) return state;
        const id = nextExitId(state.pieces);
        if (!id) return state;
        return {
          ...state, phase: 'placing', errorMsg: null,
          pieces: [...state.pieces, { id, row, col, isExit: true }],
        };
      } else {
        const helperCount = state.pieces.filter(p => !p.isExit).length;
        if (helperCount >= MAX_HELPERS) return state;
        const id = nextHelperId(state.pieces);
        if (!id) return state;
        return {
          ...state, phase: 'placing', errorMsg: null,
          pieces: [...state.pieces, { id, row, col, isExit: false }],
        };
      }
    }

    case 'SET_PLACING_TYPE':
      return { ...state, placingType: action.placingType };

    case 'CLEAR':
      return { ...INITIAL_STATE };

    case 'EDIT':
      return {
        ...INITIAL_STATE,
        pieces: state.solvedPuzzle?.robots ?? state.pieces,
      };

    case 'SOLVE_COMPLETE':
      return { ...state, phase: 'solved', solvedPuzzle: action.puzzle, errorMsg: null };

    case 'SOLVE_ERROR':
      return { ...state, phase: 'placing', errorMsg: action.msg };

    case 'LOAD_POSITIONS': {
      const { numExits, positions } = action;
      const pieces = positions.map((pos, i) => {
        const isExit = i < numExits;
        return {
          id: isExit ? EXIT_IDS[i] : HELPER_IDS[i - numExits],
          row: pos[0],
          col: pos[1],
          isExit,
        };
      });
      return { ...INITIAL_STATE, pieces };
    }

    case 'LOAD_ROBOTS': {
      // Load pieces from a puzzle's robots array [{id, row, col, isExit}, ...]
      const pieces = action.robots.map(r => ({
        id: r.id, row: r.row, col: r.col, isExit: r.isExit,
      }));
      return { ...INITIAL_STATE, pieces };
    }

    default:
      return state;
  }
}

export function useBuildMode() {
  const [buildState, buildDispatch] = useReducer(reducer, INITIAL_STATE);

  const solve = useCallback((blockedCells, board) => {
    const { pieces } = buildState;
    const exits = pieces.filter(p => p.isExit);
    const helpers = pieces.filter(p => !p.isExit);
    if (exits.length === 0) {
      buildDispatch({ type: 'SOLVE_ERROR', msg: 'Place at least one exit piece.' });
      return;
    }
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
      exits: exits.length,
      helpers: helpers.length,
      minMoves: 0,
      solution: [],
      robots,
    };

    const solution = solvePuzzle(syntheticPuzzle, blockedCells, board);
    if (!solution || solution.length === 0) {
      buildDispatch({ type: 'SOLVE_ERROR', msg: 'No solution exists for this configuration.' });
      return;
    }

    const grouped = countGroupedMoves(solution);
    const posStr = robots.map(r => `${r.row},${r.col}`).join(' ');
    const stableId = computeStableId(exits.length, posStr);
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
