// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { reducer } from './useGameState.js';

// Minimal puzzle shaped enough for buildInitial via LOAD_PUZZLE.
const puzzle = {
  id: 1,
  robots: [
    { id: 'target', row: 1, col: 1, isExit: true },
    { id: 'r1',     row: 3, col: 5, isExit: false },
    { id: 'r2',     row: 5, col: 2, isExit: false },
  ],
};

function freshState() {
  return reducer(undefined, { type: 'LOAD_PUZZLE', puzzle });
}

describe('hover state machine (Option A: hover-when-idle)', () => {
  it('initial state has no selection and no hover', () => {
    const s = freshState();
    expect(s.selectedRobotId).toBeNull();
    expect(s.hoveredRobotId).toBeNull();
  });

  it('HOVER_ROBOT sets hoveredRobotId when nothing is selected', () => {
    const s = reducer(freshState(), { type: 'HOVER_ROBOT', robotId: 'r1' });
    expect(s.hoveredRobotId).toBe('r1');
    expect(s.selectedRobotId).toBeNull();
  });

  it('HOVER_ROBOT is a no-op when a robot is already selected', () => {
    const selected = reducer(freshState(), { type: 'SELECT_ROBOT', robotId: 'r1' });
    const after = reducer(selected, { type: 'HOVER_ROBOT', robotId: 'r2' });
    expect(after).toBe(selected);
    expect(after.hoveredRobotId).toBeNull();
    expect(after.selectedRobotId).toBe('r1');
  });

  it('SELECT_ROBOT clears any pending hover', () => {
    const hovered  = reducer(freshState(), { type: 'HOVER_ROBOT', robotId: 'r1' });
    const selected = reducer(hovered,      { type: 'SELECT_ROBOT', robotId: 'r2' });
    expect(selected.selectedRobotId).toBe('r2');
    expect(selected.hoveredRobotId).toBeNull();
  });

  it('DESELECT clears both hover and selection', () => {
    let s = reducer(freshState(), { type: 'SELECT_ROBOT', robotId: 'r1' });
    s     = reducer(s,            { type: 'DESELECT' });
    expect(s.selectedRobotId).toBeNull();
    expect(s.hoveredRobotId).toBeNull();

    // After deselect, HOVER_ROBOT works again.
    s = reducer(s, { type: 'HOVER_ROBOT', robotId: 'r2' });
    expect(s.hoveredRobotId).toBe('r2');
  });

  it('UNHOVER clears hoveredRobotId', () => {
    let s = reducer(freshState(), { type: 'HOVER_ROBOT', robotId: 'r1' });
    s     = reducer(s,            { type: 'UNHOVER' });
    expect(s.hoveredRobotId).toBeNull();
  });

  it('UNHOVER is a no-op when nothing is hovered (preserves identity)', () => {
    const s     = freshState();
    const after = reducer(s, { type: 'UNHOVER' });
    expect(after).toBe(s);
  });

  it('HOVER_ROBOT to the same robot preserves state identity', () => {
    const s     = reducer(freshState(), { type: 'HOVER_ROBOT', robotId: 'r1' });
    const again = reducer(s,            { type: 'HOVER_ROBOT', robotId: 'r1' });
    expect(again).toBe(s);
  });

  it('UNDO clears any pending hover', () => {
    // Build a history entry by selecting and "sliding" via direct dispatch is
    // complex — instead, confirm UNDO from a state containing hover does the
    // right thing on a state with manufactured history.
    const base = freshState();
    const withHistory = {
      ...base,
      history: [{ positions: base.positions, lastMoverId: null }],
      selectedRobotId: 'r1',
      hoveredRobotId: 'r2',
      moveCount: 1,
      slideCount: 1,
    };
    const after = reducer(withHistory, { type: 'UNDO' });
    expect(after.selectedRobotId).toBeNull();
    expect(after.hoveredRobotId).toBeNull();
  });

  it('LOAD_PUZZLE resets hover', () => {
    let s = reducer(freshState(), { type: 'HOVER_ROBOT', robotId: 'r1' });
    s     = reducer(s,            { type: 'LOAD_PUZZLE', puzzle });
    expect(s.hoveredRobotId).toBeNull();
  });
});
