#pragma once

#include <string>

#include "tree.h"
#include "wordle.h"

void ReadWords(const std::string filename, std::vector<Word> &words);

void PrintTree(
    std::vector<Word> words,
    const Tree &t,
    Hint hint = Hint(0),
    std::string indent = "");

void PrintSolution(
    const std::vector< Word > &words,
    const std::vector< std::vector< Hint > > &hints,
    const Tree &t,
    int solution_index,
    bool show_answer = false);