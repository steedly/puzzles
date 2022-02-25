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
    double entropy_;
    int size_;
    std::map<Hint, Tree> children_;

    Tree(
        const std::vector< std::vector< Hint > > &hints,
        const std::vector< int >  &indices);

private:
    void Partition(
        const std::vector< Hint > &hints,
        const std::vector< int >  &group_indices,
        std::array< std::vector< int >, Hint::NUM_HINTS > &sub_groups_indices);

    // Find the guess that has the smallest entropy in the remaining buckets
    std::tuple<size_t,double> GetBestGuessIndex(
        const std::vector< std::vector< Hint > > &hints,
        const std::vector< int > &indices);

    // Find the best-case average tree depth (entropy) associated with each guess.
    // This best case corresponds to all remaining guesses evenly splitting the
    // remaining words at each level of the tree.
    double ComputeEntropy(
        const std::array< std::vector< int >, Hint::NUM_HINTS > &sub_groups_indices,
        size_t num_words);
};