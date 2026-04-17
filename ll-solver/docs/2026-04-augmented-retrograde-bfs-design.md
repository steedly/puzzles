# Design Doc: Augmented Retrograde BFS for Grouped-Move-Optimal Solutions

## Problem Statement

The current pipeline's Stage 4 (`solve_min_grouped`) runs a **per-puzzle** forward 0-1 BFS to compute grouped-move-optimal solutions. This is the dominant cost:

| Combo | Retro BFS (s) | Per-puzzle solve (CPU-s total) | Worst single puzzle |
|-------|--------------|-------------------------------|-------------------|
| 3+4   | 128s         | 18,677s                       | 552s (9 min)      |
| 4+2   | 0.12s        | 88,567s                       | 839,827s (9.7 days!) |
| **4+3** | **96s**    | **≥1,160,000s**               | **39,718s (11 hrs)** |

For 4+3 hex (356M retrograde states, 39K survivors), Stage 4 was on pace for ~1.2M CPU-seconds before OOM killed it. The retrograde BFS completed in 96 seconds. **Stage 4 is ~12,000× slower than Stage 1.**

**Goal**: compute grouped-move-optimal costs for ALL states in one pass during Stage 1, eliminating Stage 4 entirely.

## Why solve_min_grouped Is So Expensive for 4-Exit

The per-puzzle forward 0-1 BFS uses augmented state `(positions, last_mover_cell)`. The state space per puzzle is `reachable_positions × N` (N possible last_mover values). For 4-exit puzzles, the reachable position space explodes because 4 exits can independently be at various positions or EXITED — the combinatorial surface is much larger than for 1-2 exit puzzles.

The augmented retrograde approach amortizes this: instead of exploring the augmented state space separately for each puzzle, we explore it ONCE for the entire combo.

## Current Algorithm: What the Retrograde BFS Computes

The existing `retrograde()` function:
- State: packed robot positions (6n bits), no augmentation
- Seeds: all goal states (exits EXITED, helpers at every valid combination)
- BFS: level-synchronous, parallel, D4/Klein canonical
- Output: `FlatMap<State, uint8_t>` mapping each canonical state → min raw slides to goal
- **Does NOT track grouped moves**

## Proposed Algorithm: Augmented Retrograde 0-1 BFS

### Augmented state
`(positions, last_mover_cell)` — same augmentation as solve_min_grouped, but computed for ALL states at once in the retrograde direction.

Key bits: `6n` (positions) + `6` (last_mover_cell) = `6(n+1)` bits per state.

### Edge cost semantics in retrograde

In augmented state (S, L), the robot at cell L is **definitionally the robot that moved last** in forward time. L identifies that robot unambiguously (positions are distinct).

**Forward transition**: `(P, M) --[move robot r]--> (S, r_landing_cell)`
- Edge cost: 0 if r starts from M (same robot continuing), 1 if r starts elsewhere (new robot)

**Retrograde reversal** from (S, L) at retrograde cost c:
1. Identify r_last = the robot at L in S
2. For each direction d: reverse-slide r_last from L to predecessor position p_prev
3. Predecessor positions P = S with r_last moved from L to p_prev
4. Generate predecessor augmented states:
   - **(P, p_prev)** at cost **c + 0**: r_last was continuing (forward edge cost 0) → deque FRONT
   - **(P, M)** for each occupied cell M ≠ p_prev at cost **c + 1**: r_last was a new mover (forward edge cost 1) → deque BACK

### Why this is correct

The reversal exactly inverts the forward transition:
- Forward: from (P, M), moving r from p_prev produces (S, p) with cost 0 if p_prev==M, else 1
- Retrograde: from (S, L=p), reversing r to p_prev produces (P, p_prev) at cost+0, or (P, M≠p_prev) at cost+1

The 0-1 BFS deque ordering guarantees optimal costs are found first.

### Why the previous attempt likely failed

The README describes "N² fan-out" and "predecessor cost depends on successor path." My analysis: **the previous implementation likely reversed ALL robots' moves from each (S, L), not just the robot at L.** This creates:
- N robots × D directions × N last_mover variants = N²D predecessors per state
- Each predecessor's cost depends on which successor it came from, creating ambiguity

