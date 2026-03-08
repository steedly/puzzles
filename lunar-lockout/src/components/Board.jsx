import { slideRobot } from '../logic/gameEngine';
import Cell from './Cell';
import SolutionOverlay from './SolutionOverlay';

export default function Board({ state, dispatch, puzzle, blockedCells, blockMode, onToggleBlock, showPaths }) {
  // Build reverse lookup: "row,col" → robotId
  const cellMap = {};
  for (const [id, pos] of Object.entries(state.positions)) {
    cellMap[`${pos.row},${pos.col}`] = id;
  }

  // Build robotMeta lookup: id → { isExit, exitIndex }
  // exitIndex: 0 = first exit ('target'), 1 = 'exit1', etc., -1 = helper
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
        state.positions, state.selectedRobotId, dir, state.exitIds ?? null, blockedCells ?? null
      );
      if (!newPositions) continue;
      const newPos = newPositions[state.selectedRobotId];
      if (newPos) {
        landingCells.add(`${newPos.row},${newPos.col}`);
      } else {
        // Exit robot reached center and was removed — highlight center.
        landingCells.add('3,3');
      }
    }
  }

  function handleCellClick(row, col, robotId) {
    // Block mode: toggle blocked state on empty non-center cells
    if (blockMode) {
      if (row === 3 && col === 3) return; // can't block center
      if (robotId) return; // can't block occupied cells
      onToggleBlock(row, col);
      return;
    }

    if (robotId) {
      dispatch({ type: 'SELECT_ROBOT', robotId });
      return;
    }
    if (!state.selectedRobotId || !selectedRobotPos) {
      dispatch({ type: 'DESELECT' });
      return;
    }
    // Determine direction from selected robot to clicked empty cell.
    if (row === selectedRobotPos.row && col !== selectedRobotPos.col) {
      dispatch({ type: 'SLIDE', direction: col > selectedRobotPos.col ? 'right' : 'left', blockedCells });
    } else if (col === selectedRobotPos.col && row !== selectedRobotPos.row) {
      dispatch({ type: 'SLIDE', direction: row > selectedRobotPos.row ? 'down' : 'up', blockedCells });
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
          isBlocked={blockedCells && blockedCells.has(key)}
          blockMode={blockMode}
          onClick={handleCellClick}
        />
      );
    }
  }

  return (
    <div className="board-container">
      <div className={`board${blockMode ? ' board--block-mode' : ''}`}>{cells}</div>
      {showPaths && (
        <SolutionOverlay puzzle={puzzle} blockedCells={blockedCells} />
      )}
    </div>
  );
}
