// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// test_canonical.cpp — Verify no D4-duplicate puzzles in enumerate output.
//
// Reads puzzles from stdin (enumerate output), computes the D4 canonical form
// for each puzzle's positions (exits sorted separately from helpers), and
// checks that no two puzzles share the same canonical form.
//
// Usage:
//   ./enumerate 1 5 1 99 | ./test_canonical
//
// Build:
//   g++ -O2 -std=c++17 -o test_canonical test_canonical.cpp

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

static constexpr int N = 7;

static inline int sym(int p, int t) {
    const int r = p / N, c = p % N, m = N - 1;
    switch (t) {
        case 0: return  r*N+c;
        case 1: return  c*N+(m-r);
        case 2: return (m-r)*N+(m-c);
        case 3: return (m-c)*N+r;
        case 4: return  r*N+(m-c);
        case 5: return (m-r)*N+c;
        case 6: return  c*N+r;
        case 7: return (m-c)*N+(m-r);
        default: return -1;
    }
}

struct Puzzle {
    int id;
    int num_exits;
    int num_helpers;
    int min_moves;
    std::vector<int> cells; // first num_exits are exits, rest helpers
    std::string line;
};

// Compute D4 canonical form with exits and helpers sorted SEPARATELY.
// This matches enumerate.cpp's dedup logic: exit/helper roles are preserved
// under D4 transforms (an exit stays an exit, a helper stays a helper).
static std::vector<int> canonical_positions(const std::vector<int>& cells, int num_exits) {
    std::vector<int> best;
    for (int t = 0; t < 8; t++) {
        std::vector<int> tr(cells.size());
        for (size_t i = 0; i < cells.size(); i++)
            tr[i] = sym(cells[i], t);
        std::sort(tr.begin(), tr.begin() + num_exits);
        std::sort(tr.begin() + num_exits, tr.end());
        if (best.empty() || tr < best) best = tr;
    }
    return best;
}

static bool parse_puzzle(const std::string& line, Puzzle& p) {
    if (line.empty() || line[0] == '#') return false;

    std::istringstream iss(line);
    std::string tok;

    // id|exits|helpers|minMoves|positions|solution
    if (!std::getline(iss, tok, '|')) return false;
    p.id = std::stoi(tok);

    // Detect old vs new format
    std::vector<std::string> parts;
    parts.push_back(tok);
    while (std::getline(iss, tok, '|')) parts.push_back(tok);

    if (parts.size() == 9) {
        // New format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
        p.num_exits = std::stoi(parts[1]);
        p.num_helpers = std::stoi(parts[2]);
        p.min_moves = std::stoi(parts[3]);
        tok = parts[7];
    } else if (parts.size() == 11) {
        // Old metrics format
        p.num_exits = std::stoi(parts[1]);
        p.num_helpers = std::stoi(parts[2]);
        p.min_moves = std::stoi(parts[3]);
        tok = parts[9];
    } else if (parts.size() == 6) {
        // Legacy format: id|exits|helpers|minMoves|positions|solution
        p.num_exits = std::stoi(parts[1]);
        p.num_helpers = std::stoi(parts[2]);
        p.min_moves = std::stoi(parts[3]);
        tok = parts[4];
    } else if (parts.size() == 5) {
        if (parts[3].find(',') != std::string::npos) {
            // Old format: id|helpers|minMoves|positions|solution
            p.num_exits = 1;
            p.num_helpers = std::stoi(parts[1]);
            p.min_moves = std::stoi(parts[2]);
            tok = parts[3];
        } else {
            // Stripped new format
            p.num_exits = std::stoi(parts[1]);
            p.num_helpers = std::stoi(parts[2]);
            p.min_moves = std::stoi(parts[3]);
            tok = parts[4];
        }
    } else {
        return false;
    }

    // Parse positions
    p.cells.clear();
    std::istringstream pos_stream(tok);
    std::string pos;
    while (pos_stream >> pos) {
        auto comma = pos.find(',');
        if (comma == std::string::npos) return false;
        int r = std::stoi(pos.substr(0, comma));
        int c = std::stoi(pos.substr(comma + 1));
        p.cells.push_back(r * N + c);
    }

    p.line = line;
    return true;
}

int main() {
    std::vector<Puzzle> puzzles;
    std::string line;
    while (std::getline(std::cin, line)) {
        Puzzle p;
        if (parse_puzzle(line, p)) puzzles.push_back(std::move(p));
    }

    std::cerr << "Loaded " << puzzles.size() << " puzzles\n";

    // Check for D4 duplicates: exits and helpers sorted separately.
    // Two puzzles are D4-equivalent only if they have the same number of exits
    // and helpers, AND some D4 transform maps one's positions to the other's
    // with exit/helper roles preserved.
    std::map<std::vector<int>, std::vector<int>> canon_to_ids;
    for (const auto& p : puzzles) {
        auto canon = canonical_positions(p.cells, p.num_exits);
        canon_to_ids[canon].push_back(p.id);
    }

    int dup_groups = 0;
    int dup_puzzles = 0;
    for (const auto& [canon, ids] : canon_to_ids) {
        if (ids.size() > 1) {
            dup_groups++;
            dup_puzzles += (int)ids.size() - 1;
            if (dup_groups <= 20) {
                std::cout << "DUPLICATE GROUP: puzzles";
                for (int id : ids) std::cout << " #" << id;
                std::cout << "\n";
                for (int id : ids) {
                    for (const auto& p : puzzles) {
                        if (p.id == id) {
                            std::cout << "  #" << id << ": " << p.line.substr(0, 80) << "\n";
                            break;
                        }
                    }
                }
            }
        }
    }

    std::cout << "\n=== D4 duplicate test (exits/helpers preserved) ===\n";
    std::cout << "Total puzzles: " << puzzles.size() << "\n";
    std::cout << "Unique canonical forms: " << canon_to_ids.size() << "\n";
    std::cout << "Duplicate groups: " << dup_groups << "\n";
    std::cout << "Extra puzzles: " << dup_puzzles << "\n";
    if (dup_groups == 0)
        std::cout << "PASS: No D4 duplicates found\n";
    else
        std::cout << "FAIL: Found " << dup_groups << " groups of D4 duplicates\n";

    return 0;
}
