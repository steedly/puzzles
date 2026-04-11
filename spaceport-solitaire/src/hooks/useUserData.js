// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useState, useRef } from 'react';

// Stable, unversioned localStorage key. The format version lives *inside* the
// payload (`version` field) so future code can read older data and old code
// gracefully ignores unknown fields.
const STORAGE_KEY = 'lunar-lockout/userdata';
const FORMAT_VERSION = 1;
const MAX_COMMENT_LEN = 2000;

/**
 * Stored shape (intentionally minimal & forward-compatible):
 *   {
 *     version: 1,
 *     solved:  { [stableId]: { moves: number, optimal: boolean } },
 *     starred: { [stableId]: { comment: string } }
 *   }
 *
 * Forward compatibility rules:
 *   - The reader tolerates missing top-level fields, missing per-entry fields,
 *     and unknown extra fields (it copies the whole object so future fields
 *     survive a write/read round trip).
 *   - Truthy `solved[id]` means solved. Optimal is the explicit boolean.
 *   - Truthy `starred[id]` means starred. Comment is a plain string.
 *   - The on-disk key is unversioned; only the JSON payload carries `version`.
 */
function readInitial() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { version: FORMAT_VERSION, solved: {}, starred: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: FORMAT_VERSION, solved: {}, starred: {} };
    const parsed = JSON.parse(raw);
    const solved  = parsed && typeof parsed.solved  === 'object' && parsed.solved  ? parsed.solved  : {};
    const starred = parsed && typeof parsed.starred === 'object' && parsed.starred ? parsed.starred : {};
    return { ...parsed, version: FORMAT_VERSION, solved, starred };
  } catch {
    return { version: FORMAT_VERSION, solved: {}, starred: {} };
  }
}

export function useUserData() {
  const [data, setData] = useState(readInitial);
  const warnedRef = useRef(false);

  const writeStorage = useCallback((next) => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn('spaceport-solitaire: could not persist user data', e);
      }
    }
  }, []);

  const markSolved = useCallback((stableId, { moves, minMoves }) => {
    if (!stableId) return;
    setData(prev => {
      const prevEntry = prev.solved[stableId];
      const wasOptimal = prevEntry?.optimal === true;
      const nowOptimal = typeof minMoves === 'number' && moves === minMoves;
      const entry = {
        moves: prevEntry ? Math.min(prevEntry.moves ?? moves, moves) : moves,
        optimal: wasOptimal || nowOptimal,
      };
      const next = { ...prev, solved: { ...prev.solved, [stableId]: entry } };
      writeStorage(next);
      return next;
    });
  }, [writeStorage]);

  const toggleStar = useCallback((stableId) => {
    if (!stableId) return;
    setData(prev => {
      const nextStarred = { ...prev.starred };
      if (nextStarred[stableId]) {
        delete nextStarred[stableId];
      } else {
        nextStarred[stableId] = { comment: '' };
      }
      const next = { ...prev, starred: nextStarred };
      writeStorage(next);
      return next;
    });
  }, [writeStorage]);

  const setComment = useCallback((stableId, text) => {
    if (!stableId) return;
    const trimmed = (text ?? '').slice(0, MAX_COMMENT_LEN);
    setData(prev => {
      if (!prev.starred[stableId]) return prev; // comments require star
      const next = {
        ...prev,
        starred: {
          ...prev.starred,
          [stableId]: { ...prev.starred[stableId], comment: trimmed },
        },
      };
      writeStorage(next);
      return next;
    });
  }, [writeStorage]);

  const isSolved   = useCallback((stableId) => !!data.solved[stableId], [data]);
  const isOptimal  = useCallback((stableId) => data.solved[stableId]?.optimal === true, [data]);
  const isStarred  = useCallback((stableId) => !!data.starred[stableId], [data]);
  const getComment = useCallback((stableId) => data.starred[stableId]?.comment ?? '', [data]);

  return {
    data,
    markSolved,
    toggleStar,
    setComment,
    isSolved,
    isOptimal,
    isStarred,
    getComment,
  };
}
