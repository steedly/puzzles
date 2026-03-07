#!/usr/bin/env python3
"""Validate all solutions in a .llp puzzle file by forward simulation.

After the stabilise_indices fix, solution labels refer to initial robot
identities: 'A'=exit 0 (init pos[0]), '1'=helper 0 (init pos[num_exits]),
'2'=helper 1 (init pos[num_exits+1]), etc.  Robots keep their label
through the entire solution even as helpers get re-sorted internally.
"""

import sys

N = 7
CTR = 3 * N + 3  # 24
EXITED = -1

DR = [-1, 1, 0, 0]  # U, D, L, R
DC = [0, 0, -1, 1]
DIR_MAP = {'U': 0, 'D': 1, 'L': 2, 'R': 3}


def parse_puzzle(line):
    """Parse one puzzle line. Returns (id, num_exits, positions, solution_str) or None."""
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    parts = line.split('|')
    if len(parts) == 6:
        pid = int(parts[0])
        num_exits = int(parts[1])
        positions_str = parts[4]
        solution_str = parts[5]
    elif len(parts) == 5:
        pid = int(parts[0])
        num_exits = 1
        positions_str = parts[3]
        solution_str = parts[4]
    else:
        return None

    coords = positions_str.strip().split()
    positions = []
    for c in coords:
        r, col = c.split(',')
        positions.append(int(r) * N + int(col))

    return pid, num_exits, positions, solution_str


def validate_puzzle(pid, num_exits, positions, solution_str):
    """Validate a puzzle solution using identity-based tracking.
    Labels refer to initial positions, not current sorted order."""
    if not solution_str.strip():
        return True, ""

    moves = solution_str.strip().split()
    n_robots = len(positions)

    # current_cell[i] = current cell of robot with initial index i
    current_cell = list(positions)

    for step_num, move_str in enumerate(moves):
        if len(move_str) != 3:
            return False, f"step {step_num+1}: invalid move format '{move_str}'"

        mover_ch, dir_ch, blocker_ch = move_str[0], move_str[1], move_str[2]

        if dir_ch not in DIR_MAP:
            return False, f"step {step_num+1}: invalid direction '{dir_ch}'"

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
        direction = DIR_MAP[dir_ch]

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


def main():
    filename = sys.argv[1] if len(sys.argv) > 1 else '-'
    f = sys.stdin if filename == '-' else open(filename)

    total = 0
    valid = 0
    invalid = 0

    for line in f:
        result = parse_puzzle(line)
        if result is None:
            continue
        pid, num_exits, positions, solution_str = result
        total += 1
        ok, err = validate_puzzle(pid, num_exits, positions, solution_str)
        if ok:
            valid += 1
        else:
            invalid += 1
            if invalid <= 20:
                print(f"INVALID puzzle {pid}: {err}", file=sys.stderr)

    if f is not sys.stdin:
        f.close()

    print(f"\nResults: {total} puzzles, {valid} valid, {invalid} invalid")
    if invalid > 20:
        print(f"  (showing first 20 of {invalid} errors)", file=sys.stderr)
    return 0 if invalid == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
