#include <format>
#include <vector>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <iostream>

#include <math.h>
#include <assert.h>

#include "tree.h"

using namespace std;

void ReadWords(const string filename, vector<Word> &words)
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

string PrintTree(
    vector< Word > words,
    const Tree &t,
    Hint hint,
    string indent)
{
    ostringstream output;

    string guess = words[t.guess_index_];
    output << std::setprecision(2) << std::fixed;
    output << indent << (string)hint + ": ";
    output << guess << " " << t.size_ << " " << t.entropy_ << "\n";
    for( const auto &c : t.children_ )
    {
        output << PrintTree(words, get<1>(c), get<0>(c), indent + " ");
    }

    return output.str();
}

class PrintSolutionFunctor
{
private:
    int solution_index;
    const vector< vector< Hint > > &hints;
    const vector< Word > &words;
    bool show_answer;

public:
    ostringstream output;
    int guess_count;

    PrintSolutionFunctor(
        int solution_index, bool show_answer,
        const vector< vector< Hint > > &hints,
        const vector< Word > &words
        ) :
        solution_index(solution_index), show_answer(show_answer), hints(hints), words(words)
    {
        output << fixed << setprecision(2);
        guess_count = 0;
    }

    void operator ()(const Tree &tree)
    {
        Hint hint = hints[tree.guess_index_][solution_index];
        output << (string)hint;
        if (show_answer)
        {
            double remaining_entropy = 0.0;
            int child_size = 0;
            if( (unsigned char)hint != 0 )
            {
                child_size = tree.children_.at((unsigned char)hint).size_;
                remaining_entropy = log2(child_size);
            }
            output << " " + (string)words[tree.guess_index_];
            output << " Expected: " << tree.entropy_;
            output << " Actual: " << log2(tree.size_ - remaining_entropy);
            output << " " << tree.size_ << "->" << child_size;
            output << "\n";
        }
        else
        {
            output << "\n";
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

    cout << functor.output.str() << endl;
}