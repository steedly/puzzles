// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { buildStateGraph, computeMetrics, queryByPositions } from './stateGraph.js';
import { SQUARE_7x7 } from './boardGeometry.js';

// Build a minimal puzzle object compatible with the rest of the engine.
function makePuzzle(robots) {
  return { id: 1, stableId: 'test', robots, solution: [] };
}

// Parse a single .llp line into a puzzle object — inline minimal version
// of usePuzzleLibrary.js parseLine for test independence.
function parseLlpLine(line) {
  const parts = line.split('|');
  // 9-field format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
  const [idStr, exitsStr, helpersStr, gmStr, rsStr, mrsStr, fsStr, posStr] = parts;
  const numExits = parseInt(exitsStr, 10);
  const helpers = parseInt(helpersStr, 10);
  const groupedMoves = parseInt(gmStr, 10);
  const rawSlides = parseInt(rsStr, 10);
  const minRawSlides = parseInt(mrsStr, 10);
  const forwardStates = parseInt(fsStr, 10);
  const rawPositions = posStr.trim().split(' ');
  const robots = rawPositions.map((p, i) => {
    const [r, c] = p.split(',').map(Number);
    if (i < numExits) {
      return { id: i === 0 ? 'target' : `exit${i}`, row: r, col: c, isExit: true };
    }
    return { id: `r${i - numExits + 1}`, row: r, col: c, isExit: false };
  });
  return {
    id: parseInt(idStr, 10),
    robots,
    minMoves: groupedMoves,
    rawSlides,
    minRawSlides,
    forwardStates,
    helpers,
    numExits,
  };
}

const EMPTY_BLOCKS = new Set();

describe('stateGraph: small puzzles', () => {
  it('1 exit + 1 helper, 1-move puzzle: target slides up to hit helper at center column', () => {
    // Target at (4,3); helper at (1,3). Sliding target up bounces it into (2,3) then (1,3) is blocked.
    // Wait — slideRobot bounces UNTIL hitting another robot, so target at (4,3) sliding up
    // stops at (2,3) (one cell below the helper at (1,3)). That's NOT center.
    // Use helper at (0,3) so target sliding up stops at (1,3). Still not center.
    // For target to land at center (3,3), we need a helper at (2,3) and slide target up
    // from (4,3). slideRobot would walk from (4,3) up, find blocker at (2,3), stop at (3,3) ✓
    const puzzle = makePuzzle([
      { id: 'target', row: 4, col: 3, isExit: true },
      { id: 'r1',     row: 2, col: 3, isExit: false },
    ]);
    const graph = buildStateGraph(puzzle, EMPTY_BLOCKS, SQUARE_7x7);
    expect(graph).not.toBeNull();
    expect(graph.numStates).toBeGreaterThan(0);

    const metrics = computeMetrics(graph);
    // Start state must be solvable in some positive number of slides
    expect(metrics.solvable[0]).toBe(1);
    expect(metrics.minSlidesToGoal[0]).toBeGreaterThan(0);
    expect(metrics.minMovesToGoal[0]).toBeGreaterThan(0);
    // The puzzle is reachable + has at least 1 reachable state (the start itself)
    expect(metrics.reachableCount[0]).toBeGreaterThanOrEqual(1);
  });

  it('returns null when maxStates exceeded', () => {
    const puzzle = makePuzzle([
      { id: 'target', row: 0, col: 0, isExit: true },
      { id: 'exit1',  row: 6, col: 6, isExit: true },
      { id: 'r1',     row: 2, col: 3, isExit: false },
      { id: 'r2',     row: 4, col: 3, isExit: false },
    ]);
    const graph = buildStateGraph(puzzle, EMPTY_BLOCKS, SQUARE_7x7, { maxStates: 1 });
    expect(graph).toBeNull();
  });

  it('queryByPositions matches the start state index', () => {
    const puzzle = makePuzzle([
      { id: 'target', row: 4, col: 3, isExit: true },
      { id: 'r1',     row: 2, col: 3, isExit: false },
    ]);
    const graph = buildStateGraph(puzzle, EMPTY_BLOCKS, SQUARE_7x7);
    const metrics = computeMetrics(graph);
    const startPositions = { target: { row: 4, col: 3 }, r1: { row: 2, col: 3 } };
    const q = queryByPositions(graph, metrics, startPositions);
    expect(q).not.toBeNull();
    expect(q.stateIdx).toBe(0);
    expect(q.solvable).toBe(true);
  });

  it('reachableCount monotonically non-increasing along the optimal path', () => {
    // Build a simple 1-exit, 1-helper puzzle (target slides up to center)
    const puzzle = makePuzzle([
      { id: 'target', row: 4, col: 3, isExit: true },
      { id: 'r1',     row: 2, col: 3, isExit: false },
    ]);
    const graph = buildStateGraph(puzzle, EMPTY_BLOCKS, SQUARE_7x7);
    const metrics = computeMetrics(graph);
    // For the start state, reachableCount must be ≥ for any neighbor (slides aren't reversible)
    // Walk one step from start and check.
    const eStart = graph.edgeOffsets[0];
    const eEnd   = graph.edgeOffsets[1];
    if (eEnd > eStart) {
      const startCount = metrics.reachableCount[0];
      for (let e = eStart; e < eEnd; e++) {
        const childIdx = graph.edgeTargets[e];
        // childCount can be ≤ startCount (some descendants of start may not be reachable from child)
        expect(metrics.reachableCount[childIdx]).toBeLessThanOrEqual(startCount);
      }
    }
  });

  it('start-state minSlides equals length of shortest forward path to goal', () => {
    const puzzle = makePuzzle([
      { id: 'target', row: 4, col: 3, isExit: true },
      { id: 'r1',     row: 2, col: 3, isExit: false },
    ]);
    const graph = buildStateGraph(puzzle, EMPTY_BLOCKS, SQUARE_7x7);
    const metrics = computeMetrics(graph);
    // For this trivial puzzle, the optimal is sliding target up — 1 slide
    expect(metrics.minSlidesToGoal[0]).toBe(1);
    expect(metrics.minMovesToGoal[0]).toBe(1);
  });
});

