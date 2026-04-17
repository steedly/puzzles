// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

function robotLabel(id) {
  if (id === 'target') return 'A';
  const exitMatch = id.match(/^exit(\d+)$/);
  if (exitMatch) return String.fromCharCode(65 + parseInt(exitMatch[1], 10));
  return id.replace('r', '');
}

// Map a "wrong moves available at this state" count to a difficulty class.
// Forced (0): green. Trivial (1-2): light. Moderate (3-5): yellow. Tricky (6-9): orange. Critical (10+): red.
function trapClass(trapCount) {
  if (trapCount == null) return '';
  if (trapCount === 0)  return 'hud__sol-dir--trap0';
  if (trapCount <= 2)   return 'hud__sol-dir--trap1';
  if (trapCount <= 5)   return 'hud__sol-dir--trap2';
  if (trapCount <= 9)   return 'hud__sol-dir--trap3';
  return 'hud__sol-dir--trap4';
}

export default function HUD({
  state, dispatch, currentPuzzle, scoreMode, hideOptimal, centerUnwinnable, onEditInBuild,
  // Build-mode solution stepping (only set when in build-solved view)
  stepMode, board, variantBlocks, puzzleMetrics,
}) {
  const solution = currentPuzzle?.solution ?? [];
  const totalSlides = solution.length;

  const exitIds = state.exitIds ?? new Set(['target']);
  const totalExits = exitIds.size;
  const exitedCount = [...exitIds].filter(id => !state.positions[id]).length;
  const showExitProgress = totalExits > 1;

  // The state-graph metrics for the current step (only available in stepMode
  // when the worker has finished). solutionPath[i] = metrics AT state i,
  // BEFORE the i-th slide is taken. solutionPath has length totalSlides + 1.
  const pathReady = stepMode && puzzleMetrics?.status === 'ready' && Array.isArray(puzzleMetrics.solutionPath);
  const currentMetrics = pathReady ? puzzleMetrics.solutionPath[state.slideCount] : null;

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
              return target > 0 ? <span className="hud__optimum"> (minimum: {target})</span> : null;
            })()}
            {showExitProgress && (
              <span className="hud__exits"> · {exitedCount}/{totalExits} exits</span>
            )}
          </span>
        )}

        {centerUnwinnable && !state.isWon && (
          <span className="hud__unwinnable">Unwinnable — undo to recover</span>
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

      {stepMode && currentMetrics && (
        <div className="hud__metrics" title="Difficulty metrics for the current state">
          <span className="hud__metric">
            <span className="hud__metric-label">Reachable</span>
            <span className="hud__metric-value">{currentMetrics.reachableCount.toLocaleString()}</span>
          </span>
          <span className="hud__metric">
            <span className="hud__metric-label">Remaining</span>
            <span className="hud__metric-value">{currentMetrics.minSlidesToGoal} sl · {currentMetrics.minMovesToGoal} mv</span>
          </span>
          <span className={`hud__metric hud__metric--trap ${trapClass(currentMetrics.trapCount)}`} title="Number of legal slides from here that DON'T make optimal progress">
            <span className="hud__metric-label">Wrong moves</span>
            <span className="hud__metric-value">{currentMetrics.trapCount}</span>
          </span>
        </div>
      )}
      {stepMode && puzzleMetrics?.status === 'computing' && (
        <div className="hud__metrics hud__metrics--computing">Computing difficulty metrics…</div>
      )}
      {stepMode && puzzleMetrics?.status === 'too_large' && (
        <div className="hud__metrics hud__metrics--unavailable">Puzzle too large for difficulty metrics</div>
      )}

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
                {g.slides.map((s) => {
                  // Color-code by trap count at THIS slide's pre-state.
                  const stepMetric = pathReady ? puzzleMetrics.solutionPath[s.slideIdx] : null;
                  const tcls = stepMetric ? trapClass(stepMetric.trapCount) : '';
                  const stateClass =
                    s.slideIdx === state.slideCount ? ' hud__sol-dir--current' :
                    s.slideIdx <  state.slideCount ? ' hud__sol-dir--done' : '';
                  return (
                    <span
                      key={s.slideIdx}
                      className={`hud__sol-dir ${tcls}${stateClass}`}
                      title={stepMetric ? `${stepMetric.trapCount} wrong moves available here` : undefined}
                    >{DIR_ARROW[s.dir] ?? s.dir}</span>
                  );
                })}
              </span>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
