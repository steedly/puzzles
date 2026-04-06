# ll-solver — Lunar Lockout Puzzle Enumerator

A C++ engine that finds **every solvable Lunar Lockout starting position** on a board, deduplicates them, and outputs a compact puzzle file (`.llp`). Supports square boards (7×7 with 4 directions) and hex diamond boards (7×7 with 6 directions).

## Game Rules

- Robots slide in cardinal directions until blocked by **another robot** (wall stops are illegal).
- **Exit robots** disappear when they reach the center cell.
- **Helper robots** are blockers only — they never exit.
- **Win condition**: all exit robots have exited the board.

## How It Works — Plain-English Guide

The goal is to find every possible starting arrangement of robots that can be solved, without including duplicates that would feel like the same puzzle to a player. This happens in three stages.

### Stage 1: Finding every solvable position (Canonical Retrograde BFS)

Instead of trying every possible starting arrangement and checking "can this be solved?", the solver works **backward from the answer** using [retrograde analysis](https://en.wikipedia.org/wiki/Retrograde_analysis) — a [breadth-first search (BFS)](https://en.wikipedia.org/wiki/Breadth-first_search) that starts from solved states and expands outward to discover all positions that can reach them.

Think of it like a maze: rather than trying every entrance to see which ones reach the exit, you start at the exit and walk backward through every possible path. Every room you reach this way is a room that *can* reach the exit.

For square boards, the board has 8 symmetries (the [dihedral group D4](https://en.wikipedia.org/wiki/Dihedral_group)): 4 rotations (0°, 90°, 180°, 270°) and 4 reflections (horizontal, vertical, and both diagonals). A puzzle with all robots shifted 90° clockwise plays exactly the same way. The solver exploits this by **canonicalizing during the BFS** — only exploring one representative from each symmetry class. Hex boards use a smaller symmetry group (see [Board Variants](#board-variants)).

Concretely:

1. **Seed from "already won" states — canonical only.** A won state has all exit robots exited through the center, with helpers anywhere on the remaining cells. The solver generates every helper arrangement, but only seeds the ones that are canonical (the "smallest" version under all symmetry transforms). For 5 helpers on a standard board, this means ~215K canonical seeds instead of all 1.7M.

2. **Work backward one move at a time, staying canonical.** For each state, the solver generates all *predecessor* states (boards that could reach it in one move). Each predecessor is immediately canonicalized before insertion into the hash table. This ensures the BFS only ever stores and expands canonical states — rotations and reflections are eliminated on the fly, not in a post-processing pass.

3. **Repeat, level by level.** Because it works outward level by level, the first time a position is found is guaranteed to be at its minimum number of individual slides from the solution. (This is *not* the same as minimum grouped moves — that optimization happens later in Stage 3.)

**Why this works:** The predecessor relationship is D4-equivariant — if board P reaches board S in one move, then rotating both P and S by the same transform preserves the move. So expanding a single canonical representative discovers every canonical predecessor that any member of its symmetry orbit would have found.

The result is a complete catalog of every solvable canonical arrangement, each tagged with its minimum slide count. For 1 exit + 5 helpers, this discovers ~1.76 million canonical states (equivalent to the ~14 million total states the non-canonical approach would find).

### Stage 2: Removing puzzles that play the same (Collision-signature dedup)

Even after removing rotations and reflections, many remaining positions are **strategically identical**. Consider two puzzles where the robots are in different places, but the solution involves the same sequence of "robot A slides up and is stopped by robot 1, then robot A slides left and is stopped by robot 2" — they would feel like the same puzzle to a player.

The solver detects this by computing a **collision signature** for each puzzle:

1. **Trace the solution.** Replay each move, recording which robot moved, which direction, and which robot stopped it.

2. **Normalize the robot names.** Instead of using the actual robot labels (which depend on position), rename them by order of first appearance. The first robot to act becomes "A", the first helper involved becomes "1", and so on. This way, two puzzles with the same strategic pattern get the same signature regardless of which specific robots are involved.

3. **Normalize directions under D4.** Two puzzles that are spatial rotations/reflections of each other will have the same mover/blocker pattern but rotated directions (e.g., "A slides Right" vs "A slides Up"). The solver computes the collision signature under all 8 D4 direction transforms and keeps the lexicographically smallest one. This catches puzzles that are D4-equivalent in gameplay but weren't caught by Stage 1's spatial canonicalization (because they had different starting positions that happen to be D4 rotations).

4. **Deduplicate.** If two puzzles produce the same D4-normalized collision sequence, they're the same puzzle in different clothes. Only one representative is kept.

**Compactness preference:** When multiple starting positions share the same collision signature, the solver prefers the one where all robots fit on the **smallest board**. It measures each position's "board size" — the smallest square centered on the middle of the board that contains every robot. A puzzle where all robots are within 2 squares of the center (fitting on a 5×5 board) is preferred over one where a robot is in the corner (requiring the full 7×7 board). This produces tidier-looking puzzles without changing the gameplay.

This is the biggest source of deduplication, typically eliminating 95%+ of collected states.

### Stage 3: Finding the best solution and writing output

Stage 1's BFS tagged each state with its minimum number of **individual slides** — but a player experiences puzzles in terms of **grouped moves**, where consecutive slides by the same robot feel like a single action. For example, sliding robot A right then sliding robot A up is one grouped move (you're still "using" robot A), but then sliding robot 2 would start a second grouped move.

Critically, the solution with the fewest grouped moves is often **not** the one with the fewest individual slides. A path with more individual slides can chain multiple slides by the same robot into streaks, dramatically reducing the grouped move count. For example, a puzzle whose shortest path takes 18 individual slides and 17 grouped moves might have an alternative path using 22 slides but only 10 grouped moves — far better from the player's perspective.

For each surviving unique puzzle, the solver runs a **[0-1 BFS](https://en.wikipedia.org/wiki/0-1_BFS)** from the start position over an augmented state space of (board configuration, last-mover landing cell). Edges where the same robot continues sliding cost 0; edges where a different robot starts cost 1. This explores **all** reachable states (not just those on minimum-slide paths) and finds the globally optimal grouped-move solution. Because the forward-reachable state space per puzzle is small (typically 50–5,000 board states × ~50 last-mover cells), this is fast even when run for hundreds of thousands of puzzles.

After computing the optimal solution, three sequential dedup layers catch remaining duplicates: (1) D4-canonical positions with exit count, (2) collision-signature of the DP solution (catches greedy/DP path divergences), and (3) a hash of the forward-reachable state set (catches puzzles with identical reachability). Among duplicates at each layer, the most compact representative is kept.

### Technical summary

| Stage | What it does | 1e+5h |
|-------|-------------|-------|
| 1. Canonical retrograde BFS | Finds all solvable canonical positions | 2,135,377 states |
| — non-goal states collected | States with at least one exit robot still on the board | 1,903,904 |
| 2. Collision-sig dedup | Removes strategically identical puzzles | 78,058 unique |
| 3. DP trace + final dedup | Finds optimal grouped-move solutions, removes remaining dups | 27,632 final |

### Performance

- **Canonical BFS** eliminates D4-symmetric states during exploration, reducing states by ~8× compared to a full BFS with post-hoc filtering.
- **Parallel BFS** via OpenMP with lock-free atomic insertions into a custom hash table.
- 1 exit + 5 helpers (~2.1M canonical states): ~4 seconds single-threaded.
- 1 exit + 5 helpers produces ~28K unique puzzles after all dedup stages.
- Multi-exit runs are dominated by collision-sig dedup time, not BFS time — deduplicating 45M states for 3 exits + 4 helpers takes ~14 minutes.

## Computational Complexity

### What makes it expensive

The dominant cost is the **canonical retrograde BFS** in Stage 1. The number of canonical states grows with two factors:

- **More helpers** means exponentially more seed states. The number of canonical seed states is roughly C(48,h)/8, growing from 9 for 1 helper to ~215K for 5 helpers to ~1.5M for 6 helpers. BFS expansion then discovers ~8–18× more states per seed.

- **More exit robots** means each state is higher-dimensional. With *e* exits, each state tracks *e* additional robot positions, and the BFS explores proportionally more predecessors per state.

The memory cost is 8 bytes per canonical BFS state (each state is packed into a single 64-bit integer in the hash table). The FlatMap maintains ≤75% load factor, so actual allocation is ~10.7 bytes per state.

### Measured data

All timings measured single-threaded on a MacBook Air (1.6 GHz Dual-Core Intel Core i5, 8 GB LPDDR3). The canonical BFS explores only D4-canonical states (~1/8th of total).

#### Canonical BFS states (standard variant)

| | 0 helpers | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers | 6 helpers |
|---|---|---|---|---|---|---|---|
| **1 exit** | 1 | 12 | 255 | 4,916 | 90,050 | 1,763,957 | 27,342,689 |
| **2 exits** | 1 | 15 | 423 | 16,386 | 1,064,652 | 49,325,644 | — |
| **3 exits** | 1 | 16 | 722 | 187,867 | 44,282,845 | — | — |

Growth ratio per additional helper: ~15–20×. Multi-exit puzzles have even larger state spaces — 2 exits + 5 helpers (49M states) exceeds 1 exit + 6 helpers (27M states).

#### Wall-clock time (BFS only, single-threaded)

| | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers | 6 helpers |
|---|---|---|---|---|---|---|
| **1 exit** | <1s | <1s | <1s | 0.2s | 4s | 91s |

Multi-exit BFS times scale roughly with state count. The collision-sig dedup (Stage 2) becomes the bottleneck at scale: deduplicating 45M states takes ~14 minutes.

#### Peak FlatMap memory

| Total robots | Canonical states | FlatMap memory |
|---|---|---|
| ≤ 5 | < 5K | < 1 MB |
| 6 (1e+5h) | 1.76M | ~19 MB |
| 7 (1e+6h) | 27.3M | ~291 MB |
| 7 (2e+5h) | 49.3M | ~527 MB |
| 7 (3e+4h) | 44.3M | ~474 MB |
| 8 (1e+7h, est.) | ~355M | ~3.8 GB |
| 9 (1e+8h, est.) | ~3.9B | ~42 GB |

#### Unique puzzles after all dedup stages (standard variant)

| | 0 helpers | 1 helper | 2 helpers | 3 helpers | 4 helpers | 5 helpers | 6 helpers |
|---|---|---|---|---|---|---|---|
| **1 exit** | 0 | 1 | 3 | 39 | 1,222 | 27,143 | — |
| **2 exits** | 0 | 1 | 19 | 809 | 78,646 | — | — |
| **3 exits** | 0 | 1 | 50 | 21,078 | — | — | — |
| **4 exits** | 0 | 0 | 72 | — | — | — | — |

#### Totals by variant (≤6 total robots, up to 4 exits — currently deployed)

| Variant | Puzzles | File size |
|---|---|---|
| Standard | 129,084 | 12 MB |
| French | 56,764 | 4.8 MB |
| Solitaire | 23,834 | 1.9 MB |
| UFO | 17,996 | 1.5 MB |
| Hex | TBD | TBD |
| Bee Hive (7×7) | TBD | TBD |

#### Totals by variant (≤7 total robots, up to 3 exits — full enumeration)

| Variant | Puzzles | Stripped file size |
|---|---|---|
| Standard | 10,321,870 | 437 MB |
| Solitaire | 402,492 | 16 MB |
| UFO | 244,918 | 10 MB |

The jump from ≤6 to ≤7 total robots increases the standard puzzle count by ~70×. The three dominant combinations (1e+6h, 2e+5h, 3e+4h) account for 98.6% of all 7-total standard puzzles. Full 7-robot files are saved in `ll-solver/full/` for future quality-based filtering.

### What's feasible

- **Total robots ≤ 7** (e.g. 1 exit + 6 helpers): completes in a few minutes on a modern laptop with < 512 MB RAM.
- **Total robots = 8**: requires 8–16 GB RAM (~3.8 GB FlatMap plus working memory) — expect ~20 minutes BFS time.
- **Total robots = 9**: requires ~64 GB RAM and several hours. Server-class hardware only.
- **Total robots ≥ 10**: not supported — the FlatMap packs state + depth into 64 bits, which limits total robots to 9.

The number of exits matters significantly: more exits means more solvable states per helper count, because each exit adds an independent piece that must reach the center. Crucially, multi-exit combinations also produce far more *unique* puzzles after dedup — 3 exits + 4 helpers yields 4.7M unique puzzles versus 961K for 1 exit + 6 helpers, despite having fewer total BFS states. This makes multi-exit the primary driver of output file size at 7 total robots.

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
./enumerate [max_exits] [max_total] [min_moves] [max_moves] [variant]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_exits` | 1 | Maximum number of exit robots |
| `max_total` | 6 | Maximum total robots (exits + helpers) |
| `min_moves` | 1 | Minimum grouped moves to include |
| `max_moves` | 99 | Maximum grouped moves to include |
| `variant` | standard | Board variant (see below) |

Puzzle data goes to **stdout**; progress/stats go to **stderr**.

### Board Variants

The enumerator supports six board variants:

**Square variants** (7×7 grid, 4 cardinal directions, D4 symmetry with 8 transforms):

| Variant | Usable cells | Blocked cells | Description |
|---------|-------------|---------------|-------------|
| `standard` | 49 | 0 | Full 7×7 board |
| `french` | 45 | 4 | 7×7 with four inner-corner cells blocked: (1,1), (1,5), (5,1), (5,5) |
| `solitaire` | 33 | 16 | 7×7 with four 2×2 corners blocked |
| `ufo` | 25 | 24 | Center 5×5 only (border cells blocked) |

**Hex diamond variants** (7×7 grid rotated 45°, 6 directions, 4 symmetries):

| Variant | Usable cells | Blocked cells | Description |
|---------|-------------|---------------|-------------|
| `hex` | 25 | 24 | 7×7 hex diamond with border blocked — compact 5×5 inner board |
| `beehive` | 49 | 0 | Full 7×7 hex diamond — same cell count as standard but 6 directions |

Hex directions are the 4 cardinal directions plus 2 diagonals: NW(-1,0), SE(+1,0), SW(0,-1), NE(0,+1), N-diag(-1,+1), S-diag(+1,-1). The hex diamond is visually displayed as a rotated square grid with hexagonal cells.

**Why hex has only 4 symmetries, not 8.** On a square board, all 8 D4 transforms (4 rotations + 4 reflections) preserve the 4 cardinal directions — flipping left and right just swaps "left" and "right", which are still valid moves. But on a hex board, two of the 6 directions are *diagonals* (NE-SW axis). A horizontal or vertical flip maps these diagonals to directions that don't exist on the hex grid — like trying to move a chess bishop diagonally on a board that only has horizontal and vertical lines. So those flips don't preserve gameplay: the same arrangement of pieces would have different legal moves after flipping. Only 4 transforms keep all 6 hex directions valid: identity, 180° rotation, and the two diagonal reflections (swapping rows with columns). These form a [Klein four-group](https://en.wikipedia.org/wiki/Klein_four-group).

Blocked cells (square variants only) act as walls — robots cannot occupy or slide through them, and stopping against one is a wall-stop (illegal). All blocked patterns are D4-symmetric, so canonicalization works unchanged.

#### How variants relate to each other

The four variants form a hierarchy based on which cells are blocked:

```
Standard (0 blocked)
  └─ French (4 blocked: inner corners)
       ├─ Solitaire (16 blocked: 2×2 corners ⊃ inner corners)
       └─ UFO (24 blocked: full border ⊃ inner corners)
```

Solitaire and UFO are **incomparable** — Solitaire blocks the 2×2 corners that UFO leaves open (e.g., (0,2)–(0,4)), while UFO blocks border-edge cells that Solitaire leaves open (e.g., (0,2)–(0,4) are open in Solitaire but blocked in UFO).

**Why solvable positions form supersets.** Blocked cells only *prevent* moves — they never *enable* them. A robot slides until it hits another robot; a blocked cell in the path simply makes that slide illegal. So any valid move on a restricted board (more blocked cells) is also valid on a less-restricted board (fewer blocked cells), because the path is still clear and the stopping robot is still there. This means if a position is solvable on Solitaire, the exact same move sequence works on French and Standard. The set of solvable positions satisfies:

> Standard ⊇ French ⊇ Solitaire, and Standard ⊇ French ⊇ UFO

**Why minimum moves can only increase.** More blocked cells mean fewer legal moves at each step — edges are removed from the state graph, never added. A shorter path that existed on Standard might be blocked on French, forcing a longer detour. The reverse can never happen: blocking a cell cannot create a new path. So:

> Minimum moves: Standard ≤ French ≤ Solitaire (and Standard ≤ French ≤ UFO)

**Why puzzle counts decrease.** With fewer solvable positions and fewer collision signatures (since fewer moves produce fewer distinct solution paths), each restriction reduces the number of unique puzzles that survive dedup:

> Puzzle counts: Standard (129K) > French (57K) > Solitaire (24K) > UFO (18K)

In the code, this hierarchy is visible in `reverse_moves_normal` in `enumerate.cpp`: each candidate predecessor slide is checked against the blocked-cell mask, and blocked cells cause the slide to be skipped — directly reducing the number of predecessors discovered by the BFS.

### Examples

```bash
# Standard run: 1 exit, up to 5 helpers, all move counts
./enumerate 1 6 1 99 > puzzles.llp

# French Solitaire variant
./enumerate 1 6 1 20 french > puzzles-french.llp

# Solitaire variant
./enumerate 1 6 1 20 solitaire > puzzles-solitaire.llp

# UFO (5x5) variant
./enumerate 1 6 1 20 ufo > puzzles-ufo.llp

# Multi-exit: up to 3 exits, 6 total robots, moves 1-20
./enumerate 3 6 1 20 > puzzles.llp

# Hex diamond (5x5 inner) variant
./enumerate 4 6 1 99 hex > puzzles-hex.llp

# Bee Hive (7x7 hex diamond) variant
./enumerate 4 6 1 99 beehive > puzzles-beehive.llp

# Quick test: 1 exit, up to 3 helpers
./enumerate 1 4 1 10
```

## Output Format (.llp)

One puzzle per line:

```
id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
```

- **groupedMoves**: minimum grouped moves (consecutive slides by the same robot = 1 move) — the primary difficulty metric
- **rawSlides**: number of individual slides in the grouped-optimal solution
- **minRawSlides**: minimum individual slides (from the retrograde BFS)
- **forwardStates**: number of forward-reachable board states
- **positions**: `exit0_r,c [exit1_r,c ...] [helper_r,c ...]` — row,col on the board
- **solution**: space-separated moves, each `moverDIRblocker`
  - `A`, `B`, `C` = exit robots (by ascending initial position)
  - `1`-`9` = helper robots (by ascending initial position)
  - `DIR` (square): `U`=up, `D`=down, `L`=left, `R`=right
  - `DIR` (hex): `Nw`, `Se`, `Sw`, `Ne`, `No`, `So` (2-char codes, move tokens are 4 chars)

Example (square): `2|1|2|2|2|2|4|4,3 1,3 3,3|2U1 AU2` — 1 exit, 2 helpers, 2 grouped moves

Example (hex): `3|1|2|1|2|2|5|2,3 1,1 3,1|1Se2 ASw1` — 1 exit, 2 helpers, 1 grouped move

## Testing

Run the full validation pipeline:

```bash
make test
```

This runs:
1. **110 unit tests** (`test_enumerate`) — internal function correctness (includes hex-specific tests)
2. **Puzzle generation** — `./enumerate 1 6 1 20` for square variants, `./enumerate 1 4 1 20` for hex variants
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
