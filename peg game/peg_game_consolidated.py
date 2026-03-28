# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

import itertools

BOARD_SIZE = 5  # 5 rows, 15 holes

def initial_board(empty_pos):
    board = []
    for row in range(BOARD_SIZE):
        board.append([True] * (row + 1))
    board[empty_pos[0]][empty_pos[1]] = False
    return tuple(tuple(row) for row in board)

def no_moves_left(board):
    """Return True if there are no valid moves left on the board."""
    for move in ALL_MOVES:
        if apply_move(board, move) is not None:
            return False
    return True

def is_goal(board):
    """Return True if only one peg remains anywhere."""
    return sum(val for row in board for val in row) == 1

def is_eight_stuck(board):
    """Return True if there are 8 pegs and no moves left."""
    return sum(val for row in board for val in row) == 8 and no_moves_left(board)

def goal_positions(board):
    """Return a list of positions where the last peg remains."""
    return [(ri, ci) for ri, row in enumerate(board) for ci, val in enumerate(row) if val]

def mirror_board(board):
    return tuple(tuple(reversed(row)) for row in board)

def all_moves():
    offsets = [(-2, 0, -1, 0), (2, 0, 1, 0), (-2, -2, -1, -1), (2, 2, 1, 1), (0, -2, 0, -1), (0, 2, 0, 1)]
    moves = []
    for row in range(BOARD_SIZE):
        for col in range(row + 1):
            for dr, dc, dr2, dc2 in offsets:
                from_r, from_c = row, col
                over_r, over_c = row + dr2, col + dc2
                to_r, to_c = row + dr, col + dc
                if 0 <= to_r < BOARD_SIZE and 0 <= to_c <= to_r and \
                   0 <= over_r < BOARD_SIZE and 0 <= over_c <= over_r:
                    moves.append(((from_r, from_c), (over_r, over_c), (to_r, to_c)))
    return moves

ALL_MOVES = all_moves()

def apply_move(board, move):
    (from_r, from_c), (over_r, over_c), (to_r, to_c) = move
    if not board[from_r][from_c]:
        return None
    if not board[over_r][over_c]:
        return None
    if board[to_r][to_c]:
        return None
    board_list = [list(row) for row in board]
    board_list[from_r][from_c] = False
    board_list[over_r][over_c] = False
    board_list[to_r][to_c] = True
    return tuple(tuple(row) for row in board_list)

def board_to_str(board):
    lines = []
    for row_idx, row in enumerate(board):
        line = ' ' * (BOARD_SIZE - 1 - row_idx)
        line += ' '.join('i' if val else 'O' for val in row)
        lines.append(line)
    return '\n'.join(lines)

def mirror_move(move):
    def mirror_pos(pos):
        row, col = pos
        return (row, row - col)
    return tuple(mirror_pos(p) for p in move)

def canonicalize_path(path):
    mirrored = [mirror_move(m) for m in path]
    return min(tuple(path), tuple(mirrored))

def moves_overlap(move1, move2):
    s1 = set(move1)
    s2 = set(move2)
    return not s1.isdisjoint(s2)

def canonicalize_commuting_groups(path):
    result = []
    i = 0
    while i < len(path):
        group = [path[i]]
        j = i + 1
        while j < len(path):
            if all(not moves_overlap(path[j], m) for m in group):
                group.append(path[j])
                j += 1
            else:
                break
        if len(group) > 1:
            result.extend(sorted(group))
        else:
            result.append(group[0])
        i += len(group)
    return tuple(result)

def canonicalize_full(path):
    commuted = canonicalize_commuting_groups(path)
    return canonicalize_path(commuted)

def find_all_paths(start_board):
    """Find all solution paths from start_board to any single-peg goal or 8-stuck state."""
    solutions = []
    stack = [ (start_board, []) ]
    while stack:
        board, path = stack.pop()
        if is_goal(board):
            solutions.append((list(path), goal_positions(board)[0], "one_left"))
            continue
        if is_eight_stuck(board):
            # Use a special marker for 8-stuck solutions
            solutions.append((list(path), None, "eight_stuck"))
            continue
        for move in ALL_MOVES:
            new_board = apply_move(board, move)
            if new_board is not None:
                stack.append( (new_board, path + [move]) )
    return solutions

