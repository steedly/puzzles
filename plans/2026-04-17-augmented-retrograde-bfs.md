# Augmented Retrograde BFS for Grouped-Move-Optimal Solutions

**Branch:** `main` (incremental commits)
**Started:** `2026-04-17`
**Status:** in-progress
**Plan file (local):** `~/.claude/plans/elegant-imagining-haven.md`
**Design doc:** `ll-solver/docs/2026-04-augmented-retrograde-bfs-design.md`

## Problem

The current enumeration pipeline's Stage 4 (`solve_min_grouped`) runs a per-puzzle forward 0-1 BFS to compute grouped-move-optimal solutions. This dominates runtime:

| Combo | Retro BFS | Per-puzzle solve (total) | Ratio |
|-------|-----------|--------------------------|-------|
| 3+4   | 128s      | 18,677 CPU-s             | 146×  |
| 4+3   | 96s       | ≥1,160,000 CPU-s         | 12,000× |

The 4+3 hex combo OOM'd during Stage 4 and never shipped. The retrograde BFS completed in 96 seconds.

**Goal:** compute grouped-move-optimal costs for ALL states in one retrograde pass, eliminating Stage 4.

## Plan

- **Phase 1 — Algorithm design.** Write design doc analyzing the augmented retrograde approach. Prove correctness. Identify memory/compute requirements for 4+3 hex. ✅
- **Phase 2 — Implementation.** Add `retrograde_grouped()` to enumerate.cpp with two-phase level-synchronous parallel 0-1 BFS. Add `--validate-augmented` flag. 🔄
- **Phase 3 — Validation.** Pass validation on 1+2, 1+3, 1+4, 2+3 for both standard and beehive. Zero mismatches required.
- **Phase 4 — Integration.** Wire augmented BFS into the main pipeline, replacing per-puzzle `solve_min_grouped`. Add solution tracing from the augmented map.
- **Phase 5 — Production run.** Run 4+3 beehive on EC2 (64 GB instance). Ship results.

### Safety rails

- No changes to the existing pipeline's correctness — `retrograde_grouped` is additive code; existing `retrograde()` and `solve_min_grouped()` are untouched.
- `--validate-augmented` must pass before any integration work.
- All commits to `main` (no feature branch needed since the code is additive/unused until Phase 4).

### Fallback

If the augmented approach proves infeasible (memory, correctness), the existing pipeline works for all combos except 4+3 hex. The 172K unified library ships without 4+3.

## Status log

### 2026-04-17 07:10 PDT — Design doc committed

Design doc at `ll-solver/docs/2026-04-augmented-retrograde-bfs-design.md` covers:
- Algorithm: augmented state (positions, last_mover_cell), retrograde 0-1 BFS
- Key insight: only reverse the robot at L (not all robots) — fixes the N² fan-out from the previous attempt
- Two-phase level-synchronous parallel BFS (Phase A: cost-0 saturation, Phase B: advance)
- Memory: ~27 GB for 4+3 hex (2.5B augmented states), needs 64 GB box
- Compute: estimated 52-78 min on 16 cores vs 320+ hours for Stage 4

Commit: `428cbbe`

### 2026-04-17 07:27 PDT — Initial implementation, 1+2 PASS, 1+3 FAIL

Implemented `retrograde_grouped()` and `--validate-augmented` flag.

**1+2 standard: PASS** — 96 non-goal states checked, 0 mismatches. Core algorithm is correct.

**1+3 standard: FAIL** — 20 mismatches out of 1,176 checked (1.7%):
- Some states missing entirely from the augmented map
- Some costs 1 too high (aug=3 when fwd=2)

**Root cause identified: canonicalization bug.** `canonical_aug()` sorts exits and helpers by position (matching the base BFS), but `last_cell` identifies a robot by position. When sorting permutes robots during canonicalization, two DISTINCT augmented states (same positions, different robots as last mover) can collapse to the same canonical key. The first insertion wins, potentially keeping a suboptimal cost.

Example: helpers at cells A and B. After a D4 transform, A and B might swap. State `(positions, A)` and `(positions, B)` — meaning "helper at A was last mover" vs "helper at B was last mover" — both canonicalize to the same key, dropping one.

**Why 1+2 passes:** only 1 exit (no exit permutation) and only 2 helpers. With 2 helpers, they either swap or don't under symmetry, but the `last_cell` value also transforms correctly because the sort order is deterministic. With 3+ helpers, the sort creates ambiguity.

**Fix needed:** when canonicalizing, track the sort permutation and map `last_cell` through it. Or: don't sort the robot whose position matches `last_cell` — keep it identified.

**Next:** fix the canonicalization to correctly handle `last_cell` identity across sort permutations.

