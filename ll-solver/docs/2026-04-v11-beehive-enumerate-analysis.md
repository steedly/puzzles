# v11 beehive enumerate — algorithm, memory, compute

Snapshot of what the 7-piece beehive enumerate pipeline actually did on a
16-core / 32 GB EC2 instance (April 2026). Purpose: keep a durable
record so future experiments don't repeat these measurements or the
failure modes we hit.

## Background

**Project context.** This repo hosts two tightly-coupled programs:

- `ll-solver/enumerate.cpp` — a C++17 puzzle enumerator that generates
  every interesting Lunar Lockout / Spaceport Solitaire puzzle for a
  given board variant and piece count, and emits them (with optimal
  solutions) to a `.llp` file.
- `spaceport-solitaire/` — a React web app that loads an `.llp`
  library and lets users play the puzzles.

**Lunar Lockout.** A Lunar Lockout puzzle is a 7×7 grid with a
central goal cell and two kinds of robots: *exits* (must reach the
goal) and *helpers* (blockers only). Robots slide in straight lines
until they hit a wall, a blocked cell, or another robot. Solved when
every exit has reached the goal.

**Variants.** Six variants ship with the app, differing in
geometry and blocked cells:

- `standard`: 7×7 square, 4 directions (U/D/L/R), no blocked cells.
- `solitaire`, `ufo`, `french`: square with different corner-block
  masks.
- `hex`: 7×7 hex diamond (the same grid rotated 45° with 2 extra
  diagonal directions), border ring blocked → 5×5 inner diamond.
- `beehive`: full 7×7 hex diamond, no blocks — the widest hex
  variant. Generating beehive covers every hex puzzle.

**Generation pipeline.** `enumerate` takes `(max_exits, max_pieces,
min_moves, max_moves, variant, max_per_bucket)` and walks the outer
loop `(num_exits, num_helpers)` from `1+1` up to `max_pieces` total.
For each combo it runs the 4-stage pipeline below and appends puzzles
to stdout. Cross-combo dedup state (`seen_pruned_canons`,
`seen_dp_sigs`, `seen_state_sets`) is preserved across combos so the
same underlying position isn't emitted twice under different
piece-count labels.

**Unified library.** Since April 2026 the app consumes a single
`puzzles.llp` with a **10-field format** that tags each puzzle with
`variantFlags`, a bitmask indicating which of the 6 variants the
puzzle is playable under (bit 0 = standard, bit 5 = beehive, bit 6 =
requires diagonal moves). The client filters at runtime — no
per-variant fetches, no per-variant files shipped. A single beehive
run generates 10-field output that populates every variant slice
automatically.

