#pragma once

#include <string>

#include "tree.h"
#include "wordle.h"

void read_words(const std::string filename, std::vector<Word> &words);

void PrintTree(
    std::vector<Word> words,
    const Tree &t,
    Hint hint = Hint(0),
    std::string indent = "");