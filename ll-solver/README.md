# ll-solver — Lunar Lockout Puzzle Enumerator

A C++ engine that finds **every solvable Lunar Lockout starting position** on a 7×7 board, deduplicates them, and outputs a compact puzzle file (`.llp`).

## Game Rules

- Robots slide in cardinal directions until blocked by **another robot** (wall stops are illegal).
- **Exit robots** disappear when they reach the center cell (3,3).
- **Helper robots** are blockers only — they never exit.
- **Win condition**: all exit robots have exited the board.

## How It Works — Plain-English Guide

The goal is to find every possible starting arrangement of robots that can be solved, without including duplicates that would feel like the same puzzle to a player. This happens in four stages.

### Stage 1: Finding every solvable position (Retrograde BFS)

Instead of trying every possible starting arrangement and checking "can this be solved?", the solver works **backward from the answer**.

Think of it like a maze: rather than trying every entrance to see which ones reach the exit, you start at the exit and walk backward through every possible path. Every room you reach this way is a room that *can* reach the exit.

Concretely:

1. **Start from "already won" states.** A won state is one where all exit robots have already left through the center. The helper robots could be anywhere — so the solver generates every possible arrangement of helpers on the remaining 48 cells. For 5 helpers, that's C(48,5) = 1,712,304 starting seeds.

2. **Work backward one move at a time.** For each won state, the solver asks: "what board positions could have led here in one move?" It generates all possible *predecessor* states — every way a robot could have slid to produce the current arrangement. Each predecessor is a solvable position that's exactly one move further from the solution.

3. **Repeat, level by level.** Predecessors of predecessors are 2 moves away, their predecessors are 3 moves away, and so on. This continues until no new positions are discovered. Because it works outward level by level, the first time a position is found is guaranteed to be at its optimal (minimum) distance from the solution.

The result is a complete catalog of every solvable robot arrangement for a given number of exits and helpers, each tagged with its optimal move count. For 1 exit + 5 helpers, this discovers roughly 14 million solvable states.

### Stage 2: Removing rotations and reflections (Symmetry filter)

Many of those 14 million positions are just rotated or flipped versions of each other. A puzzle with all robots shifted 90 degrees clockwise plays exactly the same way — the player just turns their head.

The board has 8 symmetries (the "D4" group): 4 rotations (0, 90, 180, 270 degrees) and 4 reflections (horizontal, vertical, and both diagonals). For each position, the solver computes all 8 transformations and keeps only the "smallest" one (by a consistent ordering). If a position isn't the smallest version of itself, it's a duplicate and gets dropped.

This cuts the number of positions by roughly 8x (not exactly 8x because some symmetric positions map to themselves).

### Stage 3: Removing puzzles that play the same (Collision-signature dedup)

Even after removing rotations and reflections, many remaining positions are **strategically identical**. Consider two puzzles where the robots are in different places, but the solution involves the same sequence of "robot A slides right and is stopped by robot 2, then robot 2 slides up and is stopped by robot A" — they would feel like the same puzzle to a player.

The solver detects this by computing a **collision signature** for each puzzle:

1. **Trace the solution.** Replay each move, recording which robot moved, which direction, and which robot stopped it.

2. **Normalize the robot names.** Instead of using the actual robot labels (which depend on position), rename them by order of first appearance. The first robot to act becomes "A", the first helper involved becomes "1", and so on. This way, two puzzles with the same strategic pattern get the same signature regardless of which specific robots are involved.

3. **Deduplicate.** If two puzzles produce the same normalized collision sequence, they're the same puzzle in different clothes. Only one representative is kept.

**Compaction preference:** When multiple starting positions share the same collision signature, the solver prefers the one where all robots fit on the **smallest board**. It measures each position's "board size" — the smallest square centered on the middle of the board that contains every robot. A puzzle where all robots are within 2 squares of the center (fitting on a 5x5 board) is preferred over one where a robot is in the corner (requiring the full 7x7 board). This produces tidier-looking puzzles without changing the gameplay.

This stage eliminates roughly 85% of the remaining positions — it's the biggest source of deduplication.

