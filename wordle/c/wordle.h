#pragma once

#include <array>
#include <tuple>
#include <string>
#include <vector>
#include <assert.h>

class Word
{
public:
    Word()
    {
    }
    Word(const std::string &str)
    {
        assert(str.length() == 5);
        for(int i=0; i<5; i++)
        {
            word_[i] = str[i];
        }
    }

    Word(std::array<char, 5> w)
    {
        word_ = w;
    }

    char operator[](int i) const
    {
        return word_[i];
    } 

    char& operator[](int i)
    {
        return word_[i];
    } 

    operator std::string() const
    {
        return std::string({word_[0], word_[1], word_[2], word_[3], word_[4]});
    }

private:
    std::array<char, 5> word_;
};

class Hint
{
public:
    static const unsigned char NUM_HINTS = 243;
    Hint()
    {
    }

    Hint(unsigned char hint)
    {
        hint_ = hint;
    }

    Hint(Word guess, Word solution)
    {
        hint_ = 0;

        std::array<bool, 5> soln_used;
        std::array<bool, 5> guess_used;

        // Check for exact matches
        for(int i=0; i<5; i++)
        {
            bool match = (guess[i] == solution[i]);
            soln_used[i] = match;
            guess_used[i] = match;
        }

        // Handle the rest
        unsigned char scale = 1;
        for(int i=0; i<5; i++)
        {
            if( !guess_used[i] )
            {
                char letter = guess[i];
                bool no_match = true;
                for( int j=0; j<5; j++ )
                {
                    if( !soln_used[j] && letter == solution[j] )
                    {
                        soln_used[j] = true;
                        hint_ += scale;
                        no_match = false;
                        break;
                    }
                }
                if( no_match )
                {
                    hint_ += scale*2;
                }
            }

            scale *= 3;
        }
    }

    operator unsigned char() const
    {
        return hint_;
    }

    bool IsCorrect() const
    {
        return hint_ == 0;
    }
    operator std::string() const
    {
        const std::string blocks[3] = {"🟩", "🟨", "⬜"};

        unsigned char h = hint_;
        std::string str;
        for( int i=0; i<5; i++ )
        {
            str.append(blocks[h % 3]);
            h /= 3;
        }
        return str;
    }

private:
    unsigned char hint_;
};

void ComputeHints(
    const std::vector<Word> &words,
    std::vector< std::vector< Hint > > &hints);

double ComputeEntropy(
    const std::array< std::vector< int >,
    Hint::NUM_HINTS > &sub_groups_indices);

void Partition(
    const std::vector< Hint > &hints,
    const std::vector< int >  &group_indices,
    std::array< std::vector< int >, Hint::NUM_HINTS > &sub_groups_indices);

std::string EvaluateGuesses(
    std::string solution,
    const std::vector< std::string > &guesses,
    const std::vector< Word > &words);
