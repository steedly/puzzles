# Memory-Efficient Hash Maps for the Augmented Retrograde BFS

## Goal

We want to generate all puzzles for a **4-exit, 3-helper** configuration on a
7×7 hexagonal board ("4+3 beehive"). This is the hardest unsolved enumeration
target: a previous production run (v11, April 2026) completed 17 of 18
exit+helper combinations but **4+3 OOM-killed** during the solve phase.

A new algorithm — the **augmented retrograde BFS** — eliminates the expensive
per-puzzle solve phase by computing grouped-move-optimal costs for all
reachable states in one backwards pass from the goal. The algorithm is
validated and correct (12/12 combos pass, including hex boards). The remaining
challenge is **memory**: the hash map holding the augmented states is the
dominant allocation, and for 4+3 it doesn't fit in 32 GB with the current
data structure.

This document analyzes the memory problem and evaluates approaches to solve
it, written for a reader not familiar with the codebase.

---

## Background: what the hash map stores and why

### The puzzle

A Lunar Lockout puzzle is a 7×7 grid with robots that slide in straight lines
until they hit another robot (wall stops are illegal). "Exit" robots must
reach the center cell to win; "helper" robots are blockers that never exit.
The hex variant adds two diagonal slide directions (6 total vs 4 for square).

### The enumeration pipeline

The enumerator discovers all interesting puzzles for a given piece count by
working **backward from the goal**. The retrograde BFS starts from all
configurations where every exit has reached center, then reverses moves one
step at a time, recording the minimum cost to reach the goal for every
reachable board configuration.

The original pipeline uses two metrics:
- **Raw slides**: each individual robot slide counts as 1. Computed by the
  retrograde BFS.
- **Grouped moves**: consecutive slides by the same robot count as 1 move
  (the player's perspective). Previously computed by a separate per-puzzle
  forward solver that was **94% of total runtime**.

The augmented retrograde BFS computes grouped moves directly during the
retrograde pass by tracking one extra piece of information: **which robot
moved last**. This eliminates the per-puzzle solver entirely.

### The augmented state

Each entry in the hash map represents an **augmented state**:
```
(robot_positions, last_mover_cell) → grouped_move_cost
```

- **Key**: the positions of all N robots (6 bits each, packed into a
  `uint64_t`) plus the cell where the last-moving robot landed (6 more bits).
  For N=7 robots: 42 + 6 = 48 bits.
- **Value**: the minimum number of grouped moves to reach the goal from this
  state (stored as `uint8_t`, max 255).
- **Packed format**: key and value are packed into a single `uint64_t`
  (48-bit key + 8-bit value = 56 bits, fitting in 64 bits). **8 bytes per
  entry total.**

### How many entries?

The base retrograde BFS (without augmentation) for 4+3 beehive discovers
**356 million** board configurations. With augmentation, each configuration
can have multiple last-mover variants. Measured multipliers on real workloads:

| Combo | Base states | Augmented states | Multiplier |
|-------|------------|-----------------|-----------|
| 1+5 beehive | 10.2M | 58.5M | 5.76× |
| 1+6 beehive | 103.8M | 705.3M | 6.80× |
| **4+3 beehive** | **356.1M** | **~2.42B** (projected) | **~6.8×** |

The hash map for 4+3 must hold approximately **2.4 billion entries × 8 bytes
= 19.3 GB** of raw data.

---

## The current hash map: FlatMap

The codebase uses a custom hash map called `FlatMap` — an open-addressed
hash table with linear probing. Each slot is one `uint64_t` (8 bytes),
packing the key and value together. Empty slots are marked with a sentinel
value (`0xFFFFFFFFFFFFFFFF`).

### How it works

```
Slot layout:  [key: 48 bits][value: 8 bits][unused: 8 bits]
              packed into a single uint64_t

Lookup(key):
  h = hash(key) & (capacity - 1)      // starting slot
  while slot[h] is not EMPTY:
    if slot[h].key == key: return slot[h].value   // found
    h = (h + 1) & (capacity - 1)                  // linear probe
  return NOT_FOUND

Insert(key, value):
  Same as lookup, but write to the first EMPTY slot encountered.
```

### Capacity constraints

- **Load factor**: kept below 75% (`size * 4 < capacity * 3`). Above 75%,
  linear-probe chains become long and performance degrades.
- **Power-of-2 capacity**: the slot index uses bitwise AND (`h & (cap-1)`)
  which requires capacity to be a power of 2. When the table outgrows its
  capacity, it doubles.
- **Rehash**: allocates a new array at 2× capacity, copies all entries
  (re-hashing each one), then frees the old array. **During rehash, both
  the old and new arrays exist in memory simultaneously.**

### Parallel support

The augmented BFS is parallelized across 16 cores. The FlatMap supports
lock-free parallel insertion via `atomic_emplace()` — a compare-and-swap
(CAS) on each 8-byte slot. Before entering a parallel section, the caller
pre-grows the table via `ensure_parallel_capacity()` to guarantee the load
factor won't exceed 75% during the parallel phase (because `atomic_emplace`
cannot trigger a rehash).

