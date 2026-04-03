#!/usr/bin/env python3
# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Compare ll-solver hex puzzle output against John Rausch's reference data.

Parses John's hex solution files and our .llp output, maps positions between
the two coordinate systems, and flags discrepancies.

John's hex board display uses visual row*10+col notation where visual rows are
1-9 (diamond shape: 1,2,3,4,5,4,3,2,1 cells). Our system uses a 5x5 grid
with row*5+col (0-indexed).

The mapping between John's visual display and our 5x5 grid is determined by
the CONFIG_TO_BOARD mapping in his PL/I code:
  Config positions 1-5  → Board row 1 (our grid row 0)
  Config positions 6-10 → Board row 2 (our grid row 1)
  ...
  Config positions 21-25 → Board row 5 (our grid row 4)

John's board notation Xrc means the piece is at board position row*10+col
in his padded array, which maps to our grid as (row-1, col-1).
"""

import sys
import os
import re
from collections import defaultdict
from pathlib import Path


def john_board_pos_to_grid(board_pos):
    """Convert John's board position (row*10+col, 1-indexed) to our (row, col) 0-indexed."""
    row = board_pos // 10
    col = board_pos % 10
    return (row - 1, col - 1)


def parse_john_board_header(header):
    """Parse 'Board (X51:31:32:82)' to extract piece positions.

    Returns: list of (piece_type, (row, col)) where piece_type is 'X','Y','Z' for
    exits or '1'-'9' for helpers.

    But wait -- the notation may use config positions (1-25) rather than board
    positions. Let me check: position 82 can't be a board pos (max row=5, so max=55).

    Actually, looking at John's display code, the notation uses 2-digit numbers
    that are visual display coordinates: row=1-9 of the hex diamond, col=1-N
    within that visual row.

    Visual hex rows map to config positions:
      Visual row 1 (1 cell):  config 1       → grid (0,0) mapped diagonally
      Visual row 2 (2 cells): configs 2,3    → etc

    But this is complex. Let me instead just use the visual row/col from the
    ASCII art display to identify piece positions.
    """
    # This is complex -- let's use the ASCII display instead.
    pass


def parse_john_solution_file(filepath):
    """Parse a John Rausch hex solution file (solut*.txt).

    Each puzzle block looks like:
            -             : Board (X51:31:32:82)
         -     -          :
      1     2     -       : Solutions (1 Move, 3 Steps) .... 1
    ...
    X-NeSeNo
    -----------

    We extract: board config string, move count, step count, solution.
    Board notation: Xrc means piece X at visual_row r, visual_col c (1-indexed).
    """
    puzzles = []

    with open(filepath) as f:
        lines = f.readlines()

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()

        # Look for Board header
        m = re.search(r'Board \(([^)]+)\)', line)
        if m:
            config_str = m.group(1)

            # Parse piece positions from notation like "X51:31:32:82"
            pieces = []
            parts = config_str.split(':')
            for part in parts:
                # Part is like "X51" or "31" — piece char + 2-digit position
                # First part has piece char prefix (X, Y, Z); remaining are numbers
                if part[0].isalpha():
                    piece_ch = part[0]
                    pos_str = part[1:]
                else:
                    # Helper pieces are numbered sequentially by position order
                    piece_ch = str(len([p for p in pieces if p[0].isdigit()]) + 1)
                    pos_str = part

                grid_pos = john_notation_to_grid(pos_str)
                if grid_pos is not None:
                    pieces.append((piece_ch, grid_pos))

            # Parse moves and steps from nearby lines
            moves = None
            steps = None
            for j in range(i, min(i+10, len(lines))):
                sm = re.search(r'Solutions \((\d+) Moves?, (\d+) Steps?\)', lines[j])
                if sm:
                    moves = int(sm.group(1))
                    steps = int(sm.group(2))
                    break

            # Find solution line (after the display, before the dashes)
            solution = ""
            for j in range(i+9, min(i+12, len(lines))):
                sl = lines[j].strip()
                if sl and not sl.startswith('-') and ':' not in sl:
                    solution = sl
                    break

            if moves is not None and pieces:
                puzzles.append({
                    'config': config_str,
                    'moves': moves,
                    'steps': steps,
                    'pieces': pieces,
                    'solution': solution,
                })

        i += 1

    return puzzles


# Visual hex diamond row structure (0-indexed visual rows):
# Row 0: 1 cell at horizontal center
# Row 1: 2 cells
# ...
# Row 4: 5 cells (widest)
# Row 5: 4 cells
# ...
# Row 8: 1 cell
#
# Each cell occupies 6 characters in the display (including spacing).
# The center of each cell aligns with the piece character.

