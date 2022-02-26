#include <tuple>

#include "io.h"
#include "tree.h"
#include "wordle.h"

#include <iostream>

using namespace std;

int main()
{
    vector<Word> words;
    read_words("../dictionary/nyt_solution.csv", words);
    // cout << "read " << words.size() << " words" << endl;

    vector< vector< Hint > > hints;
    compute_hints(words, hints);
    
    vector< int > indices;
    indices.resize(words.size());
    for( int i=0; i<words.size(); i++ )
    {
        indices[i] = i;
    }

    Tree tree(hints, indices);

    vector< pair< Hint, int> > guesses;
    int soln_idx = 251;
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