The correct approach: **only reverse the robot at L**, giving:
- D directions × N last_mover variants = DN predecessors per state (same as forward)

### Corner cases

**Exit at center**: When L = CENTER and an exit is EXITED, the exit robot reached center and was removed. Reverse: "un-exit" — place the exit back at p_prev from which it would slide to CENTER (there must be a blocker past CENTER in that direction, or CENTER is the edge). Generate (P, p_prev) at cost+0 and (P, M) for other cells at cost+1.

**Multi-exit goals**: At the goal, all exits are EXITED. The last move was some exit reaching CENTER. We don't know which exit, so we seed with predecessors for EACH exit un-exiting. Each seed state has one exit back on the board at its pre-center position.

**SENTINEL**: In forward time, the initial state has L = SENTINEL (no previous mover, first move always costs 1). In retrograde, SENTINEL states are the farthest from goal. They're naturally handled: every (S, M) at cost c+1 represents "robot at M was a new mover" which is correct for the first move.

## Memory Analysis for 4+3 Hex

Real numbers from v11:
- **Base retrograde states**: 356,117,053 (356M)
- **FlatMap at 75% load**: ~8 bytes/slot → 356M / 0.75 × 8 = **3.8 GB**

Augmented retrograde:
- **Augmented states**: up to 356M × N = 356M × 7 = **2.49 billion** (upper bound; actual likely lower due to not all last_mover values being reachable)
- **Key size**: 6×7 + 6 = 48 bits (fits in uint64_t with room for the uint8_t cost in the same 64-bit slot)
- **FlatMap at 75% load**: 2.49B / 0.75 × 8 = **26.6 GB** (upper bound)
- **Realistic estimate**: many (S, M) combinations won't be explored (cost pruning, unreachable combinations). Expect **40-70% of upper bound → 10-19 GB**

This is tight on 32 GB but feasible — the base retrograde BFS for 3+4 already peaked at 16 GB. On 64 GB it's comfortable.

### Can we reduce the memory?

**Observation**: we don't need costs for ALL augmented states. We need:
1. Grouped-move cost for each BASE state (to use in dedup/filtering)
2. The ability to trace a solution for each surviving puzzle

For (1), we only need `min over L of cost(S, L)` — one number per base state. We could run the augmented BFS but store only the base-state minimum.

For (2), we need the full augmented map OR we can re-derive the solution via a cheap forward trace using the base-state costs as bounds.

**Hybrid approach**: Run augmented 0-1 BFS but store TWO maps:
- `base_map[S] → min grouped moves` (small, same as current retrograde map)
- `augmented_map[(S, L)] → grouped move cost` (large, but can be freed after extracting base_map)

Or: stream the augmented BFS, writing only base-state minima, and re-run a per-puzzle forward trace later (but this defeats the purpose of eliminating Stage 4).

**Recommended**: store the full augmented map. 20-27 GB is feasible on 64 GB and eliminates Stage 4 completely.

## Compute Analysis for 4+3 Hex

Current retrograde BFS: 96 seconds for 356M states at 16 cores.

Augmented retrograde 0-1 BFS:
- **States**: ~2.5B (7× more)
- **Per-state work**: D=6 directions × N=7 augmented predecessors = 42 operations (vs 6×7=42 for base retrograde). Same per-state cost.
- **Sequential 0-1 BFS**: the deque-based 0-1 BFS is inherently sequential (front/back ordering matters). Can't trivially parallelize like the level-synchronous base BFS.

