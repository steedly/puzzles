# Puzzle Generation Timing and Memory Analysis

Machine: EC2 instance, 8 vCPUs, 15 GB RAM, Amazon Linux 2023
Binary: PGO-optimized with `-O3 -march=native -flto -fopenmp -fprofile-use`
Pre-filter: `max_per_bucket=1000` (farthest-point diversity sampling)

## Summary

| Variant | Pieces | Puzzles | Wall Time | CPU Time | Peak RSS | BFS States |
|---------|--------|---------|-----------|----------|----------|------------|
| hex | 6 | 28,409 | 50s | 367s | < 1 GB | ~1.4M |
| beehive | 6 | 116,111 | 79 min | 37,002s | 4.0 GB | ~30M |
| ufo | 7 | 52,052 | 5m 14s | 39m 37s | < 2 GB | ~1.3M |
| solitaire | 7 | 93,115 | 5m 26s | 40m 6s | < 2 GB | ~3M |
| french | 7 | 128,188 | 21m 47s | 164m 54s | < 4 GB | ~30M |
| standard | 7 | 183,837 | 5h 1m | 38h 42m | ~6 GB | ~120M |

## Per-variant details

### hex (6 pieces, 7x7 grid with blocked border)

- Wall time: 50s
- CPU time: 367s (7.3x parallel efficiency on 8 cores)
- Puzzles: 28,409
- All solutions valid, 0 D4 duplicates

### beehive (6 pieces, 7x7 full hex)

- Wall time: 79 min (1h 19m)
- CPU time: 37,002s (7.8x parallel efficiency)
- Puzzles: 116,111
- Peak RSS: 4.0 GB
- All solutions valid, 0 D4 duplicates

The dominant cost was the 4e+2h combo (4 exits, 2 helpers, 6 pieces) — Pass 3 took ~50 minutes for ~21K filtered puzzles. Multi-exit puzzles have larger forward state spaces because each exit adds independent search dimensions.

### ufo (7 pieces, 5x5 inner area)

- Wall time: 5m 14s
- CPU time: 39m 37s (7.6x parallel efficiency)
- Puzzles: 52,052
- All solutions valid, 0 D4 duplicates

UFO has the smallest playable area among 7-piece variants (only 25 cells vs 49 for standard), so the BFS state space is much smaller.

### solitaire (7 pieces, 33 usable cells)

- Wall time: 5m 26s
- CPU time: 40m 6s
- Puzzles: 93,115
- All solutions valid, 0 D4 duplicates

### french (7 pieces, 45 usable cells)

- Wall time: 21m 47s
- CPU time: 164m 54s (7.6x parallel efficiency)
- Puzzles: 128,188
- All solutions valid, 0 D4 duplicates

The 2e+5h combo dominated, with ~1.2M Pass 2 survivors filtered to ~25K via the pre-filter. This is the variant with the most BFS states under 7-piece constraints.

### standard (7 pieces, full 7x7)

- Wall time: 5h 1m 42s
- CPU time: 38h 42m (7.7x parallel efficiency)
- Puzzles: 183,837
- All solutions valid, 0 D4 duplicates

The largest variant. Key combos:
- **1e+6h**: ~27M BFS states, 1.3M Pass 2 survivors → 23K filtered
- **2e+5h**: ~65M BFS states, 7.9M Pass 2 survivors → 34K filtered (235x reduction!)
- **3e+4h**: ~80M BFS states, ~3M Pass 2 survivors → ~48K filtered
- **4e+3h**: smaller, ~100K filtered

Without the pre-filter, this would have taken **80+ hours** (we measured 42% in 22 hours on the previous run). The pre-filter brings it down to 5 hours — a 16x speedup.

Peak memory ~6 GB during the BFS phase (FlatMap for 80M+ states + working memory).

## Extrapolation for larger piece counts

### Scaling factors from observed data

**State-space scaling per added piece (standard variant):**
- 6-piece BFS: ~2M canonical states (1e+5h)
- 7-piece BFS: ~120M total across all combos (~60x more)

The factor varies by combo. For 1 exit:
- 1e+5h → 1e+6h: 2.1M → 27M = **13x growth**
- 1e+6h → 1e+7h (estimated): 27M → ~360M = **13x growth**

**Wall-time scaling (with pre-filter):**
- The pre-filter caps Pass 3 work at ~max_per_bucket × num_buckets per combo
- For standard 7-piece: ~30 buckets × 1000 = ~30K solves per combo × 4-5 combos = ~150K total solves
- BFS scales linearly with state count; Pass 2 also linear
- Pass 3 is bounded by the filter, not by state count

### 7-piece hex (estimated)

The 6-piece hex took 50s wall. Hex has only 25 usable cells, so the 7-piece state space is much smaller than 7-piece standard.

- BFS states (estimated): ~5-10M (vs ~120M for standard)
- Wall time (estimated): **~10-20 minutes**
- Memory (estimated): **< 1 GB**
- Output puzzles (estimated): ~80-150K

### 7-piece beehive (estimated)

The 6-piece beehive took 79 min and produced 116K puzzles. Beehive has 49 usable cells like standard but with hex movement (6 directions instead of 4), which creates more reachable states per position.

- BFS states (estimated): ~150-200M (more than standard due to hex moves)
- Wall time (estimated): **~6-10 hours**
- Memory (estimated): **6-8 GB**
- Output puzzles (estimated): ~250-350K

### 8-piece standard (estimated)

Extrapolating from 7-piece standard:
- BFS states (estimated): ~360M for 1e+7h, ~700M for 2e+6h, ~600M for 3e+5h, ~150M for 4e+4h
- **Total BFS: ~1.8 billion canonical states across all combos**
- FlatMap memory: ~360M × 8 bytes / 0.75 = **~3.8 GB peak (1e+7h)**
- For 2e+6h: ~7.5 GB FlatMap — **may not fit in 15 GB along with working memory**

Wall-time estimate (with pre-filter, 8 cores):
- BFS phase: ~30-60 min (linear with states)
- Pass 2 phase: ~30-60 min (greedy trace + collision-sig dedup over billions of states)
- Pass 3 phase (with pre-filter): ~3-6 hours (bounded by filter)
- **Total: ~5-8 hours wall, ~40-60 hours CPU on 8 cores**

**Memory risk:** The 2e+6h combo could push memory limits. Recommendation: run with `max_exits=1` first to validate, then attempt multi-exit combos separately. Or use a larger instance (32+ GB RAM).

### 8-piece beehive (estimated)

Similar to 8-piece standard but with hex movement:
- BFS states: even larger than standard
- Wall time: ~10-15 hours
- Memory: likely **exceeds 15 GB** for the largest combos
- Recommendation: needs a larger instance

### 9-piece+ (any variant)

The FlatMap encoding uses 6 bits per robot, capping at 9 robots. For 9 pieces:
- BFS states: ~3-5 billion canonical (estimated)
- FlatMap memory: ~32-50 GB
- Requires server-class hardware (64+ GB RAM)

### Summary table (extrapolations)

| Variant | Pieces | Est. Wall Time | Est. Memory | Notes |
|---------|--------|---------------|-------------|-------|
| hex | 7 | ~15 min | < 1 GB | Easy on 8 cores |
| beehive | 7 | ~8 hours | 6-8 GB | Fits 15 GB |
| standard | 8 | ~6 hours | ~8 GB peak | Tight, may fail on 2e+6h |
| beehive | 8 | ~12 hours | 12-16 GB | Needs 32 GB instance |
| any | 9 | ~days | 64+ GB | Server-class only |

The pre-filter is the key enabler — without it, 8-piece runs would take **weeks**.
