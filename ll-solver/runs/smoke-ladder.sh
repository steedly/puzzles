#!/usr/bin/env bash
# Graduated smoke ladder for enumerate. Each rung runs `--only=E,H` with a
# wall-clock timeout and checks the log for obvious failure signals. Output
# goes under /tmp/smoke-{E}-{H}.{llp,log}. Validated via validate_solutions.py.
#
# Usage: ./runs/smoke-ladder.sh [START_INDEX]
# Example: ./runs/smoke-ladder.sh 0    # run from the start
#          ./runs/smoke-ladder.sh 4    # skip the trivial rungs

set -euo pipefail

cd "$(dirname "$0")/.."  # ll-solver root

if [[ ! -x ./enumerate ]]; then
    echo "FAIL: ./enumerate not built. Run 'make' first." >&2
    exit 1
fi

# combo  timeout_seconds   optional_note
RUNGS=(
    "1,4  60    trivial smoke"
    "1,5  120   v8 repro case (hex 6pc hard Layer3)"
    "2,4  120   medium 6pc"
    "1,6  300   first 7pc (1E)"
    "3,3  300   medium 6pc, exercises 3-exit pruning"
    "2,5  1200  second-hardest 7pc in v7"
    "3,4  3600  the killer combo — real test"
    "4,3  1800  second 7pc risk point"
)

START=${1:-0}

run_rung() {
    local combo="$1"
    local timeout_s="$2"
    local note="$3"
    local tag="${combo/,/-}"
    local llp="/tmp/smoke-${tag}.llp"
    local log="/tmp/smoke-${tag}.log"

    echo "========================================================"
    echo "RUNG: --only=${combo}  timeout=${timeout_s}s  (${note})"
    echo "========================================================"

    rm -f "$llp" "$log"
    local t0 t1
    t0=$(date +%s)
    if ! timeout --signal=KILL "${timeout_s}s" \
            ./enumerate 4 7 1 99 beehive 500 --only="${combo}" \
            > "$llp" 2> "$log"; then
        local rc=$?
        t1=$(date +%s)
        echo "FAIL: rung ${combo} exited rc=${rc} after $((t1-t0))s"
        echo "---- last 40 lines of $log ----"
        tail -n 40 "$log"
        return 1
    fi
    t1=$(date +%s)
    echo "OK: rung ${combo} completed in $((t1-t0))s"

    if grep -q 'FATAL FlatMap' "$log"; then
        echo "FAIL: FATAL FlatMap in log"
        grep 'FATAL FlatMap' "$log"
        return 1
    fi
    if grep -qE 'Killed|SOLVE_DFS_FAIL|std::bad_alloc|Segmentation fault' "$log"; then
        echo "FAIL: crash signal in log"
        grep -E 'Killed|SOLVE_DFS_FAIL|std::bad_alloc|Segmentation fault' "$log" | head
        return 1
    fi

    if [[ -s "$llp" ]]; then
        local n
        n=$(wc -l < "$llp")
        echo "puzzles emitted: $n"
        if (( n == 0 )); then
            echo "WARN: rung ${combo} emitted 0 puzzles (valid for some combos, e.g. dead-end dedup)"
        else
            if ! python3 validate_solutions.py "$llp" > "/tmp/smoke-${tag}.validate.log" 2>&1; then
                echo "FAIL: validate_solutions.py rejected $llp"
                tail -n 20 "/tmp/smoke-${tag}.validate.log"
                return 1
            fi
            echo "validated: OK"
        fi
    fi
}

i=0
for rung in "${RUNGS[@]}"; do
    if (( i >= START )); then
        # shellcheck disable=SC2206
        parts=($rung)
        combo="${parts[0]}"
        timeout_s="${parts[1]}"
        note="${parts[*]:2}"
        if ! run_rung "$combo" "$timeout_s" "$note"; then
            echo ""
            echo "SMOKE LADDER FAILED at rung index $i (${combo})"
            exit 1
        fi
    fi
    i=$((i+1))
done

echo ""
echo "ALL RUNGS PASSED"
