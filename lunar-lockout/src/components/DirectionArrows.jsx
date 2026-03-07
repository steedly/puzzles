export default function DirectionArrows({ selectedRobotId, dispatch }) {
  const disabled = !selectedRobotId;
  const slide = (dir) => dispatch({ type: 'SLIDE', direction: dir });

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
