#include <algorithm>
#include <math.h>
#include "tree.h"

using namespace std;

Tree::Tree(
    const vector< vector< Hint > > &hints,
    const vector< int >  &indices)
{
    if( indices.size() == 1 )
    {
        guess_index_ = indices[0];
        return;
    }

    auto guess = GetBestGuessIndex(hints, indices);
    guess_index_ = get<0>(guess);
    entropy_ = get<1>(guess);

    array< vector< int >, Hint::NUM_HINTS > sub_groups_indices;
    Partition( hints[guess_index_], indices, sub_groups_indices);

    // Skip exact match (h==0)
    for( unsigned char h=1; h<Hint::NUM_HINTS; h++ )
    {
        // cout << (int)h << ": " << sub_groups_indices[h].size() <<  endl;
        if( sub_groups_indices[h].size() > 0 )
        {
            Tree child(hints, sub_groups_indices[h]);
            // TODO: add position hint
            children_.insert(
                pair<Hint, Tree>(h, move(child)) );
        }
    }
}

void Tree::Partition(
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

// Find the guess that has the smallest entropy in the remaining buckets
tuple<size_t,double> Tree::GetBestGuessIndex(
    const vector< vector< Hint > > &hints,
    const vector< int > &indices)
{
    size_t num_words = indices.size();

    vector<double> entropy;
    entropy.resize(num_words);
    array< vector< int >, Hint::NUM_HINTS > sub_group_indices;
    for ( int i=0; i<num_words; i++ )
    {
        Partition( hints[indices[i]], indices, sub_group_indices );
        entropy[i] = ComputeEntropy( sub_group_indices, num_words );
    }

    size_t guess_idx = max_element(entropy.begin(),entropy.end()) - entropy.begin();

    return make_tuple(indices[guess_idx], entropy[guess_idx]);
}

// Find the best-case average tree depth (entropy) associated with each guess.
// This best case corresponds to all remaining guesses evenly splitting the
// remaining words at each level of the tree.
double Tree::ComputeEntropy(
    const array< vector< int >, Hint::NUM_HINTS > &sub_groups_indices,
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