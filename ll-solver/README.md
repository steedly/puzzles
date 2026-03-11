# ll-solver — Lunar Lockout Puzzle Enumerator

A C++ engine that finds **every solvable Lunar Lockout starting position** on a 7×7 board, deduplicates them, and outputs a compact puzzle file (`.llp`).

## Game Rules

- Robots slide in cardinal directions until blocked by **another robot** (wall stops are illegal).
- **Exit robots** disappear when they reach the center cell (3,3).
- **Helper robots** are blockers only — they never exit.
- **Win condition**: all exit robots have exited the board.

## How It Works — Plain-English Guide

The goal is to find every possible starting arrangement of robots that can be solved, without including duplicates that would feel like the same puzzle to a player. This happens in four stages.

### Stage 1: Finding every solvable position (Canonical Retrograde BFS)

Instead of trying every possible starting arrangement and checking "can this be solved?", the solver works **backward from the answer** using [retrograde analysis](https://en.wikipedia.org/wiki/Retrograde_analysis) — a [breadth-first search (BFS)](https://en.wikipedia.org/wiki/Breadth-first_search) that starts from solved states and expands outward to discover all positions that can reach them.

Think of it like a maze: rather than trying every entrance to see which ones reach the exit, you start at the exit and walk backward through every possible path. Every room you reach this way is a room that *can* reach the exit.

The board has 8 symmetries (the [dihedral group D4](https://en.wikipedia.org/wiki/Dihedral_group)): 4 rotations (0°, 90°, 180°, 270°) and 4 reflections (horizontal, vertical, and both diagonals). A puzzle with all robots shifted 90° clockwise plays exactly the same way. The solver exploits this by **canonicalizing during the BFS** — only exploring one representative from each group of 8 symmetric positions. This reduces the state space by ~8×.

Concretely:

1. **Seed from "already won" states — canonical only.** A won state has all exit robots exited through the center, with helpers anywhere on the remaining 48 cells. The solver generates every helper arrangement, but only seeds the ~1/8 that are D4-canonical (the "smallest" version under all 8 symmetry transforms). For 5 helpers, this means ~215K canonical seeds instead of all 1.7M.

2. **Work backward one move at a time, staying canonical.** For each state, the solver generates all *predecessor* states (boards that could reach it in one move). Each predecessor is immediately canonicalized before insertion into the hash table. This ensures the BFS only ever stores and expands canonical states — rotations and reflections are eliminated on the fly, not in a post-processing pass.

3. **Repeat, level by level.** Because it works outward level by level, the first time a position is found is guaranteed to be at its minimum number of individual slides from the solution. (This is *not* the same as minimum grouped moves — that optimization happens later in Stage 4.)

**Why this works:** The predecessor relationship is D4-equivariant — if board P reaches board S in one move, then rotating both P and S by the same transform preserves the move. So expanding a single canonical representative discovers every canonical predecessor that any member of its symmetry orbit would have found.

The result is a complete catalog of every solvable canonical arrangement, each tagged with its minimum slide count. For 1 exit + 5 helpers, this discovers ~1.76 million canonical states (equivalent to the ~14 million total states the non-canonical approach would find).

### Stage 2: Removing puzzles that play the same (Collision-signature dedup)

Even after removing rotations and reflections, many remaining positions are **strategically identical**. Consider two puzzles where the robots are in different places, but the solution involves the same sequence of "robot A slides up and is stopped by robot 1, then robot A slides left and is stopped by robot 2" — they would feel like the same puzzle to a player.

The solver detects this by computing a **collision signature** for each puzzle:

1. **Trace the solution.** Replay each move, recording which robot moved, which direction, and which robot stopped it.

2. **Normalize the robot names.** Instead of using the actual robot labels (which depend on position), rename them by order of first appearance. The first robot to act becomes "A", the first helper involved becomes "1", and so on. This way, two puzzles with the same strategic pattern get the same signature regardless of which specific robots are involved.

3. **Normalize directions under D4.** Two puzzles that are spatial rotations/reflections of each other will have the same mover/blocker pattern but rotated directions (e.g., "A slides Right" vs "A slides Up"). The solver computes the collision signature under all 8 D4 direction transforms and keeps the lexicographically smallest one. This catches puzzles that are D4-equivalent in gameplay but weren't caught by Stage 1's spatial canonicalization (because they had different starting positions that happen to be D4 rotations).

4. **Deduplicate.** If two puzzles produce the same D4-normalized collision sequence, they're the same puzzle in different clothes. Only one representative is kept.

**Compaction preference:** When multiple starting positions share the same collision signature, the solver prefers the one where all robots fit on the **smallest board**. It measures each position's "board size" — the smallest square centered on the middle of the board that contains every robot. A puzzle where all robots are within 2 squares of the center (fitting on a 5×5 board) is preferred over one where a robot is in the corner (requiring the full 7×7 board). This produces tidier-looking puzzles without changing the gameplay.

This stage eliminates roughly 85% of the remaining positions — it's the biggest source of deduplication.

### Stage 3: Compacting puzzles to the smallest board

After dedup picks a representative for each collision signature, the solver tries to make each puzzle even more compact by **reconstructing** a tighter starting position.

The key insight: when a robot makes its first slide, only the *direction* and *blocker* matter — the distance it travels (the "gap") is irrelevant to the gameplay. A robot that slides 5 cells right before hitting a blocker plays exactly the same as one that slides 1 cell right to the same blocker. By reducing each mover's first-move gap, all movers start closer to their first blocking interaction, pulling the board inward.

Concretely, for each puzzle:

1. **Identify adjustable robots.** Two categories:
   - **Movers** with gap > 1: robots whose first slide travels more than one cell. These can be moved to any intermediate gap position (gap=1, gap=2, etc.).
   - **Non-moving blockers**: helpers that never move in the solution but serve as blockers. These can be shifted one cell toward center if it doesn't change the collision sequence.

2. **Try candidate positions.** For movers, try gap=1 first (most compact), then gap=2, etc. For non-movers, try positions one step closer to center.

3. **Validate the collision sequence.** Replay the solution with the candidate positions, verifying that each move still produces the same mover/direction/blocker triple and that all exits reach center. This can fail if a robot's new position puts it in another robot's slide path.

4. **Verify BFS distance.** Look up the candidate state in the BFS hash table. If the BFS distance matches the original, the solution is still optimal — the compact position doesn't have a shortcut.

5. **If full compaction fails, try subsets.** With at most ~7 adjustable robots, the solver tries all 2^k combinations, picking the combination with the smallest board size.

This stage typically compacts ~260 puzzles, sometimes reducing their board size from 7×7 to 5×5.

### Stage 4: Finding the best solution and writing output

Stage 1's BFS tagged each state with its minimum number of **individual slides** — but a player experiences puzzles in terms of **grouped moves**, where consecutive slides by the same robot feel like a single action. For example, sliding robot A right then sliding robot A up is one grouped move (you're still "using" robot A), but then sliding robot 2 would start a second grouped move. A 10-slide solution might take only 5 grouped moves if robots are moved in streaks.

For each surviving unique puzzle, the solver does a forward-direction [dynamic programming (DP)](https://en.wikipedia.org/wiki/Dynamic_programming) pass along the distance-decreasing paths found by the BFS. It explores all slide sequences that use the minimum number of individual slides, and among those, selects the one with the fewest grouped moves. This is much cheaper than augmenting the BFS itself (which would multiply memory by the number of robots), since it only traces paths from a single starting position at a time.

After computing the DP-optimal solution, a final **DP collision-signature dedup** catches any remaining duplicates that the earlier greedy-trace dedup missed (since the greedy and DP tracers may find different solution paths, occasionally producing different collision signatures for the same strategic puzzle).

### Technical summary

| Stage | What it does | Typical result (1e+5h) |
|-------|-------------|-------------------|
| 1. Canonical retrograde BFS | Finds all solvable canonical positions | ~1.76M states |
| 2. D4-normalised collision-sig dedup | Removes strategically identical puzzles (including D4 rotations) | ~96% reduction |
| 3. Compaction | Tightens starting positions (movers + non-moving blockers) | ~260 compacted |
| 4. DP trace + final dedup + output | Finds optimal grouped-move solutions | ~51K final puzzles |

### Performance

- **Canonical BFS** eliminates D4-symmetric states during exploration, reducing states by ~8× compared to a full BFS with post-hoc filtering.
- **Parallel BFS** via OpenMP with lock-free atomic insertions into a custom hash table.
- 1 exit + 5 helpers (~1.76M canonical states): ~4 seconds single-threaded.
- 1 exit + 5 helpers produces ~51K unique puzzles after all dedup stages.

## Computational Complexity

### What makes it expensive

The dominant cost is the **canonical retrograde BFS** in Stage 1. The number of canonical states grows with two factors:

- **More helpers** means exponentially more seed states. The number of canonical seed states is roughly C(48,h)/8, growing from 9 for 1 helper to ~215K for 5 helpers to ~1.5M for 6 helpers. BFS expansion then discovers ~8–18× more states per seed.

- **More exit robots** means each state is higher-dimensional. With *e* exits, each state tracks *e* additional robot positions, and the BFS explores proportionally more predecessors per state.

The memory cost is 8 bytes per canonical BFS state (each state is packed into a single 64-bit integer in the hash table). The FlatMap maintains ≤75% load factor, so actual allocation is ~10.7 bytes per state.

### Measured data

All timings measured single-threaded on a MacBook Air (1.6 GHz Dual-Core Intel Core i5, 8 GB LPDDR3). The canonical BFS explores only D4-canonical states (~1/8th of total).

#### Canonical BFS states

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers | 6 helpers |
|---|---|---|---|---|---|---|
| **1 exit** | 12 | 255 | 4,916 | 90,050 | 1,763,957 | 27,342,689 |

Growth ratio per additional helper: ~15–20×.

#### Wall-clock time (BFS only, single-threaded)

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers | 6 helpers |
|---|---|---|---|---|---|---|
| **1 exit** | <1s | <1s | <1s | 0.2s | 4s | 91s |

#### Peak FlatMap memory

| Total robots | Canonical states | FlatMap memory |
|---|---|---|
| ≤ 5 | < 5K | < 1 MB |
| 6 (1e+5h) | 1.76M | ~19 MB |
| 7 (1e+6h) | 27.3M | ~291 MB |
| 8 (1e+7h, est.) | ~355M | ~3.8 GB |
| 9 (1e+8h, est.) | ~3.9B | ~42 GB |

#### Unique puzzles after all dedup stages

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers |
|---|---|---|---|---|---|
| **1 exit** | 1 | 3 | 28 | 1,052 | 50,077 |

Total for 1 exit, helpers 1–5: 51,161 unique puzzles.

### What's feasible

- **Total robots ≤ 7** (e.g. 1 exit + 6 helpers): completes in a few minutes on a modern laptop with < 512 MB RAM.
- **Total robots = 8**: requires 8–16 GB RAM (~3.8 GB FlatMap plus working memory) — expect ~20 minutes BFS time.
- **Total robots = 9**: requires ~64 GB RAM and several hours. Server-class hardware only.
- **Total robots ≥ 10**: not supported — the FlatMap packs state + depth into 64 bits, which limits total robots to 9.

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

## Testing

Run the full validation pipeline:

```bash
make test
```

This runs:
1. **80 unit tests** (`test_enumerate`) — internal function correctness
2. **Puzzle generation** — full `./enumerate 1 6 1 20` run
3. **Solution validation** (`validate_solutions.py`) — forward simulation, position validity, sequential IDs, D4 dedup, collision-sig dedup
4. **D4 duplicate check** (`test_canonical`) — no two output puzzles are D4-equivalent

### Individual test commands

```bash
# Unit tests only
make test_enumerate NO_OPENMP=1 && ./test_enumerate

# Validate an existing .llp file
python3 validate_solutions.py puzzles.llp

# Check D4 duplicates
make test_canonical NO_OPENMP=1 && ./test_canonical < puzzles.llp
```
