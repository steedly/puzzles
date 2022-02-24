#pragma once

#include <array>
#include <tuple>
#include <vector>
#define NUM_HINTS 243

unsigned char compute_hint_from_guess(
    const std::array<char,5> guess, const
    std::array<char,5> solution);
void compute_hints(
    const std::vector<std::array<char,5> > &words,
    std::vector< std::vector< unsigned char > > &hints);
std::tuple<size_t,double> get_best_guess_index(
    const std::vector< std::vector< unsigned char > > &hints,
    const std::vector< int > &indices);
void partition(
    const std::vector< unsigned char > &hints,
    const std::vector< int >  &group_indices,
    std::array< std::vector< int >, NUM_HINTS > &sub_groups_indices);