---

## The memory problem

For 2.42 billion entries at 75% max load:

```
Required capacity = 2.42B / 0.75 = 3.23B slots
Next power of 2   = 4,294,967,296 (4.3B slots)
Memory            = 4.3B × 8 bytes = 34.4 GB
```

The power-of-2 rounding wastes **1.07 billion slots (25%)**, and the 75%
load factor wastes another **1.87 billion slots**. Together, 74% of the
allocation is empty padding.

Additionally, if the table needs to rehash (e.g., an initial estimate was too
small), the old table (C slots) and new table (2C slots) coexist during the
copy. Peak memory during rehash = **3C × 8 bytes**.

### Why this matters for 32 GB

| What | Memory |
|------|--------|
| FlatMap (steady state) | 34.4 GB |
| FlatMap (during rehash from 2B → 4B) | 51.5 GB |
| BFS frontiers and buffers | ~2 GB |
| Total steady | ~36 GB — **exceeds 32 GB** |
| Total peak | ~53 GB — exceeds even 64 GB |

Even on a 64 GB machine, the rehash peak is a problem. The only reason the
current code works at all is that the initial `reserve()` call can sometimes
pre-allocate the final capacity in one shot, avoiding rehash. But this
requires knowing the final size in advance — a chicken-and-egg problem.

---

## The BFS access pattern

Understanding the access pattern is critical for evaluating alternatives.

### Wave structure

The augmented BFS processes states in order of grouped-move cost (0, 1, 2,
...). At each cost level, it discovers new states and adds them to the map.
Measured wave sizes for 1+6 beehive (705M total entries):

| Cost level | Cumulative entries | New entries this level | % of total |
|-----------|-------------------|----------------------|-----------|
| 0 | 93.6M | 93.6M | 13.3% |
| 1–5 | 689.4M | 595.8M | 84.5% |
| 6–10 | 703.9M | 14.5M | 2.1% |
| 11–15 | 705.2M | 1.3M | 0.2% |
| 16–22 | 705.3M | 0.08M | 0.01% |

**The vast majority (85%) of entries are discovered in cost levels 1–5.**
After level 10, growth is negligible. This means any approach that resizes
based on observed growth can predict the final size accurately after just a
few levels.

### Lookup vs insert ratio

During BFS expansion, each state generates ~42 predecessor candidates
(6 directions × 7 augmented variants). Each candidate requires:
1. A **canonicalization** (symmetry reduction): pure computation, no map access
2. A **lookup** to check if the state was already visited
3. An **insert** if the state is new

Of the ~42 candidates per state, most are duplicates (already in the map) or
non-canonical. Measured insert rate is roughly **15-25% of candidates**. So
the map sees approximately **3-4 lookups per insert**.

### Sequential vs random access

