#!/bin/bash
# snapshot.sh — copy the live unified.log into runs/ with a version tag.
#
# Usage:
#   ./snapshot.sh                # copy to v7-inprogress.log (default)
#   ./snapshot.sh v7             # copy to v7.log (use at run end)
#   ./snapshot.sh v8-something   # any suffix you want
#
# Idempotent. Prints the destination filename.

set -u
src="/home/ec2-user/src/puzzles/ll-solver/unified.log"
dir="$(dirname "$0")"
tag="${1:-v7-inprogress}"
dst="$dir/${tag}.log"

if [ ! -f "$src" ]; then
    echo "source not found: $src"; exit 1
fi
cp "$src" "$dst"
echo "$dst  ($(wc -l < "$dst") lines, $(du -h "$dst" | cut -f1))"
