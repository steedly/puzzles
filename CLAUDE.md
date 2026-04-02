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
- 4-stage pipeline: retrograde BFS → collision-signature dedup → CSP compaction → 0-1 BFS trace
- Uses D4 symmetry group canonicalization to eliminate redundant board states
- Makefile auto-detects OpenMP on macOS via `brew --prefix libomp`
- Generate full puzzle set: `./enumerate 4 6 1 99 [standard|solitaire|ufo|french]`
- Makefile `test` target uses max_exits=1 max_moves=20 for speed; production uses max_exits=4 max_moves=99

## Critical Design Decisions (ll-solver)

### Grouped moves vs raw slides
Players count **grouped moves** (consecutive slides by the same robot = 1 move), NOT raw slides. The retrograde BFS finds minimum raw slides, but `solve_min_grouped()` does a separate 0-1 BFS to find the globally optimal grouped-move solution, which may use MORE raw slides. The .llp `groupedMoves` field is the primary difficulty metric. Never optimize for raw slides as the primary objective.

### Compaction constraints
Compaction (CSP search in `try_compact()`) finds more compact robot positions that preserve the collision sequence. **Critical:** after compaction, `solve_min_grouped()` must be re-run on the compacted state to verify the grouped-move count is preserved. Compaction that changes grouped moves = different puzzle = must be rejected.

### Cross-combo dedup
The `seen_pruned_canons` set deduplicates across exit/helper combinations. The key MUST include `num_exits` (packed into bits 60-63) because the same cell positions with different exit/helper role assignments are different puzzles. Without this, a 1E+2H puzzle could falsely dedup against a 2E+1H puzzle.

### Variant independence
Each board variant (standard, solitaire, ufo, french) runs its own independent enumeration pipeline. The puzzle sets are NOT strict subsets of each other — different dedup survivors are selected per variant. A UFO puzzle's solution works on the standard board, but the standard pipeline may have selected a different representative with robots on blocked cells.

### Forward-state-set dedup (IN PROGRESS — not yet correct)
The current code (commit 3ecb8f7) replaces compaction with forward-state-set hashing as the Pass 3 dedup. **It has D4 duplicate bugs**: 291 D4-duplicate groups and 11,243 collision-sig duplicate groups in the test output. The state-set hash alone is insufficient because:
1. Different self-canonical starting states can have the same forward states after pruning unused helpers (D4 equivalents across combos)
2. The hash doesn't account for D4 transforms of the state set — two puzzles that are D4 reflections of each other will have different raw state sets but should be considered duplicates
3. The old `seen_pruned_canons` dedup (D4-canonical form of pruned positions with num_exits packed in) was removed and needs to be restored or replaced
4. **Independent per-state D4 canonicalization produces false positives** (~2.4% proven empirically). A global D4 transform of the entire state set is needed, but the sym() transform doesn't compose cleanly with the State encoding (helpers are sorted by cell index, so transforming and re-sorting changes the encoding).

**Next steps:** Either (a) restore the `seen_pruned_canons` dedup alongside the state-set hash, or (b) fix the global D4 state-set hash to work correctly with the encoding. Option (a) is simpler and catches the D4 dups that were caught before.

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
- **lunar-lockout** key modules: `src/logic/gameEngine.js` (slide physics), `src/logic/solver.js` (BFS solver for on-demand solutions), `src/hooks/usePuzzleLibrary.js` (.llp parser), `src/logic/puzzleFilter.js` (blocked-cell filtering).
- **ll-solver** is a single `enumerate.cpp` with unit tests in `test_enumerate.cpp` (96 tests). Collision signatures are D4-normalised across directions. Compaction uses CSP backtracking search with bounding-area optimization.
- Paths with spaces (`peg game/`, `Elastic Collision/`) require quoting in shell commands.
