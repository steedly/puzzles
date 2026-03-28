# Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

import numpy as np

class Element:
    def __init__(self, row, col, initial_value=0):
        self.row = row
        self.col = col
        self.candidates = {initial_value} if initial_value > 0 else set(range(1,10))
        self.reset()

    def __repr__(self):
        ret = '[row: ' + str(self.row) + ','
        ret += 'col: ' + str(self.col) + ','
        ret += 'candidates: ' + str(self.candidates) + ','
        ret += 'location: ' + str(self.location) + ']'

        return ret

    # Set the element back to empty/unvisited
    def reset(self):
        self.location = -1

    # Check if already pointing to the last candidate
    def at_end(self):
        return self.location == len(self.candidates) - 1

    # Return the current candidate or None if the element isn't set
    def value(self):
        return list(self.candidates)[self.location] if self.location >= 0 else None

    def increment(self):
        # If at last location, reset and return false
        if self.at_end():
            self.reset()
            return False

        self.location += 1
        return True

# Each element in the puzzle is a level of the tree. Each element maintains a
# set of candidate values for itself and the current candidate
class Tree:
    def __init__(self, element_grid):
        self.elements = [element_grid[r][c] for r in range(9) for c in range(9)]
        self.elements.sort(key = lambda e: len(e.candidates))
        self.reset()

    def reset(self):
        self.location = 0
        for e in self.elements:
            e.reset()

    def get_solution(self):
        grid = [[0 for c in range(9)] for r in range(9)]
        for e in self.elements:
            grid[e.row][e.col] = e.value() 
        
        return grid

    # Get current element
    def get_element(self):
        return self.elements[self.location]
    
    def at_end(self):
        return self.location == len(self.elements) - 1

    # If the current location in the tree has failed, increment the tree to the
    # next candidate
    def next_subtree(self):
        # Work up tree from current location until we find an element with more
        # options to try
        while not self.elements[self.location].increment():
            if self.location == 0:
                return False
            self.location -= 1
        
        return True
    
    def expand_subtree(self):
        if self.at_end():
            return False

        self.location += 1
        self.elements[self.location].reset()
        self.elements[self.location].increment()
        return True

class Sudoku:
    def __init__(self, puzzle):
        self.element_grid = [[Element(r,c,puzzle[r][c]) for c in range(9)] for r in range(9)]

    # Convert puzzle into ASCII art image (includes all candidates)
    def __repr__(self):
        ret = ''
        
        # maps a set to a 3x3 array padded with zeros
        fun = lambda x: np.reshape(np.pad(np.array(list(x)), (0,9-len(x))),(3,3))
        mat = np.vstack([np.hstack(list(map(lambda ci: fun(self.element_grid[ri][ci].candidates), range(9)))) for ri in range(9)])
    
        ret += '-'*40 + '\n'
        for bro in range(0,9,3):
            if bro > 0:
                ret += '|'+'-'*12+'+'+'-'*12+'+'+'-'*12+'|' + '\n'
            for ri in range(bro,bro+3):
                for pri in range(3):
                    ret += '|'
                    for bco in range(0,9,3):
                        for ci in range(bco,bco+3):
                            for pci in range(3):
                                val = mat[ri*3+pri,ci*3+pci]
                                ret += ' ' if val == 0 else str(val)
                            ret += ' '
                        ret += '|'
                    ret += '\n'
        ret += '-'*40
        
        return ret

    # Convert puzzle into ASCII art image
    def print(self, puzzle):
        # Create output strng
        ret = '-'*13 + '\n'
        for bro in range(0,9,3):
            if bro > 0:
                ret += '|'+'-'*3+'+'+'-'*3+'+'+'-'*3+'|' + '\n'
            for ri in range(bro,bro+3):
                ret += '|'
                for bco in range(0,9,3):
                    for ci in range(bco,bco+3):
                        ret += str(puzzle[ri][ci]) if puzzle[ri][ci] else ' '
                    ret += '|'
                ret += '\n'
        ret += '-'*13

        print(ret)
        
        return ret

    def get_row_elements(self, row):
        return self.element_grid[row]

    def get_col_elements(self, col):
        return [r[col] for r in self.element_grid]

    def get_block_elements(self, row, col):
        ro = row - row % 3
        co = col - col % 3
        return [self.element_grid[r][c] for r in range(ro, ro+3) for c in range(co, co+3)]

    def get_neighbors(self, row, col):
        rows = [e for e in self.get_row_elements(row) if e.col != col]
        cols = [e for e in self.get_col_elements(col) if e.row != row]
        blks = [e for e in self.get_block_elements(row, col) if e.row != row and e.col != col]
        return [rows, cols, blks]

    def check_element(self, element):
        value = element.value()
        if not value:
            return True

        # check elements in this row, column and blk
        for elements in self.get_neighbors(element.row, element.col):
            for e in elements:
                if e.value() == value:
                    return False

        return True

    # Use a set of heuristics to prune candidates. These by themselves will
    # greatly simplify or solve typical puzzles
    def prune_candidates(self):
        improved = False
        for row in range(9):
            for col in range(9):
                values = self.element_grid[row][col].candidates
                for elements in self.get_neighbors(row, col):
                    if len(values) == 1:
                        value = list(values)[0]
                        # For cells with only one candidate, prune that candidate
                        # from other elements in the same column, row or block
                        for e in elements:
                            if value in e.candidates:
                                improved = True
                                self.element_grid[e.row][e.col].candidates -= values
                    else:
                        # If none of the neighbors in a group (row, column, or block) can be some
                        # subset of elements, then the current element must be one of them
                        possibilities = set(range(1,10))
                        for e in elements:
                            possibilities -= e.candidates

                        if len(possibilities) > 0:
                            self.element_grid[row][col].candidates = possibilities
                            improved = True

        return improved

    def solve(self):
        # Try pruning candidates with heuristics first
        print(self)
        while self.prune_candidates():
            pass

        print(self)

        # Then evaluate the remaining candidates with a depth-first tree search
        tree = Tree(self.element_grid)
        tree.reset()
        tree.next_subtree()

        solutions = []
        iter = 0
        while True:
            iter += 1
            # Check solutions in a depth-first search.
            if self.check_element(tree.get_element()):

                # save solution if at leaf and move to next subtree
                if not tree.expand_subtree():
                    solutions += [tree.get_solution()]
                    self.print(tree.get_solution())

                    # quit if at the leaf node of the last branch
                    if not tree.next_subtree():
                        break
            else:
                # Skip to next sub-tree as soon as the current set of candidates
                # is invalidated. Quit if at the leaf node of the last branch
                if not tree.next_subtree():
                    break
    
        print('iter:', iter)
        
        return solutions
