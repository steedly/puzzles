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

int main(int argc, char** argv)
{
    cxxopts::Options options("Wordle Solver", "Solves the daily Wordle");
    options.add_options()
        ("s,show_answer", "Show the computer's guesses", cxxopts::value<bool>()->default_value("false"))
        ("p,print_tree", "Print the tree", cxxopts::value<bool>()->default_value("false"))
        ("i,index", "Solution Index", cxxopts::value<int>()->default_value("-1"))
        ;

    auto result = options.parse(argc, argv);

    // Read dictionary
    vector<Word> words;
    read_words("../dictionary/nyt_solution.csv", words);

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
    PrintSolution( words, hints, tree, soln_idx, show_answer);

    if (result["print_tree"].as<bool>())
    {
        PrintTree(words, tree);
    }

    return 0;
}


// log2(2309) = 11.173
// -5.8783 = 5.29475
// 12.20647