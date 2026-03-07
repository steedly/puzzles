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

  if (parts.length === 6) {
    // New format: id|exits|helpers|minMoves|positions|solution
    [idStr, exitsStr, helpersStr, , posStr, solStr] = parts;
    numExits = parseInt(exitsStr, 10);
    if (isNaN(numExits)) return null;
  } else if (parts.length === 5) {
    // Old format (backward compat): id|helpers|minMoves|positions|solution
    [idStr, helpersStr, , posStr, solStr] = parts;
    numExits = 1;
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

  const solution = solStr.trim().split(' ').filter(Boolean).map(mv => ({
    mover:   robotLabel(mv[0]),
    dir:     DIR_MAP[mv[1]],
    blocker: robotLabel(mv[2]),
  }));

  const minMoves = groupedMoveCount(solution);

  return { id, exits: numExits, helpers, minMoves, difficulty, robots, solution, name: `#${id}` };
}

function parseText(text) {
  return text
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(parseLine)
    .filter(Boolean);
}

export function usePuzzleLibrary() {
  const [allPuzzles,      setAllPuzzles]      = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [needsFilePicker, setNeedsFilePicker] = useState(false);

  useEffect(() => {
    // Fast path: puzzle data embedded directly in the HTML (single-file bundle mode).
    if (typeof window.__PUZZLES_LLP__ === 'string') {
      setAllPuzzles(parseText(window.__PUZZLES_LLP__));
      setLoading(false);
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
