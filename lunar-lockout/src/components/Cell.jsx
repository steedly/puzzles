import Robot from './Robot';

export default function Cell({ row, col, isCenter, robotId, robotMeta, selectedRobotId, isLandingCell, isBlocked, isVariantBlocked, blockMode, onClick }) {
  return (
    <div
      className={[
        'cell',
        isCenter         ? 'cell--center'         : '',
        isLandingCell    ? 'cell--landing'         : '',
        isVariantBlocked ? 'cell--variant-blocked' : '',
        isBlocked && !isVariantBlocked ? 'cell--blocked' : '',
        blockMode && !robotId && !isVariantBlocked && !(row === 3 && col === 3) ? 'cell--blockable' : '',
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
