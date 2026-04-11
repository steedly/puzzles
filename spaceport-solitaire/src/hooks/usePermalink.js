// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRef, useCallback, useEffect, useState } from 'react';

const VALID_VARIANTS = new Set(['standard', 'solitaire', 'ufo', 'french', 'hex', 'beehive']);
const VALID_SORTS = new Set(['id', 'moves', 'slides', 'minSlides', 'states']);

// Parse hash: #variant/stableId?h=3,4&e=1&d=easy,hard&mv=3-8&s=moves.d
export function parseHash(hash) {
  const result = { variant: null, stableId: null, filters: {} };
  if (!hash || hash === '#') return result;

  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query] = raw.split('?');
  const parts = path.split('/');

  if (parts[0] && VALID_VARIANTS.has(parts[0])) {
    result.variant = parts[0];
  }
  if (parts[1]) {
    result.stableId = decodeURIComponent(parts[1]);
  }

  if (query) {
    const params = new URLSearchParams(query);
    if (params.has('h')) result.filters.helpers = params.get('h').split(',').map(Number).filter(n => !isNaN(n));
    if (params.has('e')) result.filters.exits = params.get('e').split(',').map(Number).filter(n => !isNaN(n));
    if (params.has('d')) result.filters.diffs = params.get('d').split(',').filter(Boolean);
    if (params.has('mv')) {
      const [lo, hi] = params.get('mv').split('-').map(Number);
      if (!isNaN(lo)) result.filters.movesMin = lo;
      if (!isNaN(hi)) result.filters.movesMax = hi;
    }
    if (params.has('s')) {
      const s = params.get('s');
      const dot = s.lastIndexOf('.');
      if (dot > 0) {
        const key = s.slice(0, dot);
        const dir = s.slice(dot + 1);
        if (VALID_SORTS.has(key)) {
          result.filters.sortBy = key;
          result.filters.sortAsc = dir !== 'd';
        }
      }
    }
  }
  return result;
}

// Serialize state to hash string. Only includes non-default filter values.
export function serializeHash({ variant, stableId, filters, defaults }) {
  let hash = '#' + (variant || 'standard');
  if (stableId) hash += '/' + stableId;

  const params = [];
  if (filters && defaults) {
    // helpers: encode if not all selected
    if (filters.helpers && defaults.availableHelpers &&
        (filters.helpers.size !== defaults.availableHelpers.length ||
         !defaults.availableHelpers.every(h => filters.helpers.has(h)))) {
      params.push('h=' + [...filters.helpers].sort((a, b) => a - b).join(','));
    }
    // exits: encode if not all selected
    if (filters.exits && defaults.availableExits &&
        (filters.exits.size !== defaults.availableExits.length ||
         !defaults.availableExits.every(e => filters.exits.has(e)))) {
      params.push('e=' + [...filters.exits].sort((a, b) => a - b).join(','));
    }
    // diffs: encode if not all 4 selected
    if (filters.diffs && filters.diffs.size < 4) {
      params.push('d=' + [...filters.diffs].sort().join(','));
    }
    // moves range: encode if not at full range
    if (defaults.movesRange) {
      const nonDefaultMin = filters.movesMin != null && filters.movesMin !== defaults.movesRange.min;
      const nonDefaultMax = filters.movesMax != null && filters.movesMax !== defaults.movesRange.max;
      if (nonDefaultMin || nonDefaultMax) {
        params.push('mv=' + (filters.movesMin ?? defaults.movesRange.min) + '-' + (filters.movesMax ?? defaults.movesRange.max));
      }
    }
    // sort: encode if not default (id ascending)
    if (filters.sortBy && (filters.sortBy !== 'id' || filters.sortAsc === false)) {
      params.push('s=' + filters.sortBy + '.' + (filters.sortAsc === false ? 'd' : 'a'));
    }
  }

  if (params.length > 0) hash += '?' + params.join('&');
  return hash;
}

export function usePermalink() {
  const initialRef = useRef(null);
  const skipNextHashChange = useRef(false);
  const [externalChange, setExternalChange] = useState(0);

  if (initialRef.current === null) {
    initialRef.current = parseHash(window.location.hash);
  }

  const updateHash = useCallback(({ variant, stableId, filters, defaults }) => {
    const hash = serializeHash({ variant, stableId, filters, defaults });
    if (hash !== window.location.hash) {
      skipNextHashChange.current = true;
      history.replaceState(null, '', hash);
    }
  }, []);

  // Listen for external hash changes (user pastes URL, back button)
  useEffect(() => {
    function onHashChange() {
      if (skipNextHashChange.current) {
        skipNextHashChange.current = false;
        return;
      }
      setExternalChange(c => c + 1);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const externalState = externalChange > 0 ? parseHash(window.location.hash) : null;

  return { initialState: initialRef.current, updateHash, externalState, externalChange };
}
