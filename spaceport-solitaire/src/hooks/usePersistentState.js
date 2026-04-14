// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';

const NAMESPACE = 'spaceport-solitaire/settings';

/**
 * Drop-in replacement for useState that persists the value under a single
 * namespaced localStorage key. All settings are stored in one JSON blob so
 * we can grow the settings surface without scattering storage keys.
 *
 * Usage:
 *   const [scoreMode, setScoreMode] = usePersistentState('scoreMode', 'grouped');
 *
 * Handles SSR (typeof window === 'undefined'), corrupt JSON, and quota
 * errors gracefully — it always falls back to the in-memory default.
 */
export function usePersistentState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
    try {
      const raw = window.localStorage.getItem(NAMESPACE);
      if (!raw) return defaultValue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, key)) {
        return parsed[key];
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const warnedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = window.localStorage.getItem(NAMESPACE);
      let parsed = {};
      if (raw) {
        try { parsed = JSON.parse(raw) || {}; } catch { parsed = {}; }
      }
      parsed[key] = value;
      window.localStorage.setItem(NAMESPACE, JSON.stringify(parsed));
    } catch (e) {
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn('spaceport-solitaire: could not persist settings', e);
      }
    }
  }, [key, value]);

  return [value, setValue];
}

export const SETTINGS_STORAGE_KEY = NAMESPACE;