def goal_board(goal_pos):
    return tuple(
        tuple(True if (ri, ci) == goal_pos else False for ci in range(ri + 1))
        for ri in range(BOARD_SIZE)
    )

def print_path_row(start_board, path):
    """Print the board state after each move in the path, all in a single row, with proper triangle alignment."""
    boards = [start_board]
    board = start_board
    for move in path:
        next_board = apply_move(board, move)
        if next_board is None:
            print("\n[ERROR] Invalid move encountered in path. Stopping printout.")
            print("Move:", move)
            break
        board = next_board
        boards.append(board)
    board_lines = [board_to_str(b).splitlines() for b in boards]
    max_width = max(len(line) for lines in board_lines for line in lines)
    for row_idx in range(BOARD_SIZE):
        row_strs = [lines[row_idx].ljust(max_width) for lines in board_lines]
        print("   ".join(row_strs))
    print()  # Blank line after each path

def unique_starting_positions():
    """Return the 4 unique starting positions up to symmetry for the 5-row triangle."""
    # Canonical representatives for each symmetry class:
    # 1. Corner: (0,0)
    # 2. Edge center: (2,0)
    # 3. Edge near corner: (1,0)
    # 4. Center: (2,1)
    return [(0, 0), (2, 0), (1, 0), (2, 1)]

def print_path_moves(path):
    """Print the move sequence as tuples all in one row."""
    print(" -> ".join(str(move) for move in path))

def print_path_moves_compact(path):
    """Print the move sequence as tuples, compactly, all in one row (no extra lines)."""
    print(" ".join(str(move) for move in path))

def run_for_unique_starts(print_boards=True, print_moves=False):
    for start_pos in unique_starting_positions():
        start_board = initial_board(start_pos)
        print("="*60)
        print(f"Starting position: empty at {start_pos}")
        print(board_to_str(start_board))
        print("\nSearching for all solution paths (this may take a while)...")

        all_paths_with_goals = find_all_paths(start_board)
        print(f"\nTotal raw solution paths: {len(all_paths_with_goals)}")

        # Group by goal position
        goal_dict = {}
        for path, goal, soltype in all_paths_with_goals:
            key = (goal, soltype)
            goal_dict.setdefault(key, []).append(path)

        for (goal, soltype), paths in goal_dict.items():
            if soltype == "one_left":
                print(f"\n--- Solutions ending with peg at {goal} ---")
            else:
                print(f"\n--- Solutions with 8 pegs and no moves left ---")
                if len(paths) > 0:
                    # Print the final board for the first such path
                    board = start_board
                    for move in paths[0]:
                        board = apply_move(board, move)
                    print(board_to_str(board))
            # Only print consolidated unique paths, not raw paths
            canonical_paths = set()
            for path in paths:
                canonical = canonicalize_full(path)
                canonical_paths.add(canonical)

            print(f"\nConsolidated unique paths (by symmetry and commutation): {len(canonical_paths)}")
            if print_moves:
                for i, path in enumerate(canonical_paths):
                    print(f"Path {i+1}:", end=" ")
                    print_path_moves_compact(path)
            elif print_boards:
                for i, path in enumerate(canonical_paths):
                    print(f"\nConsolidated Path {i+1}:")
                    print_path_row(start_board, path)
            else:
                print(f"Number of consolidated unique paths: {len(canonical_paths)}")
        print("="*60 + "\n")

def main():
    # Set print_boards to False to only print counts (recommended for large runs)
    # Set print_moves to True to print moves as tuples in a row (overrides print_boards)
    print_boards = True  # Set to True to print all boards, False for just counts
    print_moves = False    # Set to True to print moves as tuples in a row
    run_for_unique_starts(print_boards=print_boards, print_moves=print_moves)

if __name__ == "__main__":
    main()