**Why this particular run existed.** We were cutting over the web app
from six per-variant `.llp` files to one unified `puzzles.llp`. v7-v10
were earlier attempts that died or were killed for various reasons
(memory OOM at different stages, parallelism bugs, manual kills to
apply optimizations). v11 was the first run to complete enough combos
to ship a viable unified library. It completed 17/18 combos (missing
only hex 4-exit + 3-helper which OOM'd in Layer 3). The final shipped
library adds back ~25K square 4+3 puzzles from a prior legacy
enumeration → 172,121 puzzles total in production.

## Scope of this run

- Command: `./enumerate 4 7 1 99 beehive 500` (max 4 exits, max 7 total
  pieces, `max_per_bucket=500`).
- Host: 16-core, 32 GB RAM.
- Binary commit: `db56997` (`wip/pass3-and-ui-unified` branch), with
  LPT scheduling (`20b6cc3`), prefetch experiment (`8cf57ec`), FlatMap
  panic guards (`4295551`), and Layer 3 heavy/light partition
  (`db56997`).
- Outcome: 17 of 18 exit+helper combos completed cleanly (146,988
  puzzles emitted); **4+3 OOM-killed in Layer 3** after its pass 3
  solve had already completed.

## Algorithm — four stages

The pipeline runs independently per `(num_exits, num_helpers)` combo,
inside an outer loop. Combos go `1+1, 1+2, …, 1+6, 2+1, …, 4+3`.

### Stage 1 — Retrograde BFS (`retrograde()` in enumerate.cpp:591)

From goal states (all exits at center, helpers anywhere) walk BFS
BACKWARD one raw slide at a time, recording the minimum raw-slide
distance for every reachable packed state. The output is a giant
`FlatMap<State, uint8_t>` keyed by the 6×n-bit state representation
(n = exits + helpers); the value is the retrograde depth in raw slides.

Parallelism: level-synchronous parallel BFS, `omp parallel`, 16 threads.
Uses `FlatMap::atomic_emplace` for lock-free insertion into a shared
`seen` map. Load factor kept ≤ 75% via `ensure_parallel_capacity` at the
start of each level.

This stage dominates pass-2-and-earlier memory: one `FlatMap` over
**all** reachable states for the combo, ~8-11 bytes per state at 75%
load.

### Stage 2 — Collect + sort (`emit()` pass 1 in enumerate.cpp)

Pull every state out of the retrograde `FlatMap` into a flat
`std::vector<Rec>` (state + depth), then sort by depth ascending (LPT
groundwork). Peak happens when both the `FlatMap` and the `vector` are
alive; as soon as the `vector` is built the `FlatMap` is freed.

### Stage 3 — Greedy collision-sig dedup (`emit()` pass 2)

For each state in sorted order, call `solve_min_raw()` (a fast
forward BFS producing a raw-slides-optimal sequence), canonicalize the
solution via collision signature under D4 (square) or Klein (hex)
symmetry, and keep the first occurrence of each signature. Output:
~70-80% of states deduped, leaving "unique" survivors.

This stage is CPU-bound on `solve_min_raw` (16-thread parallel over
states). Memory at start: already-allocated `recs` vector. Memory at
end: `recs` shrinks to just survivors.

Peak memory here can briefly DOUBLE while the dedup builds its hash
index of signatures — e.g. 3+4 peak 28.8 GB, 4+3 peak 29.2 GB during
pass 2 even though post-dedup RSS drops to ~half.

### Stage 4 — Pre-filter + pass 3 solve + Layer 3 + rebucket (`emit()`)

1. **Pre-filter** (`enumerate.cpp` around line 1850). Farthest-point
   diversity sampling caps each (helpers, minRawSlides) bucket at
   `max_per_bucket=500` and keeps the most spatially-diverse survivors.
   Drops 98-99% of remaining candidates.
2. **Pass 3 solve** (`solve_min_grouped`, 0-1 BFS, lines 2100-2130
   parallel over survivors). For each survivor, compute the
   grouped-moves-optimal solution (the UI metric — consecutive slides
   by one robot count as one grouped move). Populates
   `survivor_states`, `survivor_min_grouped`, `survivor_solutions`.
   LPT ordering (retrograde-depth descending) concentrates the hardest
   puzzles at the head.
3. **Layer 3** (`forward_bfs_states` loop, ~lines 2370-2420). For each
   surviving puzzle, run a forward 0-1 BFS to enumerate its complete
   forward-reachable set, then hash the set for a final dedup layer.
   **Heavy puzzles (pruned_ns ≥ 7)** run SERIAL `forward_bfs_states`
   4-wide — this avoids the parallel variant's aggressive pre-grow
   which worst-cases at `cur.size() * NUM_DIRS * n` and can balloon a
   single FlatMap to 5-11 GB at peak frontier. Light puzzles
   (pruned_ns ≤ 6) run the parallel variant 4 outer × 4 inner = 16
   cores.
4. **Emit** + rebucket (split by
   `(helpers, minRawSlides, square_size, requires_diagonal)` and re-cap
   at 500 so each runtime-variant slice has enough candidates).

Three dedup layers fire in pass 3: (a) D4-canonical positions, (b) DP
collision-sig, (c) forward-state-set hash. Each removes a few percent
additional duplicates.

## Key data structures and files

For someone picking this up cold, these are the code pointers you
need:

- **`FlatMap`** (`enumerate.cpp:285`). Custom open-addressed hash map
  packing a uint64 key and uint8 value into a single 64-bit slot.
  Supports serial `insert_new`/`upsert`/`find_val` (with 2× rehash)
  and parallel `atomic_emplace` (lock-free CAS, no rehash — requires
  `ensure_parallel_capacity` pre-grow). Dominates memory use.
- **State encoding** (`enumerate.cpp` top of file). Each robot's cell
  packed as 6 bits (cell index 0-48 in a 7×7 grid), concatenated into
  a `uint64_t`. `n` robots → `6*n` key bits. Exits come first in
  canonical sorted-by-cell order; helpers after. An `EXITED` sentinel
  cell (63) marks robots that have reached the goal.
- **`retrograde()`** (`enumerate.cpp:591`). Stage 1 parallel level-BFS
  producing the retrograde distance map.
- **`solve_min_raw()`** / **`solve_min_grouped()`** (search inside
  `enumerate.cpp`). Forward BFS (raw slides) and 0-1 BFS (grouped
  moves) respectively — used in Stage 3 pass 2 dedup and Stage 4
  pass 3 solve.
- **`forward_bfs_states()`** vs **`forward_bfs_states_parallel()`**.
  Serial BFS using `insert_new` (natural 2× rehash) vs level-parallel
  BFS using `atomic_emplace` + aggressive pre-grow. Layer 3 uses both
  — serial for heavy puzzles, parallel for light.
- **`compute_variant_flags()`** (`enumerate.cpp:1638`). Reads a
  puzzle's positions + solution and sets the per-variant bits of
  `variantFlags` used by the UI for runtime filtering.
- **Output format**. One puzzle per line:
  `id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|variantFlags|positions|solution`.
  Header comments at the top of the file describe field meanings.
  Parsed by `spaceport-solitaire/src/hooks/usePuzzleLibrary.js`.
- **Symmetry groups**:
  - Square (D4): 8 transforms — identity, 3 rotations, 4 reflections.
  - Hex (Klein 4-subgroup of D4 + 2 diagonal reflections): 6
    transforms. `SYM_INDICES[]` for hex = `{0, 2, 4, 5, 6, 7}` — the
    D4 transforms that preserve hex's 6 direction vectors (90° / 270°
    rotations are invalid because they rotate diagonal moves to
    non-hex directions).
