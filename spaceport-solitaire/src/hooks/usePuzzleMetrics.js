// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, useRef } from 'react';

/**
 * Spawn a worker that builds the forward state graph and computes per-state
 * metrics for the given puzzle. Worker is recreated whenever puzzle/variant
 * changes; the previous worker is terminated.
 *
 * Returns:
 *   { status: 'idle' | 'computing' | 'ready' | 'too_large' | 'error',
 *     metrics, startIdx, numStates, ms }
 */
export function usePuzzleMetrics(puzzle, blockedCells, board, { maxStates = 600_000 } = {}) {
  const [state, setState] = useState({ status: 'idle', metrics: null });
  const workerRef = useRef(null);

  useEffect(() => {
    // Reset and tear down any in-flight worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (!puzzle || !puzzle.robots || puzzle.robots.length === 0) {
      setState({ status: 'idle', metrics: null });
      return;
    }
    setState({ status: 'computing', metrics: null });

    const worker = new Worker(new URL('../logic/stateGraph.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const data = e.data;
      if (data.ok) {
        setState({
          status: 'ready',
          metrics: data.metrics,
          startIdx: data.startIdx,
          numStates: data.numStates,
          numEdges: data.numEdges,
          ms: data.ms,
        });
      } else if (data.reason === 'too_large') {
        setState({ status: 'too_large', metrics: null });
      } else {
        setState({ status: 'error', metrics: null, error: data.message });
      }
    };
    worker.onerror = (err) => {
      setState({ status: 'error', metrics: null, error: err.message });
    };

    // Send only serializable data — convert blockedCells Set to array
    worker.postMessage({
      puzzle: {
        id: puzzle.id,
        robots: puzzle.robots,
        solution: puzzle.solution,
      },
      blockedCells: blockedCells ? [...blockedCells] : [],
      board,
      maxStates,
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [puzzle, blockedCells, board, maxStates]);

  return state;
}
