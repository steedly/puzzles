// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export default function DirectionArrows({ selectedRobotId, dispatch, blockedCells }) {
  const disabled = !selectedRobotId;
  const slide = (dir) => dispatch({ type: 'SLIDE', direction: dir, blockedCells });

  return (
    <div className="arrow-pad">
      <div className="arrow-row">
        <button className="arrow-btn" onClick={() => slide('up')} disabled={disabled} title="Up (↑)">▲</button>
      </div>
      <div className="arrow-row">
        <button className="arrow-btn" onClick={() => slide('left')}  disabled={disabled} title="Left (←)">◀</button>
        <div className="arrow-center" />
        <button className="arrow-btn" onClick={() => slide('right')} disabled={disabled} title="Right (→)">▶</button>
      </div>
      <div className="arrow-row">
        <button className="arrow-btn" onClick={() => slide('down')} disabled={disabled} title="Down (↓)">▼</button>
      </div>
      {!selectedRobotId && (
        <p className="arrow-hint">Click a robot to select it</p>
      )}
    </div>
  );
}
