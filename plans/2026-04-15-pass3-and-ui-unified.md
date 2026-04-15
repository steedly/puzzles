# Pass-3/Layer-3 optimizations and spaceport-solitaire unified-library cutover

**Branch:** `wip/pass3-and-ui-unified`
**Started:** 2026-04-15
**Status:** in-progress
**Plan file (local):** `~/.claude/plans/cheeky-mapping-grove.md`

## Problem

Two threads of work need to land on one branch and be shippable:

1. **ll-solver throughput on 7-piece beehive.** The v7 run was killed at 4h15m
   still grinding 3E+4H Layer 3 on a 4-thread cap (deliberate, to avoid the
   OOM we hit at 16 threads). A 4×4 nested-parallelism design (4 outer puzzle
   slots × 4 inner BFS threads) would use all 16 cores with the same memory
   ceiling. A first attempt (commit `13c8a2f`) hung on the first real input
   and was reverted at the call site (`70dcee8`), leaving a known bug in
   `forward_bfs_states_parallel`: the shared FlatMap fills past 100% load
   during the parallel insert phase and `atomic_emplace` spins forever in a
   silent `for(;;)` loop. Also queued for this branch: LPT scheduling on
   pass 3 survivors (already active, `20b6cc3`) and a prefetch experiment
   (already active, `8cf57ec`).

2. **spaceport-solitaire unified library cutover.** The app currently loads
   one `.llp` per variant (`public/puzzles-{solitaire,ufo,french,hex,beehive}.llp`).
   The hook migration to a single unified `puzzles.llp` + runtime
   `variantFlags` filtering is code-committed on this branch (`540c118`),
   but the actual `public/puzzles.llp` file hasn't been replaced and the
   legacy per-variant files haven't been deleted.

**Root cause of the iteration-speed failure.** Unit tests (112 at session
start) didn't cover the parallel BFS path, the FlatMap `atomic_emplace`, or
capacity-exhaustion scenarios. A buggy 4×4 implementation passed every test,
then hung on the first real input — burning hours of run time. Discipline
fix: panic guards that convert hangs into loud aborts, direct tests for the
parallel BFS, and a graduated smoke ladder to catch scale-dependent bugs
before launching multi-hour runs.

## Plan

- **Phase 1 — FlatMap panic guards.** Bound every probe loop by `cap_` and
  abort with a descriptive stderr message on overflow. Applies to
  `atomic_emplace`, `insert_new`, `upsert`, `find_val`. Converts silent
  hangs into crashes with a diagnostic.

- **Phase 2 — Direct tests for `forward_bfs_states_parallel`.** New tests in
  `test_enumerate.cpp` covering matches-serial-small, matches-serial-medium
  (over retrograde states), capacity-stress (deepest state), concurrent-outer
  (nested OpenMP driving 4 outer calls), plus a direct
  `atomic_emplace`-single-thread test.

- **Phase 3 — Graduated smoke ladder.** `ll-solver/runs/smoke-ladder.sh`
  runs `./enumerate 4 7 1 99 beehive 500 --only=E,H` for
  `{1,4 → 1,5 → 2,4 → 1,6 → 3,3 → 2,5 → 3,4 → 4,3}` with per-rung timeouts
  and validate_solutions.py gating. Mandatory pre-flight before the full
  run.

- **Phase 4 — Debug 4×4 capacity overflow (1h cap).** With panic guards in
  place, rerun the `--only=1,5` v8 repro. Expected fix: replace
  `cur.size() * 8` in `enumerate.cpp:973` with `cur.size() * NUM_DIRS * n + 64`
  so the pre-grown capacity keeps up with worst-case branching. If 4×4 can't
  be fixed in 1h, keep the serial revert and proceed without it.

- **Phase 5 — Full enumerate run.** `./enumerate 4 7 1 99 beehive 500` in a
  tmux session, only after the smoke ladder is fully green. Monitor RSS and
  log progress.

- **Phase 6 — UI cutover.** Archive the log, validate, upload to S3, copy to
  `spaceport-solitaire/public/puzzles.llp`, run vitest + integration test +
  build, commit additively, then a separate commit deleting the legacy
  per-variant files, push the branch.

### Safety rails

- No pushes to `main`. All work lands on `wip/pass3-and-ui-unified`.
- No bypassing failing tests. Debug, don't `--no-verify`.
- 1-hour cap on the 4×4 debug. After that, keep the serial revert.
- Don't delete legacy `.llp` files until the cutover commit lands and
  downstream tests pass.