- **Validator**. `ll-solver/validate_solutions.py` — Python-based
  correctness check. As of v11 cutover, supports mixed hex + square
  puzzles in one file (per-puzzle format detection by move length).

## Memory pattern per stage

Memory peaks follow a distinct pattern per combo. The heaviest combo
(3+4) is the clearest example — stage-by-stage snapshots of
`mem[...] rss=X MB peak=Y MB` from the v11 log:
- `mem[bfs_done]`      **16.2 GB** (Stage 1 retrograde complete,
  FlatMap still alive pre-collect).
- `mem[pass1_done]`    **18.0 GB** (Stage 2 collect: FlatMap + recs
  vector alive simultaneously).
- `mem[pass2_done]`    **28.8 GB** ← pass 2 dedup peak (signature
  hash-index + recs alive).
- `mem[prefilter_done]` ~21 GB (recs still large, prefilter running).
- `mem[recs_shrunk]`   ~10 GB (recs trimmed to 29,176 survivors).
- `mem[pass3_solve_done]` **10.1 GB** (solve_min_grouped doesn't add
  much).
- `mem[layer3_done]`   **27.6 GB** ← Layer 3 heavy-phase peak (4
  concurrent serial BFSes + baseline).

For **4+3** the Layer 3 peak crossed 32 GB and the kernel OOM-killed
the process. Pass 3 solve for 4+3 had already completed
(`mem[pass3_solve_done] rss=9838 MB peak=10092 MB` — 39,080 survivors,
19,969 cpu-sec burn).

