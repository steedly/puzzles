// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import Robot from './Robot';

export default function Cell({ row, col, isCenter, robotId, robotMeta, selectedRobotId, isLandingCell, isVariantBlocked, onClick }) {
  return (
    <div
      className={[
        'cell',
        isCenter         ? 'cell--center'         : '',
        isLandingCell    ? 'cell--landing'         : '',
        isVariantBlocked ? 'cell--variant-blocked' : '',
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