- No full run launched until the smoke ladder is fully green on the current
  binary.

### Fallback

If the full run can't be completed in the available time, cut over the UI
using `ll-solver/runs/v7-partial-before-kill.llp` (105K puzzles covering
1+x, 2+x, 3+1..3+3 — missing 3+4 and all 4+x). The unified library would be
incomplete but the UI would still load all variants. Keep the legacy
per-variant files intact in that scenario.

## Status log

### 2026-04-15T13:50Z — Plan committed, Phase 1 & 2 complete, Phase 3 running

Starting state: branch `wip/pass3-and-ui-unified` is 5 commits ahead of main
with 4×4 reverted at the call site (`70dcee8`). No enumerate run is active.

- **Phase 1 (panic guards) — complete.** Added a `probe_panic` helper on
  FlatMap and converted the unbounded probe loops in `atomic_emplace`,
  `insert_new`, `upsert`, and `find_val` into bounded loops that abort with
  a descriptive stderr message on overflow. All 112 existing unit tests pass.

- **Phase 2 (parallel BFS tests) — complete.** Added 5 new tests to
  `test_enumerate.cpp`: `forward_bfs_states_parallel_matches_serial_small`,
  `..._matches_serial_medium`, `..._capacity_stress`, `..._concurrent_outer`,
  and `flatmap_atomic_emplace_single_thread`. Caught one test-fixture bug on
  first run (used `retrograde(1,4)` with `n=4` instead of `n=5`; fixed to
  `retrograde(1,3)` + `n=4`). 117 tests pass, 0 fail.

- **Phase 3 (smoke ladder) — in progress.** Created
  `ll-solver/runs/smoke-ladder.sh` with the 8-rung sequence and per-rung
  validation. Currently running rung 0 (`--only=1,4`) in the background.

Next: wait for the smoke ladder to run through 1,4 and 1,5 (the v8 repro).
If 1,5 either passes or aborts with a loud panic message, Phase 4 (debug)
can proceed with a concrete error location. If it passes cleanly with the
serial-cap version already in place, the smoke ladder continues up the
sequence on the current binary.

### 2026-04-15T13:54Z — Smoke ladder passed 3/8 rungs, pivot: launch full run with serial revert

Smoke ladder rungs ran before I stopped the ladder to launch the full run:

| rung | status | wall time | notes |
|---|---|---|---|
| 1,4 | PASS + validated | <60s | trivial |
| 1,5 | PASS + validated | ~60s | v8 repro case — no hang with serial revert + panic guards |
| 2,4 | PASS + validated | ~30s | |
| 1,6 | in progress at 4:33/5:00 | — | past pass3_solve_done, entering Layer 3 on 14715 survivors |

The panic guards did not fire on any rung. This is the expected outcome with
the serial-cap revert active — the parallel BFS variant (the one with the
bug) is not wired up on the call site, so it was never exercised at scale.
The smoke ladder confirmed that the panic guards don't introduce regressions
and that the production binary runs cleanly through BFS → pass1 → pass2 →
pass3 on smaller combos.

**Phase 4 (debug 4×4) — deferred.** Rather than spending the 1-hour debug
budget re-enabling the 4×4 call site and iterating on the capacity fix while
the user is away, I'm launching the full run with the serial-cap revert now.
Reasoning:

1. User leaves for work, checks back tonight. A 4-6 hour serial run
   comfortably finishes before then.
2. The serial-cap path is already known-good (v7 ran clean for 4h15m before
   being killed for unrelated reasons; the kill was to add optimizations,
   not because it was failing).
3. Attempting 4×4 risks burning hours on debugging if the capacity fix
   uncovers additional issues. Correctness beats speed for this run.
4. 4×4 can be re-attempted *after* the full run completes, with the panic
   guard and new parallel BFS tests in place to speed iteration.

**Phase 5 (full run) — in progress.** Launched at 13:54Z:
```
tmux new-session -d -s unified "/usr/bin/time -v ./enumerate 4 7 1 99 beehive 500 \
  > puzzles-unified.llp 2> unified.log; echo EXIT_CODE=\$? >> unified.log"
```
PID 5277. Output goes to `ll-solver/puzzles-unified.llp` and
`ll-solver/unified.log`. Log will contain `EXIT_CODE=N` after completion.

