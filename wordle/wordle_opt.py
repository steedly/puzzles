import math
from scipy.stats import entropy
import time
import argparse
import numpy as np
import dictionary
from wordle import compute_index_from_guess, get_tree, print_tree, print_solution

NUM_HINTS = pow(3,5)

def compute_indices_from_guess(guess_idx, words):
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
    count = len(words)
    soln = np.zeros((count, 5), dtype='<U1')
    guess = np.zeros((count, 5), dtype='<U1')
    for idx, word in enumerate(words):
        soln[idx,:] = np.array(list(word))
        guess[idx,:] = np.array(list(words[guess_idx]))

    # Handle matches
    soln[soln==guess] = 'S'
    guess[soln==guess] = 'G'

    # Handle rest
    scale = 1
    indices = np.zeros(count, dtype='uint')
    for idx, letter in enumerate(words[guess_idx]):
        unused_guesses = guess[:,idx] != 'G'
        # Find words (rows) with a match
        match_rows = unused_guesses & np.any(soln==letter, axis=1)
        # Find the first match in each word
        first_match_col = np.argmax(soln[match_rows,:]==letter)
        # Mark matches as found (put an 'S' in that location in the solution)
        soln[match_rows,:][:,first_match_col] = 'S'

        # Update indices
        indices[match_rows] += scale
        indices[~unused_guesses & ~match_rows] += 2*scale

        scale *= 3

    return indices


def compute_hints(words):
    count = len(words)
    hints = np.zeros((count,count), dtype=np.uint8)

    for guess_idx, guess in enumerate(words):
        indices = compute_indices_from_guess(guess_idx, words)
        for soln_idx, soln in enumerate(words):
            hints[guess_idx,soln_idx] = compute_index_from_guess(guess, soln)
        
        for opt, orig in zip(indices, hints[guess_idx,:]):
            if opt != orig:
                for a,b in zip(indices, hints[guess_idx,:]):
                    print(a,b)
                raise

    return hints

def distribution(guess_idx, hints):
    """
    Count the number of remaining choices in each bucket for a given guess
    """
    # create an array of length 3^5=243 containing all zeros. Each entry
    # represnts the number or words in the dictionary that would result in each
    # of the 243 possible hints
    dist = np.zeros(NUM_HINTS, dtype=np.uint16)
    # count the number of words that satisfy each hint
    for hint in hints[guess_idx,:]:
        dist[hint] += 1

    return dist

def compute_entropy(hints):
    """
    Find the best-case average tree depth (entropy) associated with each guess.
    This best case corresponds to all remaining guesses evenly splitting the
    remaining words at each level of the tree.
    """
    cnt = hints.shape[0]
    ent=np.zeros(cnt)
    for guess_idx in range(cnt):
        prob, _ = np.histogram(hints[guess_idx,:], bins=range(NUM_HINTS), density=True)
        ent[guess_idx] = entropy(prob)

    return ent
    
def main():
    """
    main function
    """
    begin = time.time()
    hints = compute_hints(dictionary.nyt.solutions)
    end = time.time()
    print('computing hints took {:.2f}s'.format(end-begin))

    begin = time.time()
    e = compute_entropy(hints)
    end = time.time()
    print('computing entropy took {:.2f}s'.format(end-begin))
    
    print(len(dictionary.nyt.candidates))
    print(len(dictionary.nyt.solutions))
    print(len(dictionary.orig.candidates))
    print(len(dictionary.orig.solutions))

if __name__ == "__main__":
    main()