// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { filterPuzzles } from '../logic/puzzleFilter';

const PAGE_SIZE   = 20;

const DIFF_OPTS  = ['easy', 'medium', 'hard', 'expert'];
const DIFF_LABEL = { easy: 'Easy', medium: 'Med', hard: 'Hard', expert: 'Exp' };
const DIFF_COLOR = { easy: '#4caf50', medium: '#ffc107', hard: '#f44336', expert: '#9c27b0' };

const SORT_OPTIONS = [
  { key: 'id',        label: 'ID',        fn: p => p.id },
  { key: 'moves',     label: 'Moves',     fn: p => p.minMoves },
  { key: 'slides',    label: 'Slides',    fn: p => p.rawSlides ?? 0 },
  { key: 'minSlides', label: 'Min Slides', fn: p => p.minRawSlides ?? 0 },
  { key: 'states',    label: 'States',    fn: p => p.forwardStates ?? 0 },
];

const VARIANTS = [
  { key: 'standard',  label: '7×7' },
  { key: 'french',    label: 'French Solitaire' },
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

export default function PuzzleNav({ allPuzzles, currentPuzzle, onSelect, onFilteredChange, blockedCells, variant, onVariantChange, scoreMode, hideOptimal, filterState, onFilterChange }) {
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

  // Filter state comes from props (owned by App); derive with defaults
  const activeHelpers = filterState?.helpers ?? new Set(availableHelpers);
  const activeExits   = filterState?.exits   ?? new Set(availableExits);
  const activeDiffs   = filterState?.diffs   ?? new Set(DIFF_OPTS);
  const movesMin      = filterState?.movesMin ?? movesRange.min;
  const movesMax      = filterState?.movesMax ?? movesRange.max;
  const sortBy        = filterState?.sortBy  ?? 'id';
  const sortAsc       = filterState?.sortAsc ?? true;

  const [page,          setPage]          = useState(0);
  const [jumpId,        setJumpId]        = useState('');
  const [collapsed,     setCollapsed]     = useState(false);

  // Helper to update a single filter field
  function updateFilter(patch) {
    onFilterChange({
      helpers: activeHelpers,
      exits: activeExits,
      diffs: activeDiffs,
      movesMin,
      movesMax,
      sortBy,
      sortAsc,
      ...patch,
    });
  }

  // Setter-like functions for compatibility with existing chip/slider handlers
  function setActiveHelpers(v) { updateFilter({ helpers: typeof v === 'function' ? v(activeHelpers) : v }); }
  function setActiveExits(v)   { updateFilter({ exits: typeof v === 'function' ? v(activeExits) : v }); }
  function setActiveDiffs(v)   { updateFilter({ diffs: typeof v === 'function' ? v(activeDiffs) : v }); }
  function setMovesMin(v)      { updateFilter({ movesMin: typeof v === 'function' ? v(movesMin) : v }); }
  function setMovesMax(v)      { updateFilter({ movesMax: typeof v === 'function' ? v(movesMax) : v }); }
  function setSortBy(v)        { updateFilter({ sortBy: typeof v === 'function' ? v(sortBy) : v }); }
  function setSortAsc(v)       { updateFilter({ sortAsc: typeof v === 'function' ? v(sortAsc) : v }); }

  // Reset filters when puzzle library changes (variant switch)
  useEffect(() => {
    onFilterChange(null); // signal reset to defaults
    setPage(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableHelpers, availableExits, movesRange]);

  // Apply blocked-cell filter first, then the standard filters.
  const { kept: unblocked, removed: blockedCount } = useMemo(
    () => filterPuzzles(allPuzzles, blockedCells),
    [allPuzzles, blockedCells]
  );

  const filteredUnsorted = useMemo(() =>
    unblocked.filter(p =>
      activeHelpers.has(p.helpers) &&
      activeExits.has(p.exits ?? 1) &&
      activeDiffs.has(p.difficulty) &&
      p.minMoves >= movesMin &&
      p.minMoves <= movesMax
    ),
    [unblocked, activeHelpers, activeExits, activeDiffs, movesMin, movesMax]
  );

  const filtered = useMemo(() => {
    const sortOpt = SORT_OPTIONS.find(o => o.key === sortBy);
    if (!sortOpt) return filteredUnsorted;
    const arr = [...filteredUnsorted];
    const fn = sortOpt.fn;
    arr.sort((a, b) => {
      const va = fn(a), vb = fn(b);
      return sortAsc ? (va < vb ? -1 : va > vb ? 1 : 0)
                     : (va > vb ? -1 : va < vb ? 1 : 0);
    });
    return arr;
  }, [filteredUnsorted, sortBy, sortAsc]);

  // Notify parent of the current filtered list (for WinModal "Next").
  useEffect(() => {
    if (onFilteredChange) onFilteredChange(filtered);
  }, [filtered, onFilteredChange]);

  const currentIdx  = currentPuzzle ? filtered.findIndex(p => p.stableId === currentPuzzle.stableId) : -1;
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

  const handleChip = useCallback((currentSet, setter, allValues, value, e) => {
    const result = chipClick(currentSet, value, e.shiftKey);
    setter(result ?? new Set(allValues));
    setPage(0);
  }, []);

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
    const p = allPuzzles.find(x => x.stableId === jumpId.trim());
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
  const trackRef = useRef(null);

  function thumbDrag(setter, clampLo, clampHi) {
    return (e) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const move = (clientX) => {
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const val = Math.round(movesRange.min + pct * (movesRange.max - movesRange.min));
        const clamped = Math.max(clampLo(), Math.min(val, clampHi()));
        setter(clamped);
        setPage(0);
      };
      const onMove = (ev) => move(ev.touches ? ev.touches[0].clientX : ev.clientX);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      move(e.touches ? e.touches[0].clientX : e.clientX);
    };
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      handlePrev();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleNext();
    }
  }

  return (
    <div className="pnav" tabIndex={-1} onKeyDown={handleKeyDown}>
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
            <select
              className="pnav__sort-select"
              value={variant}
              onChange={e => onVariantChange(e.target.value)}
            >
              {VARIANTS.map(v => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
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
                    onClick={(ev) => handleChip(activeExits, setActiveExits, availableExits, e, ev)}
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
                  onClick={(ev) => handleChip(activeHelpers, setActiveHelpers, availableHelpers, h, ev)}
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
                  onClick={(ev) => handleChip(activeDiffs, setActiveDiffs, DIFF_OPTS, d, ev)}
                >{DIFF_LABEL[d]}</button>
              ))}
            </div>

            {/* ── Moves range slider ── */}
            <div className="pnav__filter-row">
              <span className="pnav__label">Moves:</span>
              <span className="pnav__range-value">{movesMin}</span>
              <div className="pnav__range-track" ref={trackRef}>
                <div className="pnav__range-rail" />
                <div
                  className="pnav__range-fill"
                  style={{ left: `${sliderLeftPct}%`, right: `${100 - sliderRightPct}%` }}
                />
                <div
                  className="pnav__range-thumb pnav__range-thumb--min"
                  style={{ left: `${sliderLeftPct}%` }}
                  onMouseDown={thumbDrag(setMovesMin, () => movesRange.min, () => movesMax)}
                  onTouchStart={thumbDrag(setMovesMin, () => movesRange.min, () => movesMax)}
                  title="Min moves"
                >◀</div>
                <div
                  className="pnav__range-thumb pnav__range-thumb--max"
                  style={{ left: `${sliderRightPct}%` }}
                  onMouseDown={thumbDrag(setMovesMax, () => movesMin, () => movesRange.max)}
                  onTouchStart={thumbDrag(setMovesMax, () => movesMin, () => movesRange.max)}
                  title="Max moves"
                >▶</div>
              </div>
              <span className="pnav__range-value">{movesMax}</span>
            </div>
          </div>

          {/* ── Sort ── */}
          <div className="pnav__filter-row">
            <span className="pnav__label">Sort:</span>
            <select
              className="pnav__sort-select"
              value={sortBy}
              onChange={e => { setSortBy(e.target.value); setPage(0); }}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <button
              className="pnav__chip pnav__chip--on"
              onClick={() => setSortAsc(a => !a)}
              title={sortAsc ? 'Ascending' : 'Descending'}
            >{sortAsc ? '↑' : '↓'}</button>
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
                className="pnav__jump-input" type="text" placeholder="ID"
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
              const active = p.stableId === currentPuzzle?.stableId;
              const sortOpt = SORT_OPTIONS.find(o => o.key === sortBy);
              const sortVal = sortOpt && sortBy !== 'id' ? sortOpt.fn(p) : null;
              const sortLabel = sortVal != null
                ? (typeof sortVal === 'number' && !Number.isInteger(sortVal)
                    ? sortVal.toFixed(2) : sortVal)
                : null;
              return (
                <button
                  key={p.stableId}
                  className={`pnav__item${active ? ' pnav__item--active' : ''}`}
                  onClick={() => onSelect(p)}
                >
                  <span className="pnav__item-id">{p.stableId}</span>
                  <span className="pnav__item-meta">
                    {p.exits > 1 ? `${p.exits}E ` : ''}{p.helpers}H
                  </span>
                  {!hideOptimal && (
                    <span className="pnav__item-moves">
                      {scoreMode === 'slides' ? `${p.minRawSlides ?? '?'}S` : `${p.minMoves}M`}
                    </span>
                  )}
                  {sortLabel != null && (
                    <span className="pnav__item-sort">{sortLabel}</span>
                  )}
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
