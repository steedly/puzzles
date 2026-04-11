// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Exit labels: A = first exit, B = second, C = third, …
const EXIT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export default function Robot({ robotId, isExit, exitIndex, isSelected }) {
  let label, colorClass;
  if (isExit) {
    label = EXIT_LABELS[exitIndex] ?? String.fromCharCode(65 + exitIndex);
    colorClass = `robot--exit${exitIndex}`;
  } else {
    label = robotId.replace('r', '');
    colorClass = 'robot--normal';
  }

  return (
    <div className={[
      'robot',
      colorClass,
      isSelected ? 'robot--selected' : '',
    ].filter(Boolean).join(' ')}>
      {label}
    </div>
  );
}
