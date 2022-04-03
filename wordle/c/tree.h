#pragma once

#include <map>
//#include <iostream>

#include "wordle.h"

class Tree;

class Tree
{
public:
    int guess_index_;
    double entropy_;
    int size_;
    std::map<Hint, Tree> children_;

    Tree() {};
    Tree (const std::vector< std::vector< Hint > > &hints);
    Tree (const std::vector< std::vector< Hint > > &hints,
          const std::vector< int >  &indices);
    
    template<class Callback>
    int Solve(
        int soln_idx,
        const std::vector< std::vector< Hint > > &hints,
        Callback &callback) const
    {
        Hint hint = hints[guess_index_][soln_idx];
        callback(*this);

        if( (unsigned char)hint == 0 )
        {
            return guess_index_;
        }

        return children_.at((unsigned char)hint).Solve(soln_idx, hints, callback);
    };

private:

    void Create(
        const std::vector< std::vector< Hint > > &hints,
        const std::vector< int >  &indices);
};