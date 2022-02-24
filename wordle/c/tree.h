#pragma once

#include <map>
#include <utility>
#include <iostream>

#include "wordle.h"

class Tree;

class Tree
{
public:
    int guess_index_;
    std::map<unsigned char, Tree> children_;

    Tree(
        const std::vector< std::vector< unsigned char > > &hints,
        const std::vector< int >  &indices)
    {
        guess_index_ = std::get<0>(get_best_guess_index(hints, indices));

        std::array< std::vector< int >, NUM_HINTS > sub_groups_indices;
        partition( hints[guess_index_], indices, sub_groups_indices);

        // Skip exact match (h==0)
        for( unsigned char h=1; h<NUM_HINTS; h++ )
        {
            if( sub_groups_indices[h].size() > 0 )
            {
                Tree child(hints, sub_groups_indices[h]);
                // TODO: add position hint
                children_.insert(
                    std::pair<unsigned char, Tree>(h, std::move(child)) );
            }
        }
    }
};