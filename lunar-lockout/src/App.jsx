// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePuzzleLibrary } from './hooks/usePuzzleLibrary';
import { useGameState } from './hooks/useGameState';
import Board from './components/Board';
import HUD from './components/HUD';
import PuzzleNav from './components/PuzzleNav';
import WinModal from './components/WinModal';

// Placeholder so useGameState never receives null.
const DUMMY_PUZZLE = {
  id: 0,
  exits: 1,
  helpers: 0,
  minMoves: 0,
  solution: [],
  robots: [{ id: 'target', row: 3, col: 3, isExit: true }],
};

// Fixed blocked cells for each board variant
const VARIANT_BLOCKS = {
  standard: new Set(),
  solitaire: new Set(
    [0,1,5,6].flatMap(r => [0,1,5,6].map(c => `${r},${c}`))
  ),
  ufo: new Set(
    Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => ({ r, c }))
    ).flat().filter(({ r, c }) => r === 0 || r === 6 || c === 0 || c === 6)
     .map(({ r, c }) => `${r},${c}`)
  ),
  french: new Set(
    [[0,0],[0,1],[1,0],[0,5],[0,6],[1,6],
     [5,0],[6,0],[6,1],[5,6],[6,5],[6,6]]
      .map(([r, c]) => `${r},${c}`)
  ),
};

