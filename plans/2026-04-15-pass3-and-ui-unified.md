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
