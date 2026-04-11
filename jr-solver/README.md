# jr-solver

Lunar Lockout puzzle enumerator and solver by **John Rausch** (Bexley, Ohio, 2006-2022).

Generates board configurations and solves them for multiple board variants (standard, hex/UFO, 7x7). Written in [PL/I](https://en.wikipedia.org/wiki/PL/I), originally compiled with IBM's PL/I compiler on Windows.

## Algorithm overview

The solver uses a **two-phase pipeline**: first enumerate all valid board configurations, then solve each one independently with depth-first search.

### Phase 1: Configuration generation (`config.pli`)

Enumerates all distinct starting positions for a given number of letter pieces (exits) and number pieces (helpers).

**Piece placement.** Nested loops place pieces one at a time onto the board. Letter pieces (X, Y, Z) are the pieces that must reach the center to solve the puzzle. Number pieces (1-9) are interchangeable helpers, so they are placed in sorted order (N2 > N1, N3 > N2, ...) to avoid generating duplicate permutations.

**Pruning.** Each candidate configuration is checked for:
- **Stranded pieces** (STD only) -- hand-coded geometric checks detect when a letter piece is isolated in a corner/region with no possible path to the center.
- **At least one legal move** -- at least one piece must have an adjacent empty cell with something to stop against.

**Symmetry dedup.** Configurations that are equivalent under board symmetry are deduplicated using a **trie** (prefix tree) keyed on sorted piece positions:
- **STD boards:** All 8 elements of the D4 symmetry group (4 rotations x 2 reflections) are checked. Rotation and reflection are applied via PL/I `TRANSLATE` tables that batch-permute all position indices simultaneously.
- **HEX boards:** 4 symmetries (left-right and top-bottom reflections).

The trie is a massive pre-allocated array (up to 16 million nodes for 5x5, 9 million for 7x7), where each node has one child pointer per possible cell value.

### Phase 2: Solving (`solver.pli`)

Each configuration is solved independently using **recursive depth-first search** (DFS).

**Board representation.** The board uses a padded 1D array indexed by `row * 10 + col`:
- 5x5 board: 55-element array, valid cells at positions 11-15, 21-25, ..., 51-55
- 7x7 board: 77-element array, valid cells at positions 11-17, 21-27, ..., 71-77

The padding provides implicit wall detection -- sliding a piece by +1 (right), -1 (left), +10 (down), or -10 (up) naturally hits padding cells when going off-board.

**Sliding.** Move generation is fully hand-coded per cell position using cascading IF chains. For example, sliding right from row 1 col 1:
```
IF B(12) = '-' THEN
  IF B(13) = '-' THEN
    IF B(14) = '-' THEN
      IF B(15) = '-' THEN;   /* slides off board -- no move */
      ELSE CALL MOVE(RIGHT,14);
    ELSE CALL MOVE(RIGHT,13);
  ELSE CALL MOVE(RIGHT,12);
```
A piece must stop against another piece; sliding into empty space off the board is not a valid move (the core Lunar Lockout rule).

**Search strategy:**
1. Try moving letter pieces first (priority), then number pieces
2. After each move, check if a letter piece reached the center (solved)
3. For multi-letter puzzles, remove the solved piece and continue searching
4. Track both **moves** (grouped: consecutive slides of the same piece = 1 move) and **steps** (individual slides)
5. Once a solution is found with N moves, prune any path exceeding N moves
6. Avoid immediately undoing the previous slide (don't try the opposite direction on the same piece)
7. Detect move loops -- skip if a piece returns to a position it already visited in the current path

**Visited states.** A trie (same structure as config generation) keyed on sorted piece positions. The leaf stores the grouped-move count that first reached the state. A state is revisited only if the current path has equal or fewer grouped moves, ensuring all minimum-move solutions are found.

**Solution recording.** Up to 2000 solutions are stored per configuration. The solver tracks:
- Minimum grouped moves (primary metric)
- Minimum steps among minimum-move solutions
- Count of distinct minimum-move solutions
- Maximum search depth reached

**Insignificant piece detection.** After solving, the solver replays each minimum-step solution to identify pieces that were never moved and never used as a stopper. These "insignificant" pieces don't contribute to any solution.

### Moves vs steps

This distinction is important and matches the terminology used in `ll-solver`:

| jr-solver term | ll-solver term | Definition |
|----------------|----------------|------------|
| **Moves** | Grouped moves | Consecutive slides of the same piece count as 1 |
| **Steps** | Raw slides | Each individual slide is 1 |

Moves are the primary difficulty metric (what a player counts). A 3-move solution might involve 5 or more individual steps.

## Board variants

Controlled by the `%TYPE` preprocessor macro set in wrapper files:

| Variant | Wrapper files | Grid | Directions | Symmetries |
|---------|--------------|------|------------|------------|
| **STD** (Standard) | `cfgstd.pli` / `solstd.pli` | 5x5 square | Left, Right, Up, Down | D4 (8) |
| **HEX** | `config.pli` / `solver.pli` | 5x5 hex diamond | NE, SE, S, SW, NW, N | LR + TB (4) |
| **7x7** | `cfg7x7.pli` / `solver.cpy` | 7x7 square | Left, Right, Up, Down | D4 (8) |

For HEX, the hex grid is embedded in the rectangular array at 45 degrees. The six hex directions map to index deltas: NE=+1, SE=+10, S=+9, SW=-1, NW=-10, N=-9.

## Source files

| File | Description |
|------|-------------|
| `src/config.pli` | Configuration generator (HEX/UFO variant, includes STD via preprocessor) |
| `src/solver.pli` | Solver (HEX/UFO variant, includes STD via preprocessor) |
| `src/cfgstd.pli` | Wrapper: sets `%TYPE = 'STD'` and includes `config.pli` |
| `src/solstd.pli` | Wrapper: sets `%TYPE = 'STD'` and includes `solver.pli` |
| `src/cfg7x7.pli` | 7x7 board configuration generator (standalone) |
| `src/config-7x7-v2.pli` | 7x7 config generator with both STD and HEX code paths |
| `src/solver-7x7.pli` | 7x7 solver with both STD and HEX code paths |
| `src/solver.cpy` | 7x7 solver declarations (PL/I copybook) |
| `src/solstd.cod` | Compiled solver output data |

## Pre-computed data

`data/hex/` contains results for the hex board variant, organized by exit and helper count (e.g., `hex24/` = 2 exits, 4 helpers):

| File | Description |
|------|-------------|
| `solution.dat` | Binary solution data |
| `solution.txt` | Human-readable solution listings |
| `solut001.txt` ... | Paginated solution files (large sets split across files) |
| `npcfg.txt` | Configuration count summary |
| `moststep.txt` | Puzzles requiring the most steps |
| `mostmove.txt` | Puzzles requiring the most moves |
| `mostexit.txt` | Puzzles with the most exit moves |
| `highdif.txt` | Puzzles with highest difficulty (steps - moves) |
| `highsum.txt` | Puzzles with highest sum (steps + moves) |
| `lowperct.txt` | Puzzles with lowest solve percentage |
| `oneexit.txt` | Single-exit puzzles |

## Comparison with ll-solver

| Aspect | jr-solver | ll-solver |
|--------|-----------|-----------|
| Language | PL/I | C++17 |
| Search direction | Forward DFS from each config | Retrograde BFS from solved states |
| Dedup | Positional trie with D4 symmetry | Collision-signature + CSP compaction + state-set hash |
| Visited states | Trie (prefix tree) | Hash sets |
| Move generation | Hand-coded per-cell IF chains | Programmatic loop with wall detection |
| Variants | STD, HEX, 7x7 | Standard, Solitaire, UFO, French |
| Symmetry in solve | None (config dedup only) | D4 canonicalization throughout |

## Related projects

- [`ll-solver/`](../ll-solver/) -- C++ reimplementation with retrograde BFS, collision-signature dedup, and CSP compaction
- [`spaceport-solitaire/`](../spaceport-solitaire/) -- React web app that consumes generated puzzle data
