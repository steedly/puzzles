import { useState, useRef, useCallback, useEffect } from 'react';
import { usePuzzleLibrary } from './hooks/usePuzzleLibrary';
import { useGameState } from './hooks/useGameState';
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

export default function App() {
  const { allPuzzles, loading, error, needsFilePicker, loadFile } = usePuzzleLibrary();
  const [currentPuzzle, setCurrentPuzzle] = useState(null);
  const filteredRef = useRef([]);

  // Blocked cells: global preference, persisted in localStorage
  const [blockedCells, setBlockedCells] = useState(() => {
    try {
      const saved = localStorage.getItem('ll-blocked-cells');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [blockMode, setBlockMode] = useState(false);

  useEffect(() => {
    localStorage.setItem('ll-blocked-cells', JSON.stringify([...blockedCells]));
  }, [blockedCells]);

  const handleToggleBlock = useCallback((row, col) => {
    const key = `${row},${col}`;
    setBlockedCells(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const { state, dispatch } = useGameState(currentPuzzle ?? DUMMY_PUZZLE, blockedCells);

  // Called by PuzzleNav whenever the filtered list changes.
  const handleFilteredChange = useCallback(list => {
    filteredRef.current = list;
    // Auto-select the first puzzle when nothing is loaded yet.
    if (!currentPuzzle && list.length > 0) {
      setCurrentPuzzle(list[0]);
      dispatch({ type: 'LOAD_PUZZLE', puzzle: list[0] });
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
                />
                <div className="controls">
                  <HUD
                    state={state}
                    dispatch={dispatch}
                    currentPuzzle={currentPuzzle}
                    blockedCells={blockedCells}
                    blockMode={blockMode}
                    onToggleBlockMode={() => setBlockMode(m => !m)}
                    onClearBlocks={() => setBlockedCells(new Set())}
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
              Click a robot to select it, then use the arrows or keyboard arrow keys to slide it.
              Get all <span className="instructions__target">exit robots</span> (T, A, B…) to the glowing center cell.
            </p>
          </div>

          {/* ── Right: navigation panel ── */}
          <PuzzleNav
            allPuzzles={allPuzzles}
            currentPuzzle={currentPuzzle}
            onSelect={handleSelectPuzzle}
            onFilteredChange={handleFilteredChange}
            blockedCells={blockedCells}
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
