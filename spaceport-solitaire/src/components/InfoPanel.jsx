// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export default function InfoPanel({ onClose }) {
  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel" onClick={e => e.stopPropagation()}>
        <div className="overlay-panel__header">
          <h3 className="overlay-panel__title">How to Play</h3>
          <button className="overlay-panel__close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="overlay-panel__section">
          <h4 className="overlay-panel__label">Goal</h4>
          <p className="overlay-panel__text">
            Slide all <strong style={{ color: 'var(--robot-target)' }}>exit robots</strong> (A, B, C...) to the glowing center cell.
          </p>
        </div>

        <div className="overlay-panel__section">
          <h4 className="overlay-panel__label">Controls</h4>
          <p className="overlay-panel__text">
            Click a robot to select it, then click a cell or use <strong>arrow keys</strong> to slide it.
            Robots slide until they hit another robot or a wall.
          </p>
        </div>

        <div className="overlay-panel__section">
          <h4 className="overlay-panel__label">Scoring</h4>
          <p className="overlay-panel__text">
            <strong>Moves</strong> count consecutive slides by the same robot as one move.
            Try to match the minimum to earn a gold medal!
          </p>
        </div>

        <div className="overlay-panel__section">
          <h4 className="overlay-panel__label">Keyboard Shortcuts</h4>
          <p className="overlay-panel__text">
            <strong>Arrow keys</strong> &mdash; slide selected robot<br />
            <strong>↑/↓</strong> in puzzle list &mdash; previous/next puzzle
          </p>
        </div>
      </div>
    </div>
  );
}
