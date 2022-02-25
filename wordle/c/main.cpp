#include <tuple>

#include "io.h"
#include "tree.h"
#include "wordle.h"

#include <iostream>

using namespace std;

int main()
{
    vector<Word> words;
    read_words("../dictionary/orig_solution.csv", words);

    Hint hint = Hint(Word("cigar"), Word("other"));
    cout << "Hint = " << (int)hint << endl;
    cout << (string)hint << endl;

    vector< vector< Hint > > hints;
    compute_hints(words, hints);
    
    vector< int > indices;
    indices.resize(words.size());
    for( int i=0; i<words.size(); i++ )
    {
        indices[i] = i;
    }
    // auto tuple = get_best_guess_index(hints, indices);
    // cout << (string)words[get<0>(tuple)] << ": " << get<1>(tuple) << endl;

    cout << "creating tree" << endl;
    Tree tree(hints, indices);
    cout << "printing tree" << endl;
    PrintTree(words, tree);

    return 0;
}