## Per-combo metrics (v11, max_per_bucket=500)

All times are wall-clock seconds unless noted. RSS peaks are the
per-stage high-water marks (MB).

| E+H | Retro states | BFS s | Pass2 unique | Pass2 s | Pass2 peak MB | Prefilter → | Solve count | Solve CPU s | Solve max μs | Pass3 total s | Layer3 peak MB | Emitted |
|-----|-------------:|------:|-------------:|--------:|--------------:|------------:|------------:|------------:|-------------:|--------------:|---------------:|--------:|
| 1+1 |           21 |  0.01 |            2 |     0.0 |            20 |           2 |           2 |         0.0 |           21 |          0.00 |              4 |       2 |
| 1+2 |          610 |  0.01 |           14 |     0.0 |            20 |          14 |          14 |         0.0 |           27 |          0.01 |             20 |      14 |
| 1+3 |        16,769 |  0.01 |          634 |    0.0 |            36 |         634 |         634 |        0.01 |          105 |          0.01 |             36 |     558 |
| 1+4 |       507,023 |  0.17 |       40,872 |    0.07 |            38 |       6,415 |       6,415 |        1.13 |        5,572 |          0.46 |             39 |   5,822 |
| 1+5 |    10,154,771 |  2.65 |      799,172 |    2.77 |           466 |      12,773 |      12,773 |       14.9 |      170,655 |          8.21 |            257 |  11,684 |
| 1+6 |   103,789,544 |  33.7 |    2,921,311 |    31.3 |         5,127 |      14,308 |      14,308 |        722 |   30,915,341 |        459.51 |          1,702 |  12,622 |
| 2+1 |           27 |  0.00 |            2 |    0.00 |           671 |           2 |           2 |         0.0 |            7 |          0.01 |            671 |       2 |
| 2+2 |         1,833 |  0.00 |          168 |    0.00 |           671 |         168 |         168 |         0.0 |          112 |          0.00 |            671 |     157 |
| 2+3 |       251,908 |  0.10 |       47,448 |   0.08 |           671 |       8,260 |       8,260 |        3.43 |        5,541 |          0.92 |            671 |   7,600 |
| 2+4 |    18,756,258 |  4.34 |    4,168,731 |  12.05 |         1,629 |      21,182 |      21,182 |          106 |    1,581,946 |         30.7 |          1,022 |  20,025 |
| 2+5 |   284,451,000 | 82.6  |   31,735,765 | 169.3  |        14,213 |      23,582 |      23,582 |        3,153 |    88,010,098 |       2,500.8 |          7,605 |  21,763 |
| 3+1 |           29 |  0.00 |            2 |    0.01 |         3,077 |           2 |           2 |         0.0 |           13 |          0.00 |          3,077 |       2 |
| 3+2 |       10,964 |  0.00 |        1,798 |   0.01 |         3,077 |       1,798 |       1,798 |        0.51 |        4,005 |          0.12 |          3,077 |   1,494 |
| 3+3 |   14,279,100 |  3.11 |    4,467,492 |  13.21 |         3,077 |      25,407 |      25,407 |        4,190 |   49,008,850 |        352.32 |          3,285 |  24,048 |
| **3+4** | 438,915,082 | 127.7 | 97,983,538 | 407.6 |  **28,779** | **29,176** |      29,176 |       18,677 |  551,976,251 |     **11,875** |       **27,630** |  27,817 |
| 4+1 |           29 |  0.00 |            0 |   0.00 |         9,812 |           0 |           0 |         0.0 |            0 |          0.03 |          9,813 |       0 |
| 4+2 |      240,061 |  0.12 |       61,091 |   0.19 |         9,813 |      15,101 |      15,101 |       88,567 |  839,826,574 |      **7,874** |         10,841 |  13,378 |
| **4+3** | 356,117,053 | 95.6  | 108,984,566 | 488.4 | **29,221**  |   39,080   |      39,080 | **≥1.16M**  | **39.7B** |        (OOM)  |          (OOM) |       0 |

