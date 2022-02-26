#include <tuple>
#include <ctime>

#include "io.h"
#include "tree.h"
#include "wordle.h"

#include <iostream>

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

int main()
{
    // Read dictionary
    vector<Word> words;
    read_words("../dictionary/nyt_solution.csv", words);

    // Precompute hints
    vector< vector< Hint > > hints;
    compute_hints(words, hints);
    
    // Create solution tree
    Tree tree(hints);

    // Solve today's Wordle
    int soln_idx = GetSolutionIndex()-1;
    vector< pair< Hint, int> > guesses;
    tree.Solve(soln_idx, hints, guesses );
    
    cout << "Computerdle " << soln_idx << " " << guesses.size() << "/6" << endl << endl;
    for ( const auto &g: guesses )
    {
        Hint hint = get<0>(g);
        int guess_idx = get<1>(g);
        cout << (string)hint << " " << (string)words[guess_idx] << endl;
    }

    return 0;
}
