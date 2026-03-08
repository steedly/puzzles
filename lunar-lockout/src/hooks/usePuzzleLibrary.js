import { useState, useEffect } from 'react';

const DIR_MAP = { U: 'up', D: 'down', L: 'left', R: 'right' };

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

  if (parts.length === 6) {
    // New format: id|exits|helpers|minMoves|positions|solution
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

  return { id, exits: numExits, helpers, minMoves, difficulty, robots, solution, bbox, name: `#${id}` };
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

export function usePuzzleLibrary() {
  const [allPuzzles,      setAllPuzzles]      = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [needsFilePicker, setNeedsFilePicker] = useState(false);

  useEffect(() => {
    // Fast path: puzzle data embedded as raw text (legacy bundle mode).
    if (typeof window.__PUZZLES_LLP__ === 'string') {
      setAllPuzzles(parseText(window.__PUZZLES_LLP__));
      setLoading(false);
      return;
    }

    // Fast path: puzzle data embedded as gzip-compressed base64 (compact bundle mode).
    if (typeof window.__PUZZLES_GZ_B64__ === 'string') {
      decompressGzBase64(window.__PUZZLES_GZ_B64__)
        .then(text => {
          setAllPuzzles(parseText(text));
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
          setNeedsFilePicker(true);
        });
      return;
    }

    fetch('./puzzles.llp')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        setAllPuzzles(parseText(text));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setNeedsFilePicker(true);
      });
  }, []);

  function loadFile(file) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setNeedsFilePicker(false);
    const reader = new FileReader();
    reader.onload  = e => { setAllPuzzles(parseText(e.target.result)); setLoading(false); };
    reader.onerror = () => { setError('Could not read file'); setLoading(false); setNeedsFilePicker(true); };
    reader.readAsText(file);
  }

  return { allPuzzles, loading, error, needsFilePicker, loadFile };
}