export default function App() {
  const { allPuzzles, loading, error, needsFilePicker, loadFile, variant, switchVariant, pendingStableIdRef } = usePuzzleLibrary();
  const [currentPuzzle, setCurrentPuzzle] = useState(null);
  const filteredRef = useRef([]);

  const [showSolution, setShowSolution] = useState(false);
  const [scoreMode, setScoreMode] = useState('grouped'); // 'grouped' | 'slides'
  const [hideOptimal, setHideOptimal] = useState(true);

  const variantBlocks = VARIANT_BLOCKS[variant] || VARIANT_BLOCKS.standard;

  const { state, dispatch } = useGameState(currentPuzzle ?? DUMMY_PUZZLE, variantBlocks);

  // Reset solution display when puzzle changes
  useEffect(() => { setShowSolution(false); }, [currentPuzzle?.stableId]);

  // When puzzle list changes (variant switch or initial load), try to preserve
  // the current puzzle by stableId; otherwise reset to null for auto-select.
  useEffect(() => {
    const pending = pendingStableIdRef.current;
    if (pending) {
      pendingStableIdRef.current = null;
      const match = allPuzzles.find(p => p.stableId === pending);
      if (match) {
        setCurrentPuzzle(match);
        dispatch({ type: 'LOAD_PUZZLE', puzzle: match });
        return;
      }
    }
    setCurrentPuzzle(null);
  }, [allPuzzles, pendingStableIdRef, dispatch]);

  // Called by PuzzleNav whenever the filtered list changes.
  const handleFilteredChange = useCallback(list => {
    filteredRef.current = list;
    // Auto-select the first puzzle when nothing is loaded yet.
    if (!currentPuzzle && list.length > 0) {
      const first = list[0];
      setCurrentPuzzle(first);
      dispatch({ type: 'LOAD_PUZZLE', puzzle: first });
    }
  }, [currentPuzzle, dispatch]);

  function handleSelectPuzzle(puzzle) {
    setCurrentPuzzle(puzzle);
    dispatch({ type: 'LOAD_PUZZLE', puzzle });
  }

  function handleReplay() {
    if (currentPuzzle) dispatch({ type: 'LOAD_PUZZLE', puzzle: currentPuzzle });
  }

  function handleNext() {
    const fp  = filteredRef.current;
    const idx = fp.findIndex(p => p.stableId === currentPuzzle?.stableId);
    if (idx >= 0 && idx < fp.length - 1) handleSelectPuzzle(fp[idx + 1]);
  }

  const hasNext = (() => {
    const fp  = filteredRef.current;
    const idx = fp.findIndex(p => p.stableId === currentPuzzle?.stableId);
    return idx >= 0 && idx < fp.length - 1;
  })();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Lunar Lockout</h1>
        {currentPuzzle && (
          <div className="app__puzzle-info">
            <span className="pinfo-badge">{currentPuzzle.stableId}</span>
            <span className="pinfo-badge">{currentPuzzle.exits ?? 1}E {currentPuzzle.helpers}H</span>
            <span className="pinfo-badge" title="Minimum grouped moves">{currentPuzzle.minMoves}M</span>
            {currentPuzzle.rawSlides != null && (
              <span className="pinfo-badge" title="Raw slides in solution">{currentPuzzle.rawSlides}S</span>
            )}
            {currentPuzzle.minRawSlides != null && (
              <span className="pinfo-badge" title="Min possible raw slides">{currentPuzzle.minRawSlides}mS</span>
            )}
            {currentPuzzle.forwardStates != null && (
              <span className="pinfo-badge" title="Reachable states">{currentPuzzle.forwardStates}R</span>
            )}
          </div>
        )}
      </header>

      <main className="app__main">
        {/* ── File picker (file:// fallback) ── */}
        {needsFilePicker && (
          <div className="filepick">
            <p className="filepick__msg">
              Open this page from a web server, or load the puzzle library manually:
            </p>
            <label className="filepick__label">
              <span className="filepick__btn">Choose puzzles.llp</span>
              <input
                type="file"
                accept=".llp"
                className="filepick__input"
                onChange={e => loadFile(e.target.files[0])}
              />
            </label>
            <p className="filepick__hint">
              Run <code>./enumerate &gt; puzzles.llp</code> in <code>ll-solver/</code> to generate it.
            </p>
          </div>
        )}

        {loading && !needsFilePicker && (
          <div className="app__loading">Loading puzzle library…</div>
        )}
        {error && (
          <div className="app__loading app__loading--error">Error: {error}</div>
        )}

        <div className="game-layout">
          {/* ── Left: board + controls ── */}
          <div className="game-column">
            {currentPuzzle && (
              <div className="game-area">
                <Board
                  state={state} dispatch={dispatch} puzzle={currentPuzzle}
                  showPaths={showSolution}
                  variantBlocks={variantBlocks}
                />
                <HUD
                  state={state}
                  dispatch={dispatch}
                  currentPuzzle={currentPuzzle}
                  showSolution={showSolution}
                  onToggleSolution={() => setShowSolution(s => !s)}
                  scoreMode={scoreMode}
                  onScoreModeChange={setScoreMode}
                  hideOptimal={hideOptimal}
                  onHideOptimalChange={setHideOptimal}
                />
              </div>
            )}
            <p className="instructions">
              Click a robot to select it, then click a cell or use arrow keys to slide it.
              Get all <span className="instructions__target">exit robots</span> (A, B, C…) to the glowing center cell.
            </p>
          </div>

          {/* ── Right: navigation panel ── */}
          <PuzzleNav
            allPuzzles={allPuzzles}
            currentPuzzle={currentPuzzle}
            onSelect={handleSelectPuzzle}
            onFilteredChange={handleFilteredChange}
            blockedCells={new Set()}
            variant={variant}
            onVariantChange={(v) => switchVariant(v, currentPuzzle?.stableId)}
            scoreMode={scoreMode}
            hideOptimal={hideOptimal}
          />
        </div>
      </main>

      {state.isWon && (
        <WinModal
          moveCount={state.moveCount}
          slideCount={state.slideCount}
          minMoves={currentPuzzle?.minMoves}
          minRawSlides={currentPuzzle?.minRawSlides}
          scoreMode={scoreMode}
          hideOptimal={hideOptimal}
          hasNext={hasNext}
          onNext={handleNext}
          onReplay={handleReplay}
        />
      )}
    </div>
  );
}
