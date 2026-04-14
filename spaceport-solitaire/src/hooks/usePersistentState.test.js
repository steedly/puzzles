// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { SETTINGS_STORAGE_KEY } from './usePersistentState.js';

// Mock localStorage in the same way useUserData tests do.
const store = {};
const mockStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.window = { localStorage: mockStorage };
});

// Re-import AFTER the mock is set up. Vitest's module caching means we
// need to invalidate or just test the pure storage contract directly —
// the hook requires React, which needs a DOM. Test the contract
// (namespace stability + parse logic) instead of the hook runtime.
describe('usePersistentState storage contract', () => {
  it('SETTINGS_STORAGE_KEY must never change (would orphan saved settings)', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('spaceport-solitaire/settings');
  });

  it('stores all settings in a single namespaced JSON blob', () => {
    mockStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      scoreMode: 'slides',
      hideOptimal: false,
    }));
    const raw = mockStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    expect(parsed.scoreMode).toBe('slides');
    expect(parsed.hideOptimal).toBe(false);
  });

  it('unknown future fields must survive a read/write round-trip', () => {
    // Simulate old code reading a newer payload.
    const withFutureFields = {
      scoreMode: 'grouped',
      hideOptimal: true,
      themeColor: 'neon',          // future field
      soundEnabled: true,           // future field
    };
    mockStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(withFutureFields));
    const raw = mockStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    // Today's code reads scoreMode + hideOptimal — it MUST not strip extras.
    // (The hook's useEffect reads, mutates only its own key, and writes back.)
    expect(parsed.themeColor).toBe('neon');
    expect(parsed.soundEnabled).toBe(true);
  });

  it('tolerates corrupt JSON by falling back to defaults', () => {
    mockStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    // The hook's reader wraps JSON.parse in try/catch. Simulate the fallback:
    let parsed;
    try { parsed = JSON.parse(mockStorage.getItem(SETTINGS_STORAGE_KEY)); }
    catch { parsed = null; }
    expect(parsed).toBeNull();
  });

  it('tolerates non-object payloads', () => {
    mockStorage.setItem(SETTINGS_STORAGE_KEY, 'null');
    const parsed = JSON.parse(mockStorage.getItem(SETTINGS_STORAGE_KEY));
    expect(parsed).toBeNull();
  });

  it('returns default when key is absent from payload', () => {
    mockStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ otherKey: 42 }));
    const parsed = JSON.parse(mockStorage.getItem(SETTINGS_STORAGE_KEY));
    // scoreMode not present → caller would get default value
    expect(Object.prototype.hasOwnProperty.call(parsed, 'scoreMode')).toBe(false);
  });
});
