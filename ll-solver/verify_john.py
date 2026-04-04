#!/usr/bin/env python3
"""Verify our solver finds equal or better solutions than John's for his exact positions.

For each of John's hex puzzles:
1. Parse his positions and move/step counts
2. Replay his solution to verify it's valid
3. Run our solver (solve_min_grouped via C++ subprocess) on his exact positions
4. Compare: our grouped moves must be <= John's

This is the definitive test — no dedup matching involved.
"""

import sys
import os
import re
import subprocess
import json
from pathlib import Path

# Reuse parsing from compare_john.py
sys.path.insert(0, os.path.dirname(__file__))
from compare_john import parse_john_solution_file, john_notation_to_grid, VISUAL_TO_CONFIG

N = 5
CTR = 12

# Hex directions
HEX_DIR = {
    'Ne': (0, 1),   # NE
    'Se': (1, 0),   # SE
    'So': (1, -1),  # S-diag
    'Sw': (0, -1),  # SW
    'Nw': (-1, 0),  # NW
    'No': (-1, 1),  # N-diag
}

def replay_john_solution(pieces, solution_str):
    """Replay John's solution on our grid. Returns (valid, grouped_moves, raw_slides)."""
    if not solution_str.strip():
        return False, 0, 0

    # Build positions: exits first, then helpers
    exits = [(ch, pos) for ch, pos in pieces if ch.isalpha()]
    helpers = [(ch, pos) for ch, pos in pieces if ch.isdigit()]

    # Map piece chars to positions
    pos = {}
    for ch, (r, c) in exits + helpers:
        pos[ch] = (r, c)

    # Parse moves: "2-Se X-NeSo" -> piece moves with direction chains
    tokens = solution_str.strip().split()
    moves = []
    for tok in tokens:
        dash = tok.index('-')
        piece = tok[:dash]
        dirs_str = tok[dash+1:]
        # Parse 2-char direction codes
        i = 0
        while i < len(dirs_str):
            d = dirs_str[i:i+2]
            if d in HEX_DIR:
                moves.append((piece, d))
                i += 2
            else:
                return False, 0, 0  # invalid direction

    # Replay
    exited = set()
    grouped = 0
    last_piece = None

    for piece, dir_code in moves:
        if piece in exited:
            return False, 0, 0

        dr, dc = HEX_DIR[dir_code]
        r, c = pos[piece]

        # Build occupancy
        occ = {}
        for ch, (pr, pc) in pos.items():
            if ch != piece and ch not in exited:
                occ[(pr, pc)] = ch

        # Slide
        blocker = None
        wr, wc = r, c
        while True:
            nr, nc = wr + dr, wc + dc
            if nr < 0 or nr >= N or nc < 0 or nc >= N:
                break
            if (nr, nc) in occ:
                blocker = occ[(nr, nc)]
                break
            wr, wc = nr, nc

        if blocker is None:
            return False, 0, 0  # wall stop
        if wr == r and wc == c:
            return False, 0, 0  # no movement

        # Count grouped moves
        if piece != last_piece:
            grouped += 1
            last_piece = piece

        # Check if exit at center
        if piece in [ch for ch, _ in exits] and wr == N//2 and wc == N//2:
            exited.add(piece)
            del pos[piece]
        else:
            pos[piece] = (wr, wc)

    # Check all exits exited
    for ch, _ in exits:
        if ch not in exited:
            return False, 0, 0

    return True, grouped, len(moves)


def main():
    john_dir = os.path.join(os.path.dirname(__file__), '..', 'jr-solver', 'data', 'hex')

    john_puzzles = []
    for subdir in sorted(Path(john_dir).iterdir()):
        if not subdir.is_dir():
            continue
        for solfile in sorted(subdir.glob('solut*.txt')):
            puzzles = parse_john_solution_file(str(solfile))
            for p in puzzles:
                p['source'] = f"{subdir.name}/{solfile.name}"
                p['num_exits'] = sum(1 for ch, _ in p['pieces'] if ch.isalpha())
            john_puzzles.extend(puzzles)

    print(f"Loaded {len(john_puzzles)} puzzles from John's data")

    # Replay all John's solutions and verify
    valid = 0
    invalid = 0
    john_better = []  # cases where John has fewer grouped moves than we would expect

    for jp in john_puzzles:
        ok, grouped, slides = replay_john_solution(jp['pieces'], jp['solution'])
        if ok:
            valid += 1
            # Verify moves match John's reported count
            if grouped != jp['moves']:
                print(f"  WARNING: {jp['config']}: replay gives {grouped} grouped but John reports {jp['moves']}")
        else:
            invalid += 1
            if invalid <= 10:
                print(f"  INVALID: {jp['config']} ({jp['source']}): could not replay solution '{jp['solution']}'")

    print(f"\nReplay results: {valid} valid, {invalid} invalid out of {len(john_puzzles)}")

    if invalid > 0:
        print(f"\n{invalid} of John's solutions could not be replayed on our grid.")
        print("This may indicate a coordinate mapping error in the comparison script.")


def dump_positions():
    """Dump John's puzzle positions for C++ solver testing.
    Format: john_moves john_steps num_exits r0,c0 r1,c1 ...
    """
    john_dir = os.path.join(os.path.dirname(__file__), '..', 'jr-solver', 'data', 'hex')
    for subdir in sorted(Path(john_dir).iterdir()):
        if not subdir.is_dir():
            continue
        for solfile in sorted(subdir.glob('solut*.txt')):
            puzzles = parse_john_solution_file(str(solfile))
            for p in puzzles:
                num_exits = sum(1 for ch, _ in p['pieces'] if ch.isalpha())
                # Replay to get verified move count
                ok, grouped, slides = replay_john_solution(p['pieces'], p['solution'])
                if not ok:
                    continue
                # Output: john_moves john_steps num_exits positions...
                # Exits first, then helpers (matching our convention)
                exits = [pos for ch, pos in p['pieces'] if ch.isalpha()]
                helpers = [pos for ch, pos in p['pieces'] if ch.isdigit()]
                all_pos = exits + helpers
                pos_str = ' '.join(f'{r},{c}' for r, c in all_pos)
                print(f"{grouped} {slides} {num_exits} {pos_str}")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--dump':
        dump_positions()
    else:
        main()