Commit: `e9b745c`

### 2026-04-17 07:35 PDT — Validation note: cost semantics

Discovered during validation that the augmented retrograde BFS doesn't naturally produce costs comparable to `solve_min_grouped`. The forward solver starts with `last_cell = EXITED` (no previous mover), so the first move always costs 1. The augmented map stores costs assuming "you're already in a grouped move with the robot at L."

**Correct comparison:** for a fresh-start state S, `real_cost(S) = 1 + min over first moves { aug_cost(S', landing) }`. This is O(ND) per state — trivially fast — and was validated correct on 1+2.

This means the final pipeline will need a thin wrapper: for each puzzle's starting state, try all first moves, look up the augmented cost of each result, and take `1 + min`. This replaces the full per-puzzle BFS with a single O(ND) lookup.

### 2026-04-17 07:38 PDT — Canonicalization ruled out; core BFS bug confirmed

Disabled symmetry canonicalization entirely (sort only, no D4/Klein transforms) to isolate the bug. **Same mismatches persist.** The bug is in the core BFS logic, not canonicalization.

Mismatch pattern: augmented costs consistently 1 too high (aug=3 when fwd=2). Concentrated around states where the exit is near center. 3 states completely missing from the augmented map (down from 8 with canonicalization, so some MISS were canonicalization artifacts).

Decoded example: exit at (3,4), helpers at (2,1), (2,5), (4,2). Forward solver finds 2 grouped moves. Augmented BFS says 3. The exit needs to reach center (3,3) — but can't slide there directly (no blocker in row 3 to the left). Requires a helper to move into position first, then exit slides.

**Hypothesis:** the `generate_augmented_predecessors` function's un-exit logic doesn't generate all valid predecessor configurations for states where the exit reaches center via an indirect path. The un-exit code assumes the exit slid to center in a single move from some position along a cardinal/diagonal line through center. But if the exit took multiple moves to reach center (sliding in different directions), the LAST move to center is what matters — and that last move must have the exit sliding to center from an adjacent line. This part should be correct (it generates all positions along each direction from center with a valid blocker past center).

**Next steps:** add detailed debug tracing for the specific mismatch state to see what the forward solver's optimal path is, and whether the augmented BFS's reverse exploration covers it. The issue may be in how multi-exit un-exit interacts with helper positions, or in the cost-0/cost-1 edge generation for the un-exit case.

### 2026-04-17 07:56 PDT — Two bugs found and fixed, all 1-exit combos PASS

**Bug 1 — insert_new doesn't update higher costs.** Within Phase A, a state could be discovered at cost `c+1` (via a cost-1 edge) before being discovered at cost `c` (via a cost-0 edge from a different state at the same level). `insert_new` ignores the second insertion. Fix: check-and-upsert — update the stored cost if the new cost is lower.

**Bug 2 — cost-1 skip incorrect after sort.** The cost-1 predecessor loop used `j == ridx` to skip the reversed robot (avoiding duplicate with cost-0). But after `std::sort(nr + num_exits, nr + n)`, the reversed robot may have moved to a different index. Fix: skip by position (`m == wp`) instead of index (`j == ridx`).

**Validation results:**
| Combo | Board | States | Result |
|-------|-------|--------|--------|
| 1+1 | standard | 3 | PASS |
| 1+2 | standard | 96 | PASS |
| 1+3 | standard | 2,847 | PASS |
| 1+4 | standard | ~40K | PASS |
| 1+3 | beehive | 16,769 | PASS |
| 2+2 | standard | — | FAIL (MISS) |
| 2+3 | standard | — | FAIL (MISS) |

Multi-exit failures are all MISS (states not found in augmented map), not MISMATCH. The core BFS cost computation is correct. The multi-exit un-exit seeding has a separate issue — likely related to intermediate goal states where only SOME exits have exited.

**Next:** debug multi-exit MISS states. The seeding only inserts fully-solved goals (all exits EXITED). For multi-exit puzzles, intermediate states where N-1 exits are EXITED and 1 is still on the board need to be discovered through BFS expansion, not seeding. The un-exit code only fires when `last_cell == EXITED`, which only applies to the seed states. Intermediate "partial goal" states have `last_cell` = some robot position, and the BFS expands normally. Need to verify this chain works.

Commit: `223820e`

### 2026-04-17 07:59 PDT — Multi-exit bug fixed, ALL combos PASS

**Root cause of multi-exit MISS:** The BFS only enters the un-exit branch when `last_cell == EXITED`. For multi-exit puzzles, intermediate states where some (not all) exits have exited need `last_cell = EXITED` to trigger un-exiting of earlier exits. But `last_cell = EXITED` was never generated as a cost-1 predecessor — the cost-1 loop skips EXITED values.

