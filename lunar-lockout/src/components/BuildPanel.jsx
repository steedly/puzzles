// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const VARIANTS = ['standard', 'solitaire', 'ufo', 'french'];

export default function BuildPanel({ variant, onVariantChange, buildState, buildDispatch, onSolve, onBackToLibrary }) {
  const { pieces, phase, errorMsg, solvedPuzzle } = buildState;
  const hasExit = pieces.some(p => p.isExit);
  const helperCount = pieces.filter(p => !p.isExit).length;
  const canSolve = hasExit && helperCount > 0 && phase === 'placing';

  return (
    <div className="pnav build-panel">
      <div className="pnav__header">
        <span className="pnav__title">Build Puzzle</span>
      </div>

      {/* Variant selector */}
      <div className="pnav__filter-row">
        <span className="pnav__label">Board</span>
        <select
          className="pnav__sort-select"
          value={variant}
          onChange={e => onVariantChange(e.target.value)}
        >
          {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* Instructions */}
      {phase === 'placing' && (
        <div className="build-panel__instructions">
          {!hasExit
            ? 'Click a cell to place the exit piece (A).'
            : helperCount < 5
              ? `Click cells to add helpers (${helperCount}/5). Click a piece to remove it.`
              : 'Max 5 helpers placed. Click a piece to remove it.'}
        </div>
      )}

      {/* Piece status */}
      <div className="build-panel__status-row">
        <span className="pnav__label">Exit:</span>
        <span className={hasExit ? 'build-panel__placed' : 'build-panel__empty'}>
          {hasExit ? 'A' : '--'}
        </span>
        <span className="pnav__label" style={{ marginLeft: 12 }}>Helpers:</span>
        <span className="build-panel__placed">{helperCount}</span>
      </div>

      {/* Action buttons */}
      <div className="build-panel__actions">
        {phase === 'placing' && (
          <>
            <button
              className="pnav__nav-btn build-panel__solve-btn"
              disabled={!canSolve}
              onClick={onSolve}
            >
              Solve
            </button>
            <button
              className="pnav__nav-btn"
              disabled={pieces.length === 0}
              onClick={() => buildDispatch({ type: 'CLEAR' })}
            >
              Clear
            </button>
          </>
        )}
        {phase === 'solved' && (
          <button
            className="pnav__nav-btn"
            onClick={() => buildDispatch({ type: 'EDIT' })}
          >
            Edit
          </button>
        )}
      </div>

      {/* Result / error */}
      {phase === 'solved' && solvedPuzzle && (
        <div className="build-panel__result">
          Optimal solution: {solvedPuzzle.minMoves} move{solvedPuzzle.minMoves !== 1 ? 's' : ''} ({solvedPuzzle.rawSlides} slide{solvedPuzzle.rawSlides !== 1 ? 's' : ''})
        </div>
      )}
      {phase === 'error' && errorMsg && (
        <div className="build-panel__error">{errorMsg}</div>
      )}

      <button
        className="pnav__nav-btn"
        onClick={onBackToLibrary}
        style={{ marginTop: 'auto' }}
      >
        Back to Library
      </button>
    </div>
  );
}
