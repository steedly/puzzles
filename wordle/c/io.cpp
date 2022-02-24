#include <array>
#include <vector>
#include <fstream>
#include <iostream>

#include <assert.h>

#include "tree.h"

using namespace std;

void read_words(const string filename, vector<array<char,5> > &words)
{
    ifstream myfile;
    myfile.open( filename );

    string line;
    while( getline( myfile, line ) )
    {
        assert( line.length() == 5);
        array<char,5> word;
        for(int i=0; i<5; i++)
        {
            word[i] = line[i];
        }
        words.push_back(word);
    }

    cout << "read " << words.size() << " words" << endl;
    myfile.close();
}

string hint_to_str(unsigned char hint)
{
    const unsigned char green[] = {0xF0, 0x9F, 0x9F, 0xA9, 0x0};
    const unsigned char yellow[] = {0xF0, 0x9F, 0x9F, 0xA8, 0x0};
    const unsigned char white[] = {0xE2, 0xAC, 0x9C, 0x0};
    const char *strings[3] = {
        (const char*)green,
        (const char*)yellow,
        (const char*)white};

    string str;
    for( int i=0; i<5; i++ )
    {
        str.append(strings[hint % 3]);
        hint /= 3;
    }
    return str;
}

array<char,5> str_to_word(string str)
{
    assert(str.length() == 5);
    array<char,5> word;
    for(int i=0; i<5; i++)
    {
        word[i] = str[i];
    }
    return word;
}

string word_to_str(const array<char,5> &word)
{
    return string({word[0], word[1], word[2], word[3], word[4], 0x0});
}

void PrintTree(
    vector< array<char,5> > words,
    const Tree &t,
    unsigned char hint,
    string indent)
{
    string guess = word_to_str(words[t.guess_index_]);
    cout << indent << hint_to_str(hint) << ": " << guess << endl;
    for( const auto &c : t.children_ )
    {
        PrintTree(words, get<1>(c), get<0>(c), indent + " ");
    }
}