### Stage 4: Finding the best solution and writing output

For each surviving unique puzzle, the solver finds the solution that uses the fewest **grouped moves**. A "grouped move" counts consecutive slides by the same robot as a single move — if you slide robot A right, then slide robot A up, that's one grouped move (you're still "using" robot A), but then sliding robot 2 would start a second grouped move.

The solver uses dynamic programming to find the solution path with the minimum grouped move count, then writes one puzzle per line to the output file.

### Technical summary

| Stage | What it does | Typical reduction |
|-------|-------------|-------------------|
| 1. Retrograde BFS | Finds all solvable positions | 14M states (1e+5h) |
| 2. Symmetry filter | Removes rotations/reflections | ~8x reduction |
| 3. Collision-signature dedup | Removes strategically identical puzzles | ~85% reduction |
| 4. DP trace + output | Finds optimal grouped-move solutions | ~80K final puzzles |

### Performance

- **Parallel BFS** via OpenMP with lock-free atomic insertions into a custom hash table.
- 1 exit + 5 helpers (14M states): ~13 seconds wall-clock on 4 threads.
- 1 exit + 5 helpers produces ~80K unique puzzles after dedup.

## Computational Complexity

### What makes it expensive

The dominant cost is the **retrograde BFS** in Stage 1. The number of states the BFS must explore grows with two factors:

- **More helpers** means exponentially more seed states. The number of ways to place *h* helpers on 48 cells is C(48,h), which grows fast: 48 for 1 helper, 1,128 for 2, 17,296 for 3, 194,580 for 4, and 1,712,304 for 5.

- **More exit robots** means each state is higher-dimensional. With *e* exits, each state tracks *e* additional robot positions, and the BFS explores proportionally more predecessors per state.

The memory cost is 8 bytes per BFS state (each state is packed into a single 64-bit integer in the hash table). For 14 million states, that's about 730 MB of RAM.

### Measured data

All timings measured on an Apple M1 Mac Mini (4 performance cores) with OpenMP enabled. Times are wall-clock seconds.

#### BFS states discovered

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers |
|---|---|---|---|---|---|
| **1 exit** | 60 | 1,812 | 38,304 | 715,948 | 14,095,636 |
| **2 exits** | 96 | 5,000 | 241,112 | 16,816,244 | *~200M est.* |
| **3 exits** | 180 | 24,468 | 8,848,600 | *~500M est.* | — |
| **4 exits** | 336 | 157,128 | *~50M est.* | — | — |

#### Wall-clock time

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers |
|---|---|---|---|---|---|
| **1 exit** | <1s | <1s | <1s | 1s | 13s |
| **2 exits** | <1s | <1s | <1s | 1s | 30s |
| **3 exits** | <1s | <1s | 1s | 38s | *~10 min est.* |
| **4 exits** | <1s | <1s | 1s | 36s | — |

#### Peak RAM

| Total robots | Peak RAM |
|---|---|
| ≤ 5 | < 100 MB |
| 6 (e.g. 1e+5h) | ~730 MB |
| 6 (e.g. 2e+4h) | ~810 MB |
| 7 (estimated) | ~4–8 GB |

#### Unique puzzles after dedup

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers |
|---|---|---|---|---|---|
| **1 exit** | 1 | 6 | 63 | 1,975 | 79,720 |
| **2 exits** | 1 | 14 | 827 | 109,558 | *large* |
| **3 exits** | 1 | 33 | 23,096 | *large* | — |
| **4 exits** | 0 | 59 | *large* | — | — |

### What's feasible

- **Total robots ≤ 6** (e.g. 1 exit + 5 helpers, or 2 exits + 4 helpers): completes in under a minute on a modern laptop. This is the default configuration.
- **Total robots = 7**: feasible but slow — expect 5–15 minutes and several GB of RAM depending on the exit/helper split.
- **Total robots ≥ 8**: likely requires 30+ GB of RAM and hours of compute. Not practical on consumer hardware.

The number of exits matters too: more exits means more solvable states per helper count, because each exit adds an independent piece that must reach the center.

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
