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