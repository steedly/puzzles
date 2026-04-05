// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useRef } from 'react';

const SQUARE_DIR_MAP = { U: 'up', D: 'down', L: 'left', R: 'right' };
const HEX_DIR_MAP = { Nw: 'nw', Se: 'se', Sw: 'sw', Ne: 'ne', No: 'no', So: 'so' };

// Compute a stable, position-based puzzle ID.
// Encodes cell indices as digits in base-NC, then converts to base-36.
// Prefixed with exit count and a dash: e.g. "1-174o0"
// For hex5 (N=5), uses base-25; for all others (N=7), uses base-49.
export function computeStableId(numExits, positionsStr, boardN = 7) {
  const nc = boardN * boardN;
  const cells = positionsStr.trim().split(' ').map(p => {
    const [r, c] = p.split(',').map(Number);
    return r * boardN + c;
  });
  let value = 0;
  for (const cell of cells) {
    value = value * nc + cell;
  }
  // Prefix with 'h' for hex5 to avoid collisions with 7x7 IDs
  const prefix = boardN === 5 ? `h${numExits}` : `${numExits}`;
  return `${prefix}-${value.toString(36)}`;
}

// Reverse of computeStableId.
export function decodeStableId(stableId) {
  let boardN = 7;
  let rest = stableId;
  if (rest.startsWith('h')) {
    boardN = 5;
    rest = rest.slice(1);
  }
  const dash = rest.indexOf('-');
  if (dash < 0) return null;
  const numExits = parseInt(rest.slice(0, dash), 10);
  if (isNaN(numExits) || numExits < 1) return null;
  let value = parseInt(rest.slice(dash + 1), 36);
  if (isNaN(value) || value < 0) return null;
  const nc = boardN * boardN;
  const cells = [];
  while (value > 0) {
    cells.unshift(value % nc);
    value = Math.floor(value / nc);
  }
  return { numExits, positions: cells.map(c => [Math.floor(c / boardN), c % boardN]), boardN };
}

// Map solution move characters to robot IDs.
// A → 'target' (exit 0), B → 'exit1', C → 'exit2', D → 'exit3', …
// '1'-'9' → 'r1'-'r9' (helpers)
function robotLabel(ch) {
  if (ch >= 'A' && ch <= 'Z') {
    const idx = ch.charCodeAt(0) - 65; // A=0, B=1, C=2, …
    return idx === 0 ? 'target' : `exit${idx}`;
  }
  return `r${ch}`; // digits 1-9 for helpers
}

// Count grouped moves: consecutive slides by the same robot = 1 move.
function groupedMoveCount(solution) {
  let count = 0, lastMover = null;
  for (const { mover } of solution) {
    if (mover !== lastMover) { count++; lastMover = mover; }
  }
  return count;
}

