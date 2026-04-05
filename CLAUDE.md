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
- Puzzle data in `.llp` format (pipe-delimited): `id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution`
- Hex variants use 2-char direction codes in solutions (Nw, Se, Sw, Ne, No, So) instead of single-char (U, D, L, R)

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
- 3-stage pipeline: retrograde BFS → collision-signature dedup → 0-1 BFS trace
- Uses D4 symmetry group canonicalization to eliminate redundant board states
- Makefile auto-detects OpenMP on macOS via `brew --prefix libomp`
- Generate full puzzle set: `./enumerate 4 6 1 99 [standard|solitaire|ufo|french|hex|beehive]`
- Hex variants: 5x5 ("hex") and 7x7 ("beehive") hex diamond boards with 6 directions and 6-element symmetry group (identity, 180°, H-flip, V-flip, diagonal, anti-diagonal)
- Makefile `test` target uses max_exits=1 max_moves=20 for speed; production uses max_exits=4 max_moves=99

## Critical Design Decisions (ll-solver)

### Grouped moves vs raw slides
Players count **grouped moves** (consecutive slides by the same robot = 1 move), NOT raw slides. The retrograde BFS finds minimum raw slides, but `solve_min_grouped()` does a separate 0-1 BFS to find the globally optimal grouped-move solution, which may use MORE raw slides. The .llp `groupedMoves` field is the primary difficulty metric. Never optimize for raw slides as the primary objective.

### Cross-combo dedup
The `seen_pruned_canons` set deduplicates across exit/helper combinations. The key MUST include `num_exits` (packed into bits 60-63) because the same cell positions with different exit/helper role assignments are different puzzles. Without this, a 1E+2H puzzle could falsely dedup against a 2E+1H puzzle.

### Variant independence
Each board variant (standard, solitaire, ufo, french, hex, beehive) runs its own independent enumeration pipeline. The puzzle sets are NOT strict subsets of each other — different dedup survivors are selected per variant. Square variants (standard, solitaire, ufo, french) share a 7x7 grid with 4 directions and D4 symmetry (8 transforms). Hex variants (hex, beehive) use an NxN grid (5 or 7) with 6 directions (4 cardinal + 2 diagonals) and 6-element symmetry group (identity, 180°, H-flip, V-flip, diagonal, anti-diagonal).

### Three-layer dedup in Pass 3
After the greedy collision-sig dedup in Pass 2, Pass 3 applies three sequential dedup layers:
1. **D4-canonical positions** (`seen_pruned_canons`): canonical form of pruned robot positions with `num_exits` packed in bits 60-63. Catches cross-combo D4 positional duplicates.
2. **DP collision-sig** (`seen_dp_sigs`): collision signature of the min-grouped-moves solution. Catches greedy/DP path divergences where different starting states produce the same optimal solution structure.
3. **Forward state-set hash** (`seen_state_sets`): FNV hash of all forward-reachable states. Catches remaining duplicates where different positions have identical reachability.
Among duplicates at each layer, the most compact representative (smallest bounding area, then smallest Manhattan distance) is kept.

### StableIds are position-based
`stableId = numExits + "-" + base36(cells packed as base-49)`. They survive regeneration as long as the same positions exist. But regeneration changes which puzzles survive dedup, so some stableIds may appear/disappear. StableIds are fully reversible — you can decode positions from them.

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
- **lunar-lockout** key modules: `src/logic/gameEngine.js` (slide physics), `src/logic/solver.js` (BFS solver for on-demand solutions), `src/hooks/usePuzzleLibrary.js` (.llp parser), `src/logic/puzzleFilter.js` (blocked-cell filtering), `src/logic/boardGeometry.js` (board configs for square and hex variants).
- **ll-solver** is a single `enumerate.cpp` with unit tests in `test_enumerate.cpp` (110 tests). Collision signatures are symmetry-normalised across directions. Board type (square/hex) is runtime-configurable via variant parameter.
- Paths with spaces (`peg game/`, `Elastic Collision/`) require quoting in shell commands.
