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
  { key: 'fits',      label: 'Fits',      fn: p => (p.fitsSolitaire?1:0) + (p.fitsUfo?1:0) + (p.fitsFrench?1:0) },
];

const VARIANTS = [
  { key: 'standard',  label: '7×7' },
  { key: 'french',    label: 'French Solitaire' },
  { key: 'solitaire', label: 'Solitaire' },
  { key: 'ufo',       label: 'UFO' },
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
  const sortBy2       = filterState?.sortBy2 ?? 'none';
  const sortAsc       = filterState?.sortAsc ?? true;

  const [page,          setPage]          = useState(0);
  const [jumpId,        setJumpId]        = useState('');
  const [collapsed,     setCollapsed]     = useState(false);
  const [activeThumb,   setActiveThumb]   = useState('max'); // last-dragged thumb gets higher z-index

  // Helper to update a single filter field
  function updateFilter(patch) {
    onFilterChange({
      helpers: activeHelpers,
      exits: activeExits,
      diffs: activeDiffs,
      movesMin,
      movesMax,
      sortBy,
      sortBy2,
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
  function setSortBy2(v)       { updateFilter({ sortBy2: typeof v === 'function' ? v(sortBy2) : v }); }
  function setSortAsc(v)       { updateFilter({ sortAsc: typeof v === 'function' ? v(sortAsc) : v }); }

  // Preserve compatible filters across variant switches.
  // Only reset values that are no longer valid for the new puzzle set.
  useEffect(() => {
    if (!filterState) { setPage(0); return; } // already defaults
    const helpersSet = new Set(availableHelpers);
    const exitsSet = new Set(availableExits);
    const keptHelpers = new Set([...filterState.helpers ?? []].filter(h => helpersSet.has(h)));
    const keptExits = new Set([...filterState.exits ?? []].filter(e => exitsSet.has(e)));
    onFilterChange({
      helpers: keptHelpers.size > 0 ? keptHelpers : null,
      exits: keptExits.size > 0 ? keptExits : null,
      diffs: filterState.diffs,
      movesMin: filterState.movesMin != null ? Math.max(filterState.movesMin, movesRange.min) : null,
      movesMax: filterState.movesMax != null ? Math.min(filterState.movesMax, movesRange.max) : null,
      sortBy: filterState.sortBy,
      sortBy2: filterState.sortBy2,
      sortAsc: filterState.sortAsc,
    });
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
    const fn1 = sortOpt.fn;
    const sortOpt2 = sortBy2 !== 'none' ? SORT_OPTIONS.find(o => o.key === sortBy2) : null;
    const fn2 = sortOpt2?.fn;
    const arr = [...filteredUnsorted];
    arr.sort((a, b) => {
      const va = fn1(a), vb = fn1(b);
      let cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp === 0 && fn2) {
        const va2 = fn2(a), vb2 = fn2(b);
        cmp = va2 < vb2 ? -1 : va2 > vb2 ? 1 : 0;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [filteredUnsorted, sortBy, sortBy2, sortAsc]);

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

  function thumbDrag(setter, clampLo, clampHi, thumbName) {
    return (e) => {
      e.preventDefault();
      setActiveThumb(thumbName);
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
    if (e.target.tagName === 'INPUT') return;
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
              title="Board shape — variants block corner cells, reducing the playing area"
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
                  style={{ left: `${sliderLeftPct}%`, zIndex: activeThumb === 'min' ? 3 : 2 }}
                  onMouseDown={thumbDrag(setMovesMin, () => movesRange.min, () => movesMax, 'min')}
                  onTouchStart={thumbDrag(setMovesMin, () => movesRange.min, () => movesMax, 'min')}
                  title="Min moves"
                >◀</div>
                <div
                  className="pnav__range-thumb pnav__range-thumb--max"
                  style={{ left: `${sliderRightPct}%`, zIndex: activeThumb === 'max' ? 3 : 2 }}
                  onMouseDown={thumbDrag(setMovesMax, () => movesMin, () => movesRange.max, 'max')}
                  onTouchStart={thumbDrag(setMovesMax, () => movesMin, () => movesRange.max, 'max')}
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
            <select
              className="pnav__sort-select"
              value={sortBy2}
              title="Secondary sort (tiebreaker)"
              onChange={e => { setSortBy2(e.target.value); setPage(0); }}
            >
              <option value="none">then...</option>
              {SORT_OPTIONS.filter(o => o.key !== sortBy).map(o => (
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
              disabled={currentIdx <= 0} title="Previous puzzle">←</button>
            <button className="pnav__nav-btn pnav__nav-btn--rand" onClick={handleRandom}
              disabled={filtered.length === 0} title="Pick a random puzzle">Random</button>
            <button className="pnav__nav-btn" onClick={handleNext}
              disabled={currentIdx < 0 || currentIdx >= filtered.length - 1} title="Next puzzle">→</button>
            <form className="pnav__jump-inline" onSubmit={handleJump} title="Jump to a puzzle by its stable ID">
              <input
                className="pnav__jump-input" type="text" placeholder="ID"
                value={jumpId} onChange={e => setJumpId(e.target.value)}
              />
              <button type="submit" className="pnav__nav-btn">Go</button>
            </form>
          </div>

          {/* ── Puzzle list ── */}
          <div className="pnav__list">
            <div className="pnav__list-header" title="Column headers for the puzzle list">
              <span className="pnav__item-id" title="Unique puzzle identifier">ID</span>
              <span className="pnav__item-meta" title="Exit robots (E) and helper robots (H)">Cfg</span>
              <span className="pnav__item-fits" title="Which variant boards this puzzle fits on: S=Solitaire U=UFO F=French">Fits</span>
              {!hideOptimal && <span className="pnav__item-moves" title={scoreMode === 'slides' ? 'Minimum individual slides' : 'Minimum grouped moves (consecutive slides by same robot = 1 move)'}>{scoreMode === 'slides' ? 'Sld' : 'Mov'}</span>}
              <span className="pnav__item-diff" title="Difficulty based on helper count: Easy (1-2), Med (3), Hard (4), Exp (5+)">Dif</span>
            </div>
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
                  title={`${p.exits} exit${p.exits>1?'s':''}, ${p.helpers} helper${p.helpers>1?'s':''}, ${p.minMoves} moves`}
                >
                  <span className="pnav__item-id">{p.stableId}</span>
                  <span className="pnav__item-meta">
                    {p.exits > 1 ? `${p.exits}E ` : ''}{p.helpers}H
                  </span>
                  <span className="pnav__item-fits">
                    {p.fitsSolitaire && <span title="Playable on Solitaire board">S</span>}
                    {p.fitsUfo && <span title="Playable on UFO board">U</span>}
                    {p.fitsFrench && <span title="Playable on French board">F</span>}
                  </span>
                  {!hideOptimal && (
                    <span className="pnav__item-moves">
                      {scoreMode === 'slides' ? `${p.minRawSlides ?? '?'}` : `${p.minMoves}`}
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