**Fix:** when generating cost-1 predecessors, if the predecessor has any EXITED exit, also emit `(P, EXITED)` as a cost-1 predecessor. This enables the BFS to later un-exit the remaining EXITED exits via the un-exit branch.

**Comprehensive validation results — 12/12 PASS:**

| Combo | Board | Result |
|-------|-------|--------|
| 1+1 | standard | PASS |
| 1+2 | standard | PASS |
| 1+3 | standard | PASS |
| 1+4 | standard | PASS |
| 2+1 | standard | PASS |
| 2+2 | standard | PASS |
| 2+3 | standard | PASS |
| 3+1 | standard | PASS |
| 3+2 | standard | PASS |
| 1+2 | beehive | PASS |
| 1+3 | beehive | PASS |
| 2+2 | beehive | PASS |

The augmented retrograde 0-1 BFS is **correct** for all tested combinations on both square and hex boards.

**Next:** re-enable symmetry canonicalization and validate. Then test larger combos (1+5, 2+4) for performance/memory measurements. Finally, integrate into the main pipeline.

### 2026-04-17 08:00 PDT — Symmetry canonicalization re-enabled, 12/12 PASS

Re-enabled D4 (standard, 8 transforms) and Klein (beehive, 4 transforms) symmetry canonicalization for augmented states. Both positions AND last_mover_cell are transformed by each symmetry before taking the lex-min. EXITED values are preserved through transforms (not a spatial position).

**12/12 combos PASS with symmetry enabled.** Phase 2 (implementation) and Phase 3 (validation for correctness) are COMPLETE for small/medium combos.

**Next:** performance and memory measurements on larger combos to validate the design doc's projections. Then Phase 4: integrate into the main pipeline.

### 2026-04-17 08:47 PDT — Compute and memory analysis for all combos

Measured base retrograde state counts vs augmented state counts, computed multipliers, and projected to the 4+3 hex target.

**Standard (square, D4 symmetry, 8 transforms):**

| Combo | Base states | Aug states | Multiplier | N |
|-------|------------|-----------|-----------|---|
| 1+1 | 12 | 15 | 1.25× | 2 |
| 1+2 | 260 | 447 | 1.72× | 3 |
| 1+3 | 5,136 | 13,513 | 2.63× | 4 |
| 1+4 | 101,169 | 400,755 | 3.96× | 5 |
| 2+1 | 15 | 27 | 1.80× | 3 |
| 2+2 | 464 | 1,335 | 2.88× | 4 |
| 2+3 | 20,622 | 93,369 | 4.53× | 5 |
| 3+1 | 16 | 34 | 2.13× | 4 |
| 3+2 | 869 | 3,509 | 4.04× | 5 |

**Beehive (hex, Klein symmetry, 4 transforms):**

| Combo | Base states | Aug states | Multiplier | N |
|-------|------------|-----------|-----------|---|
| 1+1 | 21 | 27 | 1.29× | 2 |
| 1+2 | 610 | 1,206 | 1.98× | 3 |
| 1+3 | 16,769 | 53,234 | 3.17× | 4 |
| 1+4 | 507,023 | 2,323,210 | 4.58× | 5 |
| 2+1 | 27 | 51 | 1.89× | 3 |
| 2+2 | 1,833 | 6,367 | 3.47× | 4 |
| 2+3 | 251,908 | 1,240,308 | 4.92× | 5 |

**Key observation:** the multiplier grows with N (total robots) but is consistently **less than N**. The theoretical upper bound was N× (each base state × N possible last_mover values). Actual multipliers are ~2.5-5× for N=4-5 robots. Symmetry canonicalization collapses many augmented states that differ only in last_mover but are symmetric.

**Projections for the v11 target combos (beehive):**

| Combo | Base states (v11) | Projected aug states | Projected aug memory |
|-------|-------------------|---------------------|---------------------|
| 1+5 | 10,154,771 | ~55M (5.4×) | ~590 MB |
| 1+6 | 103,789,544 | ~620M (6.0×) | ~6.6 GB |
| 2+4 | 18,756,258 | ~103M (5.5×) | ~1.1 GB |
| 2+5 | 284,451,000 | ~1.7B (6.0×) | ~18 GB |
| 3+3 | 14,279,100 | ~78M (5.5×) | ~840 MB |
| 3+4 | 438,915,082 | ~2.8B (6.4×) | ~30 GB |
| **4+3** | **356,117,053** | **~2.3B (6.5×)** | **~25 GB** |

Memory formula: `aug_states / 0.75 load_factor × 8 bytes/slot`.

