#from english_words import english_words_lower_set
import numpy as np
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

def distribution(guess, words):
    dist = np.zeros(pow(3,5))
    for solution in words:
        dist[compute_index_from_guess(guess, solution)] += 1
    return dist

def get_best_guess(words):
    max_bucket_size={}
    for guess in words:
        max_bucket_size[guess] = np.max(distribution(guess, words))
    return sorted(max_bucket_size.items(), key=lambda item: item[1])[0][0]

def partition(guess, words):
    buckets = {}
    for solution in words:
        idx = compute_index_from_guess(guess, solution)
        if idx in buckets:
            buckets[idx].append(solution)
        else:
            buckets[idx]=[]
    return buckets

# def partition(guess, words):
#     buckets = [[] for x in range(pow(3,5))]
#     for idx in range(len(buckets)):
#         buckets[idx] = []
#     for solution in words:
#         idx = compute_index_from_guess(guess, solution)
#         buckets[idx].append(solution)
#     return buckets

# def create_tree(words):
#     guess = get_best_guess(words)
#     tree = {}
#     for index, bucket in enumerate(partition(guess, words)):
#         if len(bucket) > 1:
#             tree[index] = create_tree(bucket)

#     return guess, tree

def create_tree(words):
    guess = get_best_guess(words)
    tree = {}
    buckets = partition(guess, words)
    for k, bucket in buckets.items():
        if len(bucket) > 1:
            tree[k] = create_tree(bucket)

    return guess, tree

# Given a hint index from 0 to 3^5-1, return a string representing the hint
#
#  🟩 => 0: letter is in the right spot
#  🟨 => 1: letter is in the word but not in this spot
#  ⬜ => 2: letter is not in the word 
#
# A hint index of 38 maps to a base-3 (ternary) number as follows:
#   38 =  0 * 3^4 + 1 * 3^3 + 1 * 3^2 + 0 * 3^1 + 2 * 3^0
# This is 01102 which is printed as 🟩🟨🟨🟩⬜
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
