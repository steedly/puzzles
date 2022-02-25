#include <assert.h>

#include "wordle.h"

using namespace std;

void compute_hints(
    const vector<Word> &words,
    vector< vector< Hint > > &hints)
{
    int num_words = words.size();
    hints.resize(num_words);

    for ( int guess_idx = 0; guess_idx < num_words; guess_idx++ )
    {
        hints[guess_idx].resize(num_words);
        const auto &guess = words[guess_idx];
        for ( int soln_idx = 0; soln_idx < num_words; soln_idx++ )
        {
            const auto &soln = words[soln_idx];
            hints[guess_idx][soln_idx] = Hint(guess, soln);
        }
    }
}

// Count the number of remaining choices in each bucket for a given guess
// create an array of length 3^5=243 containing all zeros. Each entry
// represnts the number or words in the dictionary that would result in each
// of the 243 possible hints
void distribution(
    vector< Hint > &hints,
    array<int, Hint::NUM_HINTS> &dist)
{
    dist.fill(0);
    for( const auto &hint : hints )
    {
        dist[hint]++;
    }
}

