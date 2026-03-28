# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

import pytest
from peg_game_consolidated import initial_board, find_all_paths

def test_multiple_paths():
    # For a small board (3 rows), there should be more than one path for some starts
    # We'll use a 3-row board for speed
    global BOARD_SIZE, ALL_MOVES
    BOARD_SIZE = 3
    from peg_game_consolidated import all_moves as recompute_moves
    ALL_MOVES = recompute_moves()
    start_board = initial_board((0, 0))
    solutions = find_all_paths(start_board)
    # There should be more than one path to some solutions
    assert len(solutions) > 1, "Should find multiple paths for a 3-row board"

if __name__ == "__main__":
    pytest.main([__file__])
