// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function robotLabel(id) {
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

export default function HUD({
  state, dispatch, currentPuzzle, scoreMode, hideOptimal, onEditInBuild,
  // Build-mode solution stepping (only set when in build-solved view)
  stepMode, board, variantBlocks,
}) {
  const solution = currentPuzzle?.solution ?? [];
  const totalSlides = solution.length;

  const exitIds = state.exitIds ?? new Set(['target']);
  const totalExits = exitIds.size;
  const exitedCount = [...exitIds].filter(id => !state.positions[id]).length;
  const showExitProgress = totalExits > 1;

  const stepNext = () => {
    if (state.slideCount >= totalSlides) return;
    const move = solution[state.slideCount];
    dispatch({ type: 'SELECT_ROBOT', robotId: move.mover });
    dispatch({ type: 'SLIDE', direction: move.dir, blockedCells: variantBlocks, board });
  };

  return (
    <div className="hud">
      <div className="hud__top-row">
        {stepMode ? (
          <span className="hud__moves">
            Step: <strong>{state.slideCount}</strong> / {totalSlides}
            {showExitProgress && (
              <span className="hud__exits"> · {exitedCount}/{totalExits} exits</span>
            )}
          </span>
        ) : (
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
        )}

        <div className="hud__game-btns">
          <button
            className="hud__btn"
            onClick={() => dispatch({ type: 'LOAD_PUZZLE', puzzle: currentPuzzle })}
            title="Reset all robots to starting positions"
          >Restart</button>
          {stepMode ? (
            <>
              <button
                className="hud__btn"
                onClick={() => dispatch({ type: 'UNDO' })}
                disabled={state.slideCount === 0}
                title="Previous step"
              >◀</button>
              <button
                className="hud__btn"
                onClick={stepNext}
                disabled={state.slideCount >= totalSlides}
                title="Next step"
              >▶</button>
            </>
          ) : (
            <button
              className="hud__btn"
              onClick={() => dispatch({ type: 'UNDO' })}
              disabled={state.history.length === 0}
              title="Undo the last slide"
            >Undo</button>
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

      {stepMode && solution.length > 0 && (
        <div className="hud__solution">
          {(() => {
            // Group consecutive slides by mover (1 grouped move = 1 group)
            const groups = [];
            for (let i = 0; i < solution.length; i++) {
              const m = solution[i];
              const last = groups[groups.length - 1];
              if (last && last.mover === m.mover) {
                last.slides.push({ ...m, slideIdx: i });
              } else {
                groups.push({ mover: m.mover, slides: [{ ...m, slideIdx: i }] });
              }
            }
            return groups.map((g, gi) => (
              <span key={gi} className="hud__sol-step">
                <span className="hud__sol-num">{gi + 1}.</span>
                <span className="hud__sol-mover">{robotLabel(g.mover)}</span>
                {g.slides.map((s) => (
                  <span
                    key={s.slideIdx}
                    className={`hud__sol-dir${s.slideIdx === state.slideCount ? ' hud__sol-dir--current' : ''}${s.slideIdx < state.slideCount ? ' hud__sol-dir--done' : ''}`}
                  >{DIR_ARROW[s.dir] ?? s.dir}</span>
                ))}
              </span>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
