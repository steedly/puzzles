"""
Functions to solve wordle
"""
import sys
import math
import pickle
import argparse
import datetime
import dictionary
import numpy as np

def compute_index_from_guess(input_guess, input_solution):
    """
    Each of the 5 letters has 3 choices for the hint:
    🟩 => 0: letter is in the right spot
    🟨 => 1: letter is in the word but not in this spot
    ⬜ => 2: letter is not in the word

    There are 5^3=243 unique hints that Wordle can give, which can be indexed in a
    vector of length 243 using base-3 notation ([012][012][012][012][012]).

    This function returns the index value by checking each letter in the guess.
    """
    # convert from strings to list of characters
    soln = list(input_solution)
    guess = list(input_guess)

    # Handle matches
    for idx, letter in enumerate(guess):
        if soln[idx] == letter:
            soln[idx] = 'S' # mark used (input letters are all lowercase)
            guess[idx] = 'G'  # mark used (input letters are all lowercase)

    # Handle rest
    scale = 1
    index = 0
    for letter in guess:
        if letter != 'G':
            if letter in soln:
                index += scale
                soln[soln.index(letter)] = 'S' # mark used
            else:
                index += 2*scale

        scale *= 3

    return index

def distribution(guess, words):
    """
    Count the number of remaining choices in each bucket for a given guess
    """
    # create an array of length 3^5=243 containing all zeros. Each entry
    # represnts the number or words in the dictionary that would result in each
    # of the 243 possible hints
    dist = [0 for _ in range(pow(3,5))]
    # count the number of words that satisfy each hint
    for solution in words:
        dist[compute_index_from_guess(guess, solution)] += 1

    return dist

def compute_entropy(words):
    """
    Find the best-case average tree depth (entropy) associated with each guess.
    This best case corresponds to all remaining guesses evenly splitting the
    remaining words at each level of the tree.
    """
    entropy={}
    for guess in words:
        dist = distribution(guess, words)
        prob = [d/len(words) for d in dist]
        entropy[guess] = -sum([p * math.log2(p) if p>0.0 else 0.0 for p in prob])

    return entropy

def get_best_guess(words):
    """
    Find the guess that has the smallest entropy in the remaining buckets
    """
    entropy = compute_entropy(words)

    sorted_entropy = sorted(entropy.items(), key=lambda item: item[1], reverse=True)

    for guess, entropy in sorted_entropy:
        print(guess, entropy)

    return sorted_entropy[0][0]

def partition(guess, words):
    """
    Split the set of words into subsets that all correspond to the same hint
    """
    buckets = {}
    for solution in words:
        idx = compute_index_from_guess(guess, solution)
        if idx in buckets:
            buckets[idx].append(solution)
        else:
            buckets[idx]=[solution]
    return buckets

def create_tree(words):
    """
    Split a set of words by choosing the best guess at each level, then
    recursively run the same algorithm on each subset of the words corresponding
    to each hint .
    """
    guess = get_best_guess(words)
    tree = {}
    buckets = partition(guess, words)
    for k, bucket in buckets.items():
        if k != 0 and len(bucket) > 0:
            tree[k] = create_tree(bucket)

    return guess, tree

def solve(tree, solution):
    """
    Given a decision tree for a dictioniary and a word to look for, return the
    number of guesses needed and the list of guesses
    """
    guess = tree[0]
    index = compute_index_from_guess(guess, solution)
    if guess == solution:
        return 1, [guess]

    count, guesses = solve(tree[1][index], solution)
    return count+1, [guess] + guesses

def hint_from_index(index, block_index=0):
    """
    Given a hint index from 0 to 3^5-1, return a string representing the hint

    🟩 => 0: letter is in the right spot
    🟨 => 1: letter is in the word but not in this spot
    ⬜ => 2: letter is not in the word

    A hint index of 38 maps to a base-3 (ternary) number as follows:
    38 =  2 * 3^0 + 0 * 3^1 + 1 * 3^2 + 1 * 3^3 + 0 * 3^4
    This is 20110 which is printed as ⬜🟩🟨🟨🟩
    """
    blocks = ['🟩🟩', '🟨🟨', '⬜⬛' ]
    digits = []

    # Get the ternary digits
    for _ in range(5):
        index, remainder = divmod(index, 3)
        digits.append(remainder)

    # return the string corresponding to the hint
    return ''.join([blocks[d][block_index] for d in digits])

