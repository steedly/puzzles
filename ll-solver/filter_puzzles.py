#!/usr/bin/env python3
# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Filter a .llp puzzle file to keep the N most diverse puzzles per bucket.

Buckets are defined by (exits, helpers, grouped_moves, difficulty_tier).
Within each bucket, puzzles are selected using farthest-point sampling on
position fingerprints (sorted pairwise Manhattan distances between robots),
ensuring maximum geometric diversity.

Usage:
    python3 filter_puzzles.py input.llp [--n 1000] [-o output.llp]
    python3 filter_puzzles.py input.llp --n 500 -o filtered.llp
"""

import argparse
import math
import sys
from collections import defaultdict


def difficulty_tier(helpers):
    if helpers <= 2:
        return 'easy'
    if helpers == 3:
        return 'medium'
    if helpers == 4:
        return 'hard'
    return 'expert'


def position_fingerprint(positions_str, board_n):
    """Compute a rotation/reflection-invariant fingerprint from robot positions.

    Returns sorted list of pairwise Manhattan distances between all robots.
    This captures the geometric "shape" of the arrangement.
    """
    coords = []
    for p in positions_str.strip().split():
        r, c = p.split(',')
        coords.append((int(r), int(c)))

    distances = []
    n = len(coords)
    for i in range(n):
        for j in range(i + 1, n):
            d = abs(coords[i][0] - coords[j][0]) + abs(coords[i][1] - coords[j][1])
            distances.append(d)
    distances.sort()
    return distances


def fp_dist_sq(fp1, fp2):
    """Squared Euclidean distance between two fingerprints (avoids sqrt)."""
    total = 0
    n1, n2 = len(fp1), len(fp2)
    n = max(n1, n2)
    for i in range(n):
        a = fp1[i] if i < n1 else 0
        b = fp2[i] if i < n2 else 0
        d = a - b
        total += d * d
    return total


def farthest_point_sample(puzzles, fingerprints, k):
    """Select k puzzles using farthest-point (greedy k-center) sampling.

    For large buckets (>10*k), first subsample 10*k random candidates to keep
    runtime manageable, then run exact farthest-point on the subsample.

    Returns list of selected indices (into the original puzzles list).
    """
    import random

    n = len(puzzles)
    if n <= k:
        return list(range(n))

    # For large buckets, subsample to 10*k candidates first
    if n > k * 10:
        random.seed(42)  # deterministic
        candidates = random.sample(range(n), k * 10)
        sub_fps = [fingerprints[i] for i in candidates]
        sub_selected = _farthest_point_core(sub_fps, k)
        return [candidates[i] for i in sub_selected]

    return _farthest_point_core(fingerprints, k)


def _farthest_point_core(fingerprints, k):
    """Core farthest-point sampling on a list of fingerprints."""
    n = len(fingerprints)
    if n <= k:
        return list(range(n))

    # Seed: puzzle with largest fingerprint sum (most spread-out)
    best_seed = max(range(n), key=lambda i: sum(fingerprints[i]))

    selected = [best_seed]
    min_dist = [float('inf')] * n

    # Initialize distances to seed
    seed_fp = fingerprints[best_seed]
    for i in range(n):
        min_dist[i] = fp_dist_sq(fingerprints[i], seed_fp)
    min_dist[best_seed] = -1

    for _ in range(k - 1):
        # Pick puzzle with largest min_dist
        best_idx = max(range(n), key=lambda i: min_dist[i])
        if min_dist[best_idx] <= 0:
            break
        selected.append(best_idx)

        # Update min_dist with new selection
        sel_fp = fingerprints[best_idx]
        for i in range(n):
            if min_dist[i] <= 0:
                continue
            d = fp_dist_sq(fingerprints[i], sel_fp)
            if d < min_dist[i]:
                min_dist[i] = d
        min_dist[best_idx] = -1

    return selected


def main():
    parser = argparse.ArgumentParser(description='Filter puzzles to N most diverse per bucket')
    parser.add_argument('input', help='Input .llp file')
    parser.add_argument('--n', type=int, default=1000, help='Max puzzles per bucket (default: 1000)')
    parser.add_argument('-o', '--output', help='Output file (default: stdout)')
    args = parser.parse_args()

    # Detect board size from header
    board_n = 7
    header_lines = []
    with open(args.input) as f:
        for line in f:
            if line.startswith('#'):
                header_lines.append(line)
                if '# Variant: hex' in line and 'beehive' not in line:
                    board_n = 5
                elif '# Variant: beehive' in line:
                    board_n = 7
            else:
                break

    # Parse all puzzles into buckets
    buckets = defaultdict(list)  # bucket_key → [(line, fingerprint)]
    total = 0

    with open(args.input) as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            parts = line.strip().split('|')
            if len(parts) != 9:
                continue

            exits = int(parts[1])
            helpers = int(parts[2])
            grouped = int(parts[3])
            positions_str = parts[7]
            tier = difficulty_tier(helpers)

            bucket_key = (exits, helpers, grouped, tier)
            fp = position_fingerprint(positions_str, board_n)
            buckets[bucket_key].append((line.strip(), fp))
            total += 1

    # Select N most diverse per bucket
    kept = 0
    skipped = 0
    selected_lines = []

    for bucket_key in sorted(buckets.keys()):
        entries = buckets[bucket_key]
        if len(entries) <= args.n:
            # Keep all
            for line, _ in entries:
                selected_lines.append(line)
            kept += len(entries)
        else:
            # Farthest-point sample
            fps = [fp for _, fp in entries]
            indices = farthest_point_sample(entries, fps, args.n)
            for idx in sorted(indices):
                selected_lines.append(entries[idx][0])
            kept += len(indices)
            skipped += len(entries) - len(indices)

    # Renumber IDs sequentially
    out = sys.stdout if args.output is None else open(args.output, 'w')

    for hl in header_lines:
        out.write(hl)

    for new_id, line in enumerate(selected_lines, 1):
        parts = line.split('|', 1)
        out.write(f"{new_id}|{parts[1]}\n")

    if out is not sys.stdout:
        out.close()

    n_buckets = len(buckets)
    print(f"Filtered {total:,} → {kept:,} puzzles "
          f"({n_buckets} buckets, N={args.n}, "
          f"{100*kept/total:.1f}% kept)",
          file=sys.stderr)


if __name__ == '__main__':
    main()
