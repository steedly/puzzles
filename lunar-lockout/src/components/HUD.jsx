const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function robotLabel(id) {
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

export default function HUD({ state, dispatch, currentPuzzle, showSolution, onToggleSolution, scoreMode, onScoreModeChange, hideOptimal, onHideOptimalChange }) {
  const solution = currentPuzzle?.solution ?? [];
  const canSolve = currentPuzzle?.minMoves > 0;

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
            className={`hud__tool-btn${showSolution ? ' hud__tool-btn--active' : ''}`}
            onClick={onToggleSolution}
          >{showSolution ? 'Hide Solution' : 'Show Solution'}</button>
        )}
        <button
          className={`hud__tool-btn${scoreMode === 'slides' ? ' hud__tool-btn--active' : ''}`}
          onClick={() => onScoreModeChange(scoreMode === 'grouped' ? 'slides' : 'grouped')}
          title={scoreMode === 'grouped' ? 'Scoring: grouped moves' : 'Scoring: individual slides'}
        >{scoreMode === 'grouped' ? 'Scoring: Moves' : 'Scoring: Slides'}</button>
        <button
          className={`hud__tool-btn${hideOptimal ? ' hud__tool-btn--active' : ''}`}
          onClick={() => onHideOptimalChange(!hideOptimal)}
          title={hideOptimal ? 'Minimum hidden' : 'Minimum shown'}
        >{hideOptimal ? 'Min: Hidden' : 'Min: Shown'}</button>
      </div>

      {showSolution && solution.length > 0 && (
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
    </div>
  );
}
