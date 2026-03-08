import { useReducer, useEffect, useRef } from 'react';
import { slideRobot, isWon, initPositions } from '../logic/gameEngine';

function buildInitial(puzzle) {
  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));
  return {
    puzzleId:        puzzle.id,
    positions:       initPositions(puzzle),
    selectedRobotId: null,
    moveCount:       0,
    isWon:           false,
    exitIds,
    lastMoverId:     null,               // robot that made the last slide
    history:         [], // each entry: { positions, lastMoverId }
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'SELECT_ROBOT':
      return { ...state, selectedRobotId: action.robotId };

    case 'DESELECT':
      return { ...state, selectedRobotId: null };

    case 'SLIDE': {
      if (!state.selectedRobotId) return state;
      const newPositions = slideRobot(
        state.positions, state.selectedRobotId, action.direction, state.exitIds,
        action.blockedCells ?? null
      );
      if (!newPositions) return state;
      // Consecutive slides by the same robot count as one move (switching robots = new move).
      const isNewGroup = state.selectedRobotId !== state.lastMoverId;
      // Deselect if the moved robot has exited (it's no longer on the board).
      const newSelected = newPositions[state.selectedRobotId]
        ? state.selectedRobotId
        : null;
      return {
        ...state,
        positions:       newPositions,
        moveCount:       state.moveCount + (isNewGroup ? 1 : 0),
        lastMoverId:     state.selectedRobotId,
        selectedRobotId: newSelected,
        history:         [...state.history, { positions: state.positions, lastMoverId: state.lastMoverId }],
        isWon:           isWon(newPositions, state.exitIds),
      };
    }

    case 'UNDO': {
      if (state.history.length === 0) return state;
      const prev = state.history[state.history.length - 1];
      const wasNewGroup = state.lastMoverId !== prev.lastMoverId;
      return {
        ...state,
        positions:       prev.positions,
        history:         state.history.slice(0, -1),
        moveCount:       state.moveCount - (wasNewGroup ? 1 : 0),
        lastMoverId:     prev.lastMoverId,
        isWon:           false,
        selectedRobotId: null,
      };
    }

    case 'LOAD_PUZZLE':
      return buildInitial(action.puzzle);

    default:
      return state;
  }
}

export function useGameState(initialPuzzle, blockedCells) {
  const [state, dispatch] = useReducer(reducer, null, () => buildInitial(initialPuzzle));
  const blockedRef = useRef(blockedCells);
  blockedRef.current = blockedCells;

  useEffect(() => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    function handler(e) {
      if (map[e.key]) {
        e.preventDefault();
        dispatch({ type: 'SLIDE', direction: map[e.key], blockedCells: blockedRef.current });
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { state, dispatch };
}
