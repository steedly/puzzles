import { useState, useEffect } from 'react';
import { solvePuzzle } from '../logic/solver.js';

const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function robotLabel(id) {
  // target → 'A' (exit 0), exit1 → 'B', exit2 → 'C', …
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

export default function HUD({ state, dispatch, currentPuzzle, blockedCells, userBlockedCells, blockMode, onToggleBlockMode, onClearBlocks, showPaths, onTogglePaths }) {
  const [showSol, setShowSol] = useState(false);
  // null = not computed, [] = computed but empty/failed, [...] = computed solution
  const [computedSol, setComputedSol] = useState(null);

  // Reset when puzzle or blocked cells change
  const puzzleId = currentPuzzle?.id;
  const blockKey = blockedCells ? [...blockedCells].sort().join(';') : '';
  useEffect(() => {
    setShowSol(false);
    setComputedSol(null);
  }, [puzzleId, blockKey]);

  // User-added blocks invalidate embedded solutions; variant blocks do not
  // (variant puzzles were generated with their blocks baked in).
  const hasUserBlocks = userBlockedCells && userBlockedCells.size > 0;
  const embeddedSol = (!hasUserBlocks && currentPuzzle?.solution) ? currentPuzzle.solution : [];
  const solution = embeddedSol.length > 0 ? embeddedSol : (computedSol ?? []);
  const canSolve = currentPuzzle?.minMoves > 0;

  function handleSolutionClick() {
    if (showSol) {
      setShowSol(false);
      return;
    }
    // Compute solution on first click if not using embedded
    if (embeddedSol.length === 0 && computedSol === null && currentPuzzle) {
      setComputedSol(solvePuzzle(currentPuzzle, blockedCells) || []);
    }
    setShowSol(true);
  }

  // Exit progress: how many exit robots have already left the board
  const exitIds = state.exitIds ?? new Set(['target']);
  const totalExits = exitIds.size;
  const exitedCount = [...exitIds].filter(id => !state.positions[id]).length;
  const showExitProgress = totalExits > 1;

  return (
    <div className="hud">
      <span className="hud__moves">
        Moves: <strong>{state.moveCount}</strong>
        {currentPuzzle?.minMoves > 0 && (
          <span className="hud__optimum"> (opt: {currentPuzzle.minMoves})</span>
        )}
        {showExitProgress && (
          <span className="hud__exits"> · {exitedCount}/{totalExits} exits done</span>
        )}
      </span>

      <div className="hud__actions">
        <button
          className="hud__btn"
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={state.history.length === 0}
        >Undo</button>
        <button
          className="hud__btn"
          onClick={() => dispatch({ type: 'LOAD_PUZZLE', puzzle: currentPuzzle })}
        >Restart</button>
        {canSolve && (
          <button
            className="hud__btn"
            onClick={handleSolutionClick}
          >{showSol ? 'Hide' : 'Solution'}</button>
        )}
        {canSolve && (
          <button
            className={`hud__btn${showPaths ? ' hud__btn--active-paths' : ''}`}
            onClick={onTogglePaths}
          >Paths</button>
        )}
        {onToggleBlockMode && (
          <button
            className={`hud__btn${blockMode ? ' hud__btn--active' : ''}`}
            onClick={onToggleBlockMode}
          >Block</button>
        )}
        {onToggleBlockMode && hasUserBlocks && (
          <button
            className="hud__btn hud__btn--clear"
            onClick={onClearBlocks}
          >Clear ({blockedCells.size})</button>
        )}
      </div>

      {showSol && solution.length > 0 && (
        <div className="hud__solution">
          {solution.map((m, i) => (
            <span key={i} className="hud__sol-step">
              <span className="hud__sol-mover">{robotLabel(m.mover)}</span>
              <span className="hud__sol-dir">{DIR_ARROW[m.dir]}</span>
              <span className="hud__sol-blocker">/{robotLabel(m.blocker)}</span>
            </span>
          ))}
        </div>
      )}

      {showSol && computedSol !== null && computedSol.length === 0 && (
        <div className="hud__no-sol">No solution found</div>
      )}
    </div>
  );
}
