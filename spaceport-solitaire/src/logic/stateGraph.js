// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Forward reachability graph + per-state difficulty metrics.
 *
 * - buildStateGraph(puzzle, blockedCells, board, opts) → graph | null
 * - computeMetrics(graph) → { reachableCount, solvable, minSlidesToGoal, minMovesToGoal }
 * - queryByPositions(graph, metrics, positions) → { ... } | null
 *
 * State encoding: each robot's position is packed into 6 bits
 * (cell 0..48, plus sentinel 49 for "exited"). With ≤8 robots the entire
 * augmented state fits in a JS Number (≤48 bits, well under 53-bit safe).
 * Exit positions occupy fixed slots (in puzzle.robots order) so an
 * exited robot is encoded as 49. Helper positions are sorted ascending
 * before packing so equivalent permutations collapse to one key.
 */

import { initPositions, isWon } from './gameEngine.js';
import { slideWithBlocker } from './solver.js';

const EXITED = 49;       // sentinel position for an exit that has reached center
const BITS_PER_ROBOT = 6;

function packState(positions, exitOrder, helperOrder) {
  let key = 0;
  // Exits in fixed order
  for (const id of exitOrder) {
    const p = positions[id];
    const cell = p ? p.row * 7 + p.col : EXITED;
    key = key * 50 + cell;
  }
  // Helpers sorted by cell index for permutation invariance
  const hCells = [];
  for (const id of helperOrder) {
    const p = positions[id];
    if (p) hCells.push(p.row * 7 + p.col);
  }
  hCells.sort((a, b) => a - b);
  for (const cell of hCells) {
    key = key * 50 + cell;
  }
  return key;
}

/**
 * Forward BFS from puzzle start, building a CSR-format adjacency graph.
 * Returns null if |V| would exceed maxStates.
 */
