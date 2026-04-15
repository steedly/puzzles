# Enumeration run archive

Each `*.log` file here is a copy of `../unified.log` captured at the end of (or during) an enumeration run. They preserve per-combo BFS state counts, pass 1/2/3 wall times, per-phase peak memory (via `log_mem`), per-puzzle forward-BFS solve-time distributions, and the final `/usr/bin/time -v` summary.

## Usage

```
./compare-runs.sh                         # list available runs
./compare-runs.sh v7.log                  # summarize one run as a compact table
./compare-runs.sh v6.log v7.log           # summarize two runs side-by-side
```

The summarizer extracts from each combo:
- BFS state count + BFS wall time
- Pass 2 wall time, pass 3 wall time
- Emitted puzzle count
- Peak RSS at `bfs_done`, `pass2_done`, `prefilter_done`, `layer3_done`, `emit_done`
- Solve time distribution: p50, p99, max, total CPU

## Naming convention

- `v{N}.log` — completed run. Version tags are incremented whenever the code changes materially.
- `v{N}-inprogress.log` — snapshot of a run that hasn't finished yet (may be overwritten).
- `v{N}-{tag}.log` — run variants, e.g. `v7-16threads.log`, `v7-8threads.log`.

## Run history

- **v4** — first run with memory fixes 1/2/3 (FlatMap in `solve_min_grouped`, free `dist` post-pass-2, shrink `recs` post-pre-filter). OOM at 3E+4H peak 30.9 GB during pre-filter. **LOG NOT PRESERVED.**
- **v5** — v4 + memory instrumentation (`log_mem`, `reset_peak_rss`). Same OOM. **LOG NOT PRESERVED.**
- **v6** — v5 + heap-allocation optimizations (thread-local buffers in pass 2 hot loop, fixed-size FP fingerprint, `local_best` swap-clear, skip `all_states`/`all_depths` copy, 1% bucket timing distribution). OOM at 3E+4H **in Layer 3** (post-solve `forward_bfs_states` dedup phase). **LOG NOT PRESERVED.**
- **v7** — v6 + `forward_bfs_states` uses FlatMap + Layer 3 capped at 4 threads. Currently running.
