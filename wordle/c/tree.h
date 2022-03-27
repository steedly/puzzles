#pragma once

#include <map>
#include <utility>
#include <iostream>

#include <math.h>

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

    static void EvaluateGuesses(
        int soln_idx,
        const std::vector< int > &guess_indices,
        const std::vector< Word > &words,
        const std::vector< std::vector< Hint > > &hints,
        std::string &output)
    {
        std::vector< int >  indices;
        indices.resize(hints.size());
        for( int i=0; i<hints.size(); i++ )
        {
            indices[i] = i;
        }

        for( int guess_index : guess_indices )
        {
            Hint hint = hints[guess_index][soln_idx];

            std::array< std::vector< int >, Hint::NUM_HINTS > sub_groups_indices;
            Partition(hints[guess_index], indices, sub_groups_indices);
            const std::vector< int > &child = sub_groups_indices[(unsigned char)hint];

            double expected_entropy = ComputeEntropy(sub_groups_indices);
            double actual_entropy = log2(indices.size()) - log2(child.size());

            output += (std::string)hint;
            output += " " + (std::string)words[guess_index];
            output += " Expected: " + std::to_string(expected_entropy);
            output += " Actual: " + std::to_string(actual_entropy);
            output += " " + std::to_string(indices.size()) + "->";
            if( hint.IsCorrect() )
            {
                output += "0";
            }
            else
            {
                output += std::to_string(sub_groups_indices[(unsigned char)hint].size());
            }
            output += "\n";

            indices = child;
        }
    };

private:
    Tree(
        const std::vector< std::vector< Hint > > &hints,
        const std::vector< int >  &indices);

    void Create(
        const std::vector< std::vector< Hint > > &hints,
        const std::vector< int >  &indices);

    static void Partition(
        const std::vector< Hint > &hints,
        const std::vector< int >  &group_indices,
        std::array< std::vector< int >, Hint::NUM_HINTS > &sub_groups_indices);

    static void GetGuesses(
        const std::vector< std::vector< Hint > > &hints,
        const std::vector< int > &indices,
        std::vector< std::tuple<int,double> > &guesses);

    // Find the best-case average tree depth (entropy) associated with each guess.
    // This best case corresponds to all remaining guesses evenly splitting the
    // remaining words at each level of the tree.
    static double ComputeEntropy(
        const std::array< std::vector< int >,
        Hint::NUM_HINTS > &sub_groups_indices);
};