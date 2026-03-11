import { useState, useMemo, useEffect, useCallback } from 'react';
import { filterPuzzles } from '../logic/puzzleFilter';

const PAGE_SIZE   = 20;

const DIFF_OPTS  = ['easy', 'medium', 'hard', 'expert'];
const DIFF_LABEL = { easy: 'Easy', medium: 'Med', hard: 'Hard', expert: 'Exp' };
const DIFF_COLOR = { easy: '#4caf50', medium: '#ffc107', hard: '#f44336', expert: '#9c27b0' };

const VARIANTS = [
  { key: 'standard',  label: '7×7' },
  { key: 'solitaire', label: 'Solitaire' },
  { key: 'ufo',       label: 'UFO 5×5' },
];

// Click = select only this value; Shift+click = toggle add/remove
function chipClick(prev, value, shiftKey) {
  if (shiftKey) {
    const next = new Set(prev);
    if (next.has(value)) {
      if (next.size > 1) next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  }
  // Plain click: if already the sole selection, select all; otherwise select only this one
  if (prev.size === 1 && prev.has(value)) return null; // signal "select all"
  return new Set([value]);
}

export default function PuzzleNav({ allPuzzles, currentPuzzle, onSelect, onFilteredChange, blockedCells, variant, onVariantChange }) {
  // Derive available options from the puzzle library
  const availableHelpers = useMemo(() =>
    [...new Set(allPuzzles.map(p => p.helpers))].sort((a, b) => a - b),
    [allPuzzles]
  );
  const availableExits = useMemo(() =>
    [...new Set(allPuzzles.map(p => p.exits ?? 1))].sort((a, b) => a - b),
    [allPuzzles]
  );
  const movesRange = useMemo(() => {
    if (allPuzzles.length === 0) return { min: 1, max: 20 };
    let min = Infinity, max = -Infinity;
    for (const p of allPuzzles) {
      if (p.minMoves < min) min = p.minMoves;
      if (p.minMoves > max) max = p.minMoves;
    }
    return { min, max };
  }, [allPuzzles]);

  // Filter state — initialize to "all selected"
  const [activeHelpers, setActiveHelpers] = useState(new Set(availableHelpers));
  const [activeExits,   setActiveExits]   = useState(new Set(availableExits));
  const [activeDiffs,   setActiveDiffs]   = useState(new Set(DIFF_OPTS));
  const [movesMin,      setMovesMin]      = useState(movesRange.min);
  const [movesMax,      setMovesMax]      = useState(movesRange.max);
  const [page,          setPage]          = useState(0);
  const [jumpId,        setJumpId]        = useState('');
  const [collapsed,     setCollapsed]     = useState(false);

  // Reset filters when puzzle library changes (variant switch)
  useEffect(() => {
    setActiveHelpers(new Set(availableHelpers));
    setActiveExits(new Set(availableExits));
    setActiveDiffs(new Set(DIFF_OPTS));
    setMovesMin(movesRange.min);
    setMovesMax(movesRange.max);
    setPage(0);
  }, [availableHelpers, availableExits, movesRange]);

  // Apply blocked-cell filter first, then the standard filters.
  const { kept: unblocked, removed: blockedCount } = useMemo(
    () => filterPuzzles(allPuzzles, blockedCells),
    [allPuzzles, blockedCells]
  );

  const filtered = useMemo(() =>
    unblocked.filter(p =>
      activeHelpers.has(p.helpers) &&
      activeExits.has(p.exits ?? 1) &&
      activeDiffs.has(p.difficulty) &&
      p.minMoves >= movesMin &&
      p.minMoves <= movesMax
    ),
    [unblocked, activeHelpers, activeExits, activeDiffs, movesMin, movesMax]
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

  const handleChip = useCallback((setter, allValues, value, e) => {
    const result = chipClick(setter === setActiveHelpers ? activeHelpers : setter === setActiveExits ? activeExits : activeDiffs, value, e.shiftKey);
    setter(result ?? new Set(allValues));
    setPage(0);
  }, [activeHelpers, activeExits, activeDiffs]);

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

  // Dual-range slider handlers
  function handleSliderMin(val) {
    const n = Math.max(movesRange.min, Math.min(val, movesMax));
    setMovesMin(n); setPage(0);
  }
  function handleSliderMax(val) {
    const n = Math.max(movesMin, Math.min(val, movesRange.max));
    setMovesMax(n); setPage(0);
  }

  const sliderTotal = movesRange.max - movesRange.min || 1;
  const sliderLeftPct  = ((movesMin - movesRange.min) / sliderTotal) * 100;
  const sliderRightPct = ((movesMax - movesRange.min) / sliderTotal) * 100;

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

      {blockedCount > 0 && (
        <div className="pnav__blocked-info">
          {blockedCount} puzzles removed by blocks
        </div>
      )}

      {!collapsed && (
        <>
          {/* ── Board variant ── */}
          <div className="pnav__filter-row">
            <span className="pnav__label">Board:</span>
            {VARIANTS.map(v => (
              <button
                key={v.key}
                className={`pnav__chip${variant === v.key ? ' pnav__chip--on' : ''}`}
                onClick={() => onVariantChange(v.key)}
              >{v.label}</button>
            ))}
          </div>

          {/* ── Filters ── */}
          <div className="pnav__filters">
            {availableExits.length > 1 && (
              <div className="pnav__filter-row">
                <span className="pnav__label">Exits:</span>
                {availableExits.map(e => (
                  <button
                    key={e}
                    className={`pnav__chip${activeExits.has(e) ? ' pnav__chip--on' : ''}`}
                    title="Click to select; Shift+click to toggle"
                    onClick={(ev) => handleChip(setActiveExits, availableExits, e, ev)}
                  >{e}</button>
                ))}
              </div>
            )}
            <div className="pnav__filter-row">
              <span className="pnav__label">Helpers:</span>
              {availableHelpers.map(h => (
                <button
                  key={h}
                  className={`pnav__chip${activeHelpers.has(h) ? ' pnav__chip--on' : ''}`}
                  title="Click to select; Shift+click to toggle"
                  onClick={(ev) => handleChip(setActiveHelpers, availableHelpers, h, ev)}
                >{h}</button>
              ))}
            </div>
            <div className="pnav__filter-row">
              <span className="pnav__label">Difficulty:</span>
              {DIFF_OPTS.map(d => (
                <button
                  key={d}
                  className={`pnav__chip${activeDiffs.has(d) ? ' pnav__chip--on' : ''}`}
                  style={activeDiffs.has(d) ? { borderColor: DIFF_COLOR[d], color: DIFF_COLOR[d] } : {}}
                  title="Click to select; Shift+click to toggle"
                  onClick={(ev) => handleChip(setActiveDiffs, DIFF_OPTS, d, ev)}
                >{DIFF_LABEL[d]}</button>
              ))}
            </div>

            {/* ── Moves range slider ── */}
            <div className="pnav__filter-row">
              <span className="pnav__label">Moves:</span>
              <span className="pnav__range-value">{movesMin}</span>
              <div className="pnav__range-track">
                <div
                  className="pnav__range-fill"
                  style={{ left: `${sliderLeftPct}%`, right: `${100 - sliderRightPct}%` }}
                />
                <input
                  type="range"
                  className="pnav__range-input"
                  min={movesRange.min} max={movesRange.max}
                  value={movesMin}
                  style={{ zIndex: movesMin > movesRange.min && movesMin >= movesMax ? 1 : 2 }}
                  onChange={e => handleSliderMin(parseInt(e.target.value, 10))}
                />
                <input
                  type="range"
                  className="pnav__range-input"
                  min={movesRange.min} max={movesRange.max}
                  value={movesMax}
                  style={{ zIndex: movesMin > movesRange.min && movesMin >= movesMax ? 2 : 1 }}
                  onChange={e => handleSliderMax(parseInt(e.target.value, 10))}
                />
              </div>
              <span className="pnav__range-value">{movesMax}</span>
            </div>
          </div>

          {/* ── Navigation: Prev / Random / Next + Jump ── */}
          <div className="pnav__nav-row">
            <button className="pnav__nav-btn" onClick={handlePrev}
              disabled={currentIdx <= 0}>←</button>
            <button className="pnav__nav-btn pnav__nav-btn--rand" onClick={handleRandom}
              disabled={filtered.length === 0}>Random</button>
            <button className="pnav__nav-btn" onClick={handleNext}
              disabled={currentIdx < 0 || currentIdx >= filtered.length - 1}>→</button>
            <form className="pnav__jump-inline" onSubmit={handleJump}>
              <input
                className="pnav__jump-input" type="number" placeholder="#"
                value={jumpId} onChange={e => setJumpId(e.target.value)}
              />
              <button type="submit" className="pnav__nav-btn">Go</button>
            </form>
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
                  <span className="pnav__item-meta">
                    {p.exits > 1 ? `${p.exits}E ` : ''}{p.helpers}H
                  </span>
                  <span className="pnav__item-moves">{p.minMoves}M</span>
                  <span
                    className="pnav__item-diff"
                    style={{ color: DIFF_COLOR[p.difficulty] }}
                  >{DIFF_LABEL[p.difficulty]}</span>
                </button>
              );
            })}
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
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
          )}
        </>
      )}
    </div>
  );
}
