import { initPositions, isWon } from './gameEngine.js';

const DIR_NAMES = ['up', 'down', 'left', 'right'];
const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

/**
 * Slide robot `robotId` in direction `dirIdx` (0=up,1=down,2=left,3=right).
 * Returns { newPositions, landingRow, landingCol, blockerId } or null.
 * Unlike gameEngine's slideRobot, this also identifies the blocking robot.
 */
function slideWithBlocker(positions, robotId, dirIdx, exitIds, blockedCells) {
  const start = positions[robotId];
  if (!start) return null;

  const dr = DR[dirIdx], dc = DC[dirIdx];
  let row = start.row, col = start.col;

  // Build occupied cell map: "row,col" → robotId
  const cellToId = {};
  for (const [id, pos] of Object.entries(positions)) {
    if (id !== robotId) cellToId[`${pos.row},${pos.col}`] = id;
  }

  let blockerId = null;
  while (true) {
    const nr = row + dr, nc = col + dc;
    if (nr < 0 || nr > 6 || nc < 0 || nc > 6) break;
    if (blockedCells && blockedCells.has(`${nr},${nc}`)) break;
    const blocker = cellToId[`${nr},${nc}`];
    if (blocker !== undefined) { blockerId = blocker; break; }
    row = nr; col = nc;
  }

  if (blockerId === null) return null; // wall stop (illegal)
  if (row === start.row && col === start.col) return null; // didn't move

  // Build new positions
  const newPositions = { ...positions };
  if (exitIds.has(robotId) && row === 3 && col === 3) {
    delete newPositions[robotId]; // exit robot reached center
  } else {
    newPositions[robotId] = { row, col };
  }

  return { newPositions, blockerId };
}

/**
 * Canonical state key: exit positions in fixed ID order, then helper
 * positions sorted. Exited robots encoded as 'X'.
 */
function stateKey(positions, exitOrder, helperOrder) {
  const parts = [];
  for (const id of exitOrder) {
    const p = positions[id];
    parts.push(p ? `${p.row},${p.col}` : 'X');
  }
  const hParts = [];
  for (const id of helperOrder) {
    const p = positions[id];
    if (p) hParts.push(`${p.row},${p.col}`);
  }
  hParts.sort();
  parts.push(...hParts);
  return parts.join('|');
}

/**
 * Solve a puzzle, returning the solution with minimum grouped moves
 * (among all minimum raw-slide solutions).
 *
 * Uses forward BFS to find optimal depth D, then layer-by-layer DP
 * (identical approach to enumerate.cpp's trace_solution) to minimize
 * grouped moves.
 *
 * @param {Object} puzzle - Puzzle object with .robots and robot metadata
 * @returns {Array} Solution as [{mover, dir, blocker}, ...] or []
 */
export function solvePuzzle(puzzle, blockedCells) {
  const positions = initPositions(puzzle);
  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));
  const robotIds = puzzle.robots.map(r => r.id);

  // Fixed iteration order: exits first (in puzzle order), then helpers
  const exitOrder = puzzle.robots.filter(r => r.isExit).map(r => r.id);
  const helperOrder = puzzle.robots.filter(r => !r.isExit).map(r => r.id);

  if (isWon(positions, exitIds)) return [];

  const startKey = stateKey(positions, exitOrder, helperOrder);

  // ── Phase 1: Forward BFS to find optimal depth D ──
  const dist = new Map(); // stateKey → depth
  dist.set(startKey, 0);
  let frontier = [{ positions, key: startKey }];
  let goalDepth = -1;

  for (let depth = 0; frontier.length > 0; depth++) {
    if (goalDepth >= 0) break;
    const next = [];
    for (const { positions: pos } of frontier) {
      for (const rid of robotIds) {
        if (!pos[rid]) continue;
        for (let d = 0; d < 4; d++) {
          const result = slideWithBlocker(pos, rid, d, exitIds, blockedCells);
          if (!result) continue;
          const key = stateKey(result.newPositions, exitOrder, helperOrder);
          if (dist.has(key)) continue;
          dist.set(key, depth + 1);
          if (isWon(result.newPositions, exitIds)) {
            goalDepth = depth + 1;
          }
          next.push({ positions: result.newPositions, key });
        }
      }
    }
    frontier = next;
  }

  if (goalDepth < 0) return []; // unsolvable (shouldn't happen for valid puzzles)

  // ── Phase 2: Layer-by-layer DP to minimize grouped moves ──
  // Augmented state = (stateKey, lastMoverId)
  // Node: { positions, lastMover, groupedCost, prevIdx, move }

  const layers = Array.from({ length: goalDepth + 1 }, () => []);
  layers[0].push({
    positions,
    lastMover: null,
    groupedCost: 0,
    prevIdx: -1,
    move: null,
  });

  for (let step = 0; step < goalDepth; step++) {
    const nextMap = new Map(); // augKey → index in layers[step+1]
    const targetDist = step + 1;

    for (let i = 0; i < layers[step].length; i++) {
      const node = layers[step][i];

      for (const rid of robotIds) {
        if (!node.positions[rid]) continue;
        for (let d = 0; d < 4; d++) {
          const result = slideWithBlocker(node.positions, rid, d, exitIds, blockedCells);
          if (!result) continue;

          const key = stateKey(result.newPositions, exitOrder, helperOrder);
          const nodeDist = dist.get(key);
          if (nodeDist !== targetDist) continue;

          const cost = node.groupedCost + (rid === node.lastMover ? 0 : 1);
          const move = { mover: rid, dir: DIR_NAMES[d], blocker: result.blockerId };
          const augKey = key + '~' + rid;

          const existing = nextMap.get(augKey);
          if (existing === undefined) {
            nextMap.set(augKey, layers[step + 1].length);
            layers[step + 1].push({
              positions: result.newPositions,
              lastMover: rid,
              groupedCost: cost,
              prevIdx: i,
              move,
            });
          } else if (cost < layers[step + 1][existing].groupedCost) {
            layers[step + 1][existing] = {
              positions: result.newPositions,
              lastMover: rid,
              groupedCost: cost,
              prevIdx: i,
              move,
            };
          }
        }
      }
    }
  }

  // Find goal node with minimum grouped cost
  let bestIdx = -1, bestCost = Infinity;
  for (let i = 0; i < layers[goalDepth].length; i++) {
    const node = layers[goalDepth][i];
    if (isWon(node.positions, exitIds) && node.groupedCost < bestCost) {
      bestCost = node.groupedCost;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return [];

  // Backtrack to reconstruct solution
  const solution = [];
  let idx = bestIdx;
  for (let step = goalDepth; step > 0; step--) {
    solution.push(layers[step][idx].move);
    idx = layers[step][idx].prevIdx;
  }
  solution.reverse();

  return solution;
}
