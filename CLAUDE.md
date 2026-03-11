# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A collection of independent puzzle-solving projects, each in its own subdirectory with its own tech stack. There is no top-level build system.

## Projects and Build Commands

### lunar-lockout/ — React web app (puzzle game UI)
```bash
cd lunar-lockout
npm install
npm run dev          # Vite dev server with hot reload
npm run build        # Production build to dist/
npm run build:bundle # Single-file HTML bundle
npm run lint         # ESLint
```
- React 19 + Vite 7, no TypeScript
- Deployed to GitHub Pages via `.github/workflows/deploy.yml`
- Puzzle data in `.llp` format (pipe-delimited): `id|exits|helpers|minMoves|positions|solution`

### ll-solver/ — C++17 puzzle enumerator (generates .llp files for lunar-lockout)
```bash
cd ll-solver
make                                           # Linux/g++
make OPENMP_PREFIX=$(brew --prefix libomp)     # macOS with OpenMP
make NO_OPENMP=1                               # Without OpenMP
make test                                      # Full pipeline: unit tests + generate + validate + D4 check
./test_enumerate                               # Unit tests only
python3 validate_solutions.py puzzles.llp      # Validate solutions
```
- 4-stage pipeline: retrograde BFS → collision-signature dedup → compaction → DP trace
- Uses D4 symmetry group canonicalization to eliminate redundant board states

### wordle/ — Python/C++ solver
```bash
cd wordle
python3 wordle.py                   # Python solver
cd c && ./make && ./wordle          # C++ solver
```
- Entropy-based decision tree for optimal guessing strategy
- Dictionary in `dictionary.py` (2309 solutions + extended candidates)

### sudoku/ — Python solver
```bash
cd sudoku
python3 sudoku.py
```
- Constraint propagation + backtracking; also available as Jupyter notebook (`sudoku.ipynb`)
- Uses NumPy

### peg game/ — Python solver
```bash
cd "peg game"
python3 peg_game_consolidated.py
python3 test_peg_game_consolidated.py   # Tests
```
- Triangular board state-space search with mirror symmetry reduction

### Elastic Collision/ — Python physics simulator
```bash
cd "Elastic Collision"
python3 elastic_collision.py
```
- Uses NumPy + Matplotlib; has its own `.venv`

## Architecture Notes

- **lunar-lockout** and **ll-solver** are tightly coupled: ll-solver generates the `.llp` puzzle files that lunar-lockout consumes. The `.llp` format is shared between them.
- **lunar-lockout** key modules: `src/logic/gameEngine.js` (slide physics), `src/logic/solver.js` (BFS solver for on-demand solutions), `src/hooks/usePuzzleLibrary.js` (.llp parser), `src/logic/puzzleFilter.js` (blocked-cell filtering).
- **ll-solver** is a single `enumerate.cpp` with unit tests in `test_enumerate.cpp` (80 tests). Collision signatures are D4-normalised across directions. Compaction tries intermediate gaps and shifts non-moving blockers toward center.
- Paths with spaces (`peg game/`, `Elastic Collision/`) require quoting in shell commands.
