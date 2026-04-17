// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export default function SettingsPanel({ scoreMode, onScoreModeChange, hideOptimal, onHideOptimalChange, cellShading, onCellShadingChange, onExport, onImport, onClose }) {
  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={e => e.stopPropagation()}>
        <div className="overlay-panel__header">
          <h3 className="overlay-panel__title">Settings</h3>
          <button className="overlay-panel__close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="overlay-panel__section">
          <h4 className="overlay-panel__label">Display</h4>
          <div className="overlay-panel__row">
            <span>Scoring</span>
            <div className="overlay-panel__toggle-group">
              <button
                className={`overlay-panel__toggle${scoreMode === 'grouped' ? ' overlay-panel__toggle--on' : ''}`}
                onClick={() => onScoreModeChange('grouped')}
              >Moves</button>
              <button
                className={`overlay-panel__toggle${scoreMode === 'slides' ? ' overlay-panel__toggle--on' : ''}`}
                onClick={() => onScoreModeChange('slides')}
              >Slides</button>
            </div>
          </div>
          <div className="overlay-panel__row">
            <span>Cell shading</span>
            <div className="overlay-panel__toggle-group">
              {[['none','None'],['bbox','Box'],['convex','Convex'],['och','Orth.']].map(([val,label]) => (
                <button
                  key={val}
                  className={`overlay-panel__toggle${cellShading === val ? ' overlay-panel__toggle--on' : ''}`}
                  onClick={() => onCellShadingChange(val)}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="overlay-panel__row">
            <span>Show minimum</span>
            <div className="overlay-panel__toggle-group">
              <button
                className={`overlay-panel__toggle${!hideOptimal ? ' overlay-panel__toggle--on' : ''}`}
                onClick={() => onHideOptimalChange(false)}
              >On</button>
              <button
                className={`overlay-panel__toggle${hideOptimal ? ' overlay-panel__toggle--on' : ''}`}
                onClick={() => onHideOptimalChange(true)}
              >Off</button>
            </div>
          </div>
        </div>

        <div className="overlay-panel__section">
          <h4 className="overlay-panel__label">Data</h4>
          <div className="overlay-panel__row">
            <button className="overlay-panel__action-btn" onClick={onExport}>Export Progress</button>
            <label className="overlay-panel__action-btn" title="Merges imported progress with current — never overwrites">
              Import & Merge
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={e => {
                const file = e.target.files?.[0];
                if (file && onImport) onImport(file);
                e.target.value = '';
              }} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
