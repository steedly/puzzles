import { useState } from 'react';

const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function robotLabel(id) {
  // target → 'A' (exit 0), exit1 → 'B', exit2 → 'C', …
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

export default function HUD({ state, dispatch, currentPuzzle }) {
  const [showSol, setShowSol] = useState(false);

  const solution = currentPuzzle?.solution ?? [];

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
        {solution.length > 0 && (
          <button
            className="hud__btn"
            onClick={() => setShowSol(s => !s)}
          >{showSol ? 'Hide' : 'Solution'}</button>
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
    </div>
  );
}