Map accesses during BFS expansion are **effectively random** — each
predecessor's hash slot is unrelated to the parent's. With 2.4B entries in a
34 GB table, nearly every probe is an **L3 cache miss** (~100 ns on modern
hardware). This is why throughput drops from 2.5M states/sec (58M-entry map,
fits in cache) to 394K states/sec (705M-entry map, far exceeds cache).

---

## Approaches evaluated

### Approach 1: Current FlatMap with power-of-2 sizing

**How it works**: exactly as described above. Power-of-2 capacity, 75% load,
linear probing.

| Metric | Value |
|--------|-------|
| Steady-state memory | 34.4 GB |
| Peak memory (during rehash) | 51.5 GB |
| Fits 32 GB? | No |
| Fits 64 GB? | Steady yes, rehash peak no |
| Compute overhead | Baseline |
| Code complexity | None (existing code) |

### Approach 2: Robin Hood hashing + non-power-of-2 capacity, pre-sized

**How it works**: Robin Hood hashing is a variant of open addressing where,
during insertion, entries are reordered so that every entry is close to its
ideal slot. This keeps probe chains short even at high load factors (90%+),
unlike standard linear probing which degrades rapidly above 75%.

Combined with non-power-of-2 capacity (using modulo `hash(k) % cap` instead
of bitmask `hash(k) & (cap-1)`), this eliminates the wasteful rounding.

Pre-sizing: after the base retrograde BFS completes, we know the base state
count (356M). Using the measured multiplier (~6.8×) with a safety margin
(7.5×), we pre-allocate `356M × 7.5 / 0.90 = 2.97B` slots. No rehash
needed.

| Metric | Value |
|--------|-------|
| Steady-state memory | 2.97B × 8 = 23.7 GB |
| Peak memory | 23.7 GB (no rehash) |
| Fits 32 GB? | Yes (8 GB margin) |
| Fits 64 GB? | Yes (40 GB margin) |
| Compute overhead | ~5% slower per probe (modulo vs bitmask) |
| Code complexity | Moderate — change FlatMap indexing, add Robin Hood insertion logic |
| Risk | If actual multiplier exceeds 7.5×, the pre-sized table is too small. A rehash at this scale would need old + new = ~50 GB → OOM. Mitigation: abort and retry with a larger multiplier, or fall back to disk-backed approach. |

### Approach 3: Count-then-allocate per BFS level

