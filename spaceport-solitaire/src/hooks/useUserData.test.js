// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEY, FORMAT_VERSION, readInitial, mergeUserData, applyConflictResolutions } from './useUserData.js';

const store = {};
const mockStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.window = { localStorage: mockStorage };
});

describe('useUserData backward compatibility', () => {

  it('STORAGE_KEY must never change (would orphan saved progress)', () => {
    expect(STORAGE_KEY).toBe('lunar-lockout/userdata');
  });

  it('returns empty state when localStorage is empty', () => {
    const data = readInitial();
    expect(data).toEqual({ version: FORMAT_VERSION, solved: {}, starred: {} });
  });

  it('reads v1 data with solved and starred entries', () => {
    const saved = {
      version: 1,
      solved: { '1-16o': { moves: 1, optimal: true } },
      starred: { '1-16o': { comment: 'easy one' } },
    };
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const data = readInitial();
    expect(data.solved['1-16o'].moves).toBe(1);
    expect(data.solved['1-16o'].optimal).toBe(true);
    expect(data.starred['1-16o'].comment).toBe('easy one');
  });

  it('preserves unknown future fields through a read round trip', () => {
    const saved = {
      version: 1,
      solved: { '1-16o': { moves: 1, optimal: true, futureField: 42 } },
      starred: {},
      newTopLevel: 'should survive',
    };
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const data = readInitial();
    expect(data.solved['1-16o'].futureField).toBe(42);
    expect(data.newTopLevel).toBe('should survive');
  });

  it('tolerates missing solved/starred fields', () => {
    mockStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    const data = readInitial();
    expect(data.solved).toEqual({});
    expect(data.starred).toEqual({});
  });

  it('tolerates null solved/starred fields', () => {
    mockStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, solved: null, starred: null }));
    const data = readInitial();
    expect(data.solved).toEqual({});
    expect(data.starred).toEqual({});
  });

  it('tolerates corrupt JSON gracefully', () => {
    mockStorage.setItem(STORAGE_KEY, '{not valid json!!!');
    const data = readInitial();
    expect(data).toEqual({ version: FORMAT_VERSION, solved: {}, starred: {} });
  });

  it('upgrades version field to current FORMAT_VERSION', () => {
    mockStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 0, solved: {}, starred: {} }));
    const data = readInitial();
    expect(data.version).toBe(FORMAT_VERSION);
  });

  it('handles data with starred entries that have no comment', () => {
    const saved = {
      version: 1,
      solved: {},
      starred: { '2-abc': {} },
    };
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const data = readInitial();
    expect(data.starred['2-abc']).toBeTruthy();
  });
});