export function buildStateGraph(puzzle, blockedCells, board, { maxStates = 600_000 } = {}) {
  const startPositions = initPositions(puzzle);
  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));
  const exitOrder   = puzzle.robots.filter(r =>  r.isExit).map(r => r.id);
  const helperOrder = puzzle.robots.filter(r => !r.isExit).map(r => r.id);
  const robotIds = puzzle.robots.map(r => r.id);
  const numRobots = robotIds.length;
  const numDirs = board.dirs.length;

  // Sanity: packed key must fit in a Number. With base-50, 9 robots = 50^9 ≈ 2e15
  // (under 2^53 ≈ 9e15). Bail out for anything larger.
  if (numRobots > 9) return null;

  const indexOf = new Map();        // packed key → state index
  const positionsByIdx = [];        // index → positions object
  const packedKeys = [];            // index → packed key
  const goalIndices = [];

  // Adjacency built as flat arrays during BFS
  const edgeFrom   = []; // length = total edges
  const edgeTo     = [];
  const edgeMover  = []; // robot index 0..R-1
  const edgeDir    = []; // direction index 0..D-1

  // Map robot id → index for compact mover encoding
  const robotIdx = new Map();
  for (let i = 0; i < robotIds.length; i++) robotIdx.set(robotIds[i], i);

  // Seed BFS with start state
  const startKey = packState(startPositions, exitOrder, helperOrder);
  indexOf.set(startKey, 0);
  positionsByIdx.push(startPositions);
  packedKeys.push(startKey);
  if (isWon(startPositions, exitIds)) goalIndices.push(0);

  // BFS queue (just an array of indices)
  let head = 0;
  const queue = [0];

  while (head < queue.length) {
    const fromIdx = queue[head++];
    const fromPos = positionsByIdx[fromIdx];

    for (const rid of robotIds) {
      if (!fromPos[rid]) continue;
      for (let d = 0; d < numDirs; d++) {
        const result = slideWithBlocker(fromPos, rid, d, exitIds, blockedCells, board);
        if (!result) continue;
        const childPos = result.newPositions;
        const childKey = packState(childPos, exitOrder, helperOrder);

        let childIdx = indexOf.get(childKey);
        if (childIdx === undefined) {
          childIdx = positionsByIdx.length;
          if (childIdx >= maxStates) return null;
          indexOf.set(childKey, childIdx);
          positionsByIdx.push(childPos);
          packedKeys.push(childKey);
          if (isWon(childPos, exitIds)) goalIndices.push(childIdx);
          queue.push(childIdx);
        }

        edgeFrom.push(fromIdx);
        edgeTo.push(childIdx);
        edgeMover.push(robotIdx.get(rid));
        edgeDir.push(d);
      }
    }
  }

  const numStates = positionsByIdx.length;
  const numEdges = edgeFrom.length;

  // Convert edges to CSR format (sorted by from-index)
  // Compact and cache-friendly for the metric passes.
  const edgeOffsets = new Int32Array(numStates + 1);
  for (let i = 0; i < numEdges; i++) edgeOffsets[edgeFrom[i] + 1]++;
  for (let i = 1; i <= numStates; i++) edgeOffsets[i] += edgeOffsets[i - 1];

  const edgeTargets = new Int32Array(numEdges);
  const edgeMoverArr = new Uint8Array(numEdges);
  const edgeDirArr   = new Uint8Array(numEdges);
  const cursor = new Int32Array(numStates);
  for (let i = 0; i < numEdges; i++) {
    const from = edgeFrom[i];
    const slot = edgeOffsets[from] + cursor[from]++;
    edgeTargets[slot]  = edgeTo[i];
    edgeMoverArr[slot] = edgeMover[i];
    edgeDirArr[slot]   = edgeDir[i];
  }

  return {
    numStates,
    numEdges,
    numRobots,
    packedStart: startKey,
    packedKeys,                // Array<number>, length numStates
    indexOf,                   // Map<number, number>
    positionsByIdx,            // Array<positions>, length numStates
    edgeOffsets,               // Int32Array length numStates+1
    edgeTargets,               // Int32Array length numEdges
    edgeMover: edgeMoverArr,   // Uint8Array length numEdges
    edgeDir:   edgeDirArr,     // Uint8Array length numEdges
    goalIndices: Int32Array.from(goalIndices),
    exitOrder,
    helperOrder,
  };
}

/**
 * Build the transposed (predecessor) CSR adjacency from a forward graph.
 */
function buildTranspose(graph) {
  const { numStates, numEdges, edgeOffsets, edgeTargets } = graph;
  const inDegree = new Int32Array(numStates);
  for (let i = 0; i < numEdges; i++) inDegree[edgeTargets[i]]++;

  const tOffsets = new Int32Array(numStates + 1);
  for (let i = 0; i < numStates; i++) tOffsets[i + 1] = tOffsets[i] + inDegree[i];

  const tTargets = new Int32Array(numEdges);
  const cursor = new Int32Array(numStates);
  for (let from = 0; from < numStates; from++) {
    const start = edgeOffsets[from];
    const end = edgeOffsets[from + 1];
    for (let e = start; e < end; e++) {
      const to = edgeTargets[e];
      const slot = tOffsets[to] + cursor[to]++;
      tTargets[slot] = from;
    }
  }
  return { tOffsets, tTargets };
}

/**
 * Compute per-state difficulty metrics.
 */