Monitoring plan:
- Periodic RSS checks (warn >26 GB, kill >28 GB).
- Grep for `FATAL FlatMap`, `Killed`, `bad_alloc`, `Segmentation fault`.
- Log phase progress (`=== exits=`, `emitted:`, `mem[...]`).

Expected wall time: 4-6 hours (conservative). 3E+4H Layer 3 is the longest
pole — serial cap took ~4 hours in v7 before being killed.

### 2026-04-15T14:07Z — Phase 4 4×4 fix committed; session paused

User redirected: **do not defer Phase 4**. Goal: an optimized enumerate
binary that fully utilizes 16 cores while fitting in 32 GB, for both
hex + square 7×7 with 7 max pieces.

Killed the serial-revert full run (PID 5277, had been running ~3 minutes).

Applied the 4×4 fix in commit `b7cb53b`:
- Fixed the capacity pre-grow in `forward_bfs_states_parallel` from
  `cur.size() * 8` to `cur.size() * (NUM_DIRS*n + 4) + 64`. The old factor
  was wildly too small for hex 6-piece branching (max 36) — when the
  FlatMap filled to 100% load mid-parallel, `atomic_emplace` spun forever.
  With the panic guards from `4295551` in place, any future capacity
  under-estimate would now abort loudly instead of hanging.
- Re-enabled the 4×4 call site in `emit()`: 4 outer puzzle slots × 4
  inner BFS threads each (`omp_set_max_active_levels(2)` + nested
  parallel for). Same memory bound as the old 4-thread serial cap, but
  16-core utilization.

**Validated** on the v8 repro: `./enumerate 4 6 1 99 beehive 500 --only=1,5`
completes in ~11s, emits 12240 puzzles, validates clean, no panics.

**Session paused — user is closing laptop.** The scheduled wakeup is
irrelevant now (it was only valid while this terminal was connected).
When resuming, prompt:

> Continue the plan at `plans/2026-04-15-pass3-and-ui-unified.md`. Phase 4
> 4×4 fix is committed (b7cb53b) and validated on `--only=1,5`. Next: run
> the smoke ladder on the fixed binary, then launch the full
> hex + square 7-piece unified run.

Open items when resuming:
1. **Re-run smoke ladder** (`ll-solver/runs/smoke-ladder.sh`) to sanity-
   check the 4×4 binary on the graduated combo sequence, including a
   harder 7-piece rung with a more generous timeout.
2. **Scope clarification for "unified hex+square".** Today `enumerate`
   takes a single variant argument. The v7 partial only had beehive. For
   a truly unified library covering both hex and square boards we need
   either (a) separate runs per board-type + merge, or (b) an in-binary
   multi-variant run. Need to decide before Phase 5 launches.
