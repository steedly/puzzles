#!/usr/bin/env python3
# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Validate all solutions in a .llp puzzle file.

Checks performed:
  1. Solution validity    — forward simulation reaches goal state
  2. Position validity    — all positions on board, no overlaps, no exit at center
  3. Sequential IDs       — IDs are 1, 2, 3, ... with no gaps or duplicates
  4. D4 position dedup    — no two puzzles share symmetry-equivalent positions
  5. Collision-sig dedup  — no two puzzles (same exits+helpers) share collision signature

After the stabilise_indices fix, solution labels refer to initial robot
identities: 'A'=exit 0 (init pos[0]), '1'=helper 0 (init pos[num_exits]),
'2'=helper 1 (init pos[num_exits+1]), etc.  Robots keep their label
through the entire solution even as helpers get re-sorted internally.
"""

import sys
from collections import defaultdict

N = 7
CTR = 3 * N + 3  # 24
EXITED = -1

# Directions: indices 0-3 shared by square (U,D,L,R) and hex (NW,SE,SW,NE).
# Hex adds indices 4-5: N-diag and S-diag.
DR = [-1, 1, 0, 0, -1,  1]
DC = [ 0, 0,-1, 1,  1, -1]
NUM_DIRS = 4
NUM_SYMS = 8

# Square direction map (1-char codes)
SQUARE_DIR_MAP = {'U': 0, 'D': 1, 'L': 2, 'R': 3}

# Hex direction map (2-char codes)
HEX_DIR_MAP = {'Nw': 0, 'Se': 1, 'Sw': 2, 'Ne': 3, 'No': 4, 'So': 5}

IS_HEX = False

# Blocked cells for board variants (set of cell indices)
BLOCKED = set()

def make_blocked_solitaire():
    return {r*N+c for r in [0,1,5,6] for c in [0,1,5,6]}

def make_blocked_ufo():
    return {r*N+c for r in range(N) for c in range(N) if r==0 or r==N-1 or c==0 or c==N-1}

def make_blocked_french():
    cells = [(0,0),(0,1),(1,0), (0,6),(0,5),(1,6),
             (6,0),(6,1),(5,0), (6,6),(6,5),(5,6)]
    return {r*N+c for r, c in cells}


def parse_puzzle(line):
    """Parse one puzzle line. Returns dict or None."""
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    parts = line.split('|')
    if len(parts) == 10:
        # Unified format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|variantFlags|positions|solution
        pid = int(parts[0])
        num_exits = int(parts[1])
        num_helpers = int(parts[2])
        min_moves = int(parts[3])
        positions_str = parts[8]
        solution_str = parts[9]
    elif len(parts) == 9:
        # Per-variant format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
        pid = int(parts[0])
        num_exits = int(parts[1])
        num_helpers = int(parts[2])
        min_moves = int(parts[3])  # groupedMoves
        positions_str = parts[7]
        solution_str = parts[8]
    elif len(parts) == 11:
        # Old metrics format
        pid = int(parts[0])
        num_exits = int(parts[1])
        num_helpers = int(parts[2])
        min_moves = int(parts[3])
        positions_str = parts[9]
        solution_str = parts[10]
    elif len(parts) == 6:
        pid = int(parts[0])
        num_exits = int(parts[1])
        num_helpers = int(parts[2])
        min_moves = int(parts[3])
        positions_str = parts[4]
        solution_str = parts[5]
    elif len(parts) == 5:
        pid = int(parts[0])
        num_exits = 1
        num_helpers = int(parts[1])
        min_moves = int(parts[2])
        positions_str = parts[3]
        solution_str = parts[4]
    else:
        return None

    coords = positions_str.strip().split()
    positions = []
    for c in coords:
        r, col = c.split(',')
        positions.append(int(r) * N + int(col))

    return {
        'id': pid,
        'num_exits': num_exits,
        'num_helpers': num_helpers,
        'min_moves': min_moves,
        'positions': positions,
        'solution_str': solution_str,
    }


def validate_puzzle(p):
    """Validate a puzzle solution using identity-based tracking.
    Labels refer to initial positions, not current sorted order."""
    pid = p['id']
    num_exits = p['num_exits']
    positions = p['positions']
    solution_str = p['solution_str']

    if not solution_str.strip():
        return True, ""

    moves = solution_str.strip().split()
    n_robots = len(positions)

    # current_cell[i] = current cell of robot with initial index i
    current_cell = list(positions)

    for step_num, move_str in enumerate(moves):
        if IS_HEX:
            if len(move_str) != 4:
                return False, f"step {step_num+1}: invalid move format '{move_str}'"
            mover_ch, dir_str, blocker_ch = move_str[0], move_str[1:3], move_str[3]
            if dir_str not in HEX_DIR_MAP:
                return False, f"step {step_num+1}: invalid direction '{dir_str}'"
        else:
            if len(move_str) != 3:
                return False, f"step {step_num+1}: invalid move format '{move_str}'"
            mover_ch, dir_str, blocker_ch = move_str[0], move_str[1], move_str[2]
            if dir_str not in SQUARE_DIR_MAP:
                return False, f"step {step_num+1}: invalid direction '{dir_str}'"

        # Labels map to initial indices: 'A'=0, 'B'=1, '1'=num_exits, '2'=num_exits+1
        def resolve_label(ch):
            if ch.isalpha() and ch.isupper():
                idx = ord(ch) - ord('A')
                if idx >= num_exits:
                    return None, f"exit label '{ch}' exceeds {num_exits} exits"
                return idx, None
            elif ch.isdigit() and ch != '0':
                idx = num_exits + int(ch) - 1
                if idx >= n_robots:
                    return None, f"helper label '{ch}' exceeds {n_robots} robots"
                return idx, None
            else:
                return None, f"invalid label '{ch}'"

        mover_idx, err = resolve_label(mover_ch)
        if err:
            return False, f"step {step_num+1}: {err}"
        blocker_idx, err = resolve_label(blocker_ch)
        if err:
            return False, f"step {step_num+1}: {err}"

        # Check mover not already exited
        if mover_idx < num_exits and current_cell[mover_idx] == EXITED:
            return False, f"step {step_num+1}: robot {mover_ch} already exited"

        cur = current_cell[mover_idx]
        pr, pc = cur // N, cur % N
        direction = HEX_DIR_MAP[dir_str] if IS_HEX else SQUARE_DIR_MAP[dir_str]

        # Build occupancy set (all robots except mover)
        occ = {}  # cell -> initial_index
        for i in range(n_robots):
            if i != mover_idx and current_cell[i] != EXITED:
                occ[current_cell[i]] = i

        # Slide
        wr, wc = pr, pc
        blocker_cell = None
        while True:
            nr, nc = wr + DR[direction], wc + DC[direction]
            if nr < 0 or nr >= N or nc < 0 or nc >= N:
                break  # wall
            np = nr * N + nc
            if np in BLOCKED:
                break  # blocked cell = wall
            if np in occ:
                blocker_cell = np
                break
            wr, wc = nr, nc

        if blocker_cell is None:
            return False, (f"step {step_num+1}: move '{move_str}' is illegal — wall stop "
                          f"(robot {mover_ch} at ({pr},{pc}))")
        if wr == pr and wc == pc:
            return False, (f"step {step_num+1}: move '{move_str}' is illegal — no movement "
                          f"(robot {mover_ch} at ({pr},{pc}))")

        # Check blocker identity matches
        actual_blocker = occ[blocker_cell]
        if actual_blocker != blocker_idx:
            return False, (f"step {step_num+1}: move '{move_str}' expected blocker "
                          f"{blocker_ch} (idx {blocker_idx}) but actual blocker is idx "
                          f"{actual_blocker} at ({blocker_cell//N},{blocker_cell%N})")

        new_cell = wr * N + wc
        # Exit landing on center: mark EXITED
        if mover_idx < num_exits and new_cell == CTR:
            current_cell[mover_idx] = EXITED
        else:
            current_cell[mover_idx] = new_cell

    # Check win: all exits EXITED
    for e in range(num_exits):
        if current_cell[e] != EXITED:
            r, c = current_cell[e] // N, current_cell[e] % N
            return False, f"exit {e} not at center (at ({r},{c})={current_cell[e]})"

    return True, ""


def validate_positions(p):
    """Check position validity: on board, no overlaps, no exit at center."""
    positions = p['positions']
    num_exits = p['num_exits']
    errors = []

    for i, pos in enumerate(positions):
        r, c = pos // N, pos % N
        if r < 0 or r >= N or c < 0 or c >= N:
            errors.append(f"robot {i} at ({r},{c}) is off board")
        if pos in BLOCKED:
            errors.append(f"robot {i} at ({r},{c}) is on a blocked cell")
        if i < num_exits and pos == CTR:
            errors.append(f"exit {i} starts at center")

    if len(set(positions)) != len(positions):
        errors.append("duplicate positions")

    return errors


def collision_signature(p):
    """Compute D4-normalised collision signature (same as enumerate.cpp).

    Computes the signature under all 8 D4 direction transforms and returns
    the lexicographically smallest one, catching puzzles that are D4
    rotations/reflections of each other.
    """
    num_exits = p['num_exits']
    positions = p['positions']
    solution_str = p['solution_str']

    if not solution_str.strip():
        return ""

    moves = solution_str.strip().split()
    n_robots = len(positions)

    # Replay to get (mover_idx, dir, blocker_idx) triples
    current_cell = list(positions)
    triples = []

    for move_str in moves:
        if IS_HEX:
            mover_ch, dir_str, blocker_ch = move_str[0], move_str[1:3], move_str[3]
        else:
            mover_ch, dir_str, blocker_ch = move_str[0], move_str[1], move_str[2]

        def resolve(ch):
            if ch.isalpha() and ch.isupper():
                return ord(ch) - ord('A')
            return num_exits + int(ch) - 1

        mover_idx = resolve(mover_ch)
        blocker_idx = resolve(blocker_ch)
        direction = HEX_DIR_MAP[dir_str] if IS_HEX else SQUARE_DIR_MAP[dir_str]

        triples.append((mover_idx, direction, blocker_idx))

        # Update position
        cur = current_cell[mover_idx]
        pr, pc = cur // N, cur % N
        occ = set()
        for i in range(n_robots):
            if i != mover_idx and current_cell[i] != EXITED:
                occ.add(current_cell[i])
        wr, wc = pr, pc
        while True:
            nr, nc = wr + DR[direction], wc + DC[direction]
            if nr < 0 or nr >= N or nc < 0 or nc >= N:
                break
            np = nr * N + nc
            if np in occ:
                break
            wr, wc = nr, nc
        new_cell = wr * N + wc
        if mover_idx < num_exits and new_cell == CTR:
            current_cell[mover_idx] = EXITED
        else:
            current_cell[mover_idx] = new_cell

    # Direction transforms for collision signature normalization.
    if IS_HEX:
        # Klein four-group: 4 direction-preserving transforms permuting 6 hex dirs.
        # Only {identity, 180°, diag, anti-diag} preserve all 6 hex directions.
        DIR_TRANSFORMS = [
            [0, 1, 2, 3, 4, 5],  # identity
            [1, 0, 3, 2, 5, 4],  # 180°
            [2, 3, 0, 1, 5, 4],  # diag-reflect
            [3, 2, 1, 0, 4, 5],  # anti-diag
        ]
    else:
        # D4: 8 transforms permuting 4 square directions {U=0,D=1,L=2,R=3}.
        DIR_TRANSFORMS = [
            [0, 1, 2, 3],  # identity
            [2, 3, 1, 0],  # 90 CW
            [1, 0, 3, 2],  # 180
            [3, 2, 0, 1],  # 270 CW
            [0, 1, 3, 2],  # reflect-H
            [1, 0, 2, 3],  # reflect-V
            [2, 3, 0, 1],  # reflect main diagonal
            [3, 2, 1, 0],  # reflect anti-diagonal
        ]

    best_sig = None
    for dir_map in DIR_TRANSFORMS:
        # Normalize labels by order of first appearance
        exit_label = {}
        helper_label = {}
        next_exit = 0
        next_helper = 1

        sig_parts = []
        for mover_idx, direction, blocker_idx in triples:
            for idx in (mover_idx, blocker_idx):
                if idx < num_exits:
                    if idx not in exit_label:
                        exit_label[idx] = next_exit
                        next_exit += 1
                else:
                    hi = idx - num_exits
                    if hi not in helper_label:
                        helper_label[hi] = next_helper
                        next_helper += 1

            if mover_idx < num_exits:
                mc = chr(ord('A') + exit_label[mover_idx])
            else:
                mc = str(helper_label[mover_idx - num_exits])
            if blocker_idx < num_exits:
                bc = chr(ord('A') + exit_label[blocker_idx])
            else:
                bc = str(helper_label[blocker_idx - num_exits])

            mapped = dir_map[direction]
            if IS_HEX:
                dc = ["Nw","Se","Sw","Ne","No","So"][mapped]
            else:
                dc = "UDLR"[mapped]
            sig_parts.append(f"{mc}{dc}{bc}")

        sig = ' '.join(sig_parts)
        if best_sig is None or sig < best_sig:
            best_sig = sig

    return best_sig


def d4_canonical(positions, num_exits):
    """Compute symmetry-canonical positions (exits and helpers sorted separately).
    Uses D4 (8 transforms) for square boards, Klein four-group (4) for hex."""
    m = N - 1
    all_transforms = [
        lambda r, c: (r, c),           # 0: identity
        lambda r, c: (c, m - r),       # 1: 90° CW
        lambda r, c: (m - r, m - c),   # 2: 180°
        lambda r, c: (m - c, r),       # 3: 270° CW
        lambda r, c: (r, m - c),       # 4: H-flip
        lambda r, c: (m - r, c),       # 5: V-flip
        lambda r, c: (c, r),           # 6: diag reflect
        lambda r, c: (m - c, m - r),   # 7: anti-diag reflect
    ]
    if IS_HEX:
        transforms = [all_transforms[i] for i in [0, 2, 6, 7]]
    else:
        transforms = all_transforms

    best = None
    for t in transforms:
        tr = []
        for pos in positions:
            r, c = pos // N, pos % N
            nr, nc = t(r, c)
            tr.append(nr * N + nc)
        # Sort exits and helpers separately
        exits = sorted(tr[:num_exits])
        helpers = sorted(tr[num_exits:])
        canon = tuple(exits + helpers)
        if best is None or canon < best:
            best = canon
    return best


def main():
    global BLOCKED, N, CTR, NUM_DIRS, NUM_SYMS, IS_HEX
    filename = sys.argv[1] if len(sys.argv) > 1 else '-'
    f = sys.stdin if filename == '-' else open(filename)

    puzzles = []
    for line in f:
        # Auto-detect variant from header comment
        if line.startswith('# Variant:'):
            variant = line.split(':', 1)[1].strip()
            if variant == 'solitaire':
                BLOCKED = make_blocked_solitaire()
            elif variant == 'ufo':
                BLOCKED = make_blocked_ufo()
            elif variant == 'french':
                BLOCKED = make_blocked_french()
            elif variant == 'hex':
                IS_HEX = True
                N = 7; CTR = 24; NUM_DIRS = 6; NUM_SYMS = 4
                BLOCKED = make_blocked_ufo()
            elif variant == 'beehive':
                IS_HEX = True
                N = 7; CTR = 24; NUM_DIRS = 6; NUM_SYMS = 4
        p = parse_puzzle(line)
        if p is not None:
            puzzles.append(p)

    if f is not sys.stdin:
        f.close()

    total = len(puzzles)
    errors = []

    def add_error(msg):
        errors.append(msg)
        if len(errors) <= 20:
            print(f"ERROR: {msg}", file=sys.stderr)

    # ── Check 1: Solution validity ──
    solution_invalid = 0
    for p in puzzles:
        ok, err = validate_puzzle(p)
        if not ok:
            solution_invalid += 1
            add_error(f"puzzle {p['id']}: {err}")

    # ── Check 2: Position validity ──
    position_invalid = 0
    for p in puzzles:
        pos_errors = validate_positions(p)
        for err in pos_errors:
            position_invalid += 1
            add_error(f"puzzle {p['id']}: {err}")

    # ── Check 3: Sequential IDs ──
    id_errors = 0
    for i, p in enumerate(puzzles):
        expected = i + 1
        if p['id'] != expected:
            id_errors += 1
            add_error(f"expected ID {expected}, got {p['id']}")
            break  # one error is enough to flag the issue

    # ── Check 4: D4 position duplicates ──
    # Key includes num_exits because same positions with different exit/helper
    # role assignments are different puzzles (different gameplay).
    canon_map = defaultdict(list)  # (num_exits, canonical_positions) → list of IDs
    for p in puzzles:
        canon = d4_canonical(p['positions'], p['num_exits'])
        canon_map[(p['num_exits'], canon)].append(p['id'])
    d4_dup_groups = 0
    d4_dup_puzzles = 0
    for canon, ids in canon_map.items():
        if len(ids) > 1:
            d4_dup_groups += 1
            d4_dup_puzzles += len(ids) - 1
            add_error(f"D4 duplicate group: puzzles {ids}")

    # ── Check 5: Collision-signature duplicates ──
    sig_map = defaultdict(list)  # (exits, helpers, sig) → list of IDs
    for p in puzzles:
        sig = collision_signature(p)
        key = (p['num_exits'], p['num_helpers'], sig)
        sig_map[key].append(p['id'])
    sig_dup_groups = 0
    sig_dup_puzzles = 0
    for key, ids in sig_map.items():
        if len(ids) > 1:
            sig_dup_groups += 1
            sig_dup_puzzles += len(ids) - 1
            add_error(f"collision-sig duplicate: puzzles {ids} (sig={key[2][:40]}...)")

    # ── Summary ──
    all_ok = (solution_invalid == 0 and position_invalid == 0 and
              id_errors == 0 and d4_dup_groups == 0 and sig_dup_groups == 0)

    print(f"\n{'PASS' if all_ok else 'FAIL'}: {total} puzzles validated")
    print(f"  Solutions:       {total - solution_invalid}/{total} valid")
    print(f"  Positions:       {total - position_invalid}/{total} valid")
    print(f"  Sequential IDs:  {'OK' if id_errors == 0 else 'FAIL'}")
    print(f"  D4 duplicates:   {d4_dup_groups} groups ({d4_dup_puzzles} extra)")
    print(f"  Collision-sig:   {sig_dup_groups} groups ({sig_dup_puzzles} extra)")

    if len(errors) > 20:
        print(f"  (showing first 20 of {len(errors)} errors)", file=sys.stderr)

    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
