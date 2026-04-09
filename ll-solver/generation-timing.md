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
| solitaire | 7 | TBD | TBD | TBD | TBD | TBD |
| french | 7 | TBD | TBD | TBD | TBD | TBD |
| standard | 7 | TBD | TBD | TBD | TBD | TBD |

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

## Extrapolation for larger piece counts

### 7-piece hex (not yet run)

TBD — estimate based on 6-piece hex scaling.

### 8-piece standard (not yet run)

TBD — estimate based on 7-piece standard scaling.
The retrograde BFS for 1e+7h produces ~355M canonical states requiring ~3.8 GB FlatMap.
With the pre-filter (`max_per_bucket=1000`), Pass 3 would process ~200K puzzles instead of millions.
Estimated total time: 12-24 hours on 8 cores.