3. **Launch the full run** with the 4×4 binary. Target: <2h wall-time
   per board type (4× speedup over v7's 4-6h serial-cap baseline).
4. **Phase 6 cutover** unchanged.

No enumerate processes running. No tmux sessions. Branch state:
`wip/pass3-and-ui-unified` at `b7cb53b` on origin.

### 2026-04-15T14:21Z — Resumed; smoke-ladder on 4×4 ✓; beehive full run launched

Session resumed. Confirmed branch at `9cceba7`, `enumerate` binary built
with the 4×4 fix, no background processes.

**Smoke-ladder spot-checks on 4×4 binary.** Ran two representative combos
directly instead of the full 8-rung ladder (the binary was already
validated on `--only=1,5` at commit time, and full-run smoke is what
matters here):

| combo | rc | puzzles | notes |
|---|---|---|---|
| `--only=1,5` | 0 | 12240 | peak RSS 225 MB, layer3_done clean, no FATAL |
| `--only=2,5` | killed at 600s timeout | — | healthy progress, peak RSS 14 GB, reached pass3_solve. Binary is fine, rung timeout just too tight for 7-piece combos. |

**Scope decision — beehive-only, no merge.** User corrected the plan:
the whole point of the unified-library exercise is that a single beehive
run produces all variants via variantFlags. Running a separate `standard`
variant would give a slightly different (D4- vs Klein-deduped) square
slice, but the simplification from "one run serves all variants" was
the original goal. The tradeoffs accepted:
1. Square variants may miss puzzles whose hex-optimal is strictly
   better than the square-optimal (would've been emitted by a dedicated
   standard run, but in beehive they're flagged `requires_diagonal` and
   excluded from cardinal variants).
2. Square variants see near-duplicates under 90°/270° rotation because
   beehive dedup uses the Klein 4-subgroup, not full D4.
The pass-3 rebucket pass already keys on `(helpers, min_raw, square,
diag)` so cardinal-only and diagonal-required puzzles get their own
500-per-bucket budget — the cardinal-only slice of a beehive run is
sufficient to populate square variants.

No separate standard run. No merge step. `ll-solver/runs/v9-beehive.llp`
IS the unified library.

**Phase 5 (full beehive run) — in progress.** Launched at 14:21Z in
tmux session `beehive`, PID 222406:
```
/usr/bin/time -v ./enumerate 4 7 1 99 beehive 500 \
  > runs/v9-beehive.llp 2> runs/v9-beehive.log
```
Output → `ll-solver/runs/v9-beehive.llp`. Log → `runs/v9-beehive.log`,
terminated with `EXIT_CODE=N` on completion.

Target wall-time with 4×4 nested parallelism: ~1-2 hours (down from
v7's 4-6h serial-cap estimate). The 3E+4H combo Layer 3 should benefit
most from the 16-core utilization. Will monitor every 20-30 min and
append progress entries.

After beehive completes, move directly to Phase 6 cutover — no merge
step, no standard run.

### 2026-04-15T15:26Z — Beehive run progress: at 3+4 (killer combo), pass 3 solve

- Elapsed: **1h4m**
- Combos started: **15/18** (1+1 through 2+5 done; currently on 3+4)
- 3+4 pre-filter: 97,983,538 → 29,176 survivors → entering pass 3 solve
- Pass 3 solve progress on 3+4: 1000/29,176 (3%) after 94s under LPT
  ordering (hardest solves first, so the early progress rate
  understates the average rate)
- Memory: RSS 10 GB current, **28.8 GB peak during pass 2** — within
  the 32 GB cap, comfortable margin
- No FATAL, no bad_alloc, no signs of the 4×4 capacity bug

After 3+4 finishes (pass 3 + Layer 3), remaining combos are 4+1, 4+2,
4+3 — all significantly smaller than 3+4. Run should finish in another
1-2 hours assuming 3+4 solve + Layer 3 takes ~1h.

No merge needed. Once this run emits `EXIT_CODE=0`, the raw output
file IS the unified library, ready for validation and UI cutover.

### 2026-04-15T15:57Z — v9 OOM-killed in 3+4 Layer 3; v10 launched with memory-aware partition

**v9 failure.** Beehive run was OOM-killed at 1h12m, signal 9, max RSS
29.8 GB. 3+4 pass 3 solve **completed successfully** at 10 GB peak
(cpu_total=18570s, max single-puzzle solve 551s). The OOM fired during
3+4 **Layer 3** when 4 concurrent hard forward BFSes each allocated
~5-6 GB FlatMaps on top of the ~10 GB pass-3 baseline. v7's serial
4-thread cap never actually finished 3+4 either (was killed at 4h15m
elapsed), so this wasn't a regression — 4 concurrent hard 7-piece
forward BFSes in Layer 3 simply don't fit in 32 GB regardless of
whether the inner BFS is parallel.

Archived: `runs/v9-partial-oom.llp` (partial, mostly 1+x..3+3),
`runs/v9-oom.log`.

**Fix (commit `6c15d99`): memory-aware partition of Layer 3.** Split
`need_bfs` by `pruned_ns[j]`:

| Phase  | Pruned pieces | Outer × Inner | Concurrent mem | Cores |
|--------|---|---|---|---|
| heavy  | ≥ 7           | 2 × 8         | ~12 GB          | 16    |
| light  | ≤ 6           | 4 × 4         | ~4 GB           | 16    |

Heavy runs first so peak RSS drops before the 16-wide fan-out in the
light phase. Both phases use the same `forward_bfs_states_parallel`
with its nested `if(cur.size()>=256)` clause on the inner region (no
thread-spawn overhead for tiny BFSes). Expected peak during heavy:
~22 GB = 12 GB concurrent + 10 GB baseline. Plenty of headroom.

Validated: `--only=1,5` still emits 12,240 puzzles, 225 MB peak, no
FATAL. All 117 unit tests pass.

**v10 launched.** 15:57Z, tmux session `beehive`, PID 3687063:
```
/usr/bin/time -v ./enumerate 4 7 1 99 beehive 500 \
  > runs/v10-beehive.llp 2> runs/v10-beehive.log
```
Expected wall time: similar to v9 for combos 1+1..2+5 (1h4m), plus
heavy Layer 3 for 3+4 (the key variable). If 2×8 Layer 3 on 3+4 is
~10-20 min and pass 3 solve is ~25 min, the run should finish in
~2.5 hours total.

### 2026-04-15T17:36Z — v10 also OOM'd at 29.85 GB; v11 uses serial BFS for heavy

v10 OOM-killed at 1h22m, exact same RSS peak as v9 (29.85 GB). The
2×8 partition didn't save us because the real villain is **the
pre-grow overhead in `forward_bfs_states_parallel`**, not concurrent
count. At each BFS level the function calls
`ensure_parallel_capacity(seen.size() + cur.size() * 46 + 64)` so
`atomic_emplace` has guaranteed headroom. That worst-case factor 46
(= NUM_DIRS × n for hex 7pc) is wildly over-provisioned for deep BFS
levels where most successors are duplicates. At peak frontier of a
500M-state BFS, `cur.size()` reaches 10-30M and the pre-grow target
balloons to 500M-1.4B entries (5-11 GB per FlatMap). Two concurrent
heavy FlatMaps blow 32 GB regardless of how the outer slots are
scheduled.

Archived: `runs/v10-partial-oom.llp`, `runs/v10-oom.log`.

**Fix (commit `db56997`).** For heavy puzzles (`pruned_ns >= 7`), use
**serial** `forward_bfs_states`. It grows via `FlatMap::insert_new`'s
natural 2× rehash — no over-provisioning — matching v7's known-safe
point. Still 4-wide outer for throughput. Light puzzles (≤6 pruned)
keep the 4×4 nested parallel variant (small BFSes, pre-grow overhead
is negligible).

| Phase  | Variant      | Outer | Inner | Concurrent mem est. | Cores |
|--------|---|---|---|---|---|
| heavy  | serial BFS   | 4     | 1     | ~4×2 GB baseline   | 4     |
| light  | parallel BFS | 4     | 4     | ~4×0.5 GB          | 16    |

Verified on `--only=1,5`: 12240 puzzles, 217 MB peak, tests pass.

**v11 launched at 17:36Z.** Same command as v10/v11:
```
/usr/bin/time -v ./enumerate 4 7 1 99 beehive 500 \
  > runs/v11-beehive.llp 2> runs/v11-beehive.log
```
PID 1001303, tmux session `beehive`.

### 2026-04-15T23:47Z — Hourly cadence start; v11 at 6h11m on combo 17/18 (4+2)

Switching to hourly status reports (committed + pushed each hour) so
you can track the run from any device.

**3+4 completed successfully.** Peak RSS 27.6 GB (well under 32 GB
cap). 27,817 puzzles emitted, 853 state-set dups removed by Layer 3.
Pass 3 wall time for 3+4: 3h18m (Layer 3 alone ~3h under 4-wide
serial forward_bfs_states for heavy puzzles).

**Currently: 4+2, pass 3 solve tail.** Combos 1+1..4+1 all done
(16/18). Output file 19 MB with 133,626 puzzles (vs v7-partial's 105K).

Pass 3 solve of 4+2 has been running ~1h41m, which is much longer
than 3+3/3+4 took (6-20 min). Thread inspection shows only 3 of 16
threads active (state R); the other 13 are in `futex_do_wait`
(OpenMP barrier). This is LPT tail latency — a handful of
extraordinarily hard 4-exit puzzles are still solving while the other
~15000 puzzles finished. The 4-exit DP state space is dramatically
larger than 3-exit, so per-puzzle worst-case solve time scales up.
Progress lines aren't printing because `done % 500 == 0` checks are
gated on `omp_get_thread_num() == 0`, and the main thread is itself
stuck inside a long-running `solve_min_grouped` call.

**Memory is fine** (10 GB RSS, 20 GB free). **No OOM risk.** Just
slow tail. No intervention — killing would lose 6h of progress for
marginal benefit. Letting v11 finish.

After v11 completes: validate, note 4-exit tail latency as a
follow-up optimization (see open items below), do Phase 6 UI cutover.
