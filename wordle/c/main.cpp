#include <tuple>
#include <ctime>
#include <iostream>

#include "io.h"
#include "tree.h"
#include "wordle.h"
#include "cxxopts.hpp"


using namespace std;

// Get the index of today's Wordle. There is a new one each day, with index 0
// starting on June 19, 2021.
int GetSolutionIndex()
{
    // Get current date/time
    time_t now;
    time(&now);

    // Find time on June 19, 2021 in the local time zone
    struct tm start_date = *localtime(&now);
    start_date.tm_year = 2021-1900;
    start_date.tm_mon = 6-1;
    start_date.tm_mday = 19;
    double secs_per_day = 24*60*60;
    return  static_cast<int>(difftime(now, mktime(&start_date))/secs_per_day);
}

void ParseGuesses(
    const string &arg,
    const vector<Word> &words,
    vector<string> &guesses,
    vector<int> &guess_indices)
    
{
    // parse out comma-delimited guesses
    string tmp; 
    stringstream ss(arg);
    while(getline(ss, tmp, ','))
    {
        guesses.push_back(tmp);
    }

    // Get word index for each guess
    for( const string &g : guesses)
    {
        for( int guess_index = 0; guess_index<words.size(); guess_index++ )
        {
            if( g == (string)words[guess_index] )
            {
                guess_indices.push_back(guess_index);
                break;
            }
        }
    }
}

int main(int argc, char** argv)
{
    cxxopts::Options options("Wordle Solver", "Solves the daily Wordle");
    options.add_options()
        ("s,show_answer", "Show the computer's guesses", cxxopts::value<bool>()->default_value("false"))
        ("p,print_tree", "Print the tree", cxxopts::value<bool>()->default_value("false"))
        ("i,index", "Solution Index", cxxopts::value<int>()->default_value("-1"))
        ("g,guesses", "Evaluate Guesses", cxxopts::value<string>()->default_value(""))
        ;

    auto result = options.parse(argc, argv);

    // Read dictionary
    vector<Word> words;
    ReadWords("../dictionary/nyt_solution.csv", words);

    // Precompute hints
    vector< vector< Hint > > hints;
    compute_hints(words, hints);
    
    // Create solution tree
    Tree tree(hints);

    // Solve today's Wordle
    int soln_idx = result["index"].as<int>();
    if (soln_idx == -1)
    {
        soln_idx = GetSolutionIndex();
    }

    bool show_answer = result["show_answer"].as<bool>();
    cout << to_string(show_answer) << endl;
    PrintSolution( words, hints, tree, soln_idx, show_answer);

    if (result["print_tree"].as<bool>())
    {
        PrintTree(words, tree);
    }

    if( result["guesses"].as<string>().length() > 0 )
    {
        string output;

        vector<string> guesses;
        vector<int> guess_indices;
        ParseGuesses(result["guesses"].as<string>(), words, guesses, guess_indices);
        Tree::EvaluateGuesses( words[soln_idx], guesses, words, output );
        cout << output << endl;
    }

    return 0;
}