Notes on 4+2 and 4+3:

- **4+2** took 7,874 s pass-3 wall time despite only 15K survivors —
  4-exit DP state space is dramatically larger than 3-exit. One
  puzzle's grouped-moves DP peaked at **839 seconds**.
- **4+3** solve took ≥20 h wall and ≥1.16M CPU-sec with one outlier
  puzzle at **39,718 seconds (11 hours!)** for a single DP solve.
  Completed pass 3 solve; Layer 3 OOM-killed the process at RSS
  30.1 GB (32 GB cap) before emitting.

## Compute cost scaling

Two scaling regimes dominate:

1. **Retrograde BFS state count** grows roughly geometrically in
   `num_helpers`. Key breakpoints:
   - 1+5 → 1+6: 10M → 104M states (~10×)
   - 2+4 → 2+5: 18M → 284M states (~15×)
   - 3+3 → 3+4: 14M → 439M states (~30×)

2. **Per-puzzle `solve_min_grouped` cost** grows MUCH faster in
   `num_exits` than in `num_helpers`:

| combo | solve CPU per puzzle (avg, CPU-sec) |
|-------|------------------------------------:|
| 2+5   | 0.134 |
| 3+3   | 0.165 |
| 3+4   | 0.640 |
| 4+2   | 5.866 |
| 4+3   | 29.67 (observed over first 7,500 puzzles before OOM) |

4-exit DP state space blowup is the single biggest contributor to
wall-clock cost at 7-piece scale. 3+4 burned 18,677 CPU-sec; 4+3 was
on pace for ~1.2M CPU-sec.

## What worked (keep doing)

- **LPT scheduling** (commit `20b6cc3`): sort pass-3 survivors by
  retrograde depth descending. Concentrates hardest work at the head
  of the 16-thread parallel loop. Confirmed empirically: on 4+3 the
  first 7,500 puzzles averaged 100.8 CPU-sec each; the next batch
  averaged 21.8 — a 5× LPT decay once past the hard head.
- **FlatMap panic guards** (commit `4295551`): bounded probe loop in
  `atomic_emplace` + `insert_new` + `find_val` + `upsert`. Converts
  the silent infinite-spin-when-full bug class into a loud
  `std::abort` with a diagnostic. Made the 4×4-parallel BFS bug
  debuggable in minutes instead of hours.
- **Layer 3 heavy/light partition** (commit `db56997`): heavy
  (pruned ≥ 7) uses SERIAL `forward_bfs_states` 4-wide, avoiding the
  parallel variant's aggressive pre-grow. Light uses the parallel
  variant 4×4 for 16-core utilization. Both worked, though heavy
  phase on 3+4 took ~3 h at 4 cores.
- **`max_per_bucket=500`** keeps the final library ~150K puzzles per
  board-type while still giving each difficulty-and-geometry bucket
  meaningful coverage. Pre-filter drops 98-99% of survivors before
  the expensive pass 3 solve runs — essential.

## What didn't work (avoid repeating)

- **4×4 parallel `forward_bfs_states` with aggressive pre-grow**:
  the `ensure_parallel_capacity(cur.size() * NUM_DIRS * n)` bound is
  correct for worst-case safety but wildly over-provisions at deep
  BFS levels where `cur.size()` is 10-30M. Single FlatMap balloons
  to 5-11 GB. Two concurrent → blows 32 GB cap. This was v9 and v10's
  OOM.
