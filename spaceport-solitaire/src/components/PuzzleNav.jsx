// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { filterPuzzles } from '../logic/puzzleFilter';
import GoldMedal from './GoldMedal';

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
// Map variant key → movement type
function moveTypeOf(variant) {
  return (variant === 'hex' || variant === 'beehive') ? 'hex' : 'square';
}
// Default board shape when switching movement type
const DEFAULT_SHAPE = { square: 'standard', hex: 'beehive' };

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

const SOLVED_OPTS  = ['all', 'unsolved', 'solved', 'optimal'];
const SOLVED_LABEL = { all: 'All', unsolved: 'Unsolved', solved: 'Solved', optimal: 'Optimal' };
const STARRED_OPTS  = ['all', 'starred', 'unstarred'];
const STARRED_LABEL = { all: 'All', starred: 'Starred', unstarred: 'Unstarred' };

const noop = () => false;

export default function PuzzleNav({ allPuzzles, currentPuzzle, onSelect, onFilteredChange, blockedCells, variant, onVariantChange, scoreMode, hideOptimal, filterState, onFilterChange, isSolved = noop, isOptimal = noop, isStarred = noop, toggleStar = () => {}, getComment = () => '', setComment = null }) {
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
  const solvedFilter  = filterState?.solvedFilter  ?? 'all';
  const starredFilter = filterState?.starredFilter ?? 'all';

  const [page,          setPage]          = useState(0);
  const [jumpId,        setJumpId]        = useState('');
  const [collapsed,     setCollapsed]     = useState(false);

  const [editingCommentId, setEditingCommentId] = useState(null); // stableId of the row whose comment is being edited inline

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
      solvedFilter,
      starredFilter,
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
  function setSolvedFilter(v)  { updateFilter({ solvedFilter:  typeof v === 'function' ? v(solvedFilter)  : v }); }
  function setStarredFilter(v) { updateFilter({ starredFilter: typeof v === 'function' ? v(starredFilter) : v }); }

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
      solvedFilter: filterState.solvedFilter,
      starredFilter: filterState.starredFilter,
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
    unblocked.filter(p => {
      if (!activeHelpers.has(p.helpers)) return false;
      if (!activeExits.has(p.exits ?? 1)) return false;
      if (!activeDiffs.has(p.difficulty)) return false;
      if (p.minMoves < movesMin || p.minMoves > movesMax) return false;
      const solved  = isSolved(p.stableId);
      const optimal = isOptimal(p.stableId);
      if (solvedFilter === 'solved'   && !solved)  return false;
      if (solvedFilter === 'optimal'  && !optimal) return false;
      if (solvedFilter === 'unsolved' &&  solved)  return false;
      const starred = isStarred(p.stableId);
      if (starredFilter === 'starred'   && !starred) return false;
      if (starredFilter === 'unstarred' &&  starred) return false;
      return true;
    }),
    [unblocked, activeHelpers, activeExits, activeDiffs, movesMin, movesMax, solvedFilter, starredFilter, isSolved, isOptimal, isStarred]
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
          {/* ── Movement type + board shape ── */}
          <div className="pnav__filter-row">
            <span className="pnav__label">Board:</span>
            <select
              className="pnav__sort-select"
              title="Movement directions — Square (4-dir) or Hex (6-dir)"
              value={moveTypeOf(variant)}
              onChange={e => onVariantChange(DEFAULT_SHAPE[e.target.value])}
            >
              {MOVE_TYPES.map(v => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
            <select
              className="pnav__sort-select"
              title="Board shape — which cells are playable"
              value={variant}
              onChange={e => onVariantChange(e.target.value)}
            >
              {BOARD_SHAPES[moveTypeOf(variant)].map(v => (
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
              <span className="pnav__label">Solved:</span>
              {SOLVED_OPTS.map(opt => (
                <button
                  key={opt}
                  className={`pnav__chip${solvedFilter === opt ? ' pnav__chip--on' : ''}`}
                  title="Filter by your solve progress"
                  onClick={() => { setSolvedFilter(opt); setPage(0); }}
                >{SOLVED_LABEL[opt]}</button>
              ))}
            </div>
            <div className="pnav__filter-row">
              <span className="pnav__label">Starred:</span>
              {STARRED_OPTS.map(opt => (
                <button
                  key={opt}
                  className={`pnav__chip${starredFilter === opt ? ' pnav__chip--on' : ''}`}
                  title="Filter by starred status"
                  onClick={() => { setStarredFilter(opt); setPage(0); }}
                >{STARRED_LABEL[opt]}</button>
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

            {/* ── Moves range (two number inputs) ── */}
            <div className="pnav__filter-row">
              <span className="pnav__label">Moves:</span>
              <input
                type="number"
                className="pnav__range-input"
                min={movesRange.min}
                max={movesMax}
                value={movesMin}
                onChange={e => {
                  const v = +e.target.value;
                  if (!Number.isNaN(v)) { setMovesMin(Math.max(movesRange.min, Math.min(v, movesMax))); setPage(0); }
                }}
                aria-label="Minimum moves"
              />
              <span className="pnav__range-dash">–</span>
              <input
                type="number"
                className="pnav__range-input"
                min={movesMin}
                max={movesRange.max}
                value={movesMax}
                onChange={e => {
                  const v = +e.target.value;
                  if (!Number.isNaN(v)) { setMovesMax(Math.min(movesRange.max, Math.max(v, movesMin))); setPage(0); }
                }}
                aria-label="Maximum moves"
              />
              <span className="pnav__range-hint">of {movesRange.max}</span>
            </div>
          </div>

          {/* ── Sort ── */}
          <div className="pnav__filter-row pnav__sort-row">
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
              <span className="pnav__item-star" title="Starred">★</span>
              <span className="pnav__item-edit" aria-hidden="true">&nbsp;</span>
              <span className="pnav__item-solved" title="Solved status">✓</span>
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
              const starred = isStarred(p.stableId);
              const solved  = isSolved(p.stableId);
              const optimal = isOptimal(p.stableId);
              const solvedClass = optimal ? 'pnav__item-solved pnav__item-solved--optimal'
                                : solved  ? 'pnav__item-solved pnav__item-solved--on'
                                          : 'pnav__item-solved';
              const editing = editingCommentId === p.stableId;
              const comment = starred ? getComment(p.stableId) : '';
              return (
                <Fragment key={p.stableId}>
                <button
                  className={`pnav__item${active ? ' pnav__item--active' : ''}`}
                  onClick={() => onSelect(p)}
                  title={`${p.exits} exit${p.exits>1?'s':''}, ${p.helpers} helper${p.helpers>1?'s':''}, ${p.minMoves} moves${solved ? (optimal ? ' — solved optimally' : ' — solved') : ''}${starred ? ' — starred' : ''}${comment ? ` — “${comment}”` : ''}`}
                >
                  <span
                    className={`pnav__item-star${starred ? ' pnav__item-star--on' : ''}`}
                    role="button"
                    tabIndex={-1}
                    title={starred ? 'Unstar' : 'Star this puzzle'}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggleStar(p.stableId);
                      // If we're unstarring the row currently being edited, close the editor.
                      if (starred && editingCommentId === p.stableId) setEditingCommentId(null);
                    }}
                  >{starred ? '★' : '☆'}</span>
                  {setComment ? (
                    starred ? (
                      <span
                        className={`pnav__item-edit${comment ? ' pnav__item-edit--has' : ''}${editing ? ' pnav__item-edit--on' : ''}`}
                        role="button"
                        tabIndex={-1}
                        title={editing ? 'Close note' : (comment ? `Edit note: ${comment}` : 'Add a note')}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setEditingCommentId(editing ? null : p.stableId);
                        }}
                      >✎</span>
                    ) : (
                      <span className="pnav__item-edit" aria-hidden="true">&nbsp;</span>
                    )
                  ) : null}
                  <span className={solvedClass} title={optimal ? 'Solved optimally' : (solved ? 'Solved' : '')}>
                    {optimal ? <GoldMedal /> : (solved ? '✓' : '')}
                  </span>
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
                {editing && starred && setComment && (
                  <div className="pnav__item-comment-edit">
                    <textarea
                      className="pnav__item-comment-textarea"
                      placeholder="Notes about this puzzle…"
                      value={comment}
                      autoFocus
                      rows={2}
                      onChange={(ev) => setComment(p.stableId, ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Escape') { ev.preventDefault(); setEditingCommentId(null); }
                      }}
                    />
                    <button
                      type="button"
                      className="pnav__item-comment-done"
                      onClick={() => setEditingCommentId(null)}
                    >Done</button>
                  </div>
                )}
                </Fragment>
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
