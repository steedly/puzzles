// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export default function PuzzleSelector({ puzzles, currentId, onSelect }) {
  return (
    <div className="puzzle-selector">
      <label htmlFor="puzzle-select" className="puzzle-selector__label">
        Puzzle:
      </label>
      <select
        id="puzzle-select"
        className="puzzle-selector__select"
        value={currentId}
        onChange={(e) => {
          const puzzle = puzzles.find((p) => p.id === Number(e.target.value));
          if (puzzle) onSelect(puzzle);
        }}
      >
        {puzzles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} [{DIFFICULTY_LABEL[p.difficulty]}]
          </option>
        ))}
      </select>
    </div>
  );
}