**Estimate**: if the 0-1 BFS processes states at ~1M/s single-threaded (comparable to solve_min_grouped's throughput on smaller state spaces), 2.5B states → ~2,500 seconds (~42 minutes). Compare to Stage 4's 1.16M+ CPU-seconds (320+ hours) for per-puzzle solves.

**Parallelization options**:
1. **Level-synchronous 0-1 BFS**: process all cost-0 states first (like the current level BFS), then cost-1 states. This preserves correctness and enables parallelism within each "level."
2. **Partitioned 0-1 BFS**: partition the state space and run independent 0-1 BFS on each partition, exchanging boundary states. Complex but parallelizable.
3. **Accept single-threaded**: 42 minutes single-threaded is still 500× faster than the 320+ hours of Stage 4. May not need parallelism.

## Solution Tracing from the Augmented Map

Once we have `augmented_map[(S, L)] → grouped_cost`, tracing a solution for a specific puzzle:

```
Start at (S₀, SENTINEL) — or (S₀, M) for the min-cost M
At each step:
  For each robot r at position p in current S:
    For each direction d:
      Slide r → lands at p'. New state (S', p').
      edge_cost = 0 if p == L (same robot), else 1
      If augmented_map[(S', p')] == current_cost - edge_cost:
        This is an optimal next step. Take it.
```

This is the same `forward_dfs_trace` approach, but using the augmented retrograde map. No additional per-puzzle BFS needed.

## Pipeline After This Change

**Before**: retrograde BFS → dedup → pre-filter → per-puzzle solve_min_grouped → Layer 3 → emit
**After**: augmented retrograde 0-1 BFS → dedup (using grouped-move costs) → pre-filter → trace solutions → Layer 3 → emit

Stage 4 (per-puzzle solve) is replaced by a single retrograde pass. Solution tracing is a cheap forward walk using the pre-computed cost map.

## Validation Plan

1. **Small case (1+2)**: 610 base states → ~4,270 augmented states. Run both augmented retrograde and per-puzzle forward solver. Compare ALL costs. Must be 0 mismatches.

2. **Medium case (1+4)**: 507K base states → ~2.5M augmented. Same comparison on a sample of 1,000 states.

3. **Correctness metric**: For each base state S, verify `min_L(augmented_retro_cost(S, L)) == solve_min_grouped(S)`.

4. **Solution replay**: For 100 randomly selected puzzles, trace the solution from the augmented map, replay it through the game engine, verify it reaches goal in the claimed number of grouped moves.

## Parallelization: Two-Phase Level-Synchronous 0-1 BFS

### Why the naive deque approach is sequential

The standard 0-1 BFS uses a deque: cost-0 edges push to front, cost-1 edges push to back. This is inherently sequential — the deque ordering encodes the priority.

### Key insight: 0-1 BFS = processing states in cost order

All states at cost c are processed before any at cost c+1. Within cost c, cost-0 edges discover MORE cost-c states (same robot continuing). Cost-1 edges discover cost-(c+1) states. This maps directly to the existing level-synchronous parallel BFS pattern.

### Algorithm: parallel two-phase level BFS

```
augmented_map = FlatMap(6*(n+1))  // (positions, last_mover) → cost

// Seed: predecessors of goal states at cost 0 and 1
seed_from_goals(augmented_map, cur_0, cur_1)

for cost = 0, 1, 2, ... max_moves:
  // Phase A: saturate cost-0 edges (same robot continuing)
  // These discover more states at the SAME cost level.
  frontier = cur_0  // states discovered at this cost via cost-0 edges
  while frontier is not empty:
    next_0 = []  // new cost-0 discoveries
    next_1 = []  // cost-1 discoveries (deferred to next level)
    
    ensure_parallel_capacity(augmented_map, frontier.size() * D * N)
    #pragma omp parallel for
    for each (S, L) in frontier:
      reverse the robot at L in each direction d → predecessor (P, p_prev)
      // Cost-0 predecessor: same robot was continuing
      if atomic_emplace(augmented_map, (P_canon, p_prev_canon), cost):
        thread_local_next_0.push_back((P_canon, p_prev_canon))
      // Cost-1 predecessors: different robot moved before
      for each occupied cell M in P_canon where M ≠ p_prev_canon:
        if atomic_emplace(augmented_map, (P_canon, M), cost + 1):
          thread_local_next_1.push_back((P_canon, M))
    
    merge thread_local_next_0 → next_0
    merge thread_local_next_1 → next_1
    frontier = next_0
    cur_1_for_next_level.append(next_1)

  // Phase B: all cost-0 saturation done. Advance to next cost level.
  cur_0 = cur_1  // cost-1 edges from previous level become the frontier
  cur_1 = cur_1_for_next_level
```

### Why this works

- **Phase A inner loop**: expanding cost-0 edges can only discover states at the SAME cost. A robot can continue sliding at most ~6 times before running out of directions/blockers, so the inner loop converges in ≤6 iterations (typically 1-2).
- **Phase B**: advancing to cost+1 is the same as the existing level-synchronous BFS level advance.
- **Parallelism**: each phase uses `#pragma omp parallel for` over the frontier, with `atomic_emplace` for lock-free insertion — identical to the existing retrograde BFS.
- **Correctness**: states at cost c are fully explored before cost c+1, guaranteeing optimality.

### Performance estimate for 4+3 hex

Base retrograde BFS throughput: 356M states / 96s / 16 cores ≈ 232K states/sec/core.

Augmented BFS:
- ~2.5B augmented states (7× base)
- Per-state work is similar (decode, reverse-slide, canonicalize, atomic_emplace)
- But: each state generates N=7 augmented predecessors vs 1 base predecessor → 7× more atomic_emplace operations per frontier state
- Effective throughput: ~232K/7 ≈ 33K states/sec/core (pessimistic; L1 cache helps)
- At 16 cores: ~528K states/sec → 2.5B / 528K ≈ **4,700 seconds (~78 minutes)**

More optimistic estimate (cache effects, not all states generate 7 predecessors):
- 50K states/sec/core × 16 = 800K/sec → 2.5B / 800K ≈ **3,100 seconds (~52 minutes)**

**Compare to Stage 4**: ≥1.16M CPU-seconds (320+ hours). The augmented retrograde BFS is **250-400× faster** even on the same 16-core machine.

### Seeding the augmented BFS

The goal states have all exits EXITED. We can't directly seed with augmented goal states because at the goal, the last mover (an exit) has been removed. Instead, we seed with the **predecessors of goal states**:

For each goal configuration G (all exits EXITED, helpers at valid cells):
  For each exit robot e (1..num_exits):
    For each valid cell p_prev where e could slide to CENTER:
      Place e at p_prev → predecessor positions P
      Canonicalize (P, p_prev) → seed at cost 0 (same exit was continuing)
      For each occupied cell M in P where M ≠ p_prev:
        Canonicalize (P, M) → seed at cost 1 (exit was a new mover)

This replaces the current retrograde seed that inserts goal states at depth 0. The augmented seed inserts "one move before goal" states at cost 0 or 1.

## Open Questions

1. **Symmetry canonicalization with augmentation**: Need to transform both positions AND last_mover_cell under the same symmetry. For Klein (hex, 6 transforms), need to verify that `canonical(S, L) = min_T(T(S) | T(L))` works correctly — especially for the EXITED sentinel and CENTER cell. CENTER (cell 24) is a fixed point of all D4/Klein transforms, so this should be straightforward.

2. **Memory on 32 GB**: The upper bound of 27 GB for the augmented FlatMap is tight on 32 GB. Options:
   - Use 64 GB instance (recommended for 4+3)
   - Hybrid: store only base-state min costs, re-trace per-puzzle (saves 6× memory but adds per-puzzle trace work — still orders of magnitude cheaper than current Stage 4)
   - Two-pass: run augmented BFS, extract base-state minima to a smaller map, free the augmented map before continuing to dedup/filter stages

3. **FlatMap capacity for 2.5B entries**: At 8 bytes/slot and 75% load, need ~3.3B slots = 26.6 GB. FlatMap uses power-of-2 sizing, so the actual allocation would be 4B slots = 32 GB. This exceeds 32 GB RAM. Either:
   - Use 64 GB instance
   - Reduce load factor target (90% → 22.2 GB, but worse probe performance)
   - Use a more compact map (4-byte slots with smaller key/value encoding)

4. **Phase A convergence**: The inner cost-0 saturation loop should converge quickly (a robot has at most D=6 continuation directions). But need to verify empirically that it doesn't blow up the frontier for deep continuation chains.