# Maps from (visual_row, visual_col) to our 5x5 grid (row, col).
# This is derived from John's CONFIG_TO_BOARD mapping.
#
# John's config is a linear string of 25 chars. Position p (0-indexed) maps
# to grid (p // 5, p % 5).
#
# The visual hex display lays out config positions in this diamond pattern:
#   Visual row 0:  config[0]                    = grid(0,0)
#   Visual row 1:  config[1], config[5]         = grid(0,1), grid(1,0)
#   Visual row 2:  config[2], config[6], config[10]  = grid(0,2), grid(1,1), grid(2,0)
#   Visual row 3:  config[3], config[7], config[11], config[15] = (0,3),(1,2),(2,1),(3,0)
#   Visual row 4:  config[4], config[8], config[12], config[16], config[20] = (0,4),(1,3),(2,2),(3,1),(4,0)
#   Visual row 5:  config[9], config[13], config[17], config[21] = (1,4),(2,3),(3,2),(4,1)
#   Visual row 6:  config[14], config[18], config[22] = (2,4),(3,3),(4,2)
#   Visual row 7:  config[19], config[23] = (3,4),(4,3)
#   Visual row 8:  config[24] = (4,4)

# Map from John's visual notation (row*10+col, 1-indexed) to config position (0-indexed).
# Derived from MAKE_HEX_BOARD in config.pli.
# Visual display rows (1-indexed, XL(2) to XL(10)) contain config positions:
#   XL(2)  = visual row 1: config 5
#   XL(3)  = visual row 2: config 4, 10
#   XL(4)  = visual row 3: config 3, 9, 15
#   XL(5)  = visual row 4: config 2, 8, 14, 20
#   XL(6)  = visual row 5: config 1, 7, 13, 19, 25
#   XL(7)  = visual row 6: config 6, 12, 18, 24
#   XL(8)  = visual row 7: config 11, 17, 23
#   XL(9)  = visual row 8: config 16, 22
#   XL(10) = visual row 9: config 21

# Visual row r (1-indexed), col c (1-indexed) → config position (1-indexed)
VISUAL_TO_CONFIG = {}

_vis_rows = {
    1: [5],
    2: [4, 10],
    3: [3, 9, 15],
    4: [2, 8, 14, 20],
    5: [1, 7, 13, 19, 25],
    6: [6, 12, 18, 24],
    7: [11, 17, 23],
    8: [16, 22],
    9: [21],
}
for vr, configs in _vis_rows.items():
    for vc_idx, cfg in enumerate(configs):
        VISUAL_TO_CONFIG[(vr, vc_idx + 1)] = cfg  # 1-indexed col


def john_notation_to_grid(notation):
    """Convert John's visual notation (e.g., '41') to our grid (row, col).

    Notation is visual_row * 10 + visual_col (both 1-indexed).
    Config position (1-indexed) maps to grid: row=(p-1)//5, col=(p-1)%5.
    """
    vis_row = int(notation) // 10
    vis_col = int(notation) % 10
    key = (vis_row, vis_col)
    if key not in VISUAL_TO_CONFIG:
        return None
    cfg = VISUAL_TO_CONFIG[key]  # 1-indexed
    return ((cfg - 1) // 5, (cfg - 1) % 5)


def _unused_parse_hex_display(display_lines):
    """UNUSED — Kept for reference. Parse the 9-line ASCII hex display."""
    pieces = []

    # Each visual row is laid out with cells separated by spaces in a diamond.
    # The character positions for cells vary by row.
    # A simpler approach: find all alphanumeric characters that aren't '-' or spaces.

    for vis_row in range(min(9, len(display_lines))):
        line = display_lines[vis_row] if vis_row < len(display_lines) else ""
        # Find non-dash, non-space single characters that represent pieces
        # Cells contain either '-' (empty) or a piece character (X,Y,Z,1-9)

        # Extract just the cell values for this row
        if vis_row < 5:
            n_cells = vis_row + 1
        else:
            n_cells = 9 - vis_row

        # Find cell characters by looking for the pattern in the display
        # Cells are separated by variable spacing in the diamond layout
        # Look for alphabetic or digit chars that aren't part of other text
        cell_chars = re.findall(r'(?:^|[\s/\\])([A-Z0-9-])(?=[\s/\\]|$)', line)

        # Alternative: just find all standalone single chars
        # The hex display has chars like '-', 'X', '1', etc. surrounded by spaces or hex borders
        cell_chars = []
        cleaned = line.replace('__', '  ').replace('/', ' ').replace('\\', ' ')
        tokens = cleaned.split()
        for t in tokens:
            if len(t) == 1 and (t == '-' or t.isalpha() or t.isdigit()):
                cell_chars.append(t)

        for col_idx, ch in enumerate(cell_chars):
            if ch != '-' and (vis_row, col_idx) in VISUAL_TO_GRID:
                grid_r, grid_c = VISUAL_TO_GRID[(vis_row, col_idx)]
                pieces.append((ch, (grid_r, grid_c)))

    # Sort: exits (X,Y,Z) first, then helpers (1-9)
    exits = [(ch, pos) for ch, pos in pieces if ch.isalpha()]
    helpers = [(ch, pos) for ch, pos in pieces if ch.isdigit()]
    return exits + helpers


def parse_llp(filepath):
    """Parse our .llp file. Returns dict of (frozenset of positions) -> puzzle info."""
    puzzles = {}
    n = 5  # hex5

    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                if 'Variant: hex' in line and 'beehive' not in line:
                    n = 5
                elif 'Variant: beehive' in line:
                    n = 7
                continue
            parts = line.split('|')
            if len(parts) != 9:
                continue

            pid = int(parts[0])
            num_exits = int(parts[1])
            num_helpers = int(parts[2])
            grouped_moves = int(parts[3])
            raw_slides = int(parts[4])
            min_raw_slides = int(parts[5])
            positions_str = parts[7]

            coords = positions_str.strip().split()
            positions = []
            for c in coords:
                r, col = c.split(',')
                positions.append((int(r), int(col)))

            # Store with a canonical key for lookup
            puzzles[pid] = {
                'id': pid,
                'num_exits': num_exits,
                'num_helpers': num_helpers,
                'grouped_moves': grouped_moves,
                'raw_slides': raw_slides,
                'min_raw_slides': min_raw_slides,
                'positions': positions,
            }

    return puzzles, n


def canonical_positions(positions, num_exits, n):
    """Compute Klein-four-group canonical form of positions."""
    m = n - 1
    transforms = [
        lambda r, c: (r, c),           # identity
        lambda r, c: (m-r, m-c),       # 180°
        lambda r, c: (r, m-c),         # H-flip
        lambda r, c: (m-r, c),         # V-flip
    ]

    best = None
    for t in transforms:
        tr = []
        for r, c in positions:
            nr, nc = t(r, c)
            tr.append((nr, nc))
        exits = sorted(tr[:num_exits])
        helpers = sorted(tr[num_exits:])
        canon = tuple(exits + helpers)
        if best is None or canon < best:
            best = canon
    return best


def main():
    john_dir = os.path.join(os.path.dirname(__file__), '..', 'jr-solver', 'data', 'hex')
    llp_file = sys.argv[1] if len(sys.argv) > 1 else '/tmp/puzzles-hex-full.llp'

    # Parse our puzzles
    print(f"Loading ll-solver puzzles from {llp_file}...")
    our_puzzles, n = parse_llp(llp_file)
    print(f"  Loaded {len(our_puzzles)} puzzles (N={n})")

    # Build lookup: canonical positions -> list of puzzles (multiple puzzles
    # can share the same canonical form but have different actual positions).
    our_by_canon = defaultdict(list)
    for pid, p in our_puzzles.items():
        canon = canonical_positions(p['positions'], p['num_exits'], n)
        key = (p['num_exits'], canon)
        our_by_canon[key].append(p)

    # Parse John's puzzles from all hex subdirectories
    john_puzzles = []
    for subdir in sorted(Path(john_dir).iterdir()):
        if not subdir.is_dir():
            continue
        for solfile in sorted(subdir.glob('solut*.txt')):
            puzzles = parse_john_solution_file(str(solfile))
            for p in puzzles:
                p['source'] = f"{subdir.name}/{solfile.name}"
                # Determine num_exits from piece types
                p['num_exits'] = sum(1 for ch, _ in p['pieces'] if ch.isalpha())
                p['num_helpers'] = sum(1 for ch, _ in p['pieces'] if ch.isdigit())
            john_puzzles.extend(puzzles)

    print(f"Loaded {len(john_puzzles)} puzzles from John's data")

    # Compare
    matched = 0
    move_diffs = []
    step_diffs = []
    not_found = []
    parse_failures = 0

    for jp in john_puzzles:
        if not jp['pieces']:
            parse_failures += 1
            continue

        positions = [pos for _, pos in jp['pieces']]
        num_exits = jp['num_exits']

        # Check positions are valid for our grid
        valid = all(0 <= r < n and 0 <= c < n for r, c in positions)
        if not valid:
            parse_failures += 1
            continue

        canon = canonical_positions(positions, num_exits, n)
        key = (num_exits, canon)

        # Find exact match: same positions under some symmetry transform
        our = None
        if key in our_by_canon:
            m = n - 1
            transforms = [
                lambda r, c: (r, c),
                lambda r, c: (m-r, m-c),
                lambda r, c: (r, m-c),
                lambda r, c: (m-r, c),
            ]
            john_pos_set = set(positions)
            for candidate in our_by_canon[key]:
                cand_positions = candidate['positions']
                # Try each symmetry transform on candidate positions
                for t in transforms:
                    tr_cand = [t(r, c) for r, c in cand_positions]
                    # Match exits with exits, helpers with helpers
                    tr_exits = sorted(tr_cand[:num_exits])
                    tr_helpers = sorted(tr_cand[num_exits:])
                    john_exits = sorted(positions[:num_exits])
                    john_helpers = sorted(positions[num_exits:])
                    if tr_exits == john_exits and tr_helpers == john_helpers:
                        our = candidate
                        break
                if our:
                    break

        if our:
            matched += 1

            if jp['moves'] != our['grouped_moves']:
                move_diffs.append({
                    'john_config': jp['config'],
                    'john_moves': jp['moves'],
                    'our_moves': our['grouped_moves'],
                    'john_steps': jp['steps'],
                    'our_slides': our['raw_slides'],
                    'our_min_slides': our['min_raw_slides'],
                    'source': jp['source'],
                    'our_id': our['id'],
                    'john_positions': positions,
                    'our_positions': our['positions'],
                })

            if jp['steps'] != our['min_raw_slides']:
                step_diffs.append({
                    'john_config': jp['config'],
                    'john_steps': jp['steps'],
                    'our_min_slides': our['min_raw_slides'],
                    'our_slides': our['raw_slides'],
                    'source': jp['source'],
                    'our_id': our['id'],
                })
        else:
            not_found.append({
                'config': jp['config'],
                'positions': positions,
                'moves': jp['moves'],
                'steps': jp['steps'],
                'source': jp['source'],
            })

    # Write report
    report_file = os.path.join(os.path.dirname(__file__), 'john_comparison.txt')
    with open(report_file, 'w') as f:
        f.write("Comparison: ll-solver hex output vs John Rausch's reference data\n")
        f.write("=" * 70 + "\n\n")

        f.write(f"Our puzzles:        {len(our_puzzles)}\n")
        f.write(f"John's puzzles:     {len(john_puzzles)}\n")
        f.write(f"Parse failures:     {parse_failures}\n")
        f.write(f"Matched:            {matched}\n")
        f.write(f"Not found in ours:  {len(not_found)}\n")
        f.write(f"Move count diffs:   {len(move_diffs)}\n")
        f.write(f"Step count diffs:   {len(step_diffs)}\n\n")

        if move_diffs:
            f.write("MOVE COUNT DISCREPANCIES\n")
            f.write("-" * 70 + "\n")
            f.write("(John's DFS may not find globally optimal grouped moves;\n")
            f.write(" our 0-1 BFS is provably optimal.)\n\n")
            for d in move_diffs[:50]:
                f.write(f"  {d['john_config']} ({d['source']})\n")
                f.write(f"    John: {d['john_moves']} moves, {d['john_steps']} steps\n")
                f.write(f"    Ours: {d['our_moves']} moves, {d['our_slides']} slides "
                        f"(min slides: {d['our_min_slides']}) [puzzle #{d['our_id']}]\n")
                if 'john_positions' in d:
                    f.write(f"    John pos: {d['john_positions']}\n")
                    f.write(f"    Our  pos: {d['our_positions']}\n")
                f.write("\n")
            if len(move_diffs) > 50:
                f.write(f"  ... and {len(move_diffs) - 50} more\n\n")

        if not_found:
            f.write("PUZZLES IN JOHN'S DATA NOT FOUND IN OURS\n")
            f.write("-" * 70 + "\n")
            f.write("(Expected: different dedup survivors between the two solvers.)\n\n")
            for d in not_found[:20]:
                f.write(f"  {d['config']} ({d['source']}): {d['moves']} moves, {d['steps']} steps\n")
                f.write(f"    positions: {d['positions']}\n\n")
            if len(not_found) > 20:
                f.write(f"  ... and {len(not_found) - 20} more\n\n")

    print(f"\nResults:")
    print(f"  Matched:          {matched} / {len(john_puzzles) - parse_failures}")
    print(f"  Move count diffs: {len(move_diffs)}")
    print(f"  Step count diffs: {len(step_diffs)}")
    print(f"  Not found:        {len(not_found)}")
    print(f"  Parse failures:   {parse_failures}")
    print(f"\nReport written to {report_file}")


if __name__ == '__main__':
    main()
