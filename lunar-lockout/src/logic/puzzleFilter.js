const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];
const DIR_MAP = { up: 0, down: 1, left: 2, right: 3 };

/**
 * Check if a slide path passes through any blocked cell.
 * Replays one move: robot at (sr,sc) slides in direction until stopped.
 */
function slidePassesBlocked(sr, sc, dirIdx, blockedCells) {
  const dr = DR[dirIdx], dc = DC[dirIdx];
  let r = sr + dr, c = sc + dc;
  while (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
    if (blockedCells.has(`${r},${c}`)) return true;
    r += dr;
    c += dc;
  }
  return false;
}

/**
 * Check if the stored solution avoids all blocked cells.
 * Replays each move, checking if the slide path crosses a blocked cell.
 * Returns true if solution is clean (no conflicts).
 */
function solutionAvoidsCells(puzzle, blockedCells) {
  if (!puzzle.solution || puzzle.solution.length === 0) return false; // no solution to check

  // Build positions map
  const positions = {};
  for (const r of puzzle.robots) {
    positions[r.id] = { row: r.row, col: r.col };
  }

  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));

  for (const move of puzzle.solution) {
    const pos = positions[move.mover];
    if (!pos) continue; // already exited

    const dirIdx = DIR_MAP[move.dir];
    if (dirIdx === undefined) return false;

    // Check if slide path crosses a blocked cell
    if (slidePassesBlocked(pos.row, pos.col, dirIdx, blockedCells)) return false;

    // Replay the move to update positions
    const dr = DR[dirIdx], dc = DC[dirIdx];
    let r = pos.row + dr, c = pos.col + dc;
    let landR = pos.row, landC = pos.col;
    while (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
      // Check for collision with another robot
      let hit = false;
      for (const [id, p] of Object.entries(positions)) {
        if (id !== move.mover && p.row === r && p.col === c) { hit = true; break; }
      }
      if (hit) break;
      landR = r; landC = c;
      r += dr; c += dc;
    }

    if (exitIds.has(move.mover) && landR === 3 && landC === 3) {
      delete positions[move.mover];
    } else {
      positions[move.mover] = { row: landR, col: landC };
    }
  }

  return true; // solution is clean
}

/**
 * Filter puzzles based on blocked cells using a multi-tier pipeline.
 * Tier 1: Remove puzzles with a robot starting on a blocked cell.
 * Tier 2: Keep puzzles whose bounding box doesn't overlap any blocked cell.
 * Tier 3: Keep puzzles whose stored solution avoids blocked cells.
 * Puzzles that fail Tier 3 are conservatively removed.
 *
 * @returns {{ kept: Array, removed: number }}
 */
export function filterPuzzles(puzzles, blockedCells) {
  if (!blockedCells || blockedCells.size === 0) {
    return { kept: puzzles, removed: 0 };
  }

  const kept = [];
  let removed = 0;

  for (const puzzle of puzzles) {
    // Tier 1: position conflict
    let conflict = false;
    for (const r of puzzle.robots) {
      if (blockedCells.has(`${r.row},${r.col}`)) { conflict = true; break; }
    }
    if (conflict) { removed++; continue; }

    // Tier 2: bounding box check
    if (puzzle.bbox) {
      let overlaps = false;
      for (const cell of blockedCells) {
        const [cr, cc] = cell.split(',').map(Number);
        if (cr >= puzzle.bbox.minR && cr <= puzzle.bbox.maxR &&
            cc >= puzzle.bbox.minC && cc <= puzzle.bbox.maxC) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) { kept.push(puzzle); continue; }
    }

    // Tier 3: solution trace
    if (solutionAvoidsCells(puzzle, blockedCells)) {
      kept.push(puzzle);
    } else {
      removed++;
    }
  }

  return { kept, removed };
}
