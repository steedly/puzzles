// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';

/**
 * Dialog shown when an imported progress file has comment conflicts with
 * the current user data. Gives three high-level choices:
 *   - Keep my comments (no change to comments)
 *   - Use imported comments (overwrite with imported)
 *   - Decide per puzzle (show a table with per-puzzle radio buttons)
 *
 * Props:
 *   conflicts: Array<{ stableId, currentComment, importedComment }>
 *   onApply(resolutions: { [stableId]: 'current' | 'imported' })
 *   onCancel()
 */
export default function ImportMergeModal({ conflicts, onApply, onCancel }) {
  const [mode, setMode] = useState('review'); // 'review' — always show per-puzzle UI
  const [resolutions, setResolutions] = useState(() => {
    // Default: keep current
    const r = {};
    for (const c of conflicts) r[c.stableId] = 'current';
    return r;
  });

  function setAll(choice) {
    const r = {};
    for (const c of conflicts) r[c.stableId] = choice;
    setResolutions(r);
  }

  function setOne(stableId, choice) {
    setResolutions(prev => ({ ...prev, [stableId]: choice }));
  }

  return (
    <div className="overlay-backdrop" onClick={onCancel}>
      <div className="overlay-panel overlay-panel--wide" onClick={e => e.stopPropagation()}>
        <div className="overlay-panel__header">
          <h3 className="overlay-panel__title">Merge Conflicts</h3>
          <button className="overlay-panel__close" onClick={onCancel} title="Cancel">✕</button>
        </div>

        <div className="overlay-panel__section">
          <p className="overlay-panel__text">
            {conflicts.length} starred {conflicts.length === 1 ? 'puzzle has' : 'puzzles have'} different comments on the current device and in the imported file. Choose which version to keep for each.
          </p>
        </div>

        <div className="overlay-panel__section">
          <div className="import-merge__presets">
            <span className="overlay-panel__label">Quick set:</span>
            <button
              className="overlay-panel__toggle"
              onClick={() => setAll('current')}
            >All current</button>
            <button
              className="overlay-panel__toggle"
              onClick={() => setAll('imported')}
            >All imported</button>
          </div>
        </div>

        <div className="overlay-panel__section import-merge__list">
          {conflicts.map(c => (
            <div key={c.stableId} className="import-merge__row">
              <div className="import-merge__row-id">{c.stableId}</div>
              <label className={`import-merge__choice${resolutions[c.stableId] === 'current' ? ' import-merge__choice--on' : ''}`}>
                <input
                  type="radio"
                  name={`conflict-${c.stableId}`}
                  checked={resolutions[c.stableId] === 'current'}
                  onChange={() => setOne(c.stableId, 'current')}
                />
                <span className="import-merge__choice-label">Current</span>
                <span className="import-merge__choice-text">{c.currentComment || <em>(empty)</em>}</span>
              </label>
              <label className={`import-merge__choice${resolutions[c.stableId] === 'imported' ? ' import-merge__choice--on' : ''}`}>
                <input
                  type="radio"
                  name={`conflict-${c.stableId}`}
                  checked={resolutions[c.stableId] === 'imported'}
                  onChange={() => setOne(c.stableId, 'imported')}
                />
                <span className="import-merge__choice-label">Imported</span>
                <span className="import-merge__choice-text">{c.importedComment || <em>(empty)</em>}</span>
              </label>
            </div>
          ))}
        </div>

        <div className="overlay-panel__section import-merge__actions">
          <button className="overlay-panel__action-btn" onClick={onCancel}>Cancel</button>
          <button
            className="overlay-panel__action-btn overlay-panel__action-btn--primary"
            onClick={() => onApply(resolutions)}
          >Apply merge</button>
        </div>
      </div>
    </div>
  );
}
