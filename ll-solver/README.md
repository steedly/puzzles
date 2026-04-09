# ll-solver — Lunar Lockout Puzzle Enumerator

A C++ engine that finds **every solvable Lunar Lockout starting position** on a board, deduplicates them by gameplay similarity, picks a diverse subset, computes optimal solutions, and writes a compact puzzle file (`.llp`). Supports square boards (7×7 with 4 directions) and hex diamond boards (7×7 with 6 directions).

## Game Rules

- Robots slide in cardinal directions until blocked by **another robot** (wall stops are illegal).
- **Exit robots** disappear when they reach the center cell.
- **Helper robots** are blockers only — they never exit.
- **Win condition**: all exit robots have exited the board.

---

## The Problem We're Solving — A Narrative

Before diving into the algorithm, it's worth understanding *why* the algorithm has the shape it does. Each design choice exists to solve a specific problem that the previous step uncovered.

### Why brute force doesn't work

The naive approach is to enumerate every possible robot placement, check whether it's solvable, and output the solvable ones. For 7 robots on a 7×7 board, that's hundreds of billions of arrangements — and we'd have to *solve* each one to know if it's worth keeping. Even at a microsecond per check, that's days of computation. And it would be wasted: most of those puzzles are duplicates of each other in ways that matter to a player. Two puzzles that are mirror images of each other "feel" identical. Two puzzles where the robots are in different cells but the solution involves the same sequence of bumps and slides "play" identically. We need to be much smarter than enumerate-and-check.

### The trick: flip the problem around

Instead of asking "which positions are solvable?", we ask "which positions can reach the goal?" — and we work backward from the goal. This single change converts an open-ended search ("try every position") into a structured one ("walk every path back from one known endpoint").

This is the foundation of everything that follows. The rest of the algorithm is layered on top of this idea, each layer addressing a problem the previous layer left behind.

---

## Stage 1 — Discovering Every Solvable Position (Retrograde BFS)

### The strategy: walk backward from the answer

Imagine a maze with one exit. The hard way to find every room that can reach the exit is to start at every room and try to walk to the exit. The easy way is to start *at* the exit and walk backward through every connecting passage. Whichever rooms you can reach this way are exactly the rooms that can reach the exit going forward.

That's what Stage 1 does, but with Lunar Lockout positions instead of maze rooms. We start with every "already won" arrangement (all exit robots already gone, helpers anywhere on the board) and work backward, one move at a time, discovering every position that could *reach* a won state. By the time the search peters out, we have a complete catalog of every solvable starting position.