**How it works**: process each cost level in two passes. Pass 1: generate all
predecessors and count how many are new (check against the existing map, but
don't insert). Pass 2: resize the map if needed to fit the counted entries,
then insert.

This avoids predicting the final size — each resize is based on the actual
count for the next level.

| Metric | Value |
|--------|-------|
| Steady-state memory | ~20 GB (exact sizing at 90% load) |
| Peak memory | **~42 GB during rehash** (old + new table) |
| Fits 32 GB? | **No** (rehash peak exceeds 32 GB) |
| Fits 64 GB? | Yes |
| Compute overhead | ~30% — every predecessor is generated twice (once to count, once to insert) |
| Code complexity | Moderate — restructure BFS loop into count/resize/insert phases |

The rehash peak is the showstopper: growing from a 16 GB table to a 24 GB
table requires both to exist simultaneously during the copy, hitting 40 GB.
On a 64 GB machine this works; on 32 GB it doesn't.

**Variant — incremental growth with `realloc()`**: if the OS can extend the
allocation in place (common on Linux with large `mmap`-backed allocations),
`realloc()` avoids the copy and the dual-allocation peak. But this is not
guaranteed and breaks the hash layout (new slots must be initialized and
existing entries may need re-probing).

### Approach 4: Sorted array with binary search

**How it works**: instead of a hash table, store entries in a flat sorted
array. Lookup uses binary search (O(log n)). Insertion appends to a buffer,
which is periodically sorted and merged into the main array.

This achieves 100% utilization — no empty slots, no load factor overhead.

| Metric | Value |
|--------|-------|
| Steady-state memory | 2.42B × 8 = 19.4 GB |
| Peak memory | **~39 GB during merge** (old array + new sorted buffer) |
| Fits 32 GB? | **No** (merge peak) |
| Fits 64 GB? | Yes |
| Compute overhead | **~15× slower lookups** (31 binary-search comparisons vs 1-2 hash probes). With 3-4 lookups per insert, this roughly **4× total BFS time**. |
| Code complexity | High — different data structure, batch-merge logic |

The merge peak is similar to the rehash peak problem: creating the merged
array requires the old array and the merge buffer simultaneously.

### Approach 5: Two-pass with minimal perfect hashing (MPH)

**How it works**: run the BFS twice. Pass 1 discovers all keys (augmented
states) using a memory-efficient approximate data structure. Pass 2 builds a
**minimal perfect hash function** — a hash with zero collisions and 100%
load — then re-runs the BFS, storing values in a flat array indexed by the
MPH.

| Metric | Value |
|--------|-------|
| Steady-state memory (pass 2) | MPH function (0.9 GB) + value array (2.4 GB) = **3.3 GB** |
| Peak memory (pass 1) | Depends on dedup structure — see below |
| Fits 32 GB? | Pass 2 yes. Pass 1 has the same dedup problem. |
| Compute overhead | **2× BFS time** (run the BFS twice) |
| Code complexity | High — MPH construction, two-pass BFS architecture |

**The bootstrapping problem**: Pass 1 needs to track which states have been
visited to avoid infinite expansion. This requires a membership-test data
structure over 2.4B keys — which is the original problem. Options:

- **Bloom filter** (probabilistic, ~10 bits/key = 3 GB, ~1% false positive
  rate): some states are incorrectly skipped, producing an incomplete key
  set. Pass 2's MPH then has no slot for the missing keys. Acceptable only
  if the error rate is tolerable for the application.
- **Exact set** (e.g., a FlatMap storing keys without values): same memory
  problem as the original, though slightly smaller (no value byte). Defeats
  the purpose.
- **Disk-backed key log**: write all discovered keys to a temporary file.
  Use a Bloom filter for in-memory dedup (accepting ~1% redundant writes).
  Read the file back to build the MPH. Memory: ~3 GB for the Bloom filter.
  Disk: ~14 GB for keys. I/O overhead significant.

### Approach 6: Memory-mapped file (mmap)

**How it works**: replace `malloc` with `mmap` on a temporary file. The
FlatMap code is unchanged — it still indexes into a contiguous array of
`uint64_t` slots. But the OS pages data between RAM and disk as needed.
The process's **virtual address space** is 34 GB, but the **resident set**
(physical RAM used) stays within whatever is available.

| Metric | Value |
|--------|-------|
| Virtual memory | 34.4 GB (same as current) |
| Physical memory (RSS) | Limited by available RAM |
| Fits 32 GB? | Yes (pages to disk as needed) |
| Compute overhead | **Highly variable** — if working set fits in RAM, near zero. If not, disk I/O dominates. With random-access BFS pattern and HDD: catastrophically slow. With SSD: 10-50× slower than RAM. With NVMe: 3-10× slower. |
| Code complexity | Low — replace `malloc` with `mmap`, add `madvise` hints |

This is the simplest code change but the performance depends entirely on
storage speed. On an EC2 instance with EBS gp3 (3,000 IOPS baseline), the
random-access pattern would be devastating. With a local NVMe instance
store (i3/i4 instances), it could be practical.

### Approach 7: Use a larger machine

**How it works**: don't change the code. Use a 64 GB EC2 instance (e.g.,
`r6i.2xlarge`: 64 GB, 8 vCPU, ~$0.504/hr) or 128 GB (`r6i.4xlarge`:
128 GB, 16 vCPU, ~$1.008/hr).

| Metric | Value |
|--------|-------|
| Memory | 34.4 GB steady, 51 GB rehash peak |
| Fits 64 GB? | Steady yes. Rehash peak no — need pre-sizing to avoid rehash. |
| Fits 128 GB? | Yes, with full margin |
| Compute overhead | 0% |
| Code complexity | None |
| Cost | 128 GB instance for ~2 hours: ~$2. 64 GB for ~2 hours: ~$1. |

