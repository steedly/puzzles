#!/usr/bin/env python3
# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Validate the unified puzzle library produced by `make unified`.

Runs four checks on top of the basic solution validator:

  1. Flag re-derivation     — recompute variantFlags from positions+solution
                              and compare against the stored value.
  2. Cross-library compare  — for cardinal-only puzzles whose stableId also
                              exists in the legacy per-variant .llp files,
                              confirm the stored minMoves matches.
  3. Per-variant counts     — tally how many puzzles each variant filter
                              keeps; print order-of-magnitude sanity check.
  4. Slide-on-blocked check — for each (puzzle, variant) where the flag says
                              the puzzle fits, replay the stored solution
                              with that variant's BLOCKED mask enforced and
                              confirm no slide passes through a blocked cell.

Usage: validate_unified.py puzzles-unified.llp [--legacy-dir DIR]
"""

import argparse
import sys
from collections import defaultdict

N = 7
CTR_R, CTR_C = 3, 3

# Direction tables: indices 0-3 are the cardinal-equivalents shared with the
# square pipeline; 4-5 are the two extra hex diagonals.
DR = [-1, 1, 0, 0, -1,  1]
DC = [ 0, 0,-1, 1,  1, -1]

HEX_DIR_MAP = {'Nw': 0, 'Se': 1, 'Sw': 2, 'Ne': 3, 'No': 4, 'So': 5}


def make_blocked_solitaire():
    return {(r, c) for r in (0, 1, 5, 6) for c in (0, 1, 5, 6)}

def make_blocked_ufo():
    return {(r, c) for r in range(N) for c in range(N)
            if r == 0 or r == N - 1 or c == 0 or c == N - 1}

def make_blocked_french():
    return {(0,0),(0,1),(1,0),(0,6),(0,5),(1,6),
            (6,0),(6,1),(5,0),(6,6),(6,5),(5,6)}

BLOCKED_SOLITAIRE = make_blocked_solitaire()
BLOCKED_UFO       = make_blocked_ufo()
BLOCKED_FRENCH    = make_blocked_french()
BLOCKED_HEX       = BLOCKED_UFO  # 5x5 inner

VARIANT_BLOCKS = {
    'standard':  set(),
    'solitaire': BLOCKED_SOLITAIRE,
    'ufo':       BLOCKED_UFO,
    'french':    BLOCKED_FRENCH,
    'hex':       BLOCKED_HEX,
    'beehive':   set(),
}

VARIANT_BIT = {
    'standard':  1 << 0,
    'solitaire': 1 << 1,
    'ufo':       1 << 2,
    'french':    1 << 3,
    'hex':       1 << 4,
    'beehive':   1 << 5,
}
DIAGONAL_BIT = 1 << 6
CARDINAL_VARIANTS = {'standard', 'solitaire', 'ufo', 'french'}


def compute_stable_id(num_exits, positions):
    """Match usePuzzleLibrary.computeStableId."""
    value = 0
    for r, c in positions:
        value = value * 49 + (r * 7 + c)
    return f"{num_exits}-{base36(value)}"


def base36(n):
    if n == 0: return '0'
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = []
    while n > 0:
        out.append(digits[n % 36])
        n //= 36
    return ''.join(reversed(out))


def parse_unified_line(line):
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    parts = line.split('|')
    if len(parts) != 10:
        return None
    pid          = int(parts[0])
    num_exits    = int(parts[1])
    num_helpers  = int(parts[2])
    grouped      = int(parts[3])
    raw_slides   = int(parts[4])
    min_raw      = int(parts[5])
    fwd_states   = int(parts[6])
    flags        = int(parts[7])
    pos_str      = parts[8]
    sol_str      = parts[9]
    positions = []
    for tok in pos_str.split():
        r, c = tok.split(',')
        positions.append((int(r), int(c)))
    moves = sol_str.split() if sol_str else []
    return {
        'id': pid, 'num_exits': num_exits, 'num_helpers': num_helpers,
        'grouped': grouped, 'raw_slides': raw_slides, 'min_raw': min_raw,
        'fwd_states': fwd_states, 'flags': flags,
        'positions': positions, 'moves': moves,
    }


def parse_legacy_line(line):
    """Legacy 9-field per-variant format."""
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    parts = line.split('|')
    if len(parts) != 9:
        return None
    pid       = int(parts[0])
    num_exits = int(parts[1])
    grouped   = int(parts[3])
    pos_str   = parts[7]
    positions = []
    for tok in pos_str.split():
        r, c = tok.split(',')
        positions.append((int(r), int(c)))
    return pid, num_exits, grouped, positions


def expected_flags(positions, moves):
    """Recompute variantFlags from positions + solution moves."""
    def fits(blocked):
        return all((r, c) not in blocked for r, c in positions)
    f = 0
    f |= 1 << 0                                          # standard
    if fits(BLOCKED_SOLITAIRE): f |= 1 << 1
    if fits(BLOCKED_UFO):       f |= 1 << 2
    if fits(BLOCKED_FRENCH):    f |= 1 << 3
    if fits(BLOCKED_HEX):       f |= 1 << 4
    f |= 1 << 5                                          # beehive
    for mv in moves:
        if len(mv) == 4:
            d = HEX_DIR_MAP.get(mv[1:3])
            if d is not None and d >= 4:
                f |= 1 << 6
                break
    return f


def replay_with_blocks(p, blocked):
    """Replay the stored solution with `blocked` enforced.
    Returns (ok, error). A slide passing through a blocked cell -> fail."""
    num_exits = p['num_exits']
    cur = list(p['positions'])
    EXITED = (-1, -1)
    for step, mv in enumerate(p['moves']):
        if len(mv) != 4:
            return False, f"step {step+1}: bad move '{mv}'"
        mover_ch, dir_str, blocker_ch = mv[0], mv[1:3], mv[3]
        d = HEX_DIR_MAP.get(dir_str)
        if d is None:
            return False, f"step {step+1}: bad dir '{dir_str}'"
        if mover_ch.isalpha() and mover_ch.isupper():
            mi = ord(mover_ch) - ord('A')
        else:
            mi = num_exits + int(mover_ch) - 1
        if not (0 <= mi < len(cur)) or cur[mi] == EXITED:
            return False, f"step {step+1}: invalid mover"
        pr, pc = cur[mi]
        occ = {cur[i]: i for i in range(len(cur))
               if i != mi and cur[i] != EXITED}
        wr, wc = pr, pc
        landed = False
        while True:
            nr, nc = wr + DR[d], wc + DC[d]
            if nr < 0 or nr >= N or nc < 0 or nc >= N:
                break
            if (nr, nc) in blocked:
                # Wall stop on blocked cell — solution must NOT depend on
                # the slide passing *through* it. The slide simply stops.
                break
            if (nr, nc) in occ:
                landed = True
                break
            wr, wc = nr, nc
        if not landed and (wr, wc) == (pr, pc):
            return False, f"step {step+1}: no movement"
        if not landed:
            return False, f"step {step+1}: wall stop, no blocker"
        if mi < num_exits and (wr, wc) == (CTR_R, CTR_C):
            cur[mi] = EXITED
        else:
            cur[mi] = (wr, wc)
    # Goal check: all exits have exited
    for i in range(num_exits):
        if cur[i] != EXITED:
            return False, "goal not reached"
    return True, ""


def load_legacy_index(path):
    """Build {stableId: grouped_moves} from a legacy .llp file."""
    out = {}
    try:
        with open(path) as f:
            for line in f:
                rec = parse_legacy_line(line)
                if rec is None:
                    continue
                pid, ne, grouped, positions = rec
                sid = compute_stable_id(ne, positions)
                out[sid] = grouped
    except FileNotFoundError:
        return None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('llp', help='unified .llp file')
    ap.add_argument('--legacy-dir',
                    default='../spaceport-solitaire/public',
                    help='directory containing legacy puzzles*.llp')
    args = ap.parse_args()

    puzzles = []
    with open(args.llp) as f:
        for line in f:
            p = parse_unified_line(line)
            if p is not None:
                puzzles.append(p)
    print(f"Loaded {len(puzzles)} unified puzzles")

    # === Check 1: flag re-derivation =========================================
    flag_mismatches = []
    for p in puzzles:
        exp = expected_flags(p['positions'], p['moves'])
        if exp != p['flags']:
            flag_mismatches.append((p['id'], p['flags'], exp))
    if flag_mismatches:
        print(f"FAIL [flags]: {len(flag_mismatches)} puzzles disagree")
        for pid, got, exp in flag_mismatches[:10]:
            print(f"  id={pid} stored={got} expected={exp}")
    else:
        print(f"PASS [flags]: all {len(puzzles)} variantFlags match recomputation")

    # === Check 3: per-variant counts =========================================
    variant_counts = {v: 0 for v in VARIANT_BIT}
    for p in puzzles:
        for v, bit in VARIANT_BIT.items():
            if not (p['flags'] & bit):
                continue
            if v in CARDINAL_VARIANTS and (p['flags'] & DIAGONAL_BIT):
                continue
            variant_counts[v] += 1
    print("Per-variant filter counts:")
    for v in ('standard', 'solitaire', 'ufo', 'french', 'hex', 'beehive'):
        print(f"  {v:9s} {variant_counts[v]:6d}")

    # === Check 4: slide-on-blocked enforcement ==============================
    block_failures = 0
    block_examples = []
    for p in puzzles:
        for v, bit in VARIANT_BIT.items():
            if not (p['flags'] & bit):
                continue
            if v in CARDINAL_VARIANTS and (p['flags'] & DIAGONAL_BIT):
                continue
            ok, err = replay_with_blocks(p, VARIANT_BLOCKS[v])
            if not ok:
                block_failures += 1
                if len(block_examples) < 10:
                    block_examples.append((p['id'], v, err))
    if block_failures:
        print(f"FAIL [blocks]: {block_failures} (puzzle, variant) replays failed")
        for pid, v, err in block_examples:
            print(f"  id={pid} variant={v}: {err}")
    else:
        print(f"PASS [blocks]: every flagged (puzzle, variant) solution survives its block mask")

    # === Check 2: cross-library minMoves comparison =========================
    print("Cross-library comparison vs legacy per-variant files:")
    for v in ('standard', 'solitaire', 'ufo', 'french', 'hex', 'beehive'):
        legacy = load_legacy_index(f"{args.legacy_dir}/puzzles{'' if v=='standard' else '-'+v}.llp")
        if legacy is None:
            print(f"  {v:9s} (legacy file missing — skipped)")
            continue
        bit = VARIANT_BIT[v]
        compared = 0
        mismatches = 0
        examples = []
        for p in puzzles:
            if not (p['flags'] & bit):
                continue
            if v in CARDINAL_VARIANTS and (p['flags'] & DIAGONAL_BIT):
                continue
            sid = compute_stable_id(p['num_exits'], p['positions'])
            if sid not in legacy:
                continue
            compared += 1
            if legacy[sid] != p['grouped']:
                mismatches += 1
                if len(examples) < 5:
                    examples.append((p['id'], sid, p['grouped'], legacy[sid]))
        tag = "OK" if mismatches == 0 else "MISMATCH"
        print(f"  {v:9s} {tag}: {compared} overlapping puzzles, {mismatches} minMoves disagreements")
        for pid, sid, uni, leg in examples:
            print(f"    id={pid} sid={sid} unified={uni} legacy={leg}")

    fail = bool(flag_mismatches) or bool(block_failures)
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
