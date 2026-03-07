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
