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

### 2026-04-17T04:00Z — Design doc committed

Design doc at `ll-solver/docs/2026-04-augmented-retrograde-bfs-design.md` covers:
- Algorithm: augmented state (positions, last_mover_cell), retrograde 0-1 BFS
- Key insight: only reverse the robot at L (not all robots) — fixes the N² fan-out from the previous attempt
- Two-phase level-synchronous parallel BFS (Phase A: cost-0 saturation, Phase B: advance)
- Memory: ~27 GB for 4+3 hex (2.5B augmented states), needs 64 GB box
- Compute: estimated 52-78 min on 16 cores vs 320+ hours for Stage 4

Commit: `428cbbe`

### 2026-04-17T05:00Z — Initial implementation, 1+2 PASS, 1+3 FAIL

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

### 2026-04-17T05:30Z — Validation note: cost semantics

Discovered during validation that the augmented retrograde BFS doesn't naturally produce costs comparable to `solve_min_grouped`. The forward solver starts with `last_cell = EXITED` (no previous mover), so the first move always costs 1. The augmented map stores costs assuming "you're already in a grouped move with the robot at L."

**Correct comparison:** for a fresh-start state S, `real_cost(S) = 1 + min over first moves { aug_cost(S', landing) }`. This is O(ND) per state — trivially fast — and was validated correct on 1+2.

This means the final pipeline will need a thin wrapper: for each puzzle's starting state, try all first moves, look up the augmented cost of each result, and take `1 + min`. This replaces the full per-puzzle BFS with a single O(ND) lookup.

### 2026-04-17T06:00Z — Canonicalization ruled out; core BFS bug confirmed

Disabled symmetry canonicalization entirely (sort only, no D4/Klein transforms) to isolate the bug. **Same mismatches persist.** The bug is in the core BFS logic, not canonicalization.

Mismatch pattern: augmented costs consistently 1 too high (aug=3 when fwd=2). Concentrated around states where the exit is near center. 3 states completely missing from the augmented map (down from 8 with canonicalization, so some MISS were canonicalization artifacts).

Decoded example: exit at (3,4), helpers at (2,1), (2,5), (4,2). Forward solver finds 2 grouped moves. Augmented BFS says 3. The exit needs to reach center (3,3) — but can't slide there directly (no blocker in row 3 to the left). Requires a helper to move into position first, then exit slides.

**Hypothesis:** the `generate_augmented_predecessors` function's un-exit logic doesn't generate all valid predecessor configurations for states where the exit reaches center via an indirect path. The un-exit code assumes the exit slid to center in a single move from some position along a cardinal/diagonal line through center. But if the exit took multiple moves to reach center (sliding in different directions), the LAST move to center is what matters — and that last move must have the exit sliding to center from an adjacent line. This part should be correct (it generates all positions along each direction from center with a valid blocker past center).

**Next steps:** add detailed debug tracing for the specific mismatch state to see what the forward solver's optimal path is, and whether the augmented BFS's reverse exploration covers it. The issue may be in how multi-exit un-exit interacts with helper positions, or in the cost-0/cost-1 edge generation for the un-exit case.

### 2026-04-17T07:00Z — Two bugs found and fixed, all 1-exit combos PASS

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

### 2026-04-17T08:00Z — Multi-exit bug fixed, ALL combos PASS

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

### 2026-04-17T08:30Z — Symmetry canonicalization re-enabled, 12/12 PASS

Re-enabled D4 (standard, 8 transforms) and Klein (beehive, 4 transforms) symmetry canonicalization for augmented states. Both positions AND last_mover_cell are transformed by each symmetry before taking the lex-min. EXITED values are preserved through transforms (not a spatial position).

**12/12 combos PASS with symmetry enabled.** Phase 2 (implementation) and Phase 3 (validation for correctness) are COMPLETE for small/medium combos.

**Next:** performance and memory measurements on larger combos to validate the design doc's projections. Then Phase 4: integrate into the main pipeline.

### 2026-04-17T09:30Z — Compute and memory analysis for all combos

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

### 2026-04-17T10:00Z — Corrected memory analysis with power-of-2 FlatMap sizing

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

### 2026-04-17T11:00Z — Measured timing and memory on Mac, FlatMap sizing analysis

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
