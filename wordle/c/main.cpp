#include <tuple>

#include "io.h"
#include "tree.h"
#include "wordle.h"

#include <iostream>

using namespace std;

int main()
{
    vector< array<char,5> > words;
    read_words("../dictionary/orig_solution.csv", words);

    unsigned char hint = compute_hint_from_guess(str_to_word("cigar"), str_to_word("other"));
    cout << "Hint = " << (int)hint << endl;
    cout << hint_to_str(hint) << endl;

    vector< vector< unsigned char > > hints;
    compute_hints(words, hints);
    
    vector< int > indices;
    indices.resize(words.size());
    for( int i=0; i<words.size(); i++ )
    {
        indices[i] = i;
    }
    auto tuple = get_best_guess_index(hints, indices);

    cout << word_to_str(words[get<0>(tuple)]) << ": " << get<1>(tuple) << endl;

    cout << "creating tree" << endl;
    Tree tree(hints, indices);
    cout << "printing tree" << endl;
    PrintTree(words, tree);

    return 0;
}
