// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useRef } from 'react';

const DIR_MAP = { U: 'up', D: 'down', L: 'left', R: 'right' };

// Compute a stable, position-based puzzle ID.
// Encodes cell indices as digits in base-49, then converts to base-36.
// Prefixed with exit count and a dash: e.g. "1-174o0"
function computeStableId(numExits, positionsStr) {
  const cells = positionsStr.trim().split(' ').map(p => {
    const [r, c] = p.split(',').map(Number);
    return r * 7 + c;
  });
  let value = 0;
  for (const cell of cells) {
    value = value * 49 + cell;
  }
  return `${numExits}-${value.toString(36)}`;
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

function parseLine(line) {
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
  const solution = solTokens.map(mv => ({
    mover:   robotLabel(mv[0]),
    dir:     DIR_MAP[mv[1]],
    blocker: robotLabel(mv[2]),
  }));

  // Use stored minMoves if available (works even when solution is stripped);
  // fall back to computing from solution for backward compatibility.
  const minMoves = minMovesStr
    ? parseInt(minMovesStr, 10)
    : groupedMoveCount(solution);

  // Precompute bounding box for blocked-cell filtering
  let minR = 6, maxR = 0, minC = 6, maxC = 0;
  for (const r of robots) {
    if (r.row < minR) minR = r.row;
    if (r.row > maxR) maxR = r.row;
    if (r.col < minC) minC = r.col;
    if (r.col > maxC) maxC = r.col;
  }
  const bbox = { minR, maxR, minC, maxC };

  const stableId = computeStableId(numExits, posStr);

  const actualRawSlides = rawSlides ?? solution.length;

  return {
    id, stableId, exits: numExits, helpers, minMoves, difficulty, robots, solution, bbox,
    name: `#${id}`,
    rawSlides: actualRawSlides,
    minRawSlides: minRawSlides ?? null,
    forwardStates: forwardStates ?? null,
  };
}

function parseText(text) {
  return text
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(parseLine)
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
};

export function usePuzzleLibrary() {
  const [allPuzzles,      setAllPuzzles]      = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [needsFilePicker, setNeedsFilePicker] = useState(false);
  const [variant,         setVariant]         = useState('standard');
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
    loadVariantFile('standard');
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

  return { allPuzzles, loading, error, needsFilePicker, loadFile, variant, switchVariant, stableIdMap, pendingStableIdRef };
}
