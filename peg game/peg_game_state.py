# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

import copy
import heapq

# This code implements an A* search algorithm to solve a peg game.
# The game consists of a triangular board with pegs that can be removed
# by jumping over adjacent pegs. The goal is to remove all pegs except one.
# The board is represented as a tuple of tuples, where True indicates a peg
# and False indicates an empty space. The A* algorithm finds the optimal
# sequence of moves to achieve this goal by exploring the state space
# and using a heuristic based on the number of remaining pegs.
# The Node class represents a state in the game, including the current
# position of the pegs, the cost to go (number of remaining pegs),
# and the parent node for path reconstruction. The get_children method
# generates all valid moves from the current position, and the A* search
# function explores the state space using a priority queue to find the
# optimal path to the goal state.

class Node:
    # Represents a state in the peg game
    def __init__(self, position=None, parent=None):
        if position is None:
            # Default starting board as tuple of tuples
            self.position = (
                (False,),
                (True, True),
                (True, True, True),
                (True, True, True, True),
                (True, True, True, True, True)
            )
        else:
            # Ensure position is a tuple of tuples for immutability and hashability
            self.position = tuple(tuple(row) for row in position)
        self.peg_count = sum(val for row in self.position for val in row)
        self.parents = [parent] if parent is not None else []

    def __eq__(self, other):
        return isinstance(other, Node) and self.position == other.position

    def __hash__(self):
        return hash(self.position)

    def __lt__(self, other):
        # For priority queue: fewer pegs is "less"
        return self.peg_count < other.peg_count

    def is_off_board(self, pos):
        row, col = pos
        return row > 4 or row < 0 or col > row or col < 0

    def get_children(self):
        children = []
        offset_dirs = [ [-1, 0],   # upper right
                        [ 1, 0],   # lower left
                        [-1,-1],   # upper left
                        [ 1, 1],   # lower right
                        [ 0,-1],   # left
                        [ 0, 1]]   # right

        for row_idx, row in enumerate(self.position):
            for col_idx, val in enumerate(row):
                if not val:
                    pos = (row_idx, col_idx)
                    for off in offset_dirs:
                        remove = (pos[0]+off[0], pos[1]+off[1])
                        jump = (remove[0]+off[0], remove[1]+off[1])
                        if self.is_off_board(jump):
                            continue
                        try:
                            if self.position[remove[0]][remove[1]] and self.position[jump[0]][jump[1]]:
                                # Create new board as a list of lists, then convert back to tuple of tuples
                                child_pos = [list(r) for r in self.position]
                                child_pos[pos[0]][pos[1]] = True
                                child_pos[remove[0]][remove[1]] = False
                                child_pos[jump[0]][jump[1]] = False
                                child_tuple = tuple(tuple(r) for r in child_pos)
                                children.append(Node(position=child_tuple, parent=self))
                        except IndexError:
                            continue
        return children

    def __str__(self):
        # Pretty-print the board
        lines = []
        for row_idx, row in enumerate(self.position):
            line = ' ' * (4 - row_idx)
            line += ' '.join('i' if val else 'O' for val in row)
            lines.append(line)
        return '\n'.join(lines)

def print_game_strings(game_nodes):
    rows = []
    for ri in range(5):
        rows.append([f"{str(node).splitlines()[ri]:<8}" for node in game_nodes])
    for row in rows:
        print("\t".join(row))

def breadth_first_search(start):
    # Initialize the open set (queue) and closed set (visited nodes)
    solutions = []
    closed_dict = {}
    open_set = []
    start_node = Node(start)
    open_set.append(start_node)
    goal_node = Node(tuple(tuple(not val for val in row) for row in start))

    while open_set:
        current = open_set.pop(0)

        # Use the position tuple as the key
        key = current.position

        # If the current node is already in the closed set, add parent if needed and skip
        if key in closed_dict:
            closed_node = closed_dict[key]
            for parent in current.parents:
                if parent not in closed_node.parents:
                    closed_node.parents.append(parent)
            continue

        # Add the current node to the closed set
        closed_dict[key] = current

        # If the current node is the goal node, record it as a solution
        children = current.get_children()
        if (not children and current.peg_count == 8) or current.peg_count == 1:  # Goal state: only one peg left
            solutions.append(current)
            continue

        # Explore children of the current node
        for child in children:
            # Add the current node as a parent to the child
            child.parents.append(current)
            open_set.append(child)

    # Check if any solutions were found
    if not solutions:
        return None, closed_dict  # No solution found

    return solutions, closed_dict  # Return solution nodes and closed set

def get_all_paths(solution_node, solution_graph):
    # This function retrieves all paths from the solution graph
    # starting from the given solution node.
    paths = []
    stack = [(solution_node, [solution_node])]
    while stack:
        current, path = stack.pop()
        if not current.parents:
            paths.append(path)
        else:
            for parent in current.parents:
                stack.append((parent, path + [parent]))
    return paths

def evaluate_breadth_first_search(start_position):
    solutions, solution_graph = breadth_first_search(start_position)
    if not solutions:
        print("No solutions found.")
        return
    # Print each solution and the number of paths leading to it
    for index, solution in enumerate(solutions):
        print(f"Solution {index+1}:")
        paths = get_all_paths(solution, solution_graph)
        print(f"Number of paths: {len(paths)}")
        print(f"Solution string:\n{solution}")
        # Uncomment to print all paths:
        # for path in paths:
        #     print_game_strings(path[::-1])

def main():
    full_board = (
        (True, ),
        (True, True),
        (True, True, True),
        (True, True, True, True),
        (True, True, True, True, True)
    )

    # Try removing each peg from the board and find solutions
    # for each configuration
    solutions = {}
    for row_idx in range(1):
        for col_idx in range(row_idx+1):
            # Convert to list of lists for mutability, then back to tuple of tuples
            start_position = [list(row) for row in full_board]
            start_position[row_idx][col_idx] = False
            start_position_tuple = tuple(tuple(row) for row in start_position)

            print(f"Starting position:")
            print_game_strings([Node(start_position_tuple)])

            evaluate_breadth_first_search(start_position_tuple)

if __name__ == "__main__":
    main()
