# Wordle Solver #
 
This creates a tree of good guesses for [wordle](https://www.powerlanguage.co.uk/wordle/) based on the dictionary of 5-letter words it uses.

    usage: wordle.py [-h] [--show_guesses SHOW_GUESSES] [--guess_distribution GUESS_DISTRIBUTION]

    Solve Wordle

    optional arguments:
    -h, --help            show this help message and exit
    --show_guesses SHOW_GUESSES
                            show guesses and solution
    --guess_distribution GUESS_DISTRIBUTION
                            print distribution of guess count

It creates files called `candidates_cheat_sheet.txt` and `solutions_cheat_sheet.txt` representing decision trees with all candidatee words or only the subset of words used as solutions.
