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
