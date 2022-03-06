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
    cout << indent << (string)hint << ": ";
    cout << guess << " " << t.size_ <<  " " << t.entropy_ << endl;
    for( const auto &c : t.children_ )
    {
        PrintTree(words, get<1>(c), get<0>(c), indent + " ");
    }
}

class PrintSolutionFunctor
{
private:
    int solution_index;
    const vector< vector< Hint > > &hints;
    const vector< Word > &words;
    bool show_answer;

public:
    string output;
    int guess_count;

    PrintSolutionFunctor(
        int solution_index, bool show_answer,
        const vector< vector< Hint > > &hints,
        const vector< Word > &words
        ) :
        solution_index(solution_index), show_answer(show_answer), hints(hints), words(words)
    {
        output = "";
        guess_count = 0;
    }

    void operator ()(const Tree &tree)
    {
        Hint hint = hints[tree.guess_index_][solution_index];
        output += (string)hint;
        if (show_answer)
        {
            output += " " + (string)words[tree.guess_index_];
            output += " " + to_string(tree.entropy_);
            output += " " + to_string(tree.size_);
            output += "\n";
        }
        else
        {
            output += "\n";
        }
        guess_count++;
    }
};

void PrintSolution(
    const vector< Word > &words,
    const vector< vector< Hint > > &hints,
    const Tree &t,
    int solution_index,
    bool show_answer = false)
{
    PrintSolutionFunctor functor(solution_index, show_answer, hints, words);

    t.Solve<PrintSolutionFunctor>(solution_index, hints, functor);
    cout << "Computurdle " << solution_index << " " << functor.guess_count << "/6" << endl << endl;

    cout << functor.output << endl;
}