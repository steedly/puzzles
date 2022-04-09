#include <utility>
#include <iomanip>
#include <sstream>
#include <algorithm>

#include <math.h>
#include <assert.h>

#include "io.h"
#include "tree.h"
#include "wordle.h"

using namespace std;

void ComputeHints(
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

// Find the best-case average tree depth (entropy) associated with each guess.
// This best case corresponds to all remaining guesses evenly splitting the
// remaining words at each level of the tree.
double ComputeEntropy(
    const array< vector< int >,
    Hint::NUM_HINTS > &sub_groups_indices)
{
    size_t num_words = 0;
    for ( auto &sg : sub_groups_indices )
    {
        num_words += sg.size();
    }

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

void Partition(
    const vector< Hint > &hints,
    const vector< int >  &group_indices,
    array< vector< int >, Hint::NUM_HINTS > &sub_groups_indices)
{
    array< int, Hint::NUM_HINTS > partition_sizes;
    partition_sizes.fill(0);
    for( const auto gi : group_indices )
    {
        partition_sizes[hints[gi]]++;
    }

    for( int i=0; i<Hint::NUM_HINTS; i++ )
    {
        sub_groups_indices[i].reserve(partition_sizes[i]);
        sub_groups_indices[i].resize(0);
    }

    for( const auto gi : group_indices )
    {
        sub_groups_indices[hints[gi]].push_back(gi);
    }
}

string EvaluateGuesses(
    string solution,
    const vector< string > &guesses,
    const vector< Word > &words,
    const vector< vector< Hint > > &all_hints)
{
    ostringstream output;
    vector< int >  indices;
    indices.resize(words.size());
    for( int i=0; i<words.size(); i++ )
    {
        indices[i] = i;
    }

    vector< Hint > hints;
    hints.reserve(words.size());
    for( const string &guess : guesses )
    {
        Hint hint(guess, solution);

        hints.resize(0);
        for( const auto &word : words )
        {
            hints.push_back( Hint(guess, word) );
        }

        array< vector< int >, Hint::NUM_HINTS > sub_groups_indices;
        Partition(hints, indices, sub_groups_indices);
        const vector< int > &child = sub_groups_indices[(unsigned char)hint];

        double expected_entropy = ComputeEntropy(sub_groups_indices);
        double actual_entropy = log2(indices.size()) - log2(child.size());

        output << std::setprecision(2) << std::fixed;
        output << (string)hint;
        output << " " << guess;
        output << " Expected: " << expected_entropy;
        output << " Actual: " << actual_entropy;
        output << " " << indices.size() << "->";
        if( hint.IsCorrect() )
        {
            output << "0";
        }
        else
        {
            output << sub_groups_indices[(unsigned char)hint].size();
        }
        output << endl;

        indices = child;
    }

    if( indices.size() > 0 )
    {
        output << endl;

        // Create solution tree
        Tree tree(all_hints, indices);

        Hint h(words[tree.guess_index_], solution);

        output << PrintTree(words, tree, Hint(0), " ");
    }

    return output.str();
};