function parseLine(line, boardN = 7) {
  const parts = line.split('|');

  let idStr, exitsStr, helpersStr, posStr, solStr;
  let numExits;

  let minMovesStr;
  let rawSlides = null, minRawSlides = null, forwardStates = null;

  if (parts.length === 9) {
    // Current format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
    [idStr, exitsStr, helpersStr, minMovesStr] = parts;
    rawSlides = parseInt(parts[4], 10);
    minRawSlides = parseInt(parts[5], 10);
    forwardStates = parseInt(parts[6], 10);
    posStr = parts[7];
    solStr = parts[8];
    numExits = parseInt(exitsStr, 10);
    if (isNaN(numExits)) return null;
  } else if (parts.length === 11) {
    // Old 11-field format (backward compat)
    [idStr, exitsStr, helpersStr, minMovesStr] = parts;
    rawSlides = parseInt(parts[4], 10);
    forwardStates = parseInt(parts[7], 10);
    posStr = parts[9];
    solStr = parts[10];
    numExits = parseInt(exitsStr, 10);
    if (isNaN(numExits)) return null;
  } else if (parts.length === 6) {
    // Legacy format: id|exits|helpers|minMoves|positions|solution
    [idStr, exitsStr, helpersStr, minMovesStr, posStr, solStr] = parts;
    numExits = parseInt(exitsStr, 10);
    if (isNaN(numExits)) return null;
  } else if (parts.length === 5) {
    // Could be old format: id|helpers|minMoves|positions|solution
    //         or stripped: id|exits|helpers|minMoves|positions
    // Distinguish: in old format parts[3] is positions (contains ',');
    // in stripped format parts[3] is minMoves (a plain integer).
    if (parts[3].includes(',')) {
      // Old format
      [idStr, helpersStr, minMovesStr, posStr, solStr] = parts;
      numExits = 1;
    } else {
      // Stripped new format (no solution)
      [idStr, exitsStr, helpersStr, minMovesStr, posStr] = parts;
      numExits = parseInt(exitsStr, 10);
      if (isNaN(numExits)) return null;
      solStr = '';
    }
  } else {
    return null;
  }

  const id      = parseInt(idStr, 10);
  const helpers = parseInt(helpersStr, 10);
  if (isNaN(id) || isNaN(helpers)) return null;

  // Parse positions: first numExits are exits, rest are helpers.
  const rawPositions = posStr.trim().split(' ');
  const robots = rawPositions.map((p, i) => {
    const [r, c] = p.split(',').map(Number);
    if (i < numExits) {
      const id = i === 0 ? 'target' : `exit${i}`;
      return { id, row: r, col: c, isExit: true };
    } else {
      const helperIdx = i - numExits + 1;
      return { id: `r${helperIdx}`, row: r, col: c, isExit: false };
    }
  });

  const difficulty =
    helpers <= 2 ? 'easy'   :
    helpers === 3 ? 'medium' :
    helpers === 4 ? 'hard'   : 'expert';

  const solTokens = solStr ? solStr.trim().split(' ').filter(Boolean) : [];
  const solution = solTokens.map(mv => {
    if (mv.length === 4) {
      // Hex format: mover(1) + dir(2) + blocker(1), e.g. "ANeB"
      return {
        mover:   robotLabel(mv[0]),
        dir:     HEX_DIR_MAP[mv.slice(1, 3)] || mv.slice(1, 3),
        blocker: robotLabel(mv[3]),
      };
    }
    // Square format: mover(1) + dir(1) + blocker(1), e.g. "AUB"
    return {
      mover:   robotLabel(mv[0]),
      dir:     SQUARE_DIR_MAP[mv[1]] || mv[1],
      blocker: robotLabel(mv[2]),
    };
  });

  // Use stored minMoves if available (works even when solution is stripped);
  // fall back to computing from solution for backward compatibility.
  const minMoves = minMovesStr
    ? parseInt(minMovesStr, 10)
    : groupedMoveCount(solution);

  // Precompute bounding box for blocked-cell filtering
  const maxIdx = boardN - 1;
  let minR = maxIdx, maxR = 0, minC = maxIdx, maxC = 0;
  for (const r of robots) {
    if (r.row < minR) minR = r.row;
    if (r.row > maxR) maxR = r.row;
    if (r.col < minC) minC = r.col;
    if (r.col > maxC) maxC = r.col;
  }
  const bbox = { minR, maxR, minC, maxC };

  const stableId = computeStableId(numExits, posStr, boardN);

  const actualRawSlides = rawSlides ?? solution.length;

  // Check which variant boards this puzzle fits on (no robot on a blocked cell).
  const fitsVariant = (blockedTest) => robots.every(r => !blockedTest(r.row, r.col));
  const fitsSolitaire = fitsVariant((r, c) => (r <= 1 || r >= 5) && (c <= 1 || c >= 5));
  const fitsUfo       = fitsVariant((r, c) => r === 0 || r === 6 || c === 0 || c === 6);
  const fitsFrench    = fitsVariant((r, c) =>
    (r === 0 && c === 0) || (r === 0 && c === 1) || (r === 1 && c === 0) ||
    (r === 0 && c === 5) || (r === 0 && c === 6) || (r === 1 && c === 6) ||
    (r === 5 && c === 0) || (r === 6 && c === 0) || (r === 6 && c === 1) ||
    (r === 5 && c === 6) || (r === 6 && c === 5) || (r === 6 && c === 6));

  return {
    id, stableId, exits: numExits, helpers, minMoves, difficulty, robots, solution, bbox,
    name: `#${id}`,
    rawSlides: actualRawSlides,
    minRawSlides: minRawSlides ?? null,
    forwardStates: forwardStates ?? null,
    fitsSolitaire, fitsUfo, fitsFrench,
  };
}

function parseText(text) {
  const lines = text.split('\n');
  // Detect board size from header
  let boardN = 7;
  for (const l of lines) {
    if (l.startsWith('# Variant: hex')) { boardN = 5; break; }
    if (l.startsWith('# Variant: beehive')) { boardN = 7; break; }
    if (!l.startsWith('#')) break;
  }
  return lines
    .filter(l => l && !l.startsWith('#'))
    .map(l => parseLine(l, boardN))
    .filter(Boolean);
}

