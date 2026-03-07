import Robot from './Robot';

export default function Cell({ row, col, isCenter, robotId, robotMeta, selectedRobotId, isLandingCell, onClick }) {
  return (
    <div
      className={[
        'cell',
        isCenter      ? 'cell--center'  : '',
        isLandingCell ? 'cell--landing' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onClick(row, col, robotId)}
    >
      {robotId && robotMeta && (
        <Robot
          robotId={robotId}
          isExit={robotMeta.isExit}
          exitIndex={robotMeta.exitIndex}
          isSelected={robotId === selectedRobotId}
        />
      )}
    </div>
  );
}
