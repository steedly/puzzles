// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useState, useRef } from 'react';

// Stable, unversioned localStorage key. The format version lives *inside* the
// payload (`version` field) so future code can read older data and old code
// gracefully ignores unknown fields.
export const STORAGE_KEY = 'lunar-lockout/userdata';
export const FORMAT_VERSION = 1;
export const MAX_COMMENT_LEN = 2000;

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
export function readInitial() {
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

// ─────────────────────────────────────────────────────────────────────────────
// Merge helpers — pure functions, used by the Import flow.
//
// Merge policy:
//  - solved: union keyed by stableId. On conflict, keep the lower moves count
//    and OR the optimal flag (once optimal, always optimal). Unknown fields on
//    either side are preserved.
//  - starred: union keyed by stableId. On conflict, both are kept. If the two
//    comments differ AND both are non-empty, it's a "comment conflict" — the
//    merge result uses the current comment by default and lists the conflict
//    for the UI to resolve (apply_conflict_resolutions patches the result).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge two user-data payloads. Returns { merged, conflicts }.
 * conflicts: Array<{ stableId, currentComment, importedComment }>
 *   — entries where both sides have non-empty distinct comments.
 */
export function mergeUserData(current, imported) {
  const safeCurrent  = { solved: {}, starred: {}, ...current };
  const safeImported = { solved: {}, starred: {}, ...imported };

  // ── solved: best-of-both per puzzle ──
  const mergedSolved = { ...(safeCurrent.solved || {}) };
  for (const [id, iEntry] of Object.entries(safeImported.solved || {})) {
    const cEntry = mergedSolved[id];
    if (!cEntry) {
      mergedSolved[id] = { ...iEntry };
      continue;
    }
    const cMoves = typeof cEntry.moves === 'number' ? cEntry.moves : Infinity;
    const iMoves = typeof iEntry.moves === 'number' ? iEntry.moves : Infinity;
    const lower = Math.min(cMoves, iMoves);
    mergedSolved[id] = {
      // preserve unknown fields from both sides; imported overrides current,
      // then we patch the known fields back with the merged values.
      ...cEntry,
      ...iEntry,
      moves: Number.isFinite(lower) ? lower : (cEntry.moves ?? iEntry.moves),
      optimal: cEntry.optimal === true || iEntry.optimal === true,
    };
  }

  // ── starred: union, with comment conflict detection ──
  const mergedStarred = { ...(safeCurrent.starred || {}) };
  const conflicts = [];
  for (const [id, iEntry] of Object.entries(safeImported.starred || {})) {
    const cEntry = mergedStarred[id];
    if (!cEntry) {
      mergedStarred[id] = { ...iEntry };
      continue;
    }
    const cComment = (cEntry.comment ?? '').trim();
    const iComment = (iEntry.comment ?? '').trim();
    if (cComment !== iComment && cComment !== '' && iComment !== '') {
      // Real conflict — record it, but leave the merged comment as "current"
      // so the default behavior when the user cancels/defers is no-op.
      conflicts.push({ stableId: id, currentComment: cEntry.comment ?? '', importedComment: iEntry.comment ?? '' });
      mergedStarred[id] = {
        ...iEntry,
        ...cEntry,
        comment: cEntry.comment ?? '',
      };
    } else {
      // Non-conflicting: prefer the non-empty comment.
      const preferredComment = cComment !== '' ? (cEntry.comment ?? '') : (iEntry.comment ?? '');
      mergedStarred[id] = {
        ...cEntry,
        ...iEntry,
        comment: preferredComment,
      };
    }
  }

  const merged = {
    // preserve unknown top-level fields from both sides
    ...safeImported,
    ...safeCurrent,
    version: safeCurrent.version ?? safeImported.version ?? FORMAT_VERSION,
    solved: mergedSolved,
    starred: mergedStarred,
  };

  return { merged, conflicts };
}

/**
 * Apply per-puzzle conflict resolutions on top of a merged payload.
 * @param {Object} merged  Result of mergeUserData().merged
 * @param {Array}  conflicts  Result of mergeUserData().conflicts
 * @param {Object} resolutions  Map stableId → 'current' | 'imported'
 */
export function applyConflictResolutions(merged, conflicts, resolutions) {
  const out = { ...merged, starred: { ...merged.starred } };
  for (const c of conflicts) {
    const choice = resolutions[c.stableId];
    if (!out.starred[c.stableId]) continue;
    const pick = choice === 'imported' ? c.importedComment : c.currentComment;
    out.starred[c.stableId] = { ...out.starred[c.stableId], comment: pick };
  }
  return out;
}
