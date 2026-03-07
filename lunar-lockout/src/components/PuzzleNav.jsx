import { useState, useMemo, useEffect } from 'react';

const HELPER_OPTS = [1, 2, 3, 4, 5];
const EXIT_OPTS   = [1, 2, 3];
const PAGE_SIZE   = 18;

const DIFF_LABEL = { easy: 'E', medium: 'M', hard: 'H', expert: 'X' };
const DIFF_COLOR = { easy: '#4caf50', medium: '#ffc107', hard: '#f44336', expert: '#9c27b0' };

export default function PuzzleNav({ allPuzzles, currentPuzzle, onSelect, onFilteredChange }) {
  const [activeHelpers, setActiveHelpers] = useState(new Set([1, 2, 3, 4, 5]));
  const [activeExits,   setActiveExits]   = useState(new Set([1, 2, 3]));
  const [movesMin,      setMovesMin]      = useState(1);
  const [movesMax,      setMovesMax]      = useState(30);
  const [page,          setPage]          = useState(0);
  const [jumpId,        setJumpId]        = useState('');
  const [collapsed,     setCollapsed]     = useState(false);

  // Derive which exit counts actually exist in the puzzle library.
  const availableExits = useMemo(() =>
    [...new Set(allPuzzles.map(p => p.exits ?? 1))].sort((a, b) => a - b),
    [allPuzzles]
  );

  const filtered = useMemo(() =>
    allPuzzles.filter(p =>
      activeHelpers.has(p.helpers) &&
      activeExits.has(p.exits ?? 1) &&
      p.minMoves >= movesMin &&
      p.minMoves <= movesMax
    ),
    [allPuzzles, activeHelpers, activeExits, movesMin, movesMax]
  );

  // Notify parent of the current filtered list (for WinModal "Next").
  useEffect(() => {
    if (onFilteredChange) onFilteredChange(filtered);
  }, [filtered, onFilteredChange]);

  const currentIdx  = currentPuzzle ? filtered.findIndex(p => p.id === currentPuzzle.id) : -1;
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages - 1);
  const pageStart   = safePage * PAGE_SIZE;
  const pagePuzzles = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Keep current puzzle visible when it changes externally.
  useEffect(() => {
    if (currentIdx >= 0) {
      const targetPage = Math.floor(currentIdx / PAGE_SIZE);
      setPage(targetPage);
    }
  }, [currentIdx]);

  function toggleHelper(h) {
    setActiveHelpers(prev => {
      const next = new Set(prev);
      if (next.has(h)) {
        if (next.size > 1) next.delete(h);
      } else {
        next.add(h);
      }
      return next;
    });
    setPage(0);
  }

  function toggleExit(e) {
    setActiveExits(prev => {
      const next = new Set(prev);
      if (next.has(e)) {
        if (next.size > 1) next.delete(e);
      } else {
        next.add(e);
      }
      return next;
    });
    setPage(0);
  }

  function handlePrev() {
    if (currentIdx > 0) onSelect(filtered[currentIdx - 1]);
  }

  function handleNext() {
    if (currentIdx < filtered.length - 1) onSelect(filtered[currentIdx + 1]);
  }

  function handleRandom() {
    if (!filtered.length) return;
    onSelect(filtered[Math.floor(Math.random() * filtered.length)]);
  }

  function handleJump(e) {
    e.preventDefault();
    const id = parseInt(jumpId, 10);
    const p  = allPuzzles.find(x => x.id === id);
    if (p) { onSelect(p); setJumpId(''); }
  }

  function handleMovesMin(val) {
    const n = Math.max(1, Math.min(val, movesMax));
    setMovesMin(n); setPage(0);
  }
  function handleMovesMax(val) {
    const n = Math.max(movesMin, Math.min(val, 99));
    setMovesMax(n); setPage(0);
  }

  return (
    <div className="pnav">
      {/* ── Header bar ── */}
      <div className="pnav__header">
        <span className="pnav__title">Puzzles</span>
        {filtered.length > 0 && currentIdx >= 0 && (
          <span className="pnav__pos">
            {currentIdx + 1} / {filtered.length}
          </span>
        )}
        {filtered.length > 0 && currentIdx < 0 && (
          <span className="pnav__pos">{filtered.length} matching</span>
        )}
        <button className="pnav__collapse-btn" onClick={() => setCollapsed(c => !c)}>
          {collapsed ? '▾' : '▴'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* ── Filters ── */}
          <div className="pnav__filters">
            {availableExits.length > 1 && (
              <div className="pnav__filter-row">
                <span className="pnav__label">Exits:</span>
                {availableExits.map(e => (
                  <button
                    key={e}
                    className={`pnav__chip${activeExits.has(e) ? ' pnav__chip--on' : ''}`}
                    onClick={() => toggleExit(e)}
                  >{e}</button>
                ))}
              </div>
            )}
            <div className="pnav__filter-row">
              <span className="pnav__label">Helpers:</span>
              {HELPER_OPTS.map(h => (
                <button
                  key={h}
                  className={`pnav__chip${activeHelpers.has(h) ? ' pnav__chip--on' : ''}`}
                  onClick={() => toggleHelper(h)}
                >{h}</button>
              ))}
            </div>
            <div className="pnav__filter-row">
              <span className="pnav__label">Moves:</span>
              <input
                className="pnav__num-input" type="number"
                min="1" max="99" value={movesMin}
                onChange={e => handleMovesMin(parseInt(e.target.value, 10) || 1)}
              />
              <span className="pnav__label">–</span>
              <input
                className="pnav__num-input" type="number"
                min="1" max="99" value={movesMax}
                onChange={e => handleMovesMax(parseInt(e.target.value, 10) || 99)}
              />
            </div>
          </div>

          {/* ── Prev / Next / Random ── */}
          <div className="pnav__nav-row">
            <button className="pnav__nav-btn" onClick={handlePrev}
              disabled={currentIdx <= 0}>← Prev</button>
            <button className="pnav__nav-btn pnav__nav-btn--rand" onClick={handleRandom}
              disabled={filtered.length === 0}>↷ Random</button>
            <button className="pnav__nav-btn" onClick={handleNext}
              disabled={currentIdx < 0 || currentIdx >= filtered.length - 1}>Next →</button>
          </div>

          {/* ── Puzzle list ── */}
          <div className="pnav__list">
            {pagePuzzles.length === 0 && (
              <p className="pnav__empty">No puzzles match the current filters.</p>
            )}
            {pagePuzzles.map(p => {
              const active = p.id === currentPuzzle?.id;
              return (
                <button
                  key={p.id}
                  className={`pnav__item${active ? ' pnav__item--active' : ''}`}
                  onClick={() => onSelect(p)}
                >
                  <span className="pnav__item-id">#{p.id}</span>
                  <span className="pnav__item-meta">{p.exits ?? 1}E {p.helpers}H · {p.minMoves}M</span>
                  <span
                    className="pnav__item-diff"
                    style={{ color: DIFF_COLOR[p.difficulty] }}
                  >{DIFF_LABEL[p.difficulty]}</span>
                </button>
              );
            })}
          </div>

          {/* ── Pagination ── */}
          <div className="pnav__pages">
            <button className="pnav__pg-btn"
              onClick={() => setPage(0)} disabled={safePage === 0}>«</button>
            <button className="pnav__pg-btn"
              onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>‹</button>
            <span className="pnav__pg-info">{safePage + 1} / {totalPages}</span>
            <button className="pnav__pg-btn"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}>›</button>
            <button className="pnav__pg-btn"
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}>»</button>
          </div>

          {/* ── Jump to ID ── */}
          <form className="pnav__jump" onSubmit={handleJump}>
            <span className="pnav__label">Jump to ID:</span>
            <input
              className="pnav__jump-input" type="number" placeholder="ID"
              value={jumpId} onChange={e => setJumpId(e.target.value)}
            />
            <button type="submit" className="pnav__nav-btn">Go</button>
          </form>
        </>
      )}
    </div>
  );
}
