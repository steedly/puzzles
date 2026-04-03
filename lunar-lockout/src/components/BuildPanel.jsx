// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { collisionSignature, findMatchingPuzzles } from '../logic/collisionSignature';

const VARIANTS = ['standard', 'solitaire', 'ufo', 'french'];

export default function BuildPanel({
  variant, onVariantChange, buildState, buildDispatch, onSolve, onBackToLibrary,
  allPuzzles, buildPreview, onPreview, onPreviewBack,
}) {
  const { pieces, placingType, phase, errorMsg, solvedPuzzle } = buildState;
  const exitCount = pieces.filter(p => p.isExit).length;
  const helperCount = pieces.filter(p => !p.isExit).length;
  const canSolve = exitCount > 0 && helperCount > 0 && phase === 'placing';

  // Compute collision signature of the solved puzzle and find library matches
  const matches = useMemo(() => {
    if (!solvedPuzzle?.solution?.length || !allPuzzles?.length) return [];
    const sig = collisionSignature(solvedPuzzle.solution);
    return findMatchingPuzzles(sig, allPuzzles);
  }, [solvedPuzzle, allPuzzles]);

  return (
    <div className="pnav build-panel">
      <div className="pnav__header">
        <span className="pnav__title">Build Puzzle</span>
      </div>

      {/* Preview banner */}
      {buildPreview && (
        <div className="build-panel__preview-banner">
          <span>Viewing <strong>{buildPreview.stableId}</strong></span>
          <button className="pnav__nav-btn" onClick={onPreviewBack}>
            Back to Build
          </button>
        </div>
      )}

      {/* Variant selector */}
      {!buildPreview && (
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
      )}

      {/* Piece type selector */}
      {phase === 'placing' && !buildPreview && (
        <div className="pnav__filter-row">
          <span className="pnav__label">Place</span>
          <button
            className={`pnav__chip${placingType === 'exit' ? ' pnav__chip--on' : ''}`}
            onClick={() => buildDispatch({ type: 'SET_PLACING_TYPE', placingType: 'exit' })}
          >
            Exit ({exitCount}/4)
          </button>
          <button
            className={`pnav__chip${placingType === 'helper' ? ' pnav__chip--on' : ''}`}
            onClick={() => buildDispatch({ type: 'SET_PLACING_TYPE', placingType: 'helper' })}
          >
            Helper ({helperCount}/9)
          </button>
        </div>
      )}

      {/* Instructions */}
      {phase === 'placing' && !buildPreview && (
        <div className="build-panel__instructions">
          {placingType === 'exit'
            ? exitCount < 4
              ? 'Click a cell to place an exit piece. Click a piece to remove it.'
              : 'Max 4 exits placed. Switch to Helper or click a piece to remove it.'
            : helperCount < 9
              ? 'Click a cell to place a helper. Click a piece to remove it.'
              : 'Max 9 helpers placed. Click a piece to remove it.'}
        </div>
      )}

      {/* Piece status */}
      {!buildPreview && (
        <div className="build-panel__status-row">
          <span className="pnav__label">Exits:</span>
          <span className={exitCount > 0 ? 'build-panel__placed' : 'build-panel__empty'}>
            {exitCount || '--'}
          </span>
          <span className="pnav__label" style={{ marginLeft: 12 }}>Helpers:</span>
          <span className={helperCount > 0 ? 'build-panel__placed' : 'build-panel__empty'}>
            {helperCount || '--'}
          </span>
        </div>
      )}

      {/* Action buttons */}
      {!buildPreview && (
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
      )}

      {/* Result / error */}
      {phase === 'solved' && solvedPuzzle && !buildPreview && (
        <div className="build-panel__result">
          Optimal: {solvedPuzzle.minMoves} move{solvedPuzzle.minMoves !== 1 ? 's' : ''} ({solvedPuzzle.rawSlides} slide{solvedPuzzle.rawSlides !== 1 ? 's' : ''})
        </div>
      )}
      {errorMsg && !buildPreview && (
        <div className="build-panel__error">{errorMsg}</div>
      )}

      {/* Library matches */}
      {phase === 'solved' && matches.length > 0 && (
        <div className="build-panel__matches">
          <span className="pnav__label">Library matches ({matches.length})</span>
          <div className="build-panel__match-list">
            {matches.map(p => (
              <button
                key={p.stableId}
                className={`build-panel__match-id${buildPreview?.stableId === p.stableId ? ' build-panel__match-id--active' : ''}`}
                onClick={() => onPreview(p)}
                title={`${p.exits ?? 1}E ${p.helpers}H ${p.minMoves}M`}
              >
                {p.stableId}
              </button>
            ))}
          </div>
        </div>
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