This is called [retrograde analysis](https://en.wikipedia.org/wiki/Retrograde_analysis), implemented as a [breadth-first search](https://en.wikipedia.org/wiki/Breadth-first_search) (BFS): we explore one level of "moves away from won" at a time. Because BFS visits positions in order of increasing distance, the first time we see a given position is guaranteed to be at its **minimum number of slides** from a solved state.

### Symmetry: 8× speedup for free

A puzzle with all robots rotated 90° clockwise plays exactly the same way as the original. Same for mirror images. On a square board, there are 8 such "symmetry" transforms (4 rotations × 2 mirror flavors), known to mathematicians as the [dihedral group D4](https://en.wikipedia.org/wiki/Dihedral_group). We exploit this by **canonicalizing during the BFS**: every time we discover a position, we compute its 8 rotations/reflections, pick the "smallest" one (lexicographically), and only store that representative in our table.

This means the BFS only ever explores ~1/8 of the positions that a naive BFS would. Hex boards have a smaller symmetry group (only 4 transforms — see [Board Variants](#board-variants) for why), so they get a ~4× speedup instead of 8×.

The trick that makes this work: if state A can reach state B in one move, then any rotation/reflection of A can reach the corresponding rotation of B in the same kind of move. So when we expand a single canonical representative, we automatically discover everything that any of its rotations would have discovered.

### What we get out of Stage 1

A giant hash table mapping each canonical position to its **minimum slide distance** from a won state. Each entry is just 8 bytes (positions packed into 6 bits per robot, plus an 8-bit distance). For standard 7-piece, the largest single combo (2 exits + 5 helpers) finds **67 million canonical positions**.

A subtlety we'll come back to: this distance is **raw slides**, not **grouped moves**. A "grouped move" is what a player feels they're doing — sliding the same robot multiple times in a row counts as one move. Stage 4 handles that distinction. For now, raw slides are good enough.

### Cost in practice

The retrograde BFS is fast and parallelizes beautifully. On the 8-core machine we measured, it processes about 3 million states per second across all threads. The bottleneck is memory bandwidth for the hash table, not CPU work.

| Standard 7-piece combo | BFS states | BFS wall time |
|---|---|---|
| 1e+6h (1 exit, 6 helpers) | 32.5 M | ~20 s |
| 2e+5h (2 exits, 5 helpers) | 67.4 M | ~32 s |
| 3e+4h (3 exits, 4 helpers) | 75.3 M | ~33 s |
| 4e+3h (4 exits, 3 helpers) | 26.9 M | ~11 s |

Total BFS time across all combos: about 100 seconds. This is essentially free compared to what comes later.

---

## Stage 2 — Removing "Same Puzzle, Different Cells" (Collision Signatures)

### The new problem

Stage 1 already eliminated rotations and mirror images. But many remaining positions are still **strategically identical** to each other. Consider two puzzles where the robots are in completely different cells, but the solution to both involves the same sequence: "the exit robot slides up and is stopped by helper 1, then slides left and is stopped by helper 2, then slides down and exits." Same robots, same order, same kinds of bumps. To a player, these are the same puzzle wearing different costumes.

We need a way to fingerprint a puzzle by *what makes it tick* rather than by *where its pieces are*.

### How: trace the solution and record the moves

The retrograde BFS doesn't store solutions — only distances. To recover the moves of a particular puzzle, we walk forward from its starting position and at each step ask: "which slides take us to a position that's exactly one step closer to won?" Any move that does is on a shortest path. We follow it, repeat from the new position, and end up with the full sequence of moves.

For each move, we record three things: **who moved**, **which direction**, and **who stopped them**. For example: *(exit robot, up, helper 3)*. The full sequence of these triples is the **collision signature** of the puzzle.

### Making the signature truly identity-blind

The signature isn't quite enough on its own. Two puzzles might have the same structure but use robots in different orders, or be symmetry-related to each other. We do two normalizations:

1. **Rename robots by order of first appearance.** The first robot that does anything becomes "A", the first helper that gets bumped becomes "1", and so on. Now two puzzles that involve the same robots in the same roles produce the same names regardless of their actual labels.

2. **Pick the lexicographically smallest signature across all symmetry transforms.** A puzzle's solution might say "A slides Right" but its rotation says "A slides Up". By picking the alphabetically-smallest version of the signature across all 8 symmetry transforms (or 4 for hex), we collapse symmetry-equivalent puzzles to the same signature.

After these two steps, two puzzles with the same signature are guaranteed to play identically. We deduplicate: keep one representative per signature.

### Compactness preference (first appearance)

When multiple puzzles share the same signature, we don't keep an arbitrary one — we keep the **most compact** one. Specifically, we measure the smallest centered odd square (1×1, 3×3, 5×5, or 7×7) that contains all the *used* robots, and prefer the puzzle with the smallest such square. A puzzle where all the action happens within 2 cells of center is preferred over one where some helper sits in the corner doing nothing. Players see tidy, central puzzles instead of sparse ones with wasted space.

This compactness preference doesn't change *which* puzzles exist — it just picks a nicer-looking representative from each equivalence class. We'll see it again three more times in Stage 4.

### Cost in practice

The greedy trace costs ~1 µs per state, and the collision signature is short to compute. The whole stage runs in parallel. For the standard 1e+6h combo, this brings 30.8 million collected states down to **1.3 million unique signatures** — a ~24× reduction. For the 2e+5h combo it's 65 million → 7.9 million.

That's still a lot, which brings us to the next problem.

---

## Stage 3 — "Too Many Puzzles" (The Pre-Filter)

### The new problem

After Stage 2, we have millions of signature-unique puzzles. Each one is genuinely different from every other one. But:

1. **The next stage is expensive per puzzle.** Stage 4 runs a forward solver to find the optimal grouped-move solution for each surviving puzzle. That's ~milliseconds per puzzle. For 10K puzzles it's seconds. For 10M puzzles it's hours per combo.

2. **We don't actually want millions of puzzles in the final output.** The website serves up to ~1000 puzzles per "type" (combination of difficulty, robot count, etc.). Beyond a few thousand per type, more puzzles add nothing for players — there's already plenty of variety to choose from.

So we want to throw most of them away *before* the expensive Stage 4 — but throw them away in a way that keeps a representative spread, not a random sample.

### Two notions of "unique"

It's worth pausing here because the word "unique" is doing two different jobs:

- **Signature uniqueness** (Stage 2) catches *strategic equivalence*: same robots, same moves, same blockers. Two puzzles with identical signatures are the same puzzle.

- **Distribution uniqueness** (Stage 3) is about the *output collection*. Even after signature deduplication, many puzzles look almost identical to each other geometrically — same difficulty, same shape, slightly shifted positions. The output collection should *cover* the space of possible puzzles, not pile up dozens of near-identical examples in one part of it.

Stage 2 trims the puzzle space; Stage 3 picks a *representative sample* of what's left.

### Bucketing by difficulty proxy

We group the survivors by `(num_exits, num_helpers, minRawSlides)`. The first two are obvious — different robot counts feel different. The third (minimum raw slides) is a proxy for difficulty: it's the only difficulty signal we have at this stage, since we haven't computed grouped moves yet. Within each bucket, we aim to keep at most **N puzzles** (default N = 1000).

Buckets with ≤ N puzzles are kept entirely. Buckets with more get sampled.

### Diversity within each bucket: farthest-point sampling

Random sampling would over-represent dense regions of the puzzle space. We want a true *spread* of puzzles. The method we use is **farthest-point sampling** (also known as "greedy k-center"), a standard technique for picking diverse representatives from a set.

It needs two ingredients: a way to measure how "different" two puzzles are, and a procedure that uses that measure to pick a spread.

**The "fingerprint" of a puzzle.** For each puzzle, we compute the sorted list of pairwise Manhattan distances between every pair of its robots. So a puzzle with 5 robots produces a list of C(5,2) = 10 distances, sorted. This captures the *shape* of the arrangement: a tightly-clustered puzzle has small distances; a spread-out one has large. The fingerprint is invariant under rotation and reflection (because Manhattan distance doesn't care about orientation), so symmetry-related arrangements have identical fingerprints.

**The picking procedure.**
1. Start by picking the "most spread out" puzzle in the bucket — the one whose fingerprint has the largest sum.
2. Repeatedly pick the puzzle whose fingerprint is *farthest* (in Euclidean distance) from the closest already-picked fingerprint.
3. Stop after N picks.

The intuition: at each step, we're picking the puzzle that's least like anything we've already chosen. This guarantees a 2-approximation to the optimal coverage of the puzzle space — there's a mathematical theorem that says you can't do much better than this with a greedy algorithm.

### Keeping the cost down

For very large buckets (say, 7.9 million puzzles), running farthest-point sampling on the full set would be too expensive. Instead, we first take a deterministic 10×N sub-sample (10,000 puzzles for N=1000), then run farthest-point on the sub-sample. This bounds the work at O(10,000 × N) per bucket, which runs in well under a minute even for the biggest combos.

### The dramatic effect

For standard 7-piece, the pre-filter cuts millions of puzzles down to tens of thousands:

| Combo | After Stage 2 | After pre-filter | Reduction |
|---|---|---|---|
| 1e+6h | 1,312,469 | 22,658 | 58× |
| 2e+5h | **7,922,395** | **33,681** | **235×** |
| 3e+4h | 14,387,974 | 41,120 | 350× |
| 4e+3h | 6,369,387 | 48,522 | 131× |

This is the single largest optimization in the pipeline. Without it, the standard 7-piece run would have taken **80+ hours** (we measured this directly on an earlier attempt — it got 42% through one combo in 22 hours before being interrupted). With the pre-filter, the same run finishes in **5 hours** — a 16× speedup overall, with the savings concentrated in the next stage.

---

## Stage 4 — Computing the Best Solution (Forward 0-1 BFS)

### The grouped-move problem

Stage 1's BFS gave us the minimum number of *individual slides* to reach the goal. But that's not what players experience. A player's "move" is "I'll try robot A this turn" — and once you're moving robot A, you can slide it multiple times in a row without it counting as a separate turn. Two slides by the same robot count as **one grouped move**.

This distinction matters because the grouped-move-optimal solution is often *not* the same as the slide-optimal one. A solution with 18 individual slides but only 3 grouped moves (because one robot makes a long chain of slides) is much easier than one with 10 slides spread across 8 different robots.

So for each puzzle that survived the pre-filter, we need to find the solution that minimizes grouped moves.

### The algorithm: forward 0-1 BFS

We run a fresh search from each puzzle's starting position, but with an **augmented state**: not just `(robot positions)`, but `(robot positions, last-mover-cell)`. The last-mover-cell tells us which robot's "turn" we're in. Edges between augmented states have cost **0** if the same robot continues sliding (turn isn't ending) or cost **1** if a different robot starts moving (turn ends, new turn begins).

This is a [0-1 BFS](https://en.wikipedia.org/wiki/0-1_BFS), processed with a deque (double-ended queue): cost-0 edges push to the front, cost-1 edges push to the back. The first time the goal is reached, the cost is the minimum number of grouped moves.

### Why this is the bottleneck

Each puzzle's forward search visits 50–5,000 augmented states. With ~150,000 filtered puzzles in standard 7-piece, that's hundreds of millions of state expansions across the run. Stage 4 takes about 95% of the wall time. The good news: each puzzle's search is independent, so we parallelize across puzzles using OpenMP. On 8 cores we get a 7.7× parallel speedup.

### Three more dedup layers

Even after the pre-filter, three more dedup passes catch edge cases:

1. **D4-canonical of pruned positions, with exit count packed in.** Some puzzles have helpers that the optimal solution never touches. We "prune" those away and re-canonicalize — and that can reveal that the pruned puzzle is identical to another puzzle from a different combo (e.g., a 1-exit-5-helper puzzle that pruned to 1-exit-3-helpers might match another puzzle that started with 1 exit and 3 helpers).

2. **DP collision-signature dedup.** The greedy trace from Stage 2 found *some* solution to compute the signature, but the grouped-move-optimal solution from Stage 4 might be a different path — and the two paths might have slightly different collision signatures. We re-compute and re-deduplicate using the optimal signature.

3. **Forward state-set hash.** We compute the set of all board states reachable from the starting position and hash it. Two puzzles with the same reachable state set are equivalent in their game tree, even if we somehow missed them with the previous methods.

In each of these three layers, when duplicates are found, we keep the most compact representative. The metric here is **smallest bounding rectangle area**, tie-broken by **smallest sum-of-Manhattan-distances to center**. This is a tighter compactness measure than the centered-square metric in Stage 2: it picks puzzles whose pieces are clustered in a small rectangle near the center.

---

## Compactness preference: where it shows up

Throughout the pipeline, when we have multiple puzzles that are "the same" in some sense, we prefer the one that *looks tidiest*. This happens at four places:

| Stage | Metric | Where it's used |
|---|---|---|
| 2 | Smallest centered odd square (Chebyshev distance from center) | Tiebreaker among same-collision-signature puzzles |
| 4 layer 1 | Smallest bounding rectangle area, then smallest sum-Manhattan | D4-canonical-of-pruned dedup |
| 4 layer 2 | Same | DP collision-signature dedup |
| 4 layer 3 | Same | State-set hash dedup |

There's no longer an active **compaction** step that synthesizes tighter layouts (an older version of the code had one — a constraint-satisfaction search that tried to construct more-compact starting positions preserving the collision sequence — but it was removed because the natural variety of the BFS provides plenty of compact representatives without needing to synthesize new ones). The compactness preference is purely a tiebreaker among naturally-occurring duplicates.

---

## Pipeline summary

```
[Stage 1: Retrograde BFS]
   ↓ canonical positions tagged with raw-slide distances
[Stage 2: Greedy trace → collision-signature dedup]
   ↓ strategically unique puzzles
   ↓ (compactness tiebreaker: smallest centered odd square)
[Stage 3: Bucket by difficulty proxy + farthest-point sampling]
   ↓ at most ~1000 diverse puzzles per (exits, helpers, raw-slides) bucket
[Stage 4: Forward 0-1 BFS → optimal grouped moves]
[Stage 4 dedup layers 1, 2, 3]
   ↓ (compactness tiebreaker: smallest bounding rectangle, then Manhattan)
[Output to .llp file]
```

---

## Computational Cost: What We Saw on this Machine

> **For the full per-variant tables, peak memory by combo, parallel efficiency, and extrapolations to 8-piece runs and larger machines, see [`generation-timing.md`](./generation-timing.md).** This section gives the headline numbers and the per-stage flow that motivates the algorithm choices above.

All figures below come from the most recent generation run on an EC2 instance with **8 vCPUs and 15 GB RAM** running Amazon Linux 2023, using a PGO-optimized binary (`-O3 -march=native -flto -fopenmp -fprofile-use`).

### Headline numbers

| Variant | Pieces | Generated puzzles | Wall time |
|---|---|---|---|
| hex | 6 | 28,409 | 50 s |
| beehive | 6 | 116,111 | 1 h 19 m |
| ufo | 7 | 52,052 | 5 m 14 s |
| solitaire | 7 | 93,115 | 5 m 26 s |
| french | 7 | 128,188 | 21 m 47 s |
| standard | 7 | 183,837 | **5 h 1 m** |
| **Total** | — | **601,712** | **~7.3 hours** |

CPU times, peak RSS, and per-variant breakdowns are in [`generation-timing.md`](./generation-timing.md). The 5-hour standard 7-piece run alone consumed about 38 CPU-hours across the 8 cores.

### Per-stage breakdown for standard 7-piece (the worst case)

The standard variant is by far the most expensive — both because the full 7×7 board gives the largest search space and because the multi-exit combos blow up state counts. Here's how each combo flows through the pipeline:

| Combo | Stage 1 BFS states | Stage 2 unique | Stage 3 filtered | Stage 4 emitted | Pass 3 wall |
|---|---|---|---|---|---|
| 1e+5h (6 pieces) | 2,135,377 | 78,058 | 14,908 | 12,619 | 5 s |
| 1e+6h | 32,543,208 | 1,312,469 | 22,658 | 20,887 | 4 m 46 s |
| 2e+4h | 1,691,128 | 169,228 | 22,095 | 18,897 | 14 s |
| **2e+5h** | **67,427,544** | **7,922,395** | **33,681** | **32,025** | **13 m 18 s** |
| 3e+3h | 295,099 | 36,617 | 15,286 | 12,389 | 12 s |
| **3e+4h** | **75,337,813** | **14,387,974** | **41,120** | **39,116** | **38 m 21 s** |
| 4e+2h | 1,496 | 92 | 92 | 65 | < 1 s |
| **4e+3h** | **26,856,076** | **6,369,387** | **48,522** | **45,760** | **3 h 50 m** |

The **4e+3h combo (4 exits, 3 helpers)** was the long pole — its Stage 4 alone took 3 hours 50 minutes. It has the most "crowded" board (4 separate exits all needing to reach center while helpers are in the way), which means each individual puzzle's forward search explores a much larger augmented state space than any other combo. The pre-filter cuts the work from 6.4 million puzzles to 48,522, but each of those 48K puzzles is individually expensive to solve.

### Where the time went (standard 7-piece)

| Phase | Wall time | % of total |
|---|---|---|
| Stage 1: Retrograde BFS (across all combos) | ~100 s | 0.6 % |
| Stage 2: Greedy trace + collision-sig dedup | ~13 m | 4.3 % |
| Stage 3: Pre-filter | ~2 m | 0.7 % |
| Stage 4: Forward 0-1 BFS + 3-layer dedup | ~4 h 47 m | **94.4 %** |
| **Total** | **~5 h 1 m** | 100 % |

Stage 4 is the bottleneck by a wide margin. The forward 0-1 BFS is the only stage whose per-item cost grows substantially with robot count, and unlike the BFS in Stage 1 (which is bounded by the total number of canonical states), Stage 4's cost is bounded by `(filtered puzzles) × (per-puzzle search size)`. The per-puzzle search dominates in the multi-exit combos.

### Memory usage

The largest memory consumer is the Stage 1 FlatMap, which stores one 8-byte entry per canonical state at ≤ 75 % load factor. For standard 7-piece, the biggest single combo (3e+4h, 75 M states) uses about **800 MB** for the FlatMap alone, and peak RSS across the run was about **6 GB** (FlatMap plus working memory: survivor lists, fingerprints for the pre-filter, OpenMP thread-local buffers, output line buffers).

The FlatMap is freed between combos so peak memory is set by the largest single combo, not the sum across combos. The other 9 GB of the machine's RAM was unused — we have headroom for larger runs. Per-combo memory figures and 8-piece extrapolations are in [`generation-timing.md`](./generation-timing.md).

---

## Aside: the "augmented BFS" experiment (and why we didn't ship it)

You might wonder: if Stage 4 (the forward 0-1 BFS) is 94% of our time, can we eliminate it by computing grouped moves directly in the Stage 1 BFS? The hypothesis: augment each retrograde-BFS state with the "last-mover cell" so the BFS itself tracks grouped moves. The expected memory cost: roughly **N times more states**, where N is the number of robots, since each board state has N possible last-mover values.

We tried it. It didn't work — and the *way* it didn't work is interesting.

### What we built

A `retrograde_grouped()` function that:
- Augmented each state with the cell of the most-recently-moved robot
- Used a deque-based 0-1 BFS in the retrograde direction (cost 0 for same-robot continuations, cost 1 for new-robot moves)
- Canonicalized augmented states by transforming both positions and last-mover-cell with the same symmetry transform

### What broke

The augmented BFS produced **incorrect grouped-move counts** for many states. We spot-checked 500 states against the forward-solver ground truth and got 485 mismatches. After several rounds of debugging the cost-direction logic and the `EXITED` sentinel handling, we narrowed it to ~22 % mismatches but couldn't get to zero.

The fundamental issue we hit: in the *retrograde* direction, the edge cost between an augmented state `(S, L)` and its predecessor depends on how the predecessor was reached in *forward* time — and in forward time there are multiple ways. For each predecessor position P, the augmented predecessor `(P, M)` has a different cost depending on M (the last-mover at P). Generating all of them on demand created a fan-out closer to N² than N, because each `(P, M)` needed to be re-discovered from multiple successors with different cost contributions.

The forward 0-1 BFS in Stage 4 doesn't have this problem because cost flows naturally from start (cost 0) outward — the "previous mover" is determined by the path you took to get there. In the retrograde direction, "previous mover" is determined by where you're going, which doesn't compose cleanly with reverse-move generation.

### Did we measure the N× memory blowup hypothesis?

Not on a real workload, because the implementation never produced correct answers. On the small test case (1 exit + 3 helpers, ~5,000 base states), the augmented BFS terminated *early* (cost-bounded pruning kicked in) and stored *fewer* augmented states than the original retrograde BFS stored base states. So the apparent memory ratio was roughly 1× — but only because the BFS wasn't exploring everything it should have.

The honest answer: the N× hypothesis was the *optimistic* upper bound, assuming the BFS explored every (positions × last-mover) combination. Whether the actual memory cost would be N×, less, or more in a working implementation depends on details of the cost-pruning and the 0-1 BFS dynamics that we didn't get to validate. The ~22% mismatch rate suggests there's a real algorithmic issue, not just a coding bug, that we'd need to design around.

### What we did instead

We invested in the **pre-filter** (Stage 3) instead. The pre-filter doesn't eliminate Stage 4 — but it bounds the number of puzzles that need to flow through it. The end result is the same speedup target (16× for standard 7-piece, from 80+ hours down to 5 hours) achieved by *reducing the work* rather than *replacing the algorithm*. The pre-filter's correctness is straightforward (it picks a subset of already-correct puzzles), so we shipped it.

The augmented BFS remains an interesting future direction. If somebody wants to make 8-piece runs much faster, the bookkeeping it needs is solvable — it just needs more design care than we had time for in this round.

---

## Performance optimizations applied

These are the optimizations layered on top of the basic algorithm to get the throughput we measured above.

1. **Canonical BFS in Stage 1.** Eliminates D4-symmetric states during exploration, reducing the state space by 8× for square boards (4× for hex). Without this, every other phase would do 8× more work for nothing.

2. **Lock-free parallel insertion.** The Stage 1 FlatMap uses atomic compare-and-swap on packed key+value entries to support OpenMP-parallel BFS without locks. Parallel speedup on 8 cores is ~7.7×.

3. **Precomputed occupancy bitmask in `forward_move()`.** The function that simulates a single robot slide previously rebuilt the "which cells are occupied" bitmask on every call. We compute it once per state and pass it to all robot×direction calls for that state. This eliminated about 24 redundant rebuilds per state expansion.

4. **Deferred forward BFS for Stage 4 layer 3 dedup.** The forward state-set hash (used by the third dedup layer in Stage 4) used to be computed for every puzzle in the parallel solve loop. We moved it to run only after layers 1 and 2 finish, so it only runs on the ~77% of puzzles that survive those layers. Saves about 23% of forward-BFS calls.

5. **PGO + LTO + `-march=native`.** Profile-guided optimization, link-time optimization, and CPU-specific instructions together give ~13% speedup over plain `-O3` on this machine.

6. **Pre-filter with farthest-point sampling.** The largest single optimization, by a wide margin. Reduces Stage 4 work by 100–235× for the biggest combos. Total impact on standard 7-piece: from 80+ hours down to 5 hours.

---

## Feasibility on different hardware

**Why hex variants need fewer pieces.** Hex boards have 6 directions of movement instead of 4. Each board configuration can transition to more successor states, so the BFS state space grows faster with each added piece. We cap hex variants at 6 pieces in production to keep generation tractable on consumer hardware.

**The hard ceiling: 9 robots.** The packed FlatMap encoding uses 6 bits per robot position. For 9 robots that's 54 bits of key plus 8 bits of value, leaving exactly 2 bits of slack in a 64-bit entry. Beyond 9 robots, the encoding doesn't fit and we'd need a wider hash table.

For estimates of memory and wall time at higher piece counts (7-piece beehive, 8-piece standard, 8-piece beehive), see the **Extrapolation for larger piece counts** section of [`generation-timing.md`](./generation-timing.md).

---

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

### PGO-optimized build
```bash
make enumerate-pgo
```
This does a profile-generate build, runs a small training workload, then does a profile-use build. Yields ~13 % speedup over plain `-O3`.

---

## Usage

```bash
./enumerate [max_exits] [max_total] [min_moves] [max_moves] [variant] [max_per_bucket]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_exits` | 1 | Maximum number of exit robots |
| `max_total` | 6 | Maximum total robots (exits + helpers) |
| `min_moves` | 1 | Minimum grouped moves to include |
| `max_moves` | 99 | Maximum grouped moves to include |
| `variant` | standard | Board variant (see below) |
| `max_per_bucket` | 0 | If > 0, enable Stage 3 pre-filter with this bucket cap |

When `max_per_bucket = 0`, Stage 3 is disabled and every signature-unique puzzle goes through Stage 4 (the original behavior). For production runs, use `max_per_bucket = 1000` to enable diverse pre-filtering.

Puzzle data goes to **stdout**; progress/stats go to **stderr**.

### Examples

```bash
# Standard run (production): 4 exits, up to 7 robots, with pre-filter
./enumerate 4 7 1 99 standard 1000 > puzzles.llp

# Hex variants run with up to 6 pieces
./enumerate 4 6 1 99 hex 1000 > puzzles-hex.llp
./enumerate 4 6 1 99 beehive 1000 > puzzles-beehive.llp

# Quick test: 1 exit, up to 3 helpers, no pre-filter
./enumerate 1 4 1 10
```

---

## Board Variants

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
| `beehive` | 49 | 0 | Full 7×7 hex diamond |

Hex directions are the 4 cardinal directions plus 2 diagonals: NW(-1,0), SE(+1,0), SW(0,-1), NE(0,+1), N-diag(-1,+1), S-diag(+1,-1). The hex diamond is visually displayed as a rotated square grid with hexagonal cells.

**Why hex has only 4 symmetries, not 8.** On a square board, all 8 D4 transforms (4 rotations + 4 reflections) preserve the 4 cardinal directions — flipping left and right just swaps "left" and "right", which are still valid moves. But on a hex board, two of the 6 directions are *diagonals* (NE-SW axis). A horizontal or vertical flip maps these diagonals to directions that don't exist on the hex grid — like trying to move a chess bishop diagonally on a board that only has horizontal and vertical lines. So those flips don't preserve gameplay: the same arrangement of pieces would have different legal moves after flipping. Only 4 transforms keep all 6 hex directions valid: identity, 180° rotation, and the two diagonal reflections (swapping rows with columns). These form a [Klein four-group](https://en.wikipedia.org/wiki/Klein_four-group).

Blocked cells (square variants only) act as walls — robots cannot occupy or slide through them, and stopping against one is a wall-stop (illegal). All blocked patterns are D4-symmetric, so canonicalization works unchanged.

### How variants relate to each other

The four square variants form a hierarchy based on which cells are blocked:

```
Standard (0 blocked)
  └─ French (4 blocked: inner corners)
       ├─ Solitaire (16 blocked: 2×2 corners ⊃ inner corners)
       └─ UFO (24 blocked: full border ⊃ inner corners)
```

Solitaire and UFO are **incomparable** — Solitaire blocks the 2×2 corners that UFO leaves open, while UFO blocks border-edge cells that Solitaire leaves open.

**Why solvable positions form supersets.** Blocked cells only *prevent* moves — they never *enable* them. A robot slides until it hits another robot; a blocked cell in the path simply makes that slide illegal. So any valid move on a restricted board is also valid on a less-restricted board. This means if a position is solvable on Solitaire, the exact same move sequence works on French and Standard:

> Standard ⊇ French ⊇ Solitaire, and Standard ⊇ French ⊇ UFO

**Why minimum moves can only increase.** More blocked cells mean fewer legal moves at each step — edges are removed from the state graph, never added. A shorter path that existed on Standard might be blocked on French, forcing a longer detour. So:

> Minimum moves: Standard ≤ French ≤ Solitaire (and Standard ≤ French ≤ UFO)

**Why puzzle counts decrease with restriction.** With fewer solvable positions and fewer collision signatures, each restriction reduces the number of unique puzzles that survive dedup:

> Puzzle counts (this run): Standard (184K) > French (128K) > Solitaire (93K) > UFO (52K)

---

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

---

## Testing

Run the full validation pipeline:

```bash
make test
```

This runs:
1. **110+ unit tests** (`test_enumerate`) — internal function correctness (includes hex-specific tests)
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
