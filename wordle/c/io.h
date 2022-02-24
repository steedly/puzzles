#pragma once

#include <string>

#include "tree.h"
#include "wordle.h"

void read_words(const std::string filename, std::vector<std::array<char,5> > &words);

std::array<char,5> str_to_word(std::string str);
std::string word_to_str(const std::array<char,5> &word);

std::string hint_to_str(unsigned char hint);

void PrintTree(
    std::vector< std::array<char,5> > words,
    const Tree &t,
    unsigned char hint = 0,
    std::string indent = "");