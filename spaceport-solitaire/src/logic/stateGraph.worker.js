// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// Web Worker that builds the forward state graph and computes per-state
// metrics off the main thread. Heavy puzzles (~500K states) take 2-6s
// in cold JS, so running it on the main thread would freeze the UI.
//
// Protocol:
//   main →   { puzzle, blockedCells: Array<string>, board, maxStates }
//   worker → { ok: true, metrics: { reachableCount, solvable, minSlidesToGoal, minMovesToGoal }, startIdx, numStates, numEdges, ms }
//   worker → { ok: false, reason: 'too_large' | 'error', message?: string }

import { buildStateGraph, computeMetrics } from './stateGraph.js';

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
    const ms = performance.now() - t0;
    // Transfer the typed-array buffers to avoid copying.
    const transfer = [
      metrics.reachableCount.buffer,
      metrics.solvable.buffer,
      metrics.minSlidesToGoal.buffer,
      metrics.minMovesToGoal.buffer,
    ];
    self.postMessage({
      ok: true,
      metrics: {
        reachableCount:  metrics.reachableCount,
        solvable:        metrics.solvable,
        minSlidesToGoal: metrics.minSlidesToGoal,
        minMovesToGoal:  metrics.minMovesToGoal,
      },
      startIdx: 0,
      numStates: graph.numStates,
      numEdges: graph.numEdges,
      ms,
    }, transfer);
  } catch (err) {
    self.postMessage({ ok: false, reason: 'error', message: String(err && err.message || err) });
  }
};