- **Serial 4-wide heavy + 4-wide light at 32 GB**: still OOMs 4+3 in
  Layer 3 because **pass 3 baseline was 20 GB** going in (recs +
  survivor_states not yet freed) and 4 concurrent heavy serial
  FlatMaps added another 10+ GB.
- **Uniform `solve_min_grouped`** for 4-exit 7-piece puzzles: the DP
  state space explodes. One puzzle took 11 hours. Shipping hex 4+3
  on current solver is impractical.

## Future experiments — open problems

High-value follow-ups, in rough priority order:

1. **Optimize `solve_min_grouped` for 4-exit workloads.** This is
   the single biggest win. Profile the DP state-space representation
   and look for memoization/pruning/canonical-form improvements. A
   10× speedup unblocks 4+3 hex and shrinks 3+4 solve wall time
   roughly 10× too.

2. **Better pre-grow for parallel `forward_bfs_states`.** Track
   observed branching ratio per level and pre-grow to
   `seen.size() + cur.size() * observed_ratio * safety` instead of
   worst-case. Enables nested 4×4 on heavy puzzles without the
   memory blow-up. Fallback: make `atomic_emplace` fail soft on
   overflow and rehash serially at the level boundary.

3. **Free pass-3 baseline earlier.** The 20 GB baseline going into
   Layer 3 on hard combos (recs + survivor_states + output_lines)
   could drop to ~5 GB if we serialize output_lines to disk as
   they're built instead of buffering in RAM. Would give Layer 3
   headroom for more concurrent or larger FlatMaps.

4. **Streaming pass 2 output.** Pass 2's `(signature → best_rec)`
   hash alone peaked at 28-29 GB on 3+4 and 4+3. A disk-backed /
   streaming variant would let us enumerate 8+ piece positions on
   the same machine.

5. **Smarter LPT — front-load memory, not just CPU.** LPT currently
   sorts by retrograde depth. Sort also by forward-BFS-size
   estimate so the biggest memory consumers run early (while
   baseline is lowest) and memory monotonically decreases.

6. **Profile the real pre-filter cost/benefit.** Pre-filter drops
   99% of candidates in microseconds — but the ones it keeps
   dominate pass 3. Is farthest-point-diversity actually picking the
   right survivors for the rebucket step, or are we doing work on
   puzzles that rebucket will drop anyway?

## Rough machine-specific heuristics

On a **32 GB / 16-core** box:
- Comfortable: any combo with pass-2-peak < 25 GB — all combos except
  3+4 and 4+3.
- Tight: 3+4 (pass 2 28.8 GB, Layer 3 27.6 GB). Runs with current
  partition; no margin.
- Infeasible without algorithm work: 4+3 Layer 3 heavy at current
  4-wide concurrency (>32 GB). Needs fix #3 above, or a bigger box.

On a **64 GB / 32-core** box: 4+3 would likely fit. 8+ piece combos
would need the streaming fixes (#4).

## Reproduction

```bash
cd ll-solver
make                                          # produces ./enumerate
/usr/bin/time -v ./enumerate 4 7 1 99 beehive 500 \
  > runs/vNN-beehive.llp 2> runs/vNN-beehive.log
python3 validate_solutions.py runs/vNN-beehive.llp
```

Artifacts saved from v11:

- S3: `s3://home-cloud-xfer-919968175881/puzzles/v11-beehive.llp`
- S3: `s3://home-cloud-xfer-919968175881/puzzles/v11-beehive.log`
- S3: `s3://home-cloud-xfer-919968175881/puzzles/puzzles-unified-v11plus.llp`

Deployed: `spaceport-solitaire/public/puzzles.llp` on `main`
(commits `ccc301a`, `ad3f9ac`, `7f82cc7`).

## Related plan docs

- `plans/2026-04-15-pass3-and-ui-unified.md` — branch status log,
  hourly progress updates, OOM postmortems.
- `~/.claude/plans/cheeky-mapping-grove.md` — working plan (local,
  not committed).
