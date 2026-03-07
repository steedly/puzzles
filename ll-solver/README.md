# ll-solver — Lunar Lockout Puzzle Enumerator

A C++ engine that finds **every solvable Lunar Lockout starting position** on a 7×7 board, deduplicates them, and outputs a compact puzzle file (`.llp`).

## Game Rules

- Robots slide in cardinal directions until blocked by **another robot** (wall stops are illegal).
- **Exit robots** disappear when they reach the center cell (3,3).
- **Helper robots** are blockers only — they never exit.
- **Win condition**: all exit robots have exited the board.

## How It Works

The solver uses a four-stage pipeline for each (exits, helpers) combination:

1. **Retrograde BFS** — Seeds every possible "already won" state (all exits gone, helpers at every valid cell combination) and works backward, discovering all solvable configurations and their optimal distance in one pass.

2. **Canonical filter** — Keeps only one representative per D4 symmetry class (rotations and reflections of the board). The BFS is D4-closed, so `S == canonical(S)` is sufficient — no separate canonicalization map needed.

3. **Collision-signature dedup** — Computes a fast greedy trace for each state, normalizes the move sequence by first-appearance relabeling, and deduplicates puzzles with identical collision patterns. Prefers the most compact starting position (smallest board footprint) among duplicates.

4. **DP trace + output** — For surviving puzzles, finds the solution with minimum *grouped* moves (consecutive slides by the same robot count as one move) via layer-by-layer DP, then writes one puzzle per line.

### Performance

- **Parallel BFS** via OpenMP with lock-free atomic insertions into a custom `FlatMap` (8 bytes/entry, open-addressing).
- 1 exit + 5 helpers (14M states): ~50 seconds on 4 threads.
- 1 exit + 5 helpers produces ~80K unique puzzles after dedup.

## Building

### Linux (g++)
```bash
make
```

### macOS (Apple Clang + Homebrew libomp)
```bash
brew install libomp
make OPENMP_PREFIX=$(brew --prefix libomp)
```

### Without OpenMP
```bash
make NO_OPENMP=1
```

## Usage

```bash
./enumerate [max_exits] [max_total] [min_moves] [max_moves]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_exits` | 1 | Maximum number of exit robots |
| `max_total` | 6 | Maximum total robots (exits + helpers) |
| `min_moves` | 1 | Minimum grouped moves to include |
| `max_moves` | 99 | Maximum grouped moves to include |

Puzzle data goes to **stdout**; progress/stats go to **stderr**.

### Examples

```bash
# Standard run: 1 exit, up to 5 helpers, all move counts
./enumerate 1 6 1 99 > puzzles.llp

# Multi-exit: up to 3 exits, 6 total robots, moves 1-20
./enumerate 3 6 1 20 > puzzles.llp

# Quick test: 1 exit, up to 3 helpers
./enumerate 1 4 1 10
```

## Output Format (.llp)

One puzzle per line:

```
id|exits|helpers|minMoves|positions|solution
```

- **positions**: `exit0_r,c [exit1_r,c ...] [helper_r,c ...]` — row,col on the 7×7 board
- **solution**: space-separated moves, each `moverDIRblocker`
  - `A`, `B`, `C` = exit robots (by ascending initial position)
  - `1`-`9` = helper robots (by ascending initial position)
  - `DIR`: `U`=up, `D`=down, `L`=left, `R`=right

Example: `42|1|3|5|2,3 0,3 4,5 6,1|AD1 1U2 AU3 AD1 AR3`

## Tests

Build and run the 72 unit tests:

```bash
g++ -O2 -std=c++17 -Xpreprocessor -fopenmp \
    -I$(brew --prefix libomp)/include \
    -L$(brew --prefix libomp)/lib -lomp \
    -o test_enumerate test_enumerate.cpp
./test_enumerate
```

## Solution Validator

Validate all solutions in a `.llp` file by forward simulation:

```bash
python3 validate_solutions.py puzzles.llp
```
