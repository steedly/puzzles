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

export default function HUD({ state, dispatch, currentPuzzle, blockedCells, userBlockedCells, blockMode, onToggleBlockMode, onClearBlocks, showPaths, onTogglePaths, scoreMode, onScoreModeChange, hideOptimal, onHideOptimalChange }) {
  const [showSol, setShowSol] = useState(false);
  // null = not computed, [] = computed but empty/failed, [...] = computed solution
  const [computedSol, setComputedSol] = useState(null);

  // Reset when puzzle or blocked cells change
  const puzzleId = currentPuzzle?.stableId;
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
      <div className="hud__top-row">
        <span className="hud__moves">
          {scoreMode === 'slides' ? 'Slides' : 'Moves'}:{' '}
          <strong>{scoreMode === 'slides' ? state.slideCount : state.moveCount}</strong>
          {!hideOptimal && (() => {
            const target = scoreMode === 'slides' ? currentPuzzle?.minRawSlides : currentPuzzle?.minMoves;
            const label = scoreMode === 'slides' ? 'Minimum Slides' : 'Minimum Moves';
            return target > 0 ? <span className="hud__optimum"> ({label}: {target})</span> : null;
          })()}
          {showExitProgress && (
            <span className="hud__exits"> · {exitedCount}/{totalExits} exits done</span>
          )}
        </span>

        <div className="hud__game-btns">
          <button
            className="hud__btn"
            onClick={() => dispatch({ type: 'UNDO' })}
            disabled={state.history.length === 0}
          >Undo</button>
          <button
            className="hud__btn"
            onClick={() => dispatch({ type: 'LOAD_PUZZLE', puzzle: currentPuzzle })}
          >Restart</button>
        </div>
      </div>

      <div className="hud__tools">
        {canSolve && (
          <button
            className={`hud__tool-btn${showSol ? ' hud__tool-btn--active' : ''}`}
            onClick={handleSolutionClick}
          >{showSol ? 'Hide Solution' : 'Solution'}</button>
        )}
        {canSolve && (
          <button
            className={`hud__tool-btn${showPaths ? ' hud__tool-btn--active' : ''}`}
            onClick={onTogglePaths}
          >Paths</button>
        )}
        {onToggleBlockMode && (
          <button
            className={`hud__tool-btn${blockMode ? ' hud__tool-btn--block-active' : ''}`}
            onClick={onToggleBlockMode}
          >Block</button>
        )}
        {onToggleBlockMode && hasUserBlocks && (
          <button
            className="hud__tool-btn hud__tool-btn--clear"
            onClick={onClearBlocks}
          >Clear ({blockedCells.size})</button>
        )}
        <button
          className={`hud__tool-btn${scoreMode === 'slides' ? ' hud__tool-btn--active' : ''}`}
          onClick={() => onScoreModeChange(scoreMode === 'grouped' ? 'slides' : 'grouped')}
          title={scoreMode === 'grouped' ? 'Scoring: grouped moves' : 'Scoring: individual slides'}
        >{scoreMode === 'grouped' ? 'Moves' : 'Slides'}</button>
        <button
          className={`hud__tool-btn${hideOptimal ? ' hud__tool-btn--active' : ''}`}
          onClick={() => onHideOptimalChange(!hideOptimal)}
          title={hideOptimal ? 'Minimum hidden' : 'Minimum shown'}
        >{hideOptimal ? 'Min: Hidden' : 'Min: Shown'}</button>
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
