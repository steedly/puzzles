// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePuzzleLibrary, decodeStableId, computeStableId } from './hooks/usePuzzleLibrary';
import { useGameState } from './hooks/useGameState';
import { usePermalink } from './hooks/usePermalink';
import Board from './components/Board';
import HUD from './components/HUD';
import PuzzleNav from './components/PuzzleNav';
import BuildPanel from './components/BuildPanel';
import WinModal from './components/WinModal';
import { useBuildMode } from './hooks/useBuildMode';
import { boardForVariant } from './logic/boardGeometry';

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
  hex: new Set(),
  beehive: new Set(),
};

export default function App() {
  // Parse URL hash before any hooks that depend on variant
  const { initialState, updateHash, externalState, externalChange } = usePermalink();

  const { allPuzzles, loading, error, needsFilePicker, loadFile, variant, switchVariant, stableIdMap, pendingStableIdRef, findByPositions } = usePuzzleLibrary(initialState.variant || 'standard');
  const [currentPuzzle, setCurrentPuzzle] = useState(null);
  const filteredRef = useRef([]);

  const [mode, setMode] = useState('library'); // 'library' | 'build'
  const { buildState, buildDispatch, solve: buildSolve } = useBuildMode();
  const pendingBuildSolveRef = useRef(false);
  const [buildPreview, setBuildPreview] = useState(null); // library puzzle being previewed from build mode

  const [showSolution, setShowSolution] = useState(false);
  const [scoreMode, setScoreMode] = useState('grouped'); // 'grouped' | 'slides'
  const [hideOptimal, setHideOptimal] = useState(true);

  // Filter state (lifted from PuzzleNav for permalink sync)
  const [filterState, setFilterState] = useState(null); // null = use defaults

  // Buffer URL-provided stableId and filters until puzzles load
  const pendingUrlRef = useRef({
    stableId: initialState.stableId || null,
    filters: Object.keys(initialState.filters).length > 0 ? initialState.filters : null,
  });

  const variantBlocks = VARIANT_BLOCKS[variant] || VARIANT_BLOCKS.standard;
  const board = boardForVariant(variant);

  const { state, dispatch } = useGameState(currentPuzzle ?? DUMMY_PUZZLE, variantBlocks);

  // NOTE: showSolution is intentionally preserved across puzzle changes
  // so users can cycle through puzzles comparing solutions.

  // Resolve a stableId to a puzzle (exact match or position-based fallback)
  const resolvePuzzle = useCallback((stableId) => {
    if (!stableId) return null;
    // Try exact match first
    const exact = stableIdMap.get(stableId);
    if (exact) return exact;
    // Decode positions and search
    const decoded = decodeStableId(stableId);
    if (decoded) return findByPositions(decoded.numExits, decoded.positions, decoded.boardN);
    return null;
  }, [stableIdMap, findByPositions]);

  // When puzzle list changes (variant switch or initial load), apply buffered URL state
  // or try to preserve current puzzle by stableId.
  useEffect(() => {
    if (allPuzzles.length === 0) return;

    // Check for URL-buffered stableId first
    const pending = pendingUrlRef.current;
    if (pending.stableId) {
      const match = resolvePuzzle(pending.stableId);
      if (match) {
        setCurrentPuzzle(match);
        dispatch({ type: 'LOAD_PUZZLE', puzzle: match });
      } else {
        // Not in library — try to decode and open in build mode
        const decoded = decodeStableId(pending.stableId);
        if (decoded && decoded.positions.length >= 2) {
          setMode('build');
          buildDispatch({ type: 'LOAD_POSITIONS', numExits: decoded.numExits, positions: decoded.positions });
          // Auto-solve will be triggered by a separate effect
          pendingBuildSolveRef.current = true;
        }
      }
      pending.stableId = null;
    } else {
      // Check for variant-switch preservation
      const vsId = pendingStableIdRef.current;
      if (vsId) {
        pendingStableIdRef.current = null;
        const match = allPuzzles.find(p => p.stableId === vsId);
        if (match) {
          setCurrentPuzzle(match);
          dispatch({ type: 'LOAD_PUZZLE', puzzle: match });
          return;
        }
      }
      setCurrentPuzzle(null);
    }

    // Apply URL-buffered filters
    if (pending.filters) {
      const f = pending.filters;
      setFilterState({
        helpers: f.helpers ? new Set(f.helpers) : null,
        exits: f.exits ? new Set(f.exits) : null,
        diffs: f.diffs ? new Set(f.diffs) : null,
        movesMin: f.movesMin ?? null,
        movesMax: f.movesMax ?? null,
        sortBy: f.sortBy ?? 'id',
        sortBy2: f.sortBy2 ?? 'none',
        sortAsc: f.sortAsc ?? true,
      });
      pending.filters = null;
    }
  }, [allPuzzles, resolvePuzzle, pendingStableIdRef, dispatch, buildDispatch]);

  // Handle external hash changes (user pastes URL while app is running)
  useEffect(() => {
    if (externalChange === 0 || !externalState) return;
    if (externalState.variant && externalState.variant !== variant) {
      pendingUrlRef.current = {
        stableId: externalState.stableId || null,
        filters: Object.keys(externalState.filters).length > 0 ? externalState.filters : null,
      };
      switchVariant(externalState.variant);
      return;
    }
    if (externalState.stableId) {
      const match = resolvePuzzle(externalState.stableId);
      if (match) {
        setCurrentPuzzle(match);
        dispatch({ type: 'LOAD_PUZZLE', puzzle: match });
      }
    }
    if (Object.keys(externalState.filters).length > 0) {
      const f = externalState.filters;
      setFilterState({
        helpers: f.helpers ? new Set(f.helpers) : null,
        exits: f.exits ? new Set(f.exits) : null,
        diffs: f.diffs ? new Set(f.diffs) : null,
        movesMin: f.movesMin ?? null,
        movesMax: f.movesMax ?? null,
        sortBy: f.sortBy ?? 'id',
        sortBy2: f.sortBy2 ?? 'none',
        sortAsc: f.sortAsc ?? true,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalChange]);

  // Compute defaults for serialization (needed to know which filters are non-default)
  const filterDefaults = useMemo(() => {
    if (allPuzzles.length === 0) return null;
    const helpers = [...new Set(allPuzzles.map(p => p.helpers))].sort((a, b) => a - b);
    const exits = [...new Set(allPuzzles.map(p => p.exits ?? 1))].sort((a, b) => a - b);
    let min = Infinity, max = -Infinity;
    for (const p of allPuzzles) {
      if (p.minMoves < min) min = p.minMoves;
      if (p.minMoves > max) max = p.minMoves;
    }
    return { availableHelpers: helpers, availableExits: exits, movesRange: { min, max } };
  }, [allPuzzles]);

  // Compute stableId from build pieces so the URL reflects the board during editing
  const buildStableId = useMemo(() => {
    if (mode !== 'build' || buildState.pieces.length < 2) return null;
    const exits = buildState.pieces.filter(p => p.isExit);
    if (exits.length === 0) return null;
    const posStr = buildState.pieces.map(p => `${p.row},${p.col}`).join(' ');
    return computeStableId(exits.length, posStr, board.N);
  }, [mode, buildState.pieces, board.N]);

  // Update URL hash when state changes
  useEffect(() => {
    if (!filterDefaults) return;
    const stableId = currentPuzzle?.stableId || buildStableId || null;
    updateHash({
      variant,
      stableId,
      filters: filterState || {},
      defaults: filterDefaults,
    });
  }, [variant, currentPuzzle?.stableId, buildStableId, filterState, filterDefaults, updateHash]);

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

  const handleFilterChange = useCallback((newFilter) => {
    setFilterState(newFilter);
  }, []);

  // Auto-solve after loading positions from a permalink
  useEffect(() => {
    if (pendingBuildSolveRef.current && mode === 'build' && buildState.pieces.length >= 2 && buildState.phase === 'placing') {
      pendingBuildSolveRef.current = false;
      buildSolve(variantBlocks, board);
    }
  }, [mode, buildState.pieces, buildState.phase, buildSolve, variantBlocks]);

  // When build mode produces a solved puzzle, load it for play
  const buildSolvedPuzzle = buildState.solvedPuzzle;
  useEffect(() => {
    if (mode === 'build' && buildSolvedPuzzle) {
      setCurrentPuzzle(buildSolvedPuzzle);
      dispatch({ type: 'LOAD_PUZZLE', puzzle: buildSolvedPuzzle });
    }
  }, [mode, buildSolvedPuzzle, dispatch]);

  // When previewing a library match from build mode, load it
  useEffect(() => {
    if (buildPreview) {
      setCurrentPuzzle(buildPreview);
      dispatch({ type: 'LOAD_PUZZLE', puzzle: buildPreview });
    } else if (mode === 'build' && buildSolvedPuzzle) {
      // Return from preview — reload the build puzzle
      setCurrentPuzzle(buildSolvedPuzzle);
      dispatch({ type: 'LOAD_PUZZLE', puzzle: buildSolvedPuzzle });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPreview]);

  // The puzzle to show in the header — build-solved or library puzzle
  const isBuildPlacing = mode === 'build' && buildState.phase !== 'solved';
  const activePuzzle = isBuildPlacing ? null : currentPuzzle;

  // Handle build variant change: clear pieces when variant changes
  const handleBuildVariantChange = useCallback((v) => {
    switchVariant(v, currentPuzzle?.stableId);
    buildDispatch({ type: 'CLEAR' });
    setBuildPreview(null);
  }, [switchVariant, currentPuzzle?.stableId, buildDispatch]);

  // Preview a library puzzle from build mode (without losing build state)
  const handleBuildPreview = useCallback((puzzle) => {
    setBuildPreview(puzzle);
  }, []);

  const handleBuildPreviewBack = useCallback(() => {
    setBuildPreview(null);
  }, []);

  // Load a library puzzle into Build mode for editing
  const handleEditInBuild = useCallback(() => {
    if (!currentPuzzle?.robots) return;
    buildDispatch({ type: 'LOAD_ROBOTS', robots: currentPuzzle.robots });
    setBuildPreview(null);
    setMode('build');
  }, [currentPuzzle, buildDispatch]);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Spaceport Solitaire</h1>
        <div className="app__mode-toggle">
          <button
            className={`app__mode-btn${mode === 'library' ? ' app__mode-btn--active' : ''}`}
            onClick={() => setMode('library')}
          >Library</button>
          <button
            className={`app__mode-btn${mode === 'build' ? ' app__mode-btn--active' : ''}`}
            onClick={() => setMode('build')}
          >Build</button>
        </div>
        {activePuzzle && (
          <div className="app__puzzle-info">
            <span className="pinfo-badge">{activePuzzle.stableId}</span>
            <span className="pinfo-badge">{activePuzzle.exits ?? 1}E {activePuzzle.helpers}H</span>
            <span className="pinfo-badge" title="Minimum grouped moves">{activePuzzle.minMoves}M</span>
            {activePuzzle.rawSlides != null && (
              <span className="pinfo-badge" title="Raw slides in solution">{activePuzzle.rawSlides}S</span>
            )}
            {activePuzzle.minRawSlides != null && (
              <span className="pinfo-badge" title="Min possible raw slides">{activePuzzle.minRawSlides}mS</span>
            )}
            {activePuzzle.forwardStates != null && (
              <span className="pinfo-badge" title="Reachable states">{activePuzzle.forwardStates}R</span>
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
            {isBuildPlacing ? (
              /* Build mode: placement board */
              <div className="game-area">
                <Board
                  buildMode
                  buildPieces={buildState.pieces}
                  onBuildClick={(row, col) => buildDispatch({ type: 'CLICK_CELL', row, col, blockedCells: variantBlocks, board })}
                  variantBlocks={variantBlocks}
                  board={board}
                />
              </div>
            ) : currentPuzzle ? (
              /* Play mode (library or solved build puzzle) */
              <div className="game-area">
                <Board
                  state={state} dispatch={dispatch} puzzle={currentPuzzle}
                  showPaths={showSolution}
                  variantBlocks={variantBlocks}
                  board={board}
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
                  onEditInBuild={currentPuzzle?.robots ? handleEditInBuild : undefined}
                />
              </div>
            ) : null}
            {!isBuildPlacing && (
              <p className="instructions">
                Click a robot to select it, then click a cell or use arrow keys to slide it.
                Get all <span className="instructions__target">exit robots</span> (A, B, C…) to the glowing center cell.
              </p>
            )}
          </div>

          {/* ── Right: navigation or build panel ── */}
          {mode === 'build' ? (
            <BuildPanel
              variant={variant}
              onVariantChange={handleBuildVariantChange}
              buildState={buildState}
              buildDispatch={buildDispatch}
              onSolve={() => buildSolve(variantBlocks, board)}
              onBackToLibrary={() => { setMode('library'); setBuildPreview(null); }}
              allPuzzles={allPuzzles}
              buildPreview={buildPreview}
              onPreview={handleBuildPreview}
              onPreviewBack={handleBuildPreviewBack}
            />
          ) : (
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
              filterState={filterState}
              onFilterChange={handleFilterChange}
            />
          )}
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
