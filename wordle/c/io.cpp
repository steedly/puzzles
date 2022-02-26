#include <vector>
#include <fstream>
#include <iostream>
#include <iomanip>

#include <assert.h>

#include "tree.h"

using namespace std;

void read_words(const string filename, vector<Word> &words)
{
    ifstream myfile;
    myfile.open( filename );

    string line;
    while( getline( myfile, line ) )
    {
        assert( line.length() == 5);
        Word word;
        for(int i=0; i<5; i++)
        {
            word[i] = line[i];
        }
        words.push_back(word);
    }

    myfile.close();
}

void PrintTree(
    vector< Word > words,
    const Tree &t,
    Hint hint,
    string indent)
{
    string guess = words[t.guess_index_];
    cout << setiosflags(ios::fixed) << setprecision(2);
    cout << indent << (string)hint << ": " << guess << " " << t.entropy_ << endl;
    for( const auto &c : t.children_ )
    {
        PrintTree(words, get<1>(c), get<0>(c), indent + " ");
    }
}
