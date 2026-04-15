#!/bin/bash
# compare-runs.sh — summarize and compare enumeration runs
#
# Usage:
#   ./compare-runs.sh                  # list available runs
#   ./compare-runs.sh <run1> [<run2>]  # summarize one run, or diff two runs
#
# Each run is a .log file in this directory. The script extracts per-combo
# timing and memory info and prints a compact table.

set -u
script_dir="$(dirname "$0")"

usage() {
    echo "Usage: $0 [run1.log [run2.log]]"
    echo
    echo "Available runs (in $script_dir):"
    ls -1 "$script_dir"/*.log 2>/dev/null | sed 's|.*/|  |'
    exit 1
}

resolve_log() {
    local arg="$1"
    if [ -f "$arg" ]; then echo "$arg"
    elif [ -f "$script_dir/$arg" ]; then echo "$script_dir/$arg"
    else echo ""; fi
}

summarize() {
    local log="$1"
    echo "=== $log ==="
    awk '
    function extract_peak(line,   v) {
        match(line, /peak=[0-9]+/)
        v = substr(line, RSTART+5, RLENGTH-5)
        return v+0
    }
    function extract_rss(line,   v) {
        match(line, /rss=[0-9]+/)
        v = substr(line, RSTART+4, RLENGTH-4)
        return v+0
    }
    /^=== exits=/ {
        if (combo != "") emit_combo()
        combo = $0
        gsub(/=== | ===/, "", combo)
        bfs_states=0; bfs_s=0
        p1_s=0; p2_s=0; p3_s=0
        bfs_peak=0; p2_peak=0; prefilter_peak=0; recs_rss=0; emit_peak=0; l3_peak=0
        p3_emit=0
        p50=0; p90=0; p99=0; pmax=0; cpu_total=0
    }
    /BFS done:/ { bfs_states=$3; bfs_s=$5; sub(/s,?/, "", bfs_s); sub(/,/, "", bfs_states) }
    /pass 1 \(collect/ { p1_s=$NF; sub(/s$/,"",p1_s) }
    /pass 2 \(greedy/ { p2_s=$NF; sub(/s$/,"",p2_s) }
    /pass 3 \(solve/ { p3_s=$NF; sub(/s$/,"",p3_s) }
    /mem\[bfs_done\]/       { bfs_peak       = extract_peak($0) }
    /mem\[pass2_done\]/     { p2_peak        = extract_peak($0) }
    /mem\[prefilter_done\]/ { prefilter_peak = extract_peak($0) }
    /mem\[recs_shrunk\]/    { recs_rss       = extract_rss($0) }
    /mem\[layer3_done\]/    { l3_peak        = extract_peak($0) }
    /mem\[emit_done\]/      { emit_peak      = extract_peak($0) }
    /solve times \(us\):/ {
        for (i=1; i<=NF; i++) {
            if ($i ~ /^p50=/)   { p50=$i;      sub(/p50=/,"",p50) }
            if ($i ~ /^p90=/)   { p90=$i;      sub(/p90=/,"",p90) }
            if ($i ~ /^p99=/)   { p99=$i;      sub(/p99=/,"",p99) }
            if ($i ~ /^max=/)   { pmax=$i;     sub(/max=/,"",pmax) }
            if ($i ~ /^cpu_total=/) { cpu_total=$i; sub(/cpu_total=/,"",cpu_total); sub(/s$/,"",cpu_total) }
        }
    }
    /^  emitted:/ { p3_emit=$2 }
    END { emit_combo() }

    function emit_combo() {
        if (combo == "") return
        printf "%-28s bfs=%10s (%6.1fs) p2=%6.1fs p3=%7.1fs  emit=%-7s | bfs_peak=%5dMB p2_peak=%6dMB pf_peak=%5dMB l3_peak=%5dMB emit_peak=%6dMB | p50=%-8s p99=%-10s max=%-10s cpu=%ss\n",
            combo, bfs_states, bfs_s+0, p2_s+0, p3_s+0, p3_emit,
            bfs_peak, p2_peak, prefilter_peak, l3_peak, emit_peak,
            p50, p99, pmax, cpu_total
    }
    ' "$log"
    echo
    # Summary line from the end of the file
    grep -E "Total unique|Maximum resident set size|Elapsed \(wall clock\)|EXIT_CODE" "$log" | sed 's/^/  /'
}

if [ $# -eq 0 ]; then
    usage
fi

for arg in "$@"; do
    log=$(resolve_log "$arg")
    if [ -z "$log" ]; then
        echo "not found: $arg"; exit 1
    fi
    summarize "$log"
    echo
done