export function computeMetrics(graph) {
  const { numStates, numEdges, numRobots, edgeOffsets, edgeTargets, edgeMover, goalIndices } = graph;

  const minSlidesToGoal = new Int32Array(numStates).fill(-1);
  const solvable        = new Uint8Array(numStates);
  const reachableCount  = new Int32Array(numStates);
  const minMovesToGoal  = new Int32Array(numStates).fill(-1);

  // ── Pass 1: minSlidesToGoal + solvable via reverse BFS from goals ──
  const { tOffsets, tTargets } = buildTranspose(graph);
  const bfsQueue = new Int32Array(numStates);
  let qHead = 0, qTail = 0;
  for (let i = 0; i < goalIndices.length; i++) {
    const g = goalIndices[i];
    minSlidesToGoal[g] = 0;
    solvable[g] = 1;
    bfsQueue[qTail++] = g;
  }
  while (qHead < qTail) {
    const cur = bfsQueue[qHead++];
    const dist = minSlidesToGoal[cur];
    const ps = tOffsets[cur], pe = tOffsets[cur + 1];
    for (let p = ps; p < pe; p++) {
      const pred = tTargets[p];
      if (minSlidesToGoal[pred] === -1) {
        minSlidesToGoal[pred] = dist + 1;
        solvable[pred] = 1;
        bfsQueue[qTail++] = pred;
      }
    }
  }

  // ── Pass 2: reachableCount via DFS topological reverse-DP ──
  // Slides aren't reversible; cycles are rare but possible. We use an
  // iterative DFS that finishes nodes in post-order, then sum children.
  // For correctness in the presence of cycles we use SCC-aware counting:
  // since this is rare we just do BFS from each node (small constant).
  // For efficiency on the common DAG case we use post-order memoization
  // with cycle detection.
  //
  // Simpler & always-correct approach: forward BFS from each state.
  // For typical graphs (V < 600k) and given we only care about reachability
  // counts from O(steps) states (the solution path), we compute reachableCount
  // lazily. But the metric is asked for arbitrary states, so precompute it.
  //
  // We use the iterative-DFS post-order approach with a "visited bitmap"
  // descendant set per node — bounded by the size of the reachable set
  // from that node. Worst case O(V*V) but in practice much smaller.
  //
  // For correctness with cycles, use SCC + DAG DP. Since slides are mostly
  // not reversible, cycles are rare; we detect via Tarjan and collapse.
  reachableCountViaSCC(graph, reachableCount);

  // ── Pass 3: minMovesToGoal via 0-1 BFS on augmented state ──
  //
  // Augmented state: (stateIdx, lastMover) where lastMover ∈ [0..numRobots].
  // numRobots is the sentinel "no previous mover" (used at game start).
  //
  // augDist[(S, L)] = minimum grouped-moves remaining to reach goal,
  // assuming that the previous slide's mover was L. The first slide we
  // take from S costs 0 if L === slide's mover (continues same group),
  // else 1 (new group starts).
  //
  // Forward recurrence:
  //   augDist[(S, L)] = 0                                   if S is goal
  //                   = min over outgoing edges (S → S', mover X) of
  //                        cost(L, X) + augDist[(S', X)]
  //
  // Backward BFS: seed every (goal, L) with 0. Walk transposed edges,
  // relaxing predecessors. When relaxing pred via edge (pred → S, mover X)
  // we only consider arrivals where S's lastMover IS X (because the edge
  // is what set lastMover to X). So we only process aug entries where
  // curLastMover === X. This means the goal seeds with L != sentinel only
  // matter when an outgoing edge from some pred has mover === L.
  const augSize = numStates * (numRobots + 1);
  const augDist = new Int32Array(augSize).fill(-1);

  // Build transposed adjacency including mover index per edge.
  const tOffsetsM = new Int32Array(numStates + 1);
  const inDeg = new Int32Array(numStates);
  for (let i = 0; i < numEdges; i++) inDeg[edgeTargets[i]]++;
  for (let i = 0; i < numStates; i++) tOffsetsM[i + 1] = tOffsetsM[i] + inDeg[i];
  const tFromM  = new Int32Array(numEdges);
  const tMoverM = new Uint8Array(numEdges);
  const cursor2 = new Int32Array(numStates);
  for (let from = 0; from < numStates; from++) {
    const s = edgeOffsets[from], e = edgeOffsets[from + 1];
    for (let i = s; i < e; i++) {
      const to = edgeTargets[i];
      const slot = tOffsetsM[to] + cursor2[to]++;
      tFromM[slot]  = from;
      tMoverM[slot] = edgeMover[i];
    }
  }

  // 0-1 BFS deque using two arrays
  const front = [];
  const back = [];
  // Seed every (goal, L) with distance 0 — at goal, any "remaining moves" is 0.
  for (let i = 0; i < goalIndices.length; i++) {
    for (let L = 0; L <= numRobots; L++) {
      const aug = goalIndices[i] * (numRobots + 1) + L;
      augDist[aug] = 0;
      front.push(aug);
    }
  }

  while (front.length > 0 || back.length > 0) {
    const aug = front.length > 0 ? front.pop() : back.shift();
    const dist = augDist[aug];
    const stateIdx = (aug / (numRobots + 1)) | 0;
    const curLastMover = aug - stateIdx * (numRobots + 1);
    const ps = tOffsetsM[stateIdx], pe = tOffsetsM[stateIdx + 1];
    for (let p = ps; p < pe; p++) {
      const predIdx = tFromM[p];
      const edgeMoverIdx = tMoverM[p];
      // This edge sets the "lastMover" of the destination state to edgeMoverIdx.
      // So only relax through aug entries where curLastMover === edgeMoverIdx.
      if (curLastMover !== edgeMoverIdx) continue;

      // Update augDist[(pred, predL)] for every possible predL.
      // From (pred, predL=edgeMoverIdx) we continue same group → cost 0.
      // From (pred, predL=anything else, including sentinel) → cost 1.
      for (let predLast = 0; predLast <= numRobots; predLast++) {
        const isCost0 = (predLast === edgeMoverIdx);
        const newDist = dist + (isCost0 ? 0 : 1);
        const augPred = predIdx * (numRobots + 1) + predLast;
        const cur = augDist[augPred];
        if (cur === -1 || newDist < cur) {
          augDist[augPred] = newDist;
          if (isCost0) front.push(augPred);
          else back.push(augPred);
        }
      }
    }
  }

  // For each state, the user-visible "min grouped moves remaining from cold
  // entry" = augDist[(s, sentinel)]. This is the value at game start and also
  // the worst-case for any state reachable via a different mover.
  for (let s = 0; s < numStates; s++) {
    minMovesToGoal[s] = augDist[s * (numRobots + 1) + numRobots];
  }

  return { reachableCount, solvable, minSlidesToGoal, minMovesToGoal, minMovesAug: augDist };
}