Pre-sizing the FlatMap from the base BFS count (as in Approach 2, but keeping
power-of-2 capacity) avoids rehash. With pre-sizing: `356M × 7.5 / 0.75 =
3.56B → next pow2 = 4.3B = 34.4 GB`. Fits on 64 GB with 30 GB margin for
frontiers and follow-up pipeline stages.

---

## Summary

| # | Approach | Fits 32GB | Fits 64GB | Compute cost | Complexity | Risk |
|---|----------|-----------|-----------|-------------|-----------|------|
| 1 | Current FlatMap | ✗ | ✗ (rehash) | Baseline | None | — |
| 2 | Robin Hood + non-pow2, pre-sized | ✓ | ✓ | +5% | Moderate | Multiplier estimate wrong → OOM |
| 3 | Count-then-allocate | ✗ (rehash) | ✓ | +30% | Moderate | — |
| 4 | Sorted array | ✗ (merge) | ✓ | +300% | High | — |
| 5 | Two-pass MPH | ✓* | ✓ | +100% | High | Pass 1 dedup is circular |
| 6 | mmap to disk | ✓ | ✓ | +300-1000% | Low | Storage-dependent |
| 7 | Larger machine | n/a | ✓ (pre-sized) | 0% | None | Cost: ~$1-2 |

*Pass 1 of MPH requires its own memory-efficient dedup solution.

### Recommendation

For a **one-off 4+3 enumeration run** (expected to take ~2 hours total), the
cost of a larger EC2 instance (~$1-2) is negligible. **Approach 7 (larger
machine) with Approach 2's pre-sizing** (to avoid rehash on 64 GB) is the
pragmatic choice: zero code changes, zero risk, trivial cost.

If 32 GB is a hard constraint (e.g., for iterative development or repeated
runs), **Approach 2 (Robin Hood + non-pow2 pre-sized)** is the best
engineering tradeoff: moderate code change, 5% compute overhead, fits with
8 GB margin. The multiplier-estimation risk is mitigated by the consistent
measured values (5.76-6.80× across all tested combos).

For future work beyond 7-piece enumeration (8+ pieces with billions of base
states), the FlatMap will need fundamental changes regardless. Approach 6
(mmap) or a streaming/disk-backed architecture would be the natural
evolution.

---

## Appendix: measured data

### Augmented BFS timing (single-threaded, Mac M-series, no OpenMP)

| Combo | Aug states | Time (s) | Throughput | FlatMap cap | RSS |
|-------|-----------|----------|-----------|-------------|-----|
| 1+4 beehive | 2.3M | 0.4 | 5.2M/s | 4M (32 MB) | 74 MB |
| 1+5 beehive | 58.5M | 23 | 2.5M/s | 134M (1,024 MB) | 2,441 MB |
| 1+6 beehive | 705M | 1,788 | 394K/s | 1,074M (8,192 MB) | 9,525 MB |

Throughput degrades 6.4× from 1+5 to 1+6 as the map exceeds L3 cache
(~30 MB). Projected 4+3 (2.4B states): ~103 min single-threaded, ~21 min
with 16-core parallel BFS.

### Base retrograde BFS timing (16-core EC2, from v11 production run)

| Combo | Base states | Time (s) |
|-------|------------|----------|
| 1+6 | 103.8M | 33.7 |
| 2+5 | 284.5M | 82.6 |
| 3+4 | 438.9M | 127.7 |
| 4+3 | 356.1M | 95.6 |

### Augmented state multiplier trend

| N (total robots) | Measured multiplier range |
|-----------------|------------------------|
| 2 | 1.25-1.89× |
| 3 | 1.72-2.13× |
| 4 | 2.63-3.47× |
| 5 | 3.96-4.92× |
| 6 (1+5 bee) | 5.76× |
| 7 (1+6 bee) | 6.80× |
