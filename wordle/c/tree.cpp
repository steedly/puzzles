#include <algorithm>
#include <math.h>
#include "tree.h"

using namespace std;

Tree::Tree (const vector< vector< Hint > > &hints)
{
    vector< int >  indices;
    indices.resize(hints.size());
    for( int i=0; i<hints.size(); i++ )
    {
        indices[i] = i;
    }
    Create(hints, indices);
}

Tree::Tree(
    const vector< vector< Hint > > &hints,
    const vector< int >  &indices)
{
    Create(hints, indices);
}

void Tree::Create(
    const vector< vector< Hint > > &hints,
    const vector< int >  &indices)
{
    size_ = indices.size();
    if( size_ == 1 )
    {
        guess_index_ = indices[0];
        return;
    }

    vector< tuple<int,double> > guesses;
    GetGuesses(hints, indices, guesses);

    // auto guess = GetBestGuessIndex(hints, indices);
    auto guess = guesses[0];

    guess_index_ = get<0>(guess);
    entropy_ = get<1>(guess);

    array< vector< int >, Hint::NUM_HINTS > sub_groups_indices;
    Partition( hints[guess_index_], indices, sub_groups_indices);

    // Skip exact match (h==0)
    for( unsigned char h=1; h<Hint::NUM_HINTS; h++ )
    {
        if( sub_groups_indices[h].size() > 0 )
        {
            Tree child(hints, sub_groups_indices[h]);
            children_.insert( pair<Hint, Tree>(h, move(child)) );
        }
    }
}

void Tree::Partition(
    const vector< Hint > &hints,
    const vector< int >  &group_indices,
    array< vector< int >, Hint::NUM_HINTS > &sub_groups_indices) const
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
    const vector< int > &indices) const
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

void Tree::GetGuesses(
    const vector< vector< Hint > > &hints,
    const vector< int > &indices,
    vector< tuple<int,double> > &guesses) const
{
    size_t num_words = indices.size();

    guesses.resize(num_words);
    array< vector< int >, Hint::NUM_HINTS > sub_group_indices;
    for ( int i=0; i<num_words; i++ )
    {
        int index = indices[i];
        Partition( hints[index], indices, sub_group_indices );
        double entropy = ComputeEntropy( sub_group_indices, num_words );

        guesses[i] = make_tuple(index, entropy);
    }

    // Sort based on descending entropy
    sort(
        guesses.begin(), guesses.end(),
        [](const tuple<int,double> & a, const tuple<int,double> & b) -> bool
        { 
            return get<1>(a) > get<1>(b);
        }
    );
}


// Find the best-case average tree depth (entropy) associated with each guess.
// This best case corresponds to all remaining guesses evenly splitting the
// remaining words at each level of the tree.
double Tree::ComputeEntropy(
    const array< vector< int >,
    Hint::NUM_HINTS > &sub_groups_indices,
    size_t num_words) const
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