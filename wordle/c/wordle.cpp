#include <algorithm>
#include <math.h>
#include <assert.h>

#include "wordle.h"

using namespace std;

unsigned char compute_hint_from_guess(const array<char,5> guess, const array<char,5> solution)
{
    unsigned char hint = 0;

    array<bool, 5> soln_used;
    array<bool, 5> guess_used;

    // Check for exact matches
    for(int i=0; i<5; i++)
    {
        bool match = (guess[i] == solution[i]);
        soln_used[i] = match;
        guess_used[i] = match;
    }

    // Handle the rest
    unsigned char scale = 1;
    for(int i=0; i<5; i++)
    {
        if( !guess_used[i] )
        {
            char letter = guess[i];
            bool no_match = true;
            for( int j=0; j<5; j++ )
            {
                if( !soln_used[j] && letter == solution[j] )
                {
                    soln_used[j] = true;
                    hint += scale;
                    no_match = false;
                    break;
                }
            }
            if( no_match )
            {
                hint += scale*2;
            }
        }

        scale *= 3;
    }

    return hint;
}

void compute_hints(
    const vector<array<char,5> > &words,
    vector< vector< unsigned char > > &hints)
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
            hints[guess_idx][soln_idx] = compute_hint_from_guess(guess, soln);
        }
    }
}

// Count the number of remaining choices in each bucket for a given guess
// create an array of length 3^5=243 containing all zeros. Each entry
// represnts the number or words in the dictionary that would result in each
// of the 243 possible hints
void distribution(
    vector< unsigned char > &hints,
    array<int, NUM_HINTS> &dist)
{
    dist.fill(0);
    for( const auto &hint : hints )
    {
        dist[hint]++;
    }
}

void partition(
    const vector< unsigned char > &hints,
    const vector< int >  &group_indices,
    array< vector< int >, NUM_HINTS > &sub_groups_indices)
{
    array< int, NUM_HINTS > partition_sizes;
    partition_sizes.fill(0);
    for( const auto gi : group_indices )
    {
        partition_sizes[hints[gi]]++;
    }

    for( int i=0; i<NUM_HINTS; i++ )
    {
        sub_groups_indices[i].reserve(partition_sizes[i]);
        sub_groups_indices[i].resize(0);
    }

    for( const auto gi : group_indices )
    {
        sub_groups_indices[hints[gi]].push_back(gi);
    }
}

// Find the best-case average tree depth (entropy) associated with each guess.
// This best case corresponds to all remaining guesses evenly splitting the
// remaining words at each level of the tree.
double compute_entropy(
    const array< vector< int >, NUM_HINTS > &sub_groups_indices,
    size_t num_words)
{
    double e = 0;
    for ( auto &sg : sub_groups_indices )
    {
        size_t d = sg.size();
        if( d != 0 )
        {
            double p = (double)d/(double)num_words;
            e -= p*log2(p);
        }
    }
    return e;
}

// Find the guess that has the smallest entropy in the remaining buckets
tuple<size_t,double> get_best_guess_index(
    const vector< vector< unsigned char > > &hints,
    const vector< int > &indices)
{
    size_t num_words = indices.size();

    vector<double> entropy;
    entropy.resize(num_words);
    array< vector< int >, NUM_HINTS > sub_group_indices;
    for ( int i=0; i<num_words; i++ )
    {
        partition( hints[indices[i]], indices, sub_group_indices );
        entropy[i] = compute_entropy( sub_group_indices, num_words );
    }

    size_t guess_idx = max_element(entropy.begin(),entropy.end()) - entropy.begin();

    return make_tuple(guess_idx, entropy[guess_idx]);
}
