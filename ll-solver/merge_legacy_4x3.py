#!/usr/bin/env python3
"""Extract 4-exit+3-helper puzzles from the legacy standard puzzles.llp,
compute unified-format variantFlags from positions, and emit 10-field lines.

Used once to preserve square-variant 4+3 coverage that v11's beehive run
couldn't produce (hex 4+3 OOM'd in Layer 3). See
plans/2026-04-15-pass3-and-ui-unified.md.

Input:  spaceport-solitaire/public/puzzles.llp  (legacy 9-field standard)
Output: /tmp/legacy-4x3.llp                     (10-field unified)

Block-mask logic matches enumerate.cpp:181-209 (make_blocked_* functions).
variantFlags bit layout matches compute_variant_flags at enumerate.cpp:1638.
"""
import sys

N = 7  # board side

def cell_bit(r, c):
    return 1 << (r * N + c)

def make_blocked_solitaire():
    # 2x2 corners at (0,0),(0,1),(1,0),(1,1) and 3 symmetric copies
    b = 0
    for r in (0, 1, 5, 6):
        for c in (0, 1, 5, 6):
            b |= cell_bit(r, c)
    return b

def make_blocked_ufo():
    # Entire border ring (row 0 or 6, col 0 or 6)
    b = 0
    for r in range(N):
        for c in range(N):
            if r in (0, N-1) or c in (0, N-1):
                b |= cell_bit(r, c)
    return b

def make_blocked_french():
    # 3 cells per corner: corner + 2 neighbours (12 total)
    cells = [(0,0),(0,1),(1,0),
             (0,6),(0,5),(1,6),
             (6,0),(6,1),(5,0),
             (6,6),(6,5),(5,6)]
    b = 0
    for r, c in cells:
        b |= cell_bit(r, c)
    return b

BLOCKED_SOLITAIRE = make_blocked_solitaire()
BLOCKED_UFO       = make_blocked_ufo()
BLOCKED_FRENCH    = make_blocked_french()

def fits(positions, blocked_mask):
    """All positions avoid the blocked-cell mask."""
    for (r, c) in positions:
        if blocked_mask & cell_bit(r, c):
            return False
    return True

def compute_variant_flags(positions_str):
    """Match enumerate.cpp's compute_variant_flags exactly.
    positions_str looks like "4,2 5,1 2,3 3,0" (space-separated r,c)."""
    positions = []
    for tok in positions_str.split():
        r, c = tok.split(',')
        positions.append((int(r), int(c)))
    flags = 0
    flags |= 1 << 0                                   # standard always
    if fits(positions, BLOCKED_SOLITAIRE): flags |= 1 << 1
    if fits(positions, BLOCKED_UFO):       flags |= 1 << 2
    if fits(positions, BLOCKED_FRENCH):    flags |= 1 << 3
    if fits(positions, BLOCKED_UFO):       flags |= 1 << 4  # hex = ufo geometrically
    flags |= 1 << 5                                   # beehive always
    # bit 6 (requires_diagonal): 0 — legacy square solutions are cardinal-only
    return flags

def main():
    in_path  = sys.argv[1] if len(sys.argv) > 1 else "spaceport-solitaire/public/puzzles.llp"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/legacy-4x3.llp"
    kept = 0
    with open(in_path) as fin, open(out_path, "w") as fout:
        for line in fin:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("|")
            # Legacy 9-field: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
            if len(parts) != 9:
                continue
            pid, exits, helpers, grouped, raw, min_raw, fwd, positions, solution = parts
            if exits != "4" or helpers != "3":
                continue
            vf = compute_variant_flags(positions)
            # 10-field: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|variantFlags|positions|solution
            fout.write(f"{pid}|{exits}|{helpers}|{grouped}|{raw}|{min_raw}|{fwd}|{vf}|{positions}|{solution}\n")
            kept += 1
    print(f"Extracted {kept} 4+3 puzzles → {out_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