// ── Ground-truth validation against published .llp metrics ──
//
// The C++ ll-solver publishes forwardStates, groupedMoves, and minRawSlides
// for every puzzle. After buildStateGraph + computeMetrics on a puzzle, the
// startIdx values must match exactly. Any drift indicates a bug in the JS
// graph builder or metric computation.
describe('stateGraph: ground-truth validation against published .llp metrics', () => {
  // Sample puzzles spanning easy → medium difficulty.
  // Numbers are from public/puzzles.llp (spot-verified by hand).
  const SAMPLES = [
    // Easiest puzzle (1H, 1 move)
    '1|1|1|1|1|1|3|4,3 2,3|AU1',
    // 2-exit, 1-helper, 2 moves, 5 states
    '26810|2|1|2|2|2|5|4,3 5,3 2,3|AU1 BU1',
    // 3-exit, 1-helper, 3 moves, 7 states
    '63617|3|1|3|3|3|7|4,3 5,3 6,3 2,3|AU1 BU1 CU1',
    // 1-exit, 3-helper, 4 moves, 38 forward states
    '36|1|3|4|4|4|38|4,3 1,3 4,1 4,5|2RA AU1 3L2 AD3',
    // 1-exit, 3-helper, 4 moves, 16 forward states
    '37|1|3|4|4|4|16|4,4 1,2 2,5 4,2|AL3 3U1 2L3 AU2',
  ];

  for (const line of SAMPLES) {
    const p = parseLlpLine(line);
    it(`puzzle ${p.id} (${p.numExits}E ${p.helpers}H, ${p.minMoves}M): metrics match published values`, () => {
      const graph = buildStateGraph(p, EMPTY_BLOCKS, SQUARE_7x7);
      expect(graph, 'graph should build').not.toBeNull();
      const metrics = computeMetrics(graph);
      expect(metrics.reachableCount[0], 'forwardStates').toBe(p.forwardStates);
      expect(metrics.minSlidesToGoal[0], 'minRawSlides').toBe(p.minRawSlides);
      expect(metrics.minMovesToGoal[0], 'minMoves (grouped)').toBe(p.minMoves);
      expect(metrics.solvable[0], 'solvable').toBe(1);
    });
  }
});