describe('mergeUserData: import merge semantics', () => {
  it('empty + empty = empty', () => {
    const { merged, conflicts } = mergeUserData(
      { version: 1, solved: {}, starred: {} },
      { version: 1, solved: {}, starred: {} }
    );
    expect(merged.solved).toEqual({});
    expect(merged.starred).toEqual({});
    expect(conflicts).toEqual([]);
  });

  it('solved: imported entries are added to current (union)', () => {
    const current  = { version: 1, solved: { '1-a': { moves: 5, optimal: false } }, starred: {} };
    const imported = { version: 1, solved: { '1-b': { moves: 3, optimal: true  } }, starred: {} };
    const { merged } = mergeUserData(current, imported);
    expect(merged.solved['1-a']).toEqual({ moves: 5, optimal: false });
    expect(merged.solved['1-b']).toEqual({ moves: 3, optimal: true });
  });

  it('solved: conflicting moves → keep the lower one', () => {
    const current  = { solved: { '1-a': { moves: 8, optimal: false } } };
    const imported = { solved: { '1-a': { moves: 5, optimal: false } } };
    const { merged } = mergeUserData(current, imported);
    expect(merged.solved['1-a'].moves).toBe(5);
  });

  it('solved: optimal flag is OR-ed across sides', () => {
    const current  = { solved: { '1-a': { moves: 5, optimal: false } } };
    const imported = { solved: { '1-a': { moves: 5, optimal: true  } } };
    const { merged } = mergeUserData(current, imported);
    expect(merged.solved['1-a'].optimal).toBe(true);
  });

  it('solved: both sides optimal=true stays true', () => {
    const current  = { solved: { '1-a': { moves: 3, optimal: true } } };
    const imported = { solved: { '1-a': { moves: 3, optimal: true } } };
    const { merged } = mergeUserData(current, imported);
    expect(merged.solved['1-a']).toEqual({ moves: 3, optimal: true });
  });

  it('solved: preserves unknown future fields from both sides', () => {
    const current  = { solved: { '1-a': { moves: 5, optimal: false, foo: 'current' } } };
    const imported = { solved: { '1-a': { moves: 3, optimal: false, bar: 'imported' } } };
    const { merged } = mergeUserData(current, imported);
    // future fields on imported win merge order (spread order is ...current, ...imported)
    expect(merged.solved['1-a'].bar).toBe('imported');
    expect(merged.solved['1-a'].moves).toBe(3);
  });

  it('starred: union of stars, no conflict when only one side commented', () => {
    const current  = { starred: { '1-a': { comment: 'tricky' } } };
    const imported = { starred: { '1-a': { comment: '' } } };
    const { merged, conflicts } = mergeUserData(current, imported);
    expect(conflicts).toEqual([]);
    expect(merged.starred['1-a'].comment).toBe('tricky');
  });

  it('starred: identical comments are not conflicts', () => {
    const current  = { starred: { '1-a': { comment: 'same' } } };
    const imported = { starred: { '1-a': { comment: 'same' } } };
    const { conflicts } = mergeUserData(current, imported);
    expect(conflicts).toEqual([]);
  });

  it('starred: distinct non-empty comments are conflicts (default: keep current)', () => {
    const current  = { starred: { '1-a': { comment: 'mine'  } } };
    const imported = { starred: { '1-a': { comment: 'theirs' } } };
    const { merged, conflicts } = mergeUserData(current, imported);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({ stableId: '1-a', currentComment: 'mine', importedComment: 'theirs' });
    expect(merged.starred['1-a'].comment).toBe('mine');
  });

  it('applyConflictResolutions: picks the imported comment when requested', () => {
    const current  = { starred: { '1-a': { comment: 'mine'  } } };
    const imported = { starred: { '1-a': { comment: 'theirs' } } };
    const { merged, conflicts } = mergeUserData(current, imported);
    const resolved = applyConflictResolutions(merged, conflicts, { '1-a': 'imported' });
    expect(resolved.starred['1-a'].comment).toBe('theirs');
    // original merged object is unchanged
    expect(merged.starred['1-a'].comment).toBe('mine');
  });

  it('applyConflictResolutions: per-puzzle mixed resolution', () => {
    const current  = { starred: { '1-a': { comment: 'am' }, '1-b': { comment: 'bm' } } };
    const imported = { starred: { '1-a': { comment: 'ai' }, '1-b': { comment: 'bi' } } };
    const { merged, conflicts } = mergeUserData(current, imported);
    const resolved = applyConflictResolutions(merged, conflicts, {
      '1-a': 'imported',
      '1-b': 'current',
    });
    expect(resolved.starred['1-a'].comment).toBe('ai');
    expect(resolved.starred['1-b'].comment).toBe('bm');
  });

  it('scenario: iPhone → Mac → iPhone round-trip yields union', () => {
    // iPhone initial: A, B solved
    const iphone1 = {
      solved: { A: { moves: 5, optimal: true }, B: { moves: 10, optimal: false } },
      starred: {},
    };
    // Mac imports iPhone1, then solves X and improves A
    const macAfterImport = mergeUserData(
      { solved: { X: { moves: 7, optimal: true } }, starred: {} },
      iphone1
    ).merged;
    expect(macAfterImport.solved).toHaveProperty('A');
    expect(macAfterImport.solved).toHaveProperty('B');
    expect(macAfterImport.solved).toHaveProperty('X');
    // Simulate Mac improving A (lower moves)
    macAfterImport.solved.A = { moves: 3, optimal: true };
    // iPhone imports Mac export. iPhone meanwhile solved D.
    const iphone2 = {
      solved: {
        A: { moves: 5, optimal: true }, B: { moves: 10, optimal: false },
        D: { moves: 12, optimal: false },
      },
      starred: {},
    };
    const final = mergeUserData(iphone2, macAfterImport).merged;
    // Union: A, B, X, D all present. A keeps lower moves (3).
    expect(Object.keys(final.solved).sort()).toEqual(['A', 'B', 'D', 'X']);
    expect(final.solved.A.moves).toBe(3);
    expect(final.solved.D.moves).toBe(12);
    expect(final.solved.X.moves).toBe(7);
  });
});
