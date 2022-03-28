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
        entropy_ = 0.0;
        return;
    }

    // Get entropy for each guess
    vector< tuple<int,double> > guesses;
    guesses.resize(size_);

    array< vector< int >, Hint::NUM_HINTS > sub_group_indices;
    for ( int i=0; i<size_; i++ )
    {
        int index = indices[i];
        Partition( hints[index], indices, sub_group_indices );
        double entropy = ComputeEntropy( sub_group_indices );
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

    // Pick lowest entropy guess
    auto guess = guesses[0];

    guess_index_ = get<0>(guess);
    entropy_ = get<1>(guess);

    // Partition remaining words based on the lowest entropy guess
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
