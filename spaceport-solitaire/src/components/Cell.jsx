// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import Robot from './Robot';

/**
 * Unified cell component for both square and hex boards.
 *
 * Square cells are laid out by CSS Grid on the parent .board element.
 * Hex cells receive explicit `style` with absolute positioning from Board.jsx.
 */
export default function Cell({
  row, col, isCenter, robotId, robotMeta, selectedRobotId,
  isLandingCell, isNextTarget, isVariantBlocked, isUnreachable, isBuildMode, onClick,
  hex, style,
}) {
  const prefix = hex ? 'cell cell--hex' : 'cell';

  const className = [
    prefix,
    isCenter         ? 'cell--center'    : '',
    isLandingCell    ? 'cell--landing'    : '',
    isNextTarget     ? 'cell--next-target' : '',
    isVariantBlocked ? 'cell--blocked'    : '',
    isUnreachable && !isVariantBlocked ? 'cell--unreachable' : '',
    isBuildMode && !robotId && !isVariantBlocked && !isCenter ? 'cell--placeable' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} style={style} onClick={() => onClick(row, col, robotId)}>
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
