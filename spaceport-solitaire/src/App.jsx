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
import SettingsPanel from './components/SettingsPanel';
import InfoPanel from './components/InfoPanel';
import ImportMergeModal from './components/ImportMergeModal';
import { useBuildMode } from './hooks/useBuildMode';
import { useUserData, STORAGE_KEY, mergeUserData, applyConflictResolutions } from './hooks/useUserData';
import { usePuzzleMetrics } from './hooks/usePuzzleMetrics';
import { usePersistentState } from './hooks/usePersistentState';
import { boardForVariant } from './logic/boardGeometry';
import { computeReachableCells } from './logic/reachabilityBounds';

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
  hex: new Set(
    Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => ({ r, c }))
    ).flat().filter(({ r, c }) => r === 0 || r === 6 || c === 0 || c === 6)
     .map(({ r, c }) => `${r},${c}`)
  ),
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

  const [scoreMode, setScoreMode] = usePersistentState('scoreMode', 'grouped'); // 'grouped' | 'slides'
  const [hideOptimal, setHideOptimal] = usePersistentState('hideOptimal', true);
  const [cellShading, setCellShading] = usePersistentState('cellShading', 'bbox'); // 'none' | 'bbox' | 'convex' | 'och'

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

  // Detect unwinnable: center outside selected bound
  const centerUnwinnable = useMemo(() => {
    if (cellShading === 'none' || !state.positions) return false;
    const reachable = computeReachableCells(state.positions, cellShading, board.type === 'hex', board.N);
    return reachable !== null && !reachable.has(`${board.centerRow},${board.centerCol}`);
  }, [state.positions, cellShading, board]);

  // Persistent per-browser user state: solved/starred/comments by stableId
  const userData = useUserData();

  // Overlay panels
  const [openPanel, setOpenPanel] = useState(null); // 'settings' | 'info' | null

  // Import merge flow: holds a pending merge waiting for conflict resolution.
  const [pendingMerge, setPendingMerge] = useState(null);
  // pendingMerge shape: { merged, conflicts } | null

  const handleExportProgress = useCallback(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spaceport-solitaire-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Write the final merged payload and reload so the rest of the app picks
  // up the new userData cleanly.
  const applyMergedProgress = useCallback((merged) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      window.location.reload();
    } catch (e) {
      console.warn('spaceport-solitaire: could not write merged progress', e);
    }
  }, []);

  const handleImportProgress = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported || typeof imported !== 'object') return;
        // Merge with current data (read from userData hook — fresh snapshot)
        const currentRaw = localStorage.getItem(STORAGE_KEY);
        const current = currentRaw ? JSON.parse(currentRaw) : { version: 1, solved: {}, starred: {} };
        const { merged, conflicts } = mergeUserData(current, imported);
        if (conflicts.length === 0) {
          applyMergedProgress(merged);
        } else {
          // Show the conflict resolution modal — App.jsx holds the pending
          // merge until the user resolves or cancels.
          setPendingMerge({ merged, conflicts });
          setOpenPanel(null); // close settings panel while the modal is up
        }
      } catch (e) {
        console.warn('spaceport-solitaire: could not parse imported file', e);
      }
    };
    reader.readAsText(file);
  }, [applyMergedProgress]);

  // Mark puzzle as solved on win edge — but NOT when stepping through a
  // build-mode solution playback (the user didn't actually solve it).
  const wonRef = useRef(false);
  const isStepModeForWin = mode === 'build' && buildState.phase === 'solved' && !buildPreview;
  useEffect(() => {
    if (state.isWon && !wonRef.current && currentPuzzle?.stableId && !isStepModeForWin) {
      wonRef.current = true;
      userData.markSolved(currentPuzzle.stableId, {
        moves:    state.moveCount,
        minMoves: currentPuzzle.minMoves,
      });
    } else if (!state.isWon) {
      wonRef.current = false;
    }
  }, [state.isWon, state.moveCount, currentPuzzle, userData, isStepModeForWin]);

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
    if (decoded) return findByPositions(decoded.numExits, decoded.positions);
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

  const isBuildPlacing = mode === 'build' && buildState.phase !== 'solved';
  const isStepMode = mode === 'build' && buildState.phase === 'solved' && !buildPreview;

  // Compute per-step difficulty metrics in a Web Worker — only when in
  // build-stepper mode. Returns { status, solutionPath: [...] }.
  const stepperPuzzle = isStepMode ? currentPuzzle : null;
  const puzzleMetrics = usePuzzleMetrics(stepperPuzzle, variantBlocks, board);

  // In solution-stepper mode, auto-select the next mover so the user
  // sees the yellow selection ring + landing cells highlighted.
  const nextMove = isStepMode ? currentPuzzle?.solution?.[state.slideCount] : null;
  useEffect(() => {
    if (!isStepMode) return;
    if (nextMove && state.selectedRobotId !== nextMove.mover) {
      dispatch({ type: 'SELECT_ROBOT', robotId: nextMove.mover });
    } else if (!nextMove && state.selectedRobotId) {
      dispatch({ type: 'DESELECT' });
    }
  }, [isStepMode, nextMove, state.selectedRobotId, dispatch]);

  const handleEditInBuild = useCallback(() => {
    if (!currentPuzzle?.robots) return;
    buildDispatch({ type: 'LOAD_ROBOTS', robots: currentPuzzle.robots });
    setBuildPreview(null);
    setMode('build');
  }, [currentPuzzle, buildDispatch]);

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

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Spaceport Solitaire</h1>
        <div className="app__header-right">
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
          <button
            className="app__icon-btn"
            onClick={() => setOpenPanel(p => p === 'info' ? null : 'info')}
            title="How to play"
          >?</button>
          <button
            className="app__icon-btn"
            onClick={() => setOpenPanel(p => p === 'settings' ? null : 'settings')}
            title="Settings"
          >⚙</button>
        </div>
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
          <div
            className="game-column"
          >
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
                  variantBlocks={variantBlocks}
                  board={board}
                  nextMove={nextMove}
                  cellShading={cellShading}
                />
                <HUD
                  state={state}
                  dispatch={dispatch}
                  currentPuzzle={currentPuzzle}
                  scoreMode={scoreMode}
                  hideOptimal={hideOptimal}
                  centerUnwinnable={centerUnwinnable}
                  onEditInBuild={mode === 'library' && currentPuzzle?.robots ? handleEditInBuild : undefined}
                  stepMode={isStepMode}
                  board={board}
                  variantBlocks={variantBlocks}
                  puzzleMetrics={isStepMode ? puzzleMetrics : null}
                />
              </div>
            ) : null}
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
              isSolved={userData.isSolved}
              isOptimal={userData.isOptimal}
              isStarred={userData.isStarred}
              toggleStar={userData.toggleStar}
              getComment={userData.getComment}
              setComment={userData.setComment}
            />
          )}
        </div>
      </main>

      {state.isWon && !isStepMode && (
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
          stableId={currentPuzzle?.stableId}
          isStarred={userData.isStarred}
          toggleStar={userData.toggleStar}
          getComment={userData.getComment}
          setComment={userData.setComment}
        />
      )}

      {openPanel === 'settings' && (
        <SettingsPanel
          scoreMode={scoreMode}
          onScoreModeChange={setScoreMode}
          hideOptimal={hideOptimal}
          onHideOptimalChange={setHideOptimal}
          cellShading={cellShading}
          onCellShadingChange={setCellShading}
          onExport={handleExportProgress}
          onImport={handleImportProgress}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === 'info' && (
        <InfoPanel onClose={() => setOpenPanel(null)} />
      )}

      {pendingMerge && (
        <ImportMergeModal
          conflicts={pendingMerge.conflicts}
          onCancel={() => setPendingMerge(null)}
          onApply={(resolutions) => {
            const finalMerged = applyConflictResolutions(pendingMerge.merged, pendingMerge.conflicts, resolutions);
            setPendingMerge(null);
            applyMergedProgress(finalMerged);
          }}
        />
      )}
    </div>
  );
}
