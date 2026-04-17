// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo, useState } from 'react';
import { collisionSignature, findMatchingPuzzles, findD4PositionMatches } from '../logic/collisionSignature';
import { decodeStableId } from '../hooks/usePuzzleLibrary';

const MOVE_TYPES = [
  { key: 'square', label: 'Square' },
  { key: 'hex',    label: 'Hex' },
];
const BOARD_SHAPES = {
  square: [
    { key: 'standard',  label: 'Standard' },
    { key: 'french',    label: 'French' },
    { key: 'solitaire', label: 'Solitaire' },
    { key: 'ufo',       label: 'UFO' },
  ],
  hex: [
    { key: 'beehive', label: 'Standard' },
    { key: 'hex',     label: '5x5' },
  ],
};
function moveTypeOf(variant) {
  return (variant === 'hex' || variant === 'beehive') ? 'hex' : 'square';
}
const DEFAULT_SHAPE = { square: 'standard', hex: 'beehive' };

export default function BuildPanel({
  variant, onVariantChange, buildState, buildDispatch, onSolve, onBackToLibrary,
  allPuzzles, buildPreview, onPreview, onPreviewBack,
}) {
  const { pieces, placingType, phase, errorMsg, solvedPuzzle } = buildState;
  const exitCount = pieces.filter(p => p.isExit).length;
  const helperCount = pieces.filter(p => !p.isExit).length;
  const canSolve = exitCount > 0 && helperCount > 0 && phase === 'placing';

  // Stable-ID loader: lets the user paste an ID and load its piece positions.
  const [loadIdInput, setLoadIdInput] = useState('');
  const [loadIdError, setLoadIdError] = useState(null);
  const handleLoadId = (e) => {
    e.preventDefault();
    const trimmed = loadIdInput.trim();
    if (!trimmed) return;
    const decoded = decodeStableId(trimmed);
    if (!decoded || decoded.positions.length === 0) {
      setLoadIdError('Invalid stable ID');
      return;
    }
    if (decoded.positions.length < decoded.numExits) {
      setLoadIdError('Decoded ID has fewer pieces than declared exits');
      return;
    }
    // Validate against the current board: cells must be in range and unblocked.
    const N = 7;
    for (const [r, c] of decoded.positions) {
      if (r < 0 || r >= N || c < 0 || c >= N) {
        setLoadIdError('Decoded position outside the board');
        return;
      }
    }
    buildDispatch({ type: 'LOAD_POSITIONS', numExits: decoded.numExits, positions: decoded.positions });
    setLoadIdInput('');
    setLoadIdError(null);
  };

  // The board is showing the built puzzle (not a library preview)
  const showingBuild = phase === 'solved' && !buildPreview;

  // Find library matches via collision signature + D4 position matching
  const matches = useMemo(() => {
    if (!solvedPuzzle?.solution?.length || !allPuzzles?.length) return [];
    const sigMatches = findMatchingPuzzles(collisionSignature(solvedPuzzle.solution), allPuzzles);
    const posMatches = findD4PositionMatches(solvedPuzzle.solution, solvedPuzzle.robots, allPuzzles);
    // Merge and dedup by stableId
    const seen = new Set();
    const merged = [];
    for (const p of [...sigMatches, ...posMatches]) {
      if (!seen.has(p.stableId)) { seen.add(p.stableId); merged.push(p); }
    }
    return merged;
  }, [solvedPuzzle, allPuzzles]);

  return (
    <div className="pnav build-panel">
      <div className="pnav__header">
        <span className="pnav__title">Build Puzzle</span>
      </div>

      {/* Variant selector: movement type + board shape */}
      <div className="pnav__filter-row">
        <span className="pnav__label">Board</span>
        <select
          className="pnav__sort-select"
          value={moveTypeOf(variant)}
          onChange={e => onVariantChange(DEFAULT_SHAPE[e.target.value])}
        >
          {MOVE_TYPES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <select
          className="pnav__sort-select"
          value={variant}
          onChange={e => onVariantChange(e.target.value)}
        >
          {BOARD_SHAPES[moveTypeOf(variant)].map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
      </div>

      {/* Load by stable ID */}
      {phase === 'placing' && (
        <form className="build-panel__loadid-row" onSubmit={handleLoadId}>
          <span className="pnav__label">Load ID</span>
          <input
            className="build-panel__loadid-input"
            type="text"
            placeholder="e.g. 1-16o"
            value={loadIdInput}
            onChange={e => { setLoadIdInput(e.target.value); setLoadIdError(null); }}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="pnav__nav-btn" disabled={!loadIdInput.trim()}>Load</button>
          {loadIdError && <span className="build-panel__loadid-error">{loadIdError}</span>}
        </form>
      )}

      {/* Piece type selector */}
      {phase === 'placing' && (
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
      {phase === 'placing' && (
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
          Optimal: {solvedPuzzle.minMoves} move{solvedPuzzle.minMoves !== 1 ? 's' : ''} ({solvedPuzzle.rawSlides} slide{solvedPuzzle.rawSlides !== 1 ? 's' : ''})
        </div>
      )}
      {errorMsg && (
        <div className="build-panel__error">{errorMsg}</div>
      )}

      {/* Built puzzle + library matches list */}
      {phase === 'solved' && solvedPuzzle && (
        <div className="build-panel__matches">
          {/* Built puzzle entry */}
          <button
            className={`build-panel__match-id build-panel__match-id--built${showingBuild ? ' build-panel__match-id--active' : ''}`}
            onClick={onPreviewBack}
            title={`Your puzzle: ${solvedPuzzle.exits}E ${solvedPuzzle.helpers}H ${solvedPuzzle.minMoves}M`}
          >
            {solvedPuzzle.stableId} (built)
          </button>

          {/* Separator + library matches */}
          {matches.length > 0 && (
            <>
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
            </>
          )}
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