// Decompress a gzip-compressed base64 string using the browser's DecompressionStream API.
async function decompressGzBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Response(ds.readable).text();
}

// Variant file names (relative to public/)
const VARIANT_FILES = {
  standard:  'puzzles.llp',
  solitaire: 'puzzles-solitaire.llp',
  ufo:       'puzzles-ufo.llp',
  french:    'puzzles-french.llp',
  hex:       'puzzles-hex.llp',
  beehive:   'puzzles-beehive.llp',
};

export function usePuzzleLibrary(initialVariant = 'standard') {
  const [allPuzzles,      setAllPuzzles]      = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [needsFilePicker, setNeedsFilePicker] = useState(false);
  const [variant,         setVariant]         = useState(initialVariant);
  const [stableIdMap,     setStableIdMap]     = useState(new Map());

  // Cache parsed puzzles per variant to avoid re-fetching/re-parsing
  const cacheRef = useRef({});
  const pendingStableIdRef = useRef(null);

  // Load a puzzle file (fetch or from cache)
  const loadVariantFile = useCallback(async (v) => {
    // Check cache first
    if (cacheRef.current[v]) {
      setAllPuzzles(cacheRef.current[v]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Check for embedded data (bundle mode) — only for standard
    if (v === 'standard') {
      if (typeof window.__PUZZLES_LLP__ === 'string') {
        const puzzles = parseText(window.__PUZZLES_LLP__);
        cacheRef.current[v] = puzzles;
        setAllPuzzles(puzzles);
        setLoading(false);
        return;
      }
      if (typeof window.__PUZZLES_GZ_B64__ === 'string') {
        try {
          const text = await decompressGzBase64(window.__PUZZLES_GZ_B64__);
          const puzzles = parseText(text);
          cacheRef.current[v] = puzzles;
          setAllPuzzles(puzzles);
          setLoading(false);
          return;
        } catch {
          // fall through to fetch
        }
      }
    }

    try {
      const filename = VARIANT_FILES[v] || VARIANT_FILES.standard;
      const r = await fetch(`./${filename}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const puzzles = parseText(text);
      cacheRef.current[v] = puzzles;
      setAllPuzzles(puzzles);
      setLoading(false);
    } catch {
      setLoading(false);
      if (v === 'standard') {
        setNeedsFilePicker(true);
      } else {
        setError(`Could not load ${v} puzzles`);
      }
    }
  }, []);

  // Build stableIdMap whenever allPuzzles changes
  useEffect(() => {
    const map = new Map();
    for (const p of allPuzzles) {
      map.set(p.stableId, p);
    }
    setStableIdMap(map);
  }, [allPuzzles]);

  // Initial load
  useEffect(() => {
    loadVariantFile(initialVariant);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVariantFile]);

  // Switch variant; caller can pass a stableId to try to preserve across the switch
  const switchVariant = useCallback((v, pendingStableId) => {
    if (v === variant) return;
    pendingStableIdRef.current = pendingStableId || null;
    setVariant(v);
    loadVariantFile(v);
  }, [variant, loadVariantFile]);

  function loadFile(file) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setNeedsFilePicker(false);
    const reader = new FileReader();
    reader.onload  = e => {
      const puzzles = parseText(e.target.result);
      cacheRef.current.standard = puzzles;
      setAllPuzzles(puzzles);
      setLoading(false);
    };
    reader.onerror = () => { setError('Could not read file'); setLoading(false); setNeedsFilePicker(true); };
    reader.readAsText(file);
  }

  // Find a puzzle by decoded positions (forward-compatibility fallback).
  // Searches for a puzzle with the same set of robot positions and exit count.
  const findByPositions = useCallback((numExits, positions, boardN = 7) => {
    if (!positions || positions.length === 0) return null;
    const posKey = positions.map(([r, c]) => `${r},${c}`).join(' ');
    // Recompute what the stableId would be for these positions
    const newStableId = computeStableId(numExits, posKey, boardN);
    const exact = stableIdMap.get(newStableId);
    if (exact) return exact;
    // Fallback: linear search by matching position sets
    const posSet = new Set(positions.map(([r, c]) => r * boardN + c));
    return allPuzzles.find(p =>
      p.exits === numExits &&
      p.robots.length === positions.length &&
      p.robots.every(r => posSet.has(r.row * boardN + r.col))
    ) || null;
  }, [allPuzzles, stableIdMap]);

  return { allPuzzles, loading, error, needsFilePicker, loadFile, variant, switchVariant, stableIdMap, pendingStableIdRef, findByPositions };
}