def print_tree(tree, file=sys.stdout, depth=0):
    """
    Recursively print the tree
    """
    # Print the word to guess
    print(tree[0], 'depth:', depth, file=file)

    # Print each subtree corresponding to each hint
    for k in tree[1].keys():
        # indent the subtree and print the hint for subtree and the word to guess
        print(' '*depth, hint_from_index(k), ': ', sep='', end='', file=file)
        # recusviely print the subtree corresponding to possible hint
        print_tree(tree[1][k], file=file, depth=depth+1)

def print_solution(tree, solution_index, print_guesses=False, site='nyt'):
    """
    Print the list of hints for a solution that can be shared
    """
    solution = getattr(dictionary, site).solutions[solution_index]
    _, guesses = solve(tree, solution)
    print('Wordle ', solution_index, ' ', len(guesses), '/6\n', sep='')
    for guess in guesses:
        hint = hint_from_index(compute_index_from_guess(guess, solution))
        if print_guesses:
            print( hint, guess )
        else:
            print( hint )
    print()

def get_tree(name, recompute=False, site='nyt'):
    """
    create tree from just the solutions
    """
    filename = name + '_tree.pkl'
    if recompute:
        ret = create_tree(getattr(getattr(dictionary, site), name))
        with open(filename, 'wb') as f:
            pickle.dump(ret, f)
        return ret

    try:
        with open(filename, 'rb') as f:
            return pickle.load(f)
    except EnvironmentError: # parent of IOError, OSError *and* WindowsError where available
        ret = create_tree(getattr(getattr(dictionary, site), name))
        with open(filename, 'wb') as f:
            pickle.dump(ret, f)
        return ret

def guess_count_distribution(tree):
    """
    Compute distribution of guess counts
    """
    solutions = [solve(tree, soln) for soln in dictionary.solutions]
    counts, _ = zip(*solutions)
    print(np.histogram(counts, bins=max(counts)-1, density=True)[0]*100)
    print(sum(counts)/len(dictionary.solutions))

def main():
    """
    main function
    """
    parser = argparse.ArgumentParser(description='Solve Wordle')
    parser.add_argument('--show_guesses', help='show guesses and solution',
        type=bool, default=False)
    parser.add_argument('--guess_distribution', help='print distribution of guess count',
        type=bool, default=False)
    parser.add_argument('--recompute', help='recompute trees',
        type=str, default="")
    parser.add_argument('--site', help='which website dictionary to use)',
        type=str, choices=['orig','nyt'], default="nyt")
    args = parser.parse_args()

    index = (datetime.date.today() - datetime.date(2021,6,19)).days

    # create tree from just the solutions
    solutions_tree = get_tree('solutions', args.recompute=="solutions", args.site)
    with open(args.site + '_solutions_cheat_sheet.txt', 'wt', encoding='utf-8') as f:
        print_tree(solutions_tree, file=f)
    print_solution(solutions_tree, index, args.show_guesses, args.site)

    candidates_tree = get_tree('candidates', args.recompute=="candidates", args.site)
    with open('candidates_cheat_sheet.txt', 'wt', encoding='utf-8') as f:
        print_tree(candidates_tree, file=f)

    print_solution(candidates_tree, index, args.show_guesses, args.site)

    if args.guess_distribution:
        print(len(dictionary.solutions))
        guess_count_distribution(candidates_tree)
        guess_count_distribution(solutions_tree)

    # 11.17 bits in 2309 choices
    # raise provides 5.878 bits, leaving 5.29 bits
    print(len(dictionary.nyt.candidates))
    print(len(dictionary.nyt.solutions))
    print(len(dictionary.orig.candidates))
    print(len(dictionary.orig.solutions))

if __name__ == "__main__":
    main()