// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function robotLabel(id) {
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

export default function HUD({ state, dispatch, currentPuzzle, showSolution, onToggleSolution, scoreMode, hideOptimal, onEditInBuild }) {
  const solution = currentPuzzle?.solution ?? [];
  const canSolve = currentPuzzle?.minMoves > 0;

  const exitIds = state.exitIds ?? new Set(['target']);
  const totalExits = exitIds.size;
  const exitedCount = [...exitIds].filter(id => !state.positions[id]).length;
  const showExitProgress = totalExits > 1;

  return (
    <div className="hud">
      <div className="hud__top-row">
        <span className="hud__moves" title={scoreMode === 'slides'
          ? 'Individual robot slides — each slide in any direction counts as 1'
          : 'Grouped moves — consecutive slides by the same robot count as 1 move'}>
          {scoreMode === 'slides' ? 'Slides' : 'Moves'}:{' '}
          <strong>{scoreMode === 'slides' ? state.slideCount : state.moveCount}</strong>
          {!hideOptimal && (() => {
            const target = scoreMode === 'slides' ? currentPuzzle?.minRawSlides : currentPuzzle?.minMoves;
            const label = scoreMode === 'slides' ? 'Minimum Slides' : 'Minimum Moves';
            return target > 0 ? <span className="hud__optimum"> ({label}: {target})</span> : null;
          })()}
          {showExitProgress && (
            <span className="hud__exits"> · {exitedCount}/{totalExits} exits</span>
          )}
        </span>

        <div className="hud__game-btns">
          <button
            className="hud__btn"
            onClick={() => dispatch({ type: 'UNDO' })}
            disabled={state.history.length === 0}
            title="Undo the last slide"
          >Undo</button>
          <button
            className="hud__btn"
            onClick={() => dispatch({ type: 'LOAD_PUZZLE', puzzle: currentPuzzle })}
            title="Reset all robots to starting positions"
          >Restart</button>
          {canSolve && (
            <button
              className={`hud__btn${showSolution ? ' hud__btn--active' : ''}`}
              onClick={onToggleSolution}
              title="Show/hide the optimal solution path on the board"
            >{showSolution ? 'Hide Solution' : 'Show Solution'}</button>
          )}
          {onEditInBuild && (
            <button
              className="hud__btn"
              onClick={onEditInBuild}
              title="Edit this puzzle in Build mode"
            >✎</button>
          )}
        </div>
      </div>

      {showSolution && solution.length > 0 && (
        <div className="hud__solution">
          {scoreMode === 'slides'
            ? solution.map((m, i) => (
                <span key={i} className="hud__sol-step">
                  <span className="hud__sol-mover">{robotLabel(m.mover)}</span>
                  <span className="hud__sol-dir">{DIR_ARROW[m.dir] ?? m.dir}</span>
                  <span className="hud__sol-blocker">/{robotLabel(m.blocker)}</span>
                </span>
              ))
            : (() => {
                const groups = [];
                for (const m of solution) {
                  const last = groups[groups.length - 1];
                  if (last && last.mover === m.mover) {
                    last.slides.push(m);
                  } else {
                    groups.push({ mover: m.mover, slides: [m] });
                  }
                }
                return groups.map((g, gi) => (
                  <span key={gi} className="hud__sol-step">
                    <span className="hud__sol-num">{gi + 1}.</span>
                    <span className="hud__sol-mover">{robotLabel(g.mover)}</span>
                    {g.slides.map((s, si) => (
                      <span key={si} className="hud__sol-dir">{DIR_ARROW[s.dir] ?? s.dir}</span>
                    ))}
                  </span>
                ));
              })()
          }
        </div>
      )}
    </div>
  );
}
