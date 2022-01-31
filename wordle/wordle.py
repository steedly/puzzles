import dictionary
import sys

# Each of the 5 letters has 3 choices for the hint:
#  🟩 => 0: letter is in the right spot
#  🟨 => 1: letter is in the word but not in this spot
#  ⬜ => 2: letter is not in the word 
#
# There are 5^3=243 unique hints that Wordle can give, which can be indexed in a
# vector of length 243 using base-3 notation ([012][012][012][012][012]).
#
# This function returns the index value by checking each letter in the guess.
def compute_index_from_guess(input_guess, input_solution):
    # convert from strings to list of characters
    soln = [l for l in input_solution]
    guess = [l for l in input_guess] 

    index = 0
    # Handle matches
    for idx, letter in enumerate(guess):
        if soln[idx] is letter:
            index += 0*pow(3,idx)
            soln[idx] = 'S' # mark used (input letters are all lowercase)
            guess[idx] = 'G'  # mark used (input letters are all lowercase)

    # Handle rest
    for idx, letter in enumerate(guess):
        if letter == 'G':
            continue

        if letter in soln:
            index += 1*pow(3,idx)
            soln[soln.index(letter)] = 'S' # mark used
        else:
            index += 2*pow(3,idx)

    return(index)

# Count the number of remaining choices in each bucket for a given guess
def distribution(guess, words):
    # create an array of length 3^5=243 containing all zeros. Each entry
    # represnts the number or words in the dictionary that would result in each
    # of the 243 possible hints
    dist = [0 for _ in range(pow(3,5))]
    # count the number of words that satisfy each hint
    for solution in words:
        dist[compute_index_from_guess(guess, solution)] += 1
    return dist

# Find the guess that has the smallest number of remaining choices
def get_best_guess(words):
    max_bucket_size={}
    for guess in words:
        max_bucket_size[guess] = max(distribution(guess, words))
    return sorted(max_bucket_size.items(), key=lambda item: item[1])[0][0]

# Split the set of words into subsets that all correspond to the same hint
def partition(guess, words):
    buckets = {}
    for solution in words:
        idx = compute_index_from_guess(guess, solution)
        if idx in buckets:
            buckets[idx].append(solution)
        else:
            buckets[idx]=[solution]
    return buckets

# Split a set of words by choosing the best guess at each level, then
# recursively run the same algorithm on each subset of the words corresponding
# to each hint .
def create_tree(words):
    guess = get_best_guess(words)
    tree = {}
    buckets = partition(guess, words)
    for k, bucket in buckets.items():
        if k == 0:
            continue
        if len(bucket) > 0:
            tree[k] = create_tree(bucket)

    return guess, tree

# Given a hint index from 0 to 3^5-1, return a string representing the hint
#
#  🟩 => 0: letter is in the right spot
#  🟨 => 1: letter is in the word but not in this spot
#  ⬜ => 2: letter is not in the word 
#
# A hint index of 38 maps to a base-3 (ternary) number as follows:
#   38 =  2 * 3^0 + 0 * 3^1 + 1 * 3^2 + 1 * 3^3 + 0 * 3^4
# This is 20110 which is printed as ⬜🟩🟨🟨🟩
#
def hint_from_index(index, block_index=0):
    blocks = ['🟩🟩', '🟨🟨', '⬜⬛' ]
    digits = []

    # Get the ternary digits
    for _ in range(5):
        index, remainder = divmod(index, 3)
        digits.append(remainder)

    # return the string corresponding to the hint
    return ''.join([blocks[d][block_index] for d in digits])

# Recursively print the tree
def print_tree(tree, file=sys.stdout, depth=0):
    # Print the word to guess
    print(tree[0], 'depth:', depth, file=file)

    # Print each subtree corresponding to each hint
    for k in tree[1].keys():
        # indent the subtree and print the hint for subtree and the word to guess
        print(' '*depth, hint_from_index(k), ': ', sep='', end='', file=file)
        # recusviely print the subtree corresponding to possible hint
        print_tree(tree[1][k], file=file, depth=depth+1)

    
if __name__ == "__main__":
    tree = create_tree(dictionary.solutions)
    with open('cheat_sheet.txt', 'w') as f:
        print_tree(tree, file=f)