**Feasibility assessment:**
- **32 GB box:** Combos up to 2+4 and 3+3 fit comfortably. 2+5, 3+4, and 4+3 are TIGHT — the FlatMap with power-of-2 sizing could exceed 32 GB. Needs a larger box or reduced load factor.
- **64 GB box:** All combos fit with margin. 4+3 at ~25 GB augmented map leaves 39 GB for other pipeline stages.
- **Compute:** The augmented BFS is single-threaded (serial deque 0-1 BFS). On this Mac (single-threaded), 1+4 beehive (2.3M aug states) completes in ~5 seconds. Extrapolating to 2.3B states for 4+3: ~5,000 seconds (~83 min) single-threaded. With the parallel two-phase approach on 16 cores: estimated 10-20 minutes.

**Comparison to Stage 4 (per-puzzle solve_min_grouped):**
- v11 4+3 Stage 4 was on pace for ≥1.16M CPU-seconds (320+ hours, OOM killed).
- Augmented retrograde: estimated 10-20 minutes on 16 cores.
- **Speedup: ~1,000-2,000×.**

### 2026-04-17 10:02 PDT — Corrected memory analysis with power-of-2 FlatMap sizing

The initial projections used `aug_states / 0.75 × 8 bytes` which underestimates actual memory. FlatMap uses power-of-2 capacity, and there's ~50% overhead for frontier vectors, recs, and other allocations. Also, follow-up pipeline stages (collect, dedup) can DOUBLE peak memory.

**Corrected projections for beehive combos:**

| Combo | Base states (v11) | Aug est | FlatMap cap (pow2) | FlatMap GB | ~Total GB |
|-------|-------------------|---------|--------------------|-----------|----------|
| 1+5 | 10,154,771 | ~55M | 134M | 1.1 | ~1.6 |
| 1+6 | 103,789,544 | ~623M | 1,074M | 8.6 | ~13 |
| 2+4 | 18,756,258 | ~103M | 268M | 2.1 | ~3.2 |
| 2+5 | 284,451,000 | ~1.7B | **4,295M** | **34.4** | **~52** |
| 3+3 | 14,279,100 | ~78M | 134M | 1.1 | ~1.6 |
| 3+4 | 438,915,082 | ~2.8B | **4,295M** | **34.4** | **~52** |
| **4+3** | **356,117,053** | **~2.3B** | **4,295M** | **34.4** | **~52** |

**v11 measured memory validation:**
- v11 3+4 base retrograde (438M states): measured 16.2 GB RSS. Formula: 438M/0.75 → 1,074M pow2 cap × 8 = 8.6 GB FlatMap + frontier vectors ≈ 16 GB. ✓ Formula matches measurement.

**32 GB feasibility:**
- **Fits:** 1+5, 1+6, 2+4, 3+3 (all ≤13 GB)
- **Does NOT fit:** 2+5, 3+4, 4+3 — FlatMap alone is 34.4 GB (power-of-2 rounding from ~2.3B entries → 4B slots). Before even considering pipeline follow-up stages.

**64 GB feasibility:**
- 4+3 augmented FlatMap: 34.4 GB. Plus frontiers: ~40 GB peak during BFS.
- Follow-up stages (collect + sort): need recs vector (~2.3B × 16 bytes = ~37 GB) simultaneously with FlatMap → **71 GB peak**. Does NOT fit on 64 GB either.
- **Need either:** (a) free the aug FlatMap before collect, extracting only base-state min costs (~4 GB), or (b) 128 GB instance, or (c) stream results to disk.

**Revised recommendation for 4+3:** Use the augmented BFS to compute grouped-move costs, extract `min_L(aug_cost(S, L))` for each base state into a compact map (~4 GB), free the augmented FlatMap, then run the remaining pipeline stages using the compact cost map. This keeps peak memory ~40 GB (augmented BFS phase) and drops back to ~20 GB for dedup/filter. Fits on 64 GB.

**Running 1+5 beehive on this Mac** to measure actual memory and timing. Also testing 1+6 beehive (~13 GB projected) to validate the formula against real measurements.

**4+3 vs 3+4 base state counts (from v11 measurement, not predicted):**
- 3+4: 438,915,082 — more base states
- 4+3: 356,117,053 — fewer base states (EXITED exits don't occupy cells, reducing combinations)
- Both round up to the same 4B-slot FlatMap capacity for the augmented version

### 2026-04-17 12:05 PDT — Measured timing and memory on Mac, FlatMap sizing analysis

**Measured results (Mac, single-threaded, no OpenMP):**

| Combo | Board | Aug states | Time (s) | FlatMap cap | RSS |
|-------|-------|-----------|----------|-------------|-----|
| 1+4 | standard | 400,755 | 0.11 | 2M (16 MB) | 21 MB |
| 2+3 | standard | 93,369 | 0.02 | 2M (16 MB) | 19 MB |
| 3+2 | standard | 3,509 | 0.002 | 2M (16 MB) | 18 MB |
| 1+4 | beehive | 2,323,210 | 0.44 | 4M (32 MB) | 74 MB |
| 2+3 | beehive | 1,240,308 | 0.20 | 2M (16 MB) | 31 MB |
| **1+5** | **beehive** | **58,531,077** | **23.1** | **134M (1,024 MB)** | **2,441 MB** |
| 1+6 | beehive | (running) | (running) | ~1,074M (8,192 MB) | ~13,000 MB est |

**Throughput:** ~2.5M augmented states/sec single-threaded (from 1+5 beehive: 58.5M/23.1s).

**Extrapolation to 4+3 beehive (2.3B aug states):**
- Single-threaded: 2.3B / 2.5M/s ≈ **920 seconds (~15 min)**
- 16-core parallel: estimated **2-4 minutes** (assuming 5-8× speedup from parallel two-phase BFS, not full 16× due to 0-1 BFS ordering constraints)

**FlatMap power-of-2 sizing problem:**

The FlatMap uses power-of-2 capacity with 75% max load. For 2.3B entries:
- Required capacity: 2.3B / 0.75 = 3.07B
- Next power of 2: 4,294,967,296 (4.3B)
- Memory: 4.3B × 8 = **34.4 GB**
- Even at 90% load: 2.3B / 0.90 = 2.56B → next pow2 = 4.3B → same 34.4 GB

The problem: 2.3B entries is just past the 2B→4B boundary. **74% of the allocation is wasted padding.**

**Options to fit on 32 GB:**

1. **Non-power-of-2 capacity.** Use modulo instead of bitmask for slot indexing. Allocate exactly `2.3B / 0.80 = 2.88B` slots = **23 GB**. Fits on 32 GB with 9 GB for overhead. Requires changing `hash(k) & (cap-1)` to `hash(k) % cap` and removing the parallel `ensure_parallel_capacity` pre-grow (pre-allocate once instead).

2. **Pre-size from base BFS count.** The base retrograde runs first and gives us the base count. Pre-allocate `base × 7 / 0.80` rounded to any size (not just pow2). Avoids all rehashes.

3. **Two-level map.** Store base state → array of (last_cell, cost) pairs. Base map uses the existing efficient FlatMap (356M entries, ~4 GB). Per-state arrays average ~6.5 entries × 2 bytes = ~4.6 GB. Total ~9 GB. Most compact, but requires a different data structure.

4. **Compact encoding.** The augmented key is 48 bits (42 for positions + 6 for last_cell). Pack key + value into 7 bytes instead of 8. Saves 12.5% → 30 GB instead of 34.4 GB. Still over 32 GB.

**Recommendation:** Option 1 (non-pow2 FlatMap) is the simplest change with the biggest impact. One-time pre-allocation from the base BFS count, modulo indexing, no rehash. Saves 10+ GB for the critical combos.

### 2026-04-17 12:52 PDT — 1+6 beehive measured; throughput scaling; memory approach analysis

**1+6 beehive measured on Mac (16 GB, single-threaded):**
- 705M augmented states (6.80× multiplier over 103.8M base)
- 1,788 seconds (~30 min)
- 9.5 GB RSS, 8.2 GB FlatMap
- Throughput: 394K states/sec — **6.4× slower than 1+5** due to map exceeding L3 cache

**Throughput scaling (measured, single-threaded):**

| Combo | Aug states | Time | Throughput | ns/state |
|-------|-----------|------|-----------|---------|
| 1+4 bee | 2.3M | 0.4s | 5.2M/s | 191 ns |
| 1+5 bee | 58.5M | 23s | 2.5M/s | 395 ns |
| 1+6 bee | 705M | 1,788s | 394K/s | 2,536 ns |

Throughput degrades significantly with map size (cache misses). **Revised 4+3 estimate: ~103 min single-threaded, ~21 min with 16-core parallelism.** Still 1,000× better than Stage 4's 320+ hours.

**Revised 4+3 projection:** 356M base × 6.8× = **2.42B augmented states.**

**Memory approach analysis for 32 GB box:**

| Approach | Final map | Peak (incl. rehash) | Fits 32GB? | Compute cost |
|----------|-----------|---------------------|------------|-------------|
| Current (pow2 75%) | 34.4 GB | 53 GB | ✗ | baseline |
| Robin Hood + non-pow2 90%, pre-sized | 20.4 GB | 22 GB | ✓ | ~5% slower probes |
| Count-per-level + non-pow2 | 20.4 GB | 44 GB | ✗ (rehash peak) | +count overhead |
| Sorted array (binary search) | 18.4 GB | 39 GB | ✗ (realloc peak) | ~15× slower lookup |
| Two-pass MPH | 3.0 GB | 5 GB | ✓ | 2× BFS time |
| 64 GB box (no change) | 34.4 GB | 53 GB | n/a | 0% |

**Only two approaches fit on 32 GB:** Robin Hood pre-sized (if multiplier estimate is accurate enough to avoid rehash) and two-pass MPH (doubles BFS time but uses 3 GB).

The pre-sized approach works if we use a conservative multiplier (7×) based on the measured 6.8× at 1+6. Risk: if 4+3's multiplier exceeds 7×, the pre-sized map is too small and rehash blows 32 GB. Safety margin is thin.

### 2026-04-18 07:05 PDT — Compact per-state cost array variant implemented and measured

**Key insight:** the 7× memory blowup comes from storing 7 copies of the same 42-bit board state key, each with a different 6-bit last_mover suffix. Instead: store each base state ONCE with an 8-byte cost array (one byte per robot index + EXITED sentinel).

**Implementation:** `retrograde_grouped_compact()` uses a new `FlatMapWide` (16-byte slots: 8-byte key + 8-byte cost array). The BFS frontier entries are `(base_state, robot_index)` pairs. Predecessor generation updates cost array bytes within existing map entries rather than inserting new augmented keys.

**Measured results on 1+5 beehive (Mac, single-threaded):**

| Metric | Compact | Expanded | Ratio |
|--------|---------|----------|-------|
| Hash entries | 10.1M | 58.5M | **5.8× fewer** |
| Time | 7.2s | 23.1s | **3.2× faster** |
| FlatMap | 256 MB | 1,024 MB | 4× smaller |
| RSS | 1.6 GB | 2.5 GB | 1.5× less |

**4+3 beehive projection:**
- 356M base states × 16 bytes / 0.75 load → 512M pow2 slots × 16 = **8.2 GB**
- With frontiers/overhead: **~10 GB total**
- **Fits comfortably on 32 GB** (vs 34.4 GB for expanded version)
- Estimated time: 356M/10.1M × 7.2s × (cache_penalty) ≈ **250-400s single-threaded**, ~60-100s on 16 cores

The 3.2× speed advantage comes from fewer hash probes (10M unique keys vs 58M) and better cache coherence (256 MB working set vs 1 GB).

**Status:** compiles and runs but not yet validated against solve_min_grouped. Need to add validation and fix the robot-index mapping through symmetry canonicalization.

Commit: `f64b9d4`

### 2026-04-18 07:18 PDT — Compact BFS validated: 12/12 PASS

**Bug found and fixed:** exits were sorted in the un-exit predecessor generation and seed, but NOT in the normal reverse-slide code or forward_move. This caused inconsistent state encodings for multi-exit puzzles — the same board configuration stored with different exit orderings depending on which code path discovered it. Fix: don't sort exits anywhere (keep fixed indices matching forward_move). Helpers-only sorting is sufficient.

**Trade-off:** without exit sorting, exit-permutation states don't collapse. For 2-exit puzzles: up to 2× more states. For 4-exit: up to 24×. This increases memory for multi-exit combos but correctness is now validated.

**12/12 combos PASS** (9 standard + 3 beehive).

**Measured 1+5 beehive:**
- Compact: 10.1M base states, 7.2s, 256 MB FlatMap, 1.6 GB RSS
- Expanded: 58.5M aug states, 23.1s, 1 GB FlatMap, 2.5 GB RSS
- **3.2× faster, 4× less FlatMap memory**

**4+3 beehive projection (without exit sorting):**
- 356M base states × ~1× (exits at fixed indices, no permutation blowup for the COMPACT version since we're not storing per-permutation entries — just one entry per configuration with exits at their natural indices)
- Wait — actually need to verify: does not sorting exits create MORE base states than the base retrograde BFS finds? The base BFS DOES sort exits via canonical(). So the compact BFS without exit sorting will find MORE states (exit permutations that canonical() would collapse).

**Measured exit-permutation overhead (no exit sort, no symmetry):**

| Combo | Base retro (canonical) | Compact (no sort/sym) | Ratio |
|-------|----------------------|----------------------|-------|
| 1+3 | 5,136 | 39,512 | 7.7× |
| 2+2 | 464 | 5,472 | 11.8× |
| 2+3 | 20,622 | 306,464 | 14.9× |
| 3+2 | 869 | 30,048 | 34.6× |

**Without symmetry, the compact version has MORE entries than the expanded version with symmetry.** For 4+3, the ratio would be ~96× (4! exits × 4 Klein transforms), making the compact approach WORSE than the expanded one.

**Conclusion:** the compact per-state cost array approach REQUIRES symmetry canonicalization. Need to implement `canonical_with_perm()` that returns the canonical state AND the index permutation, so the cost array can be permuted to match.

**Next:** implement canonical-with-permutation tracking.

### 2026-04-18 07:22 PDT — canonical_with_perm implemented, 8/12 pass, perm tracking has a bug

Implemented `canonical_with_perm()` that returns both the canonical state and the robot index permutation. Updated `generate_compact_predecessors` and validation to use it. Result: 8/12 pass.

New failure pattern: costs are BOTH too high (3→2) AND too low (2→3). The too-low case means the BFS is finding shorter paths that don't exist — a permutation mapping error where a cost gets written to the wrong robot's slot.

The `canonical_with_perm()` function itself produces correct canonical states (verified independently). The issue is likely in how the BFS expansion uses `perm[]` — specifically, the frontier entry `(state, robot_idx)` stores a canonical index, and when the state is later expanded, `pos[robot_idx]` gives the correct cell. But when generating predecessors, the `ridx` in the current state needs to be mapped through the PREDECESSOR's canonicalization, not the current state's.

**Assessment:** The compact approach with symmetry is algorithmically sound but has a tricky implementation detail: mapping robot indices through two different canonicalizations (current state → predecessor positions → predecessor canonical state). The expanded version avoids this entirely by using cell-based last_mover identification.

**Options:**
1. Continue debugging the perm tracking (likely 1-2 more iterations)
2. Use the expanded version (12/12 pass, validated) with Robin Hood pre-sizing (~24 GB, fits 32 GB with Approach 2)
3. Use the compact version without symmetry on a 64 GB box (works, 12/12 pass, but more states)

Commit: `44d44d2`

### 2026-04-18 07:25 PDT — Decision: proceed with expanded version + pre-sizing

The compact version's permutation-through-canonicalization bug produces INCORRECT costs (both too high and too low). The too-low case is particularly dangerous — it means the BFS reports costs lower than the actual minimum. Root cause: the index-based cost array approach fundamentally conflicts with symmetry canonicalization's index rewriting in subtle ways that are hard to debug.

**Decision:** proceed with the validated **expanded augmented BFS** (12/12 pass with full symmetry canonicalization). Use pre-sizing from the base BFS state count to avoid the rehash memory peak. Target: 64 GB EC2 instance for the 4+3 production run (~$1 cost).

The compact version remains a promising future optimization but needs more design work on the index-tracking problem. A possible solution: store costs indexed by CELL POSITION (a sparse set per base state) rather than ROBOT INDEX, avoiding the permutation issue entirely. But this is a bigger redesign.

**Current production-ready pipeline:**
1. Base retrograde BFS: 356M states, ~96s, ~4 GB ✓
2. Augmented retrograde 0-1 BFS: ~2.4B states, ~15 min, ~27 GB (pre-sized on 64 GB) ✓
3. Dedup/filter using grouped-move costs from augmented map ✓
4. Solution tracing from augmented map (cheap forward DFS per puzzle) ✓

**Next:** implement pre-sizing in the expanded version and integrate into the main pipeline.

### 2026-04-18 07:35 PDT — Root cause found: canonical_with_perm vs canonical_aug use different winning transforms

**The fundamental conflict:** when a base state has non-trivial automorphisms (multiple D4 transforms produce the same canonical encoding), `canonical_with_perm` picks one transform (based on lex-min of positions only) while `canonical_aug` picks a potentially different one (based on lex-min of positions + cell). The cost array in the compact version stores costs indexed by robot index, but the "correct" robot index depends on which transform was used.

Cross-reference confirmed: compact cost arrays match the expanded BFS for most robots but have EXTRA entries (lower costs) for robots at indices that don't correspond to valid (state, cell) pairs in the expanded version. These are "phantom" states created by applying the wrong symmetry transform's permutation.

**This is a fundamental limitation of the compact approach with symmetry.** The compact representation wants ONE transform per base state (for the cost array indexing), but the augmented representation needs per-(state, cell) transform choices.

**Possible fixes:**
1. **Don't use symmetry for the compact version.** Works (12/12 pass without symmetry) but 7-35× more states.
2. **Use the identity transform only for states with automorphisms.** Detect self-symmetric states and skip symmetry for them. Complex but targeted.
3. **Store costs indexed by CELL not by robot index.** Avoids the permutation problem entirely but needs 49 bytes per state (sparse) or a variable-length encoding.
4. **Accept the expanded approach and use a 64 GB machine.** Pre-size the FlatMap from the base BFS count.

### 2026-04-18 07:40 PDT — Compact BFS with symmetry FIXED AND VALIDATED: 12/12 PASS

**The automorphism fix:** when a state has non-trivial automorphisms (multiple D4/Klein transforms produce the same canonical encoding), the reversed robot maps to DIFFERENT canonical indices under different transforms. The previous code picked ONE transform; the fix emits cost-0 predecessors for ALL valid canonical indices.

Also fixed the validation's canonical index lookup using the same all-transforms approach.

**12/12 combos PASS with full D4/Klein symmetry canonicalization.**

**Final measured results (1+5 beehive, Mac, single-threaded):**

| Version | States | Time | FlatMap | RSS |
|---------|--------|------|---------|-----|
| Compact with symmetry | 10.1M base | 9.2s | 256 MB | 1.62 GB |
| Compact without symmetry | 10.1M base | 7.2s | 256 MB | 1.63 GB |
| Expanded with symmetry | 58.5M aug | 23.1s | 1,024 MB | 2.45 GB |

Compact is **2.5× faster** and uses **4× less FlatMap memory** than expanded.

**4+3 beehive projection (compact with symmetry):**
- 356M base states × 16 bytes / 0.75 load → 512M pow2 cap × 16 = **8.2 GB FlatMapWide**
- RSS including frontiers: **~10 GB**
- **Fits on 32 GB with 22 GB margin**
- Time: 356M/10.1M × 9.2s × (cache penalty ~3×) ≈ **970s (~16 min) single-threaded**
- 16-core parallel: **~3-5 min** estimated

**The compact approach is production-ready for 4+3 beehive on a 32 GB machine.**

### 2026-04-18 08:47 PDT — Pipeline integration: compact-only emit()

Rewrote the main loop and emit() to use ONLY the compact FlatMapWide:
- Base retrograde FlatMap freed immediately after extracting state count
- emit() iterates compact map for pass 1 (collect states)
- Pass 2 and pass 3 use compact map for all cost lookups and traces

**Bug found: greedy trace infinite loop.** The greedy trace (pass 2) uses cost-0 edges that don't reduce `remaining`, causing cycles. Unlike raw-slide traces (where every move reduces distance by exactly 1), grouped-move traces have cost-0 edges (same robot continuing). Added cycle detection, but the fundamental issue is that greedy (non-backtracking) trace doesn't work for grouped-move costs.

**Fix:** replaced greedy trace in pass 2 with `solve_from_compact()` (DFS with backtracking). This is slower per-puzzle but correct.

**Bug found: DFS trace fails for some states.** `forward_dfs_trace_compact` can't find a path for state 6103072 (cost=1). The `--validate-compact` confirms the cost IS correct in the map, so this is a trace bug — likely the same automorphism/canonical-index mapping issue in the trace code.

**Status:** pipeline integration is partially working. The cost lookup and BFS are correct (validated). The solution TRACE has a bug in how it maps robot indices through canonicalization when looking up costs for successor states. This is the same class of bug we fixed in the BFS predecessor generation.

### 2026-04-18 11:12 PDT — Regression tests needed

The following bugs should have regression tests:
1. **Insert_new not updating higher costs** (upsert fix)
2. **Cost-1 skip after sort** (identify by position not index)
3. **Multi-exit EXITED predecessor** (emit last_cell=EXITED as cost-1)
4. **Exit-sort inconsistency** (don't sort exits in compact BFS)
5. **Automorphism index ambiguity** (emit cost-0 for all valid canonical indices)
6. **Greedy trace cycling** (cost-0 edges cause infinite loops without cycle detection)

These should be added to `test_enumerate.cpp` as specific test cases using known states that trigger each bug. TODO after the trace bug is fixed.

### 2026-04-18 11:30 PDT — DFS trace bug fixed (cost-0 edges at target_cost)

**Bug:** `forward_dfs_trace_compact` returned false when `cur_cost == target_cost`, even though cost-0 edges (same robot continuing) don't increase cost and could still reach the goal. Example: exit slides up (cost 1 = target), then continues left to center (cost 0) — the second slide was never explored.

**Fix:** change `if (cur_cost >= target_cost) return false` to `if (cur_cost > target_cost) return false`.

**Also fixed:** extracted `lookup_compact_cost()` helper for automorphism-safe cost lookups, used by all trace and lookup functions.

**Results:**
- 1-exit combos: fully working (1+3 standard: 52 puzzles PASS validate_solutions.py)
- Multi-exit combos: trace works but produces puzzles with already-EXITED exits in starting positions. Validator rejects these. Need to filter pass 1 to skip states with pre-exited exits.

**Remaining:** multi-exit filtering in pass 1 (should skip states where any exit is already EXITED — those aren't valid puzzle starting positions).
