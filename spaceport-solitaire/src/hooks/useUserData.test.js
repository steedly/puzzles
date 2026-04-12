// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEY, FORMAT_VERSION, readInitial } from './useUserData.js';

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
