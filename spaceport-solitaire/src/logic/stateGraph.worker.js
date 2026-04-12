// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// Web Worker that builds the forward state graph and computes per-state
// metrics off the main thread. Heavy puzzles (~500K states) take 2-6s
// in cold JS, so running it on the main thread would freeze the UI.
//
// Protocol:
//   main →   { puzzle, blockedCells: Array<string>, board, maxStates }
//   worker → { ok: true, solutionPath: [...per-step metric records...], numStates, numEdges, ms }
//   worker → { ok: false, reason: 'too_large' | 'error', message?: string }
//
// We only return the per-step metrics for the puzzle's optimal solution
// path, not the full per-state arrays. The HUD only needs to display
// metrics at each playback step, so this is all the data the UI consumes.
// Avoids posting hundreds of KB of typed arrays back across the worker
// boundary for every puzzle.

import { buildStateGraph, computeMetrics, computeSolutionPathMetrics } from './stateGraph.js';

self.onmessage = (e) => {
  const { puzzle, blockedCells: blockedArr, board, maxStates } = e.data;
  const blockedCells = new Set(blockedArr || []);
  const t0 = performance.now();
  try {
    const graph = buildStateGraph(puzzle, blockedCells, board, { maxStates });
    if (!graph) {
      self.postMessage({ ok: false, reason: 'too_large' });
      return;
    }
    const metrics = computeMetrics(graph);
    const solutionPath = computeSolutionPathMetrics(graph, metrics, puzzle, blockedCells, board);
    const ms = performance.now() - t0;
    self.postMessage({
      ok: true,
      solutionPath,
      numStates: graph.numStates,
      numEdges: graph.numEdges,
      ms,
    });
  } catch (err) {
    self.postMessage({ ok: false, reason: 'error', message: String(err && err.message || err) });
  }
};
