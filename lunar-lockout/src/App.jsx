import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePuzzleLibrary } from './hooks/usePuzzleLibrary';
import { useGameState } from './hooks/useGameState';
import { resolvePuzzle } from './logic/puzzleFilter';
import Board from './components/Board';
import HUD from './components/HUD';
import DirectionArrows from './components/DirectionArrows';
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
};

export default function App() {
  const { allPuzzles, loading, error, needsFilePicker, loadFile, variant, switchVariant } = usePuzzleLibrary();
  const [currentPuzzle, setCurrentPuzzle] = useState(null);
  const filteredRef = useRef([]);

  // User-added blocked cells (only active in standard mode)
  const [userBlockedCells, setUserBlockedCells] = useState(() => {
    try {
      const saved = localStorage.getItem('ll-blocked-cells');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [blockMode, setBlockMode] = useState(false);
  const [showPaths, setShowPaths] = useState(false);

  useEffect(() => {
    localStorage.setItem('ll-blocked-cells', JSON.stringify([...userBlockedCells]));
  }, [userBlockedCells]);

  // Variant blocks are fixed; user blocks only apply in standard mode
  const variantBlocks = VARIANT_BLOCKS[variant] || VARIANT_BLOCKS.standard;
  const blockedCells = useMemo(() => {
    if (variant !== 'standard') return variantBlocks;
    if (userBlockedCells.size === 0) return variantBlocks; // empty set
    return userBlockedCells;
  }, [variant, variantBlocks, userBlockedCells]);

  // Disable block mode when switching away from standard
  useEffect(() => {
    if (variant !== 'standard') setBlockMode(false);
  }, [variant]);

  // Reset current puzzle when puzzle list changes (variant switch or initial load)
  useEffect(() => {
    setCurrentPuzzle(null);
  }, [allPuzzles]);

  const handleToggleBlock = useCallback((row, col) => {
    if (variant !== 'standard') return; // can't modify variant blocks
    const key = `${row},${col}`;
    setUserBlockedCells(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [variant]);

  const { state, dispatch } = useGameState(currentPuzzle ?? DUMMY_PUZZLE, blockedCells);

  // Called by PuzzleNav whenever the filtered list changes.
  const handleFilteredChange = useCallback(list => {
    filteredRef.current = list;
    // Auto-select the first puzzle when nothing is loaded yet.
    if (!currentPuzzle && list.length > 0) {
      let first = list[0];
      if (first.needsResolve && blockedCells.size > 0) {
        first = resolvePuzzle(first, blockedCells) || first;
      }
      setCurrentPuzzle(first);
      dispatch({ type: 'LOAD_PUZZLE', puzzle: first });
    }
  }, [currentPuzzle, dispatch, blockedCells]);

  function handleSelectPuzzle(puzzle) {
    // Tier 4 lazy resolve: if this puzzle needs re-solving with blocked cells, do it now
    let resolved = puzzle;
    if (puzzle.needsResolve && blockedCells.size > 0) {
      resolved = resolvePuzzle(puzzle, blockedCells);
      if (!resolved) return; // unsolvable with current blocks — skip
    }
    setCurrentPuzzle(resolved);
    dispatch({ type: 'LOAD_PUZZLE', puzzle: resolved });
  }

  function handleReplay() {
    if (currentPuzzle) dispatch({ type: 'LOAD_PUZZLE', puzzle: currentPuzzle });
  }

  function handleNext() {
    const fp  = filteredRef.current;
    const idx = fp.findIndex(p => p.id === currentPuzzle?.id);
    if (idx >= 0 && idx < fp.length - 1) handleSelectPuzzle(fp[idx + 1]);
  }

  const hasNext = (() => {
    const fp  = filteredRef.current;
    const idx = fp.findIndex(p => p.id === currentPuzzle?.id);
    return idx >= 0 && idx < fp.length - 1;
  })();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Lunar Lockout</h1>
        {currentPuzzle && (
          <div className="app__puzzle-info">
            <span className="pinfo-badge">#{currentPuzzle.id}</span>
            <span className="pinfo-badge">{currentPuzzle.exits ?? 1}E {currentPuzzle.helpers}H</span>
            <span className="pinfo-badge">{currentPuzzle.minMoves}M opt</span>
            <span className={`pinfo-badge pinfo-badge--${currentPuzzle.difficulty}`}>
              {currentPuzzle.difficulty}
            </span>
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
                  blockedCells={blockedCells} blockMode={blockMode}
                  onToggleBlock={handleToggleBlock}
                  showPaths={showPaths}
                  variantBlocks={variantBlocks}
                />
                <div className="controls">
                  <HUD
                    state={state}
                    dispatch={dispatch}
                    currentPuzzle={currentPuzzle}
                    blockedCells={blockedCells}
                    userBlockedCells={variant === 'standard' ? userBlockedCells : null}
                    blockMode={blockMode}
                    onToggleBlockMode={variant === 'standard' ? () => setBlockMode(m => !m) : null}
                    onClearBlocks={() => setUserBlockedCells(new Set())}
                    showPaths={showPaths}
                    onTogglePaths={() => setShowPaths(p => !p)}
                  />
                  <DirectionArrows
                    selectedRobotId={state.selectedRobotId}
                    dispatch={dispatch}
                    blockedCells={blockedCells}
                  />
                </div>
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
            blockedCells={variant === 'standard' ? userBlockedCells : new Set()}
            variant={variant}
            onVariantChange={switchVariant}
          />
        </div>
      </main>

      {state.isWon && (
        <WinModal
          moveCount={state.moveCount}
          minMoves={currentPuzzle?.minMoves}
          hasNext={hasNext}
          onNext={handleNext}
          onReplay={handleReplay}
        />
      )}
    </div>
  );
}
