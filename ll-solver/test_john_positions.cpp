// Test solve_min_grouped against John Rausch's hex puzzle positions.
// Reads positions from stdin (one per line: num_exits r0,c0 r1,c1 ...)
// and reports the optimal grouped moves for each.
//
// Usage:
//   python3 -c "from verify_john import *; dump_positions()" | ./test_john_positions

#define main enumerate_main
#include "enumerate.cpp"
#undef main

#include <iostream>
#include <sstream>
#include <string>

int main() {
    BOARD_TYPE = BOARD_HEX;
    N = 5; NC = 25; CTR = 12; NUM_DIRS = 6; NUM_SYMS = 4;
    SYM_INDICES[0] = 0; SYM_INDICES[1] = 2; SYM_INDICES[2] = 4; SYM_INDICES[3] = 5;

    std::string line;
    int total = 0, our_better = 0, john_better = 0, equal = 0, unsolvable = 0;

    while (std::getline(std::cin, line)) {
        if (line.empty() || line[0] == '#') continue;

        // Format: john_moves john_steps num_exits r0,c0 r1,c1 ...
        std::istringstream iss(line);
        int john_moves, john_steps, num_exits;
        iss >> john_moves >> john_steps >> num_exits;

        std::vector<int> cells;
        std::string pos;
        while (iss >> pos) {
            auto comma = pos.find(',');
            int r = std::stoi(pos.substr(0, comma));
            int c = std::stoi(pos.substr(comma + 1));
            cells.push_back(r * N + c);
        }

        int n = (int)cells.size();
        if (n < 2 || n > 10) continue;

        // Sort helpers (positions after exits)
        std::sort(cells.begin() + num_exits, cells.end());

        State s = encode(cells.data(), n);
        auto result = solve_min_grouped(s, n, num_exits);

        total++;

        if (result.moves.empty()) {
            unsolvable++;
            std::cerr << "UNSOLVABLE: " << line << "\n";
            continue;
        }

        int our_moves = result.grouped_moves;

        if (our_moves < john_moves) {
            our_better++;
        } else if (our_moves > john_moves) {
            john_better++;
            std::cout << "JOHN_BETTER: john=" << john_moves << " ours=" << our_moves
                      << " pos:";
            for (int i = 0; i < n; i++) std::cout << " " << cells[i]/N << "," << cells[i]%N;
            std::cout << "\n";
        } else {
            equal++;
        }
    }

    std::cerr << "\nResults: " << total << " puzzles tested\n";
    std::cerr << "  Equal:       " << equal << "\n";
    std::cerr << "  Ours better: " << our_better << "\n";
    std::cerr << "  John better: " << john_better << "\n";
    std::cerr << "  Unsolvable:  " << unsolvable << "\n";

    return john_better > 0 ? 1 : 0;
}