/**
 * Look up the per-(state, lastMover) min grouped moves. Use this when the
 * caller knows the actual lastMover from game state.
 *
 * @param {number} lastMoverIdx Robot index 0..R-1, or numRobots for sentinel.
 */
export function getMinMovesAug(graph, metrics, stateIdx, lastMoverIdx) {
  if (stateIdx < 0 || stateIdx >= graph.numStates) return -1;
  const idx = stateIdx * (graph.numRobots + 1) + lastMoverIdx;
  return metrics.minMovesAug[idx];
}

/**
 * Compute reachableCount[s] = number of states reachable from s (including s).
 * Uses Tarjan SCC + DAG-of-SCCs reverse topological DP.
 * Slides are not reversible so most SCCs are singletons.
 */
function reachableCountViaSCC(graph, reachableCount) {
  const { numStates, edgeOffsets, edgeTargets } = graph;

  // ── Tarjan's SCC (iterative) ──
  const index = new Int32Array(numStates).fill(-1);
  const lowlink = new Int32Array(numStates);
  const onStack = new Uint8Array(numStates);
  const stack = [];
  const sccId = new Int32Array(numStates).fill(-1);
  let nextIndex = 0;
  let nextScc = 0;

  // Iterative DFS to avoid stack overflow on large graphs.
  // dfsStack entries: { v, edgePtr }
  const dfsStack = [];
  for (let start = 0; start < numStates; start++) {
    if (index[start] !== -1) continue;
    dfsStack.push({ v: start, edgePtr: edgeOffsets[start] });
    index[start] = nextIndex;
    lowlink[start] = nextIndex;
    nextIndex++;
    stack.push(start);
    onStack[start] = 1;

    while (dfsStack.length > 0) {
      const top = dfsStack[dfsStack.length - 1];
      const v = top.v;
      const eEnd = edgeOffsets[v + 1];
      if (top.edgePtr < eEnd) {
        const w = edgeTargets[top.edgePtr++];
        if (index[w] === -1) {
          index[w] = nextIndex;
          lowlink[w] = nextIndex;
          nextIndex++;
          stack.push(w);
          onStack[w] = 1;
          dfsStack.push({ v: w, edgePtr: edgeOffsets[w] });
        } else if (onStack[w]) {
          if (index[w] < lowlink[v]) lowlink[v] = index[w];
        }
      } else {
        // Done with v
        if (lowlink[v] === index[v]) {
          // Pop SCC
          while (true) {
            const w = stack.pop();
            onStack[w] = 0;
            sccId[w] = nextScc;
            if (w === v) break;
          }
          nextScc++;
        }
        dfsStack.pop();
        if (dfsStack.length > 0) {
          const parent = dfsStack[dfsStack.length - 1].v;
          if (lowlink[v] < lowlink[parent]) lowlink[parent] = lowlink[v];
        }
      }
    }
  }

  // ── Group states by SCC, build SCC-DAG ──
  const numSccs = nextScc;
  const sccSize = new Int32Array(numSccs);
  for (let s = 0; s < numStates; s++) sccSize[sccId[s]]++;

  // SCC-DAG edges (deduped)
  const sccChildrenSet = new Array(numSccs);
  for (let i = 0; i < numSccs; i++) sccChildrenSet[i] = new Set();
  for (let s = 0; s < numStates; s++) {
    const fromScc = sccId[s];
    const eStart = edgeOffsets[s], eEnd = edgeOffsets[s + 1];
    for (let e = eStart; e < eEnd; e++) {
      const toScc = sccId[edgeTargets[e]];
      if (toScc !== fromScc) sccChildrenSet[fromScc].add(toScc);
    }
  }

  // Tarjan returns SCCs in reverse topological order: sccId 0 is the
  // first SCC popped (a "sink" of the DAG). So processing in increasing
  // sccId order gives us reverse topological order.
  // For each SCC, reachableCount = sccSize + sum over distinct child SCCs.
  //
  // Cleaner: do reverse-topological DP using inclusion-exclusion via
  // descendant sets. To avoid O(V^2) descendant sets, use the following
  // observation: when SCCs are mostly singletons and the DAG is shallow,
  // we can compute "number of distinct descendants" by union of child
  // descendant sets. We use Set<sccId> for this — bounded by total SCCs.
  //
  // For our use case (V ≤ 600K, mostly singletons), this is fine.
  const descendants = new Array(numSccs); // Set<sccId> (transitive descendants incl self)
  for (let s = 0; s < numSccs; s++) {
    const set = new Set();
    set.add(s);
    for (const child of sccChildrenSet[s]) {
      const childDesc = descendants[child];
      if (childDesc) {
        for (const d of childDesc) set.add(d);
      }
    }
    descendants[s] = set;
  }

  // reachableCount per state = sum of sizes of all SCCs in its descendant set
  for (let s = 0; s < numStates; s++) {
    const desc = descendants[sccId[s]];
    let total = 0;
    for (const d of desc) total += sccSize[d];
    reachableCount[s] = total;
  }
}

/**
 * Look up metrics for a runtime positions object.
 */
export function queryByPositions(graph, metrics, positions) {
  const key = packState(positions, graph.exitOrder, graph.helperOrder);
  const idx = graph.indexOf.get(key);
  if (idx === undefined) return null;
  return {
    stateIdx:        idx,
    reachableCount:  metrics.reachableCount[idx],
    solvable:        metrics.solvable[idx] === 1,
    minSlidesToGoal: metrics.minSlidesToGoal[idx],
    minMovesToGoal:  metrics.minMovesToGoal[idx],
  };
}
