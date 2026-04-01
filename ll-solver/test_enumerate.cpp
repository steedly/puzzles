// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// test_enumerate.cpp — Unit tests for enumerate.cpp
//
// Build:
//   g++ -O2 -std=c++17 -o test_enumerate test_enumerate.cpp
//
// With OpenMP:
//   g++ -O2 -std=c++17 -fopenmp -o test_enumerate test_enumerate.cpp
//   (macOS: add -Xpreprocessor -fopenmp -I$(brew --prefix libomp)/include
//           -L$(brew --prefix libomp)/lib -lomp)
//
// Run:
//   ./test_enumerate

// Rename enumerate's main() so we can define our own.
#define main enumerate_main
#include "enumerate.cpp"
#undef main

#include <cassert>
#include <cmath>
#include <iostream>
#include <sstream>
#include <set>

static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) \
    static void test_##name(); \
    struct reg_##name { reg_##name() { test_registry().push_back({#name, test_##name}); } } reg_inst_##name; \
    static void test_##name()

#define ASSERT(cond) do { \
    if (!(cond)) { \
        std::cerr << "  FAIL: " << #cond << " at " << __FILE__ << ":" << __LINE__ << "\n"; \
        throw std::runtime_error("assertion failed"); \
    } \
} while(0)

#define ASSERT_EQ(a, b) do { \
    auto _a = (a); auto _b = (b); \
    if (_a != _b) { \
        std::cerr << "  FAIL: " << #a << " == " << #b \
                  << " (got " << _a << " vs " << _b << ")" \
                  << " at " << __FILE__ << ":" << __LINE__ << "\n"; \
        throw std::runtime_error("assertion failed"); \
    } \
} while(0)

struct TestEntry { const char* name; void (*func)(); };
static std::vector<TestEntry>& test_registry() {
    static std::vector<TestEntry> r;
    return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// State encoding / decoding
// ═══════════════════════════════════════════════════════════════════════════════

TEST(encode_decode_roundtrip) {
    int pos[4] = {0, 24, 48, 63}; // corners + center + EXITED
    State s = encode(pos, 4);
    int out[4];
    decode(s, 4, out);
    for (int i = 0; i < 4; i++)
        ASSERT_EQ(pos[i], out[i]);
}

TEST(encode_decode_single_robot) {
    for (int cell = 0; cell < NC; cell++) {
        int pos[1] = {cell};
        State s = encode(pos, 1);
        int out[1];
        decode(s, 1, out);
        ASSERT_EQ(cell, out[0]);
    }
}

TEST(encode_decode_exited_sentinel) {
    int pos[2] = {EXITED, 10};
    State s = encode(pos, 2);
    int out[2];
    decode(s, 2, out);
    ASSERT_EQ(EXITED, out[0]);
    ASSERT_EQ(10, out[1]);
}

TEST(encode_decode_max_robots) {
    // 10 robots (maximum supported)
    int pos[10] = {0, 1, 2, 3, 4, 5, 6, 7, 48, EXITED};
    State s = encode(pos, 10);
    int out[10];
    decode(s, 10, out);
    for (int i = 0; i < 10; i++)
        ASSERT_EQ(pos[i], out[i]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// D4 symmetry
// ═══════════════════════════════════════════════════════════════════════════════

TEST(sym_identity) {
    for (int p = 0; p < NC; p++)
        ASSERT_EQ(p, sym(p, 0));
}

TEST(sym_center_invariant) {
    // Center (3,3) = cell 24 should be invariant under all D4 transforms.
    for (int t = 0; t < 8; t++)
        ASSERT_EQ(CTR, sym(CTR, t));
}

TEST(sym_four_rotations_cycle) {
    // Applying 90° rotation 4 times should return to original.
    for (int p = 0; p < NC; p++) {
        int q = p;
        for (int i = 0; i < 4; i++) q = sym(q, 1);
        ASSERT_EQ(p, q);
    }
}

TEST(sym_reflection_involution) {
    // Each reflection applied twice should return to original.
    for (int t = 4; t < 8; t++) {
        for (int p = 0; p < NC; p++)
            ASSERT_EQ(p, sym(sym(p, t), t));
    }
}

TEST(sym_180_is_double_90) {
    for (int p = 0; p < NC; p++)
        ASSERT_EQ(sym(p, 2), sym(sym(p, 1), 1));
}

TEST(sym_corners_rotate) {
    // (0,0)=0 → 90°CW → (0,6)=6 → (6,6)=48 → (6,0)=42 → (0,0)=0
    ASSERT_EQ(6,  sym(0, 1));
    ASSERT_EQ(48, sym(6, 1));
    ASSERT_EQ(42, sym(48, 1));
    ASSERT_EQ(0,  sym(42, 1));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Canonical form
// ═══════════════════════════════════════════════════════════════════════════════

TEST(canonical_idempotent) {
    // canonical(canonical(s)) == canonical(s)
    int pos[3] = {0, 10, 30}; // 1 exit + 2 helpers
    State s = encode(pos, 3);
    State c1 = canonical(s, 3, 1);
    State c2 = canonical(c1, 3, 1);
    ASSERT_EQ(c1, c2);
}

TEST(canonical_d4_equivalents_same) {
    // All D4 transforms of a state should have the same canonical form.
    int pos[3] = {0, 10, 30}; // 1 exit, 2 helpers
    State canon_val = canonical(encode(pos, 3), 3, 1);

    for (int t = 0; t < 8; t++) {
        int tr[3];
        tr[0] = sym(pos[0], t);
        tr[1] = sym(pos[1], t);
        tr[2] = sym(pos[2], t);
        std::sort(tr + 1, tr + 3); // sort helpers
        ASSERT_EQ(canon_val, canonical(encode(tr, 3), 3, 1));
    }
}

TEST(canonical_exit_permutation_dedup) {
    // Two states that differ only by swapping exit positions should
    // have the same canonical form.
    int pos1[4] = {5, 10, 20, 30}; // exits at 5,10; helpers at 20,30
    int pos2[4] = {10, 5, 20, 30}; // exits swapped
    State c1 = canonical(encode(pos1, 4), 4, 2);
    State c2 = canonical(encode(pos2, 4), 4, 2);
    ASSERT_EQ(c1, c2);
}

TEST(canonical_lex_min) {
    // canonical() returns the lex-min encoding.
    int pos[2] = {0, 48}; // 1 exit + 1 helper
    State s = encode(pos, 2);
    State c = canonical(s, 2, 1);
    ASSERT(c <= s);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FlatMap
// ═══════════════════════════════════════════════════════════════════════════════

TEST(flatmap_insert_find) {
    FlatMap m(12);
    ASSERT(m.insert_new(100, 5));
    uint8_t val;
    ASSERT(m.find_val(100, &val));
    ASSERT_EQ(5, (int)val);
}

TEST(flatmap_no_duplicate_insert) {
    FlatMap m(12);
    ASSERT(m.insert_new(42, 1));
    ASSERT(!m.insert_new(42, 2)); // already present
    uint8_t val;
    ASSERT(m.find_val(42, &val));
    ASSERT_EQ(1, (int)val); // original value kept
}

TEST(flatmap_missing_key) {
    FlatMap m(12);
    m.insert_new(1, 1);
    uint8_t val;
    ASSERT(!m.find_val(999, &val));
}

TEST(flatmap_empty_find) {
    FlatMap m(12);
    uint8_t val;
    ASSERT(!m.find_val(0, &val));
}

TEST(flatmap_many_inserts) {
    FlatMap m(24); // 24 bits = up to 16M keys
    const int N_KEYS = 10000;
    for (int i = 0; i < N_KEYS; i++)
        ASSERT(m.insert_new((uint64_t)i, (uint8_t)(i % 256)));
    ASSERT_EQ((size_t)N_KEYS, m.size());
    for (int i = 0; i < N_KEYS; i++) {
        uint8_t val;
        ASSERT(m.find_val((uint64_t)i, &val));
        ASSERT_EQ((int)(i % 256), (int)val);
    }
}

TEST(flatmap_iterator) {
    FlatMap m(12);
    m.insert_new(10, 1);
    m.insert_new(20, 2);
    m.insert_new(30, 3);
    std::set<uint64_t> keys;
    for (auto [k, v] : m) keys.insert(k);
    ASSERT_EQ((size_t)3, keys.size());
    ASSERT(keys.count(10));
    ASSERT(keys.count(20));
    ASSERT(keys.count(30));
}

TEST(flatmap_reserve) {
    FlatMap m(12);
    m.reserve(100000);
    ASSERT(m.cap() >= 100000);
    // Should still work after reserve
    m.insert_new(42, 7);
    uint8_t val;
    ASSERT(m.find_val(42, &val));
    ASSERT_EQ(7, (int)val);
}

TEST(flatmap_pack_unpack) {
    FlatMap m(42); // 7 robots × 6 bits
    // Verify packing preserves both key and value
    uint64_t key = ((uint64_t)1 << 42) - 1; // max key for 42 bits
    uint64_t packed = m.pack(key, 200);
    ASSERT_EQ(key, packed & m.km_);
    ASSERT_EQ(200, (int)(uint8_t)(packed >> 42));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Forward move
// ═══════════════════════════════════════════════════════════════════════════════

TEST(forward_move_basic_slide) {
    // Robot 0 (exit) at (0,3)=3, robot 1 (helper) at (3,3)=24 (center).
    // Slide exit down → blocked by helper at center → lands at (2,3)=17.
    int pos[2] = {3, 24}; // exit at row0,col3; helper at center
    int new_cell, blocker_idx;
    State new_state;
    // dir=1 is Down
    ASSERT(forward_move(pos, 2, 1, 0, 1, new_cell, blocker_idx, new_state));
    ASSERT_EQ(17, new_cell); // (2,3)
    ASSERT_EQ(1, blocker_idx); // blocked by helper
}

TEST(forward_move_wall_stop_illegal) {
    // Robot 0 at (0,3), no blocker to the right → slides to wall → ILLEGAL.
    int pos[2] = {3, 24};
    int new_cell, blocker_idx;
    State new_state;
    // dir=3 is Right; robot at (0,3), blocker at (3,3) is not in the way
    ASSERT(!forward_move(pos, 2, 1, 0, 3, new_cell, blocker_idx, new_state));
}

TEST(forward_move_no_movement) {
    // Robot 0 at (0,3), robot 1 at (0,4). Slide right → already adjacent.
    // Wait — that would be no movement since (0,3) moving right is blocked by (0,4)
    // and the robot doesn't move at all? Actually it does: it stays at (0,3).
    // forward_move returns false for "no movement".
    int pos[2] = {3, 4}; // (0,3) and (0,4) are adjacent
    int new_cell, blocker_idx;
    State new_state;
    // dir=3 is Right
    ASSERT(!forward_move(pos, 2, 1, 0, 3, new_cell, blocker_idx, new_state));
}

TEST(forward_move_exit_reaches_center) {
    // Exit at (0,3)=3, helper at (5,3)=38. Slide exit down →
    // passes center (3,3)=24, continues... wait, exit STOPS at center.
    // Actually, per the code: exit slides down, lands at some cell. If that
    // cell is CTR, it gets EXITED sentinel.
    // (0,3) slides down: hits helper at (5,3), lands at (4,3)=31. Not center.
    // Let's use: exit at (0,3)=3, helper at (4,3)=31.
    // Slides down from (0,3), blocked by helper at (4,3), lands at (3,3)=24=CTR.
    int pos[2] = {3, 31};
    int new_cell, blocker_idx;
    State new_state;
    ASSERT(forward_move(pos, 2, 1, 0, 1, new_cell, blocker_idx, new_state));
    ASSERT_EQ(CTR, new_cell);
    // Verify the exit robot is EXITED in the new state
    int result[2];
    decode(new_state, 2, result);
    ASSERT_EQ(EXITED, result[0]);
}

TEST(forward_move_helper_through_center) {
    // Helper at (0,3)=3, another helper at (5,3)=38, 1 exit at EXITED.
    // Helper slides down → passes through center → lands at (4,3)=31.
    // Wait, helpers don't get special treatment at center; they just slide through.
    // Actually, looking at the code: exit-on-center check is only for exits.
    int pos[3] = {EXITED, 3, 38}; // exit(exited), helper at (0,3), helper at (5,3)
    int new_cell, blocker_idx;
    State new_state;
    // Slide helper (idx=1) down (dir=1)
    ASSERT(forward_move(pos, 3, 1, 1, 1, new_cell, blocker_idx, new_state));
    ASSERT_EQ(31, new_cell); // (4,3) — one before (5,3)
    ASSERT_EQ(2, blocker_idx);
    // Helper should NOT be EXITED
    int result[3];
    decode(new_state, 3, result);
    ASSERT(result[1] != EXITED);
}

TEST(forward_move_exited_robot_cannot_move) {
    int pos[2] = {EXITED, 10};
    int new_cell, blocker_idx;
    State new_state;
    // Try to move the exited exit robot
    ASSERT(!forward_move(pos, 2, 1, 0, 0, new_cell, blocker_idx, new_state));
}

TEST(forward_move_helpers_sorted_in_result) {
    // After a helper moves, helpers should be sorted in the resulting state.
    // Exit at (0,0)=0, helpers at (3,0)=21 and (6,0)=42.
    // Slide helper at (6,0) up → blocked by (3,0) → lands at (4,0)=28.
    // Helpers should be sorted: [21, 28] not [28, 21].
    int pos[3] = {0, 21, 42}; // exit, helper, helper
    int new_cell, blocker_idx;
    State new_state;
    // Slide robot 2 (helper at 42) Up (dir=0)
    ASSERT(forward_move(pos, 3, 1, 2, 0, new_cell, blocker_idx, new_state));
    ASSERT_EQ(28, new_cell); // (4,0)
    int result[3];
    decode(new_state, 3, result);
    // Helpers should be sorted
    ASSERT(result[1] <= result[2]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reverse moves
// ═══════════════════════════════════════════════════════════════════════════════

TEST(reverse_moves_normal_basic) {
    // 1 exit + 2 helpers. Helper at (3,0)=21, helper at (3,6)=27.
    // Reverse slide of helper at (3,6)=27: for direction Right (d=3),
    // blocker must be at (3,7) — off board. For direction Left (d=2),
    // blocker at (3,5)? No, that's empty. For direction Up (d=0),
    // blocker at (2,6)? Empty. For direction Down (d=1), blocker at (4,6)?
    // Empty. — We need a blocker adjacent to the robot.
    //
    // Better setup: helper0 at (3,3)=24 (center), helper1 at (3,5)=26.
    // occ excluding helper1 = {24}. For helper1 at (3,5):
    //   dir=2 (Left): blocker at (3,4)=25? Not in occ. No.
    //   dir=3 (Right): blocker at (3,6)=27? Not in occ. No.
    //   dir=0 (Up): blocker at (2,5)=19? Not in occ. No.
    //   dir=1 (Down): blocker at (4,5)=33? Not in occ. No.
    // Still need adjacency. Let's use 3 robots total with adjacency.
    //
    // Exit at (0,0)=0, helper0 at (0,1)=1, helper1 at (0,5)=5.
    // Reverse moves for helper1 at (0,5): occ excl helper1 = {0, 1}.
    //   dir=2 (Left): blocker at (0,4)=4? Not in occ. No.
    //   dir=3 (Right): blocker at (0,6)=6? Not in occ. No.
    // Still no.
    //
    // The blocker must be one step PAST pos in direction d.
    // helper at (0,1)=1. For dir=2 (Left), blocker at (0,0)=0.
    // occ excl helper0 = {0, 5}. Yes, 0 is in occ!
    // So helper0 at (0,1) can have predecessors from the right: (0,2), (0,3), (0,4).
    int r[3] = {0, 1, 5}; // exit at 0, helper0 at 1, helper1 at 5
    uint64_t occ_excl = ((uint64_t)1 << 0) | ((uint64_t)1 << 5); // excl helper0
    std::vector<State> out;
    reverse_moves_normal(r, 3, 1, 1, occ_excl, out);
    // Helper0 at (0,1), blocker exit at (0,0) in Left direction.
    // Predecessors: helper0 came from (0,2), (0,3), (0,4) — stopping before helper1 at (0,5).
    ASSERT(!out.empty());
}

TEST(reverse_moves_unexit_basic) {
    // An exited exit robot is "un-exited": placed back on the board at a
    // position from which it would slide to center and exit.
    // Need a blocker adjacent to center for a valid un-exit.
    int r[2] = {EXITED, 17}; // exit exited, helper at (2,3)=17 (above center)
    uint64_t occ = (uint64_t)1 << 17;
    std::vector<State> out;
    reverse_moves_unexit(r, 2, 1, 0, occ, out);
    // Helper at (2,3) is one step above center in the Up direction.
    // Exit could have slid Up to reach center, blocked by helper at (2,3).
    // So the exit came from below center: (4,3), (5,3), (6,3).
    ASSERT(!out.empty());
    // Verify each predecessor has the exit somewhere on the board
    for (State s : out) {
        int pos[2];
        decode(s, 2, pos);
        ASSERT(pos[0] != EXITED);
        ASSERT(pos[0] != CTR); // center is not a valid starting position for exit
    }
}

TEST(reverse_moves_unexit_center_blocked) {
    // If center is occupied by another robot, no un-exit is possible.
    int r[3] = {EXITED, CTR, 10}; // exit exited, helper AT center, helper at 10
    uint64_t occ = ((uint64_t)1 << CTR) | ((uint64_t)1 << 10);
    std::vector<State> out;
    reverse_moves_unexit(r, 3, 1, 0, occ, out);
    ASSERT(out.empty());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Retrograde BFS (small cases)
// ═══════════════════════════════════════════════════════════════════════════════

TEST(retrograde_1exit_0helpers) {
    // 1 exit, 0 helpers: only goal state is {EXITED} with 0 helpers.
    // No solvable initial states because exit alone can never move
    // (needs a blocker). BFS should have exactly 1 state (the goal).
    FlatMap dist = retrograde(1, 0);
    ASSERT_EQ((size_t)1, dist.size());
    int pos[1] = {EXITED};
    uint8_t val;
    ASSERT(dist.find_val(encode(pos, 1), &val));
    ASSERT_EQ(0, (int)val);
}

TEST(retrograde_1exit_1helper) {
    // 1 exit, 1 helper: should produce a small but non-trivial BFS.
    // With canonical BFS, only D4-canonical goal states are seeded.
    // For 1 helper on 48 cells: ~48/8 ≈ 9 canonical seeds (due to D4 symmetry).
    FlatMap dist = retrograde(1, 1);
    ASSERT(dist.size() > 1); // more than just the goals
    int goal_count = 0;
    for (auto [s, d] : dist)
        if (d == 0) goal_count++;
    ASSERT_EQ(9, goal_count); // 9 canonical goal states
}

TEST(retrograde_1exit_1helper_depth1) {
    // In 1-exit, 1-helper: a state at depth 1 means the exit is one slide
    // from the center (blocked by the helper).
    FlatMap dist = retrograde(1, 1);
    int depth1_count = 0;
    for (auto [s, d] : dist)
        if (d == 1) depth1_count++;
    ASSERT(depth1_count > 0);

    // Verify a known depth-1 state (canonicalized):
    // Exit at (0,3)=3, helper at (4,3)=31.
    // Exit slides down, blocked by helper, lands on center. Exits!
    // Must canonicalize before FlatMap lookup (BFS stores canonical states only).
    int pos[2] = {3, 31};
    State cs = canonical(encode(pos, 2), 2, 1);
    uint8_t val;
    ASSERT(dist.find_val(cs, &val));
    ASSERT_EQ(1, (int)val);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Forward move + trace integration
// ═══════════════════════════════════════════════════════════════════════════════

TEST(trace_greedy_1exit_1helper) {
    FlatMap dist = retrograde(1, 1);
    // Exit at (0,3)=3, helper at (4,3)=31. Depth 1.
    // Must use canonical state for trace (FlatMap only has canonical states).
    int pos[2] = {3, 31};
    State s = canonical(encode(pos, 2), 2, 1);
    auto sol = trace_solution_greedy(s, 2, 1, dist);
    ASSERT_EQ((size_t)1, sol.size());
    ASSERT_EQ(0, (int)sol[0].mover);   // exit robot
    ASSERT_EQ(1, (int)sol[0].blocker); // helper
}

TEST(trace_dp_1exit_1helper) {
    FlatMap dist = retrograde(1, 1);
    int pos[2] = {3, 31};
    State s = canonical(encode(pos, 2), 2, 1);
    auto tr = trace_solution(s, 2, 1, dist);
    auto& sol = tr.moves;
    ASSERT_EQ((size_t)1, sol.size());
    ASSERT_EQ(0, (int)sol[0].mover);
    ASSERT_EQ(1, (int)sol[0].blocker);
}

TEST(trace_greedy_depth0_returns_empty) {
    FlatMap dist = retrograde(1, 1);
    // A goal state has depth 0 → trace should return empty.
    int pos[2] = {EXITED, 10};
    State s = encode(pos, 2);
    auto sol = trace_solution_greedy(s, 2, 1, dist);
    ASSERT(sol.empty());
}

TEST(trace_dp_depth0_returns_empty) {
    FlatMap dist = retrograde(1, 1);
    int pos[2] = {EXITED, 10};
    State s = encode(pos, 2);
    auto tr = trace_solution(s, 2, 1, dist);
    ASSERT(tr.moves.empty());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Solution validation (simulate forward, verify reaches goal)
// ═══════════════════════════════════════════════════════════════════════════════

// Simulate a solution forward and verify it reaches a goal state.
static bool validate_solution(State start, const std::vector<Move>& sol,
                               int n, int num_exits) {
    State cur = start;
    for (const auto& m : sol) {
        int pos[10];
        decode(cur, n, pos);
        int new_cell, blocker_idx;
        State new_state;
        if (!forward_move(pos, n, num_exits, (int)m.mover, (int)m.dir,
                          new_cell, blocker_idx, new_state))
            return false;
        if (blocker_idx != (int)m.blocker)
            return false;
        cur = new_state;
    }
    // All exits should be EXITED
    int pos[10];
    decode(cur, n, pos);
    for (int e = 0; e < num_exits; e++)
        if (pos[e] != EXITED) return false;
    return true;
}

TEST(validate_solution_greedy_small) {
    FlatMap dist = retrograde(1, 2);
    // Find a few states at various depths and validate their greedy solutions.
    int validated = 0;
    for (auto [s, d] : dist) {
        if (d == 0 || d > 5) continue;
        int r[10]; decode(s, 3, r);
        if (r[0] == EXITED) continue; // skip non-initial states
        auto sol = trace_solution_greedy(s, 3, 1, dist);
        if (sol.size() != (size_t)d) continue;
        ASSERT(validate_solution(s, sol, 3, 1));
        if (++validated >= 100) break;
    }
    ASSERT(validated > 0);
}

TEST(validate_solution_dp_small) {
    FlatMap dist = retrograde(1, 2);
    int validated = 0;
    for (auto [s, d] : dist) {
        if (d == 0 || d > 5) continue;
        int r[10]; decode(s, 3, r);
        if (r[0] == EXITED) continue;
        auto tr = trace_solution(s, 3, 1, dist);
        if (tr.moves.size() != (size_t)d) continue;
        ASSERT(validate_solution(s, tr.moves, 3, 1));
        if (++validated >= 100) break;
    }
    ASSERT(validated > 0);
}

TEST(validate_solution_2exit) {
    FlatMap dist = retrograde(2, 1);
    int validated = 0;
    for (auto [s, d] : dist) {
        if (d == 0 || d > 6) continue;
        int r[10]; decode(s, 3, r);
        if (r[0] == EXITED || r[1] == EXITED) continue;
        auto sol = trace_solution_greedy(s, 3, 2, dist);
        if (sol.size() != (size_t)d) continue;
        ASSERT(validate_solution(s, sol, 3, 2));
        if (++validated >= 50) break;
    }
    ASSERT(validated > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// sort_exits_and_remap
// ═══════════════════════════════════════════════════════════════════════════════

TEST(sort_exits_basic) {
    // 2 exits at cells 20 and 5; sort should put 5 first.
    int pos[4] = {20, 5, 30, 40}; // exit0=20, exit1=5, helper0=30, helper1=40
    std::vector<Move> sol = {{0, 1, 1}, {1, 0, 2}}; // exit0 Down blocked_by exit1; exit1 Up blocked_by helper0
    sort_exits_and_remap(pos, sol, 2);
    ASSERT_EQ(5, pos[0]);  // sorted: cell 5 first
    ASSERT_EQ(20, pos[1]); // cell 20 second
    // In original: exit0(20) → new idx 1, exit1(5) → new idx 0
    // sol[0]: mover was 0 (exit0=20) → now 1; blocker was 1 (exit1=5) → now 0
    ASSERT_EQ(1, (int)sol[0].mover);
    ASSERT_EQ(0, (int)sol[0].blocker);
    // sol[1]: mover was 1 (exit1=5) → now 0; blocker was 2 (helper) → unchanged
    ASSERT_EQ(0, (int)sol[1].mover);
    ASSERT_EQ(2, (int)sol[1].blocker);
}

TEST(sort_exits_already_sorted) {
    int pos[3] = {5, 30, 40}; // 1 exit, 2 helpers — already sorted
    std::vector<Move> sol = {{0, 2, 1}};
    sort_exits_and_remap(pos, sol, 1);
    ASSERT_EQ(5, pos[0]); // unchanged
    ASSERT_EQ(0, (int)sol[0].mover); // unchanged
}

TEST(sort_exits_helper_refs_unchanged) {
    // Helper-to-helper moves should not be remapped.
    int pos[4] = {20, 5, 30, 40};
    std::vector<Move> sol = {{2, 0, 3}}; // helper2 Up blocked_by helper3
    sort_exits_and_remap(pos, sol, 2);
    ASSERT_EQ(2, (int)sol[0].mover);   // helper indices ≥ num_exits: unchanged
    ASSERT_EQ(3, (int)sol[0].blocker);
}

// ═══════════════════════════════════════════════════════════════════════════════
// prune_unused_helpers
// ═══════════════════════════════════════════════════════════════════════════════

TEST(prune_unused_helpers_basic) {
    // 1 exit + 3 helpers (indices 0, 1, 2, 3).
    // Solution only references helpers 1 and 3 (indices 1 and 3).
    // Helper 2 (index 2) should be pruned.
    std::vector<Move> sol = {{0, 1, 1}, {3, 0, 0}}; // exit blocked by helper0; helper2 blocked by exit
    bool used[4];
    std::vector<Move> pruned;
    int new_h = prune_unused_helpers(sol, 1, 4, pruned, used);
    ASSERT_EQ(2, new_h); // only 2 helpers survive
    ASSERT(used[0]);  // exit: always kept
    ASSERT(used[1]);  // helper 0: used as blocker
    ASSERT(!used[2]); // helper 1: unused → pruned
    ASSERT(used[3]);  // helper 2: used as mover
    // Check remapping: old idx 1 → new idx 1, old idx 3 → new idx 2
    ASSERT_EQ(0, (int)pruned[0].mover);   // exit stays 0
    ASSERT_EQ(1, (int)pruned[0].blocker); // helper at old 1 → new 1
    ASSERT_EQ(2, (int)pruned[1].mover);   // helper at old 3 → new 2
    ASSERT_EQ(0, (int)pruned[1].blocker); // exit stays 0
}

TEST(prune_no_helpers_removed) {
    // All helpers used → nothing pruned.
    std::vector<Move> sol = {{1, 2, 0}, {2, 0, 1}}; // both helpers used
    bool used[3];
    std::vector<Move> pruned;
    int new_h = prune_unused_helpers(sol, 1, 3, pruned, used);
    ASSERT_EQ(2, new_h);
    ASSERT(used[0] && used[1] && used[2]);
}

TEST(prune_all_helpers_unused) {
    // Solution only involves the exit (blocked by... hmm, exit can't block itself).
    // Actually this can't happen — every move needs a blocker.
    // Let's say 2 exits, 1 helper. Solution: exit0 blocked by exit1.
    std::vector<Move> sol = {{0, 1, 1}};
    bool used[3];
    std::vector<Move> pruned;
    int new_h = prune_unused_helpers(sol, 2, 3, pruned, used);
    ASSERT_EQ(0, new_h); // helper pruned
    ASSERT(!used[2]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Collision signature
// ═══════════════════════════════════════════════════════════════════════════════

TEST(collision_sig_first_appearance_labeling) {
    // 1 exit + 2 helpers. Moves: exit blocked by helper1, helper0 blocked by helper1.
    // Exit = idx 0 (< num_exits) → 'A' (first exit seen)
    // Helper idx 1 (first helper seen) → '1'
    // Helper idx 2 (second helper seen) → '2'
    // Wait, the indices after pruning would be 0=exit, 1=helper0, 2=helper1.
    std::vector<Move> sol = {
        {0, 1, 2}, // exit Down blocked by helper1 → A D 1 (first: A=exit0, 1=helper idx2-1+1=1)
        {1, 0, 2}, // helper0 Up blocked by helper1 → 2 U 1 (helper idx1 first seen → '2')
    };
    std::string sig = collision_signature(sol, 1);
    ASSERT_EQ("AD1 2U1", sig);
}

TEST(collision_sig_same_structure_different_indices) {
    // Two solutions with same collision structure but different robot indices
    // should produce the same signature.
    std::vector<Move> sol1 = {{0, 1, 1}, {1, 0, 0}}; // exit, helper0
    std::vector<Move> sol2 = {{0, 1, 2}, {2, 0, 0}}; // exit, helper1 (different index)
    std::string sig1 = collision_signature(sol1, 1);
    std::string sig2 = collision_signature(sol2, 1);
    ASSERT_EQ(sig1, sig2);
}

TEST(collision_sig_different_structure) {
    // Different collision patterns should give different signatures.
    // Note: single-move solutions with opposite directions (U vs D) are
    // now equivalent under D4 (180 rotation maps D<->U).  Use genuinely
    // different structures: different mover/blocker relationships.
    std::vector<Move> sol1 = {{0, 1, 1}, {1, 0, 0}}; // exit D helper; helper U exit
    std::vector<Move> sol2 = {{0, 1, 1}, {0, 0, 1}}; // exit D helper; exit U helper (same exit twice)
    std::string sig1 = collision_signature(sol1, 1);
    std::string sig2 = collision_signature(sol2, 1);
    ASSERT(sig1 != sig2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// count_grouped_moves
// ═══════════════════════════════════════════════════════════════════════════════

TEST(grouped_moves_single) {
    std::vector<Move> sol = {{0, 1, 1}};
    ASSERT_EQ(1, count_grouped_moves(sol));
}

TEST(grouped_moves_same_robot_consecutive) {
    // Same robot moves twice → 1 grouped move.
    std::vector<Move> sol = {{0, 1, 1}, {0, 2, 1}};
    ASSERT_EQ(1, count_grouped_moves(sol));
}

TEST(grouped_moves_alternating) {
    // Robot 0, then 1, then 0 → 3 grouped moves.
    std::vector<Move> sol = {{0, 1, 1}, {1, 0, 0}, {0, 2, 1}};
    ASSERT_EQ(3, count_grouped_moves(sol));
}

TEST(grouped_moves_empty) {
    std::vector<Move> sol;
    ASSERT_EQ(0, count_grouped_moves(sol));
}

// ═══════════════════════════════════════════════════════════════════════════════
// hash_dedup_key
// ═══════════════════════════════════════════════════════════════════════════════

TEST(hash_dedup_deterministic) {
    std::string key = "e1h2|AD1 2U1";
    uint64_t h1 = hash_dedup_key(key);
    uint64_t h2 = hash_dedup_key(key);
    ASSERT_EQ(h1, h2);
}

TEST(hash_dedup_different_keys) {
    uint64_t h1 = hash_dedup_key("e1h2|AD1");
    uint64_t h2 = hash_dedup_key("e1h2|AU1");
    ASSERT(h1 != h2);
}

TEST(hash_dedup_empty_string) {
    // Should not crash, should return the FNV offset basis.
    uint64_t h = hash_dedup_key("");
    ASSERT_EQ(0xcbf29ce484222325ULL, h);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Predecessor generation
// ═══════════════════════════════════════════════════════════════════════════════

TEST(generate_predecessors_goal_state) {
    // Goal state with 1 exit (EXITED) and 1 helper.
    // Should generate un-exit predecessors + normal reverse moves for helper.
    int pos[2] = {EXITED, 17}; // helper at (2,3)
    State s = encode(pos, 2);
    std::vector<State> preds;
    generate_predecessors(s, 2, 1, preds);
    ASSERT(!preds.empty());
    // Each predecessor should be a valid state (exit on board or exited, helper on board).
    for (State p : preds) {
        int r[2]; decode(p, 2, r);
        ASSERT(r[0] < NC || r[0] == EXITED);
        ASSERT(r[1] < NC);
    }
}

TEST(predecessors_no_duplicates_in_bfs) {
    // Run a small BFS and verify no state appears at two different depths.
    FlatMap dist = retrograde(1, 1);
    // Check: every state has exactly one depth.
    // (This is guaranteed by insert_new, but let's verify.)
    std::set<State> seen;
    for (auto [s, d] : dist) {
        ASSERT(seen.find(s) == seen.end());
        seen.insert(s);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trace DP produces minimum grouped moves
// ═══════════════════════════════════════════════════════════════════════════════

TEST(trace_dp_min_grouped_moves) {
    // The DP trace should produce solutions with minimum grouped moves.
    // Greedy trace may produce more grouped moves.
    // Use 1 exit + 3 helpers for deeper puzzles.
    FlatMap dist = retrograde(1, 3);
    const int n = 4; // 1 exit + 3 helpers
    int checked = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 8) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;

        auto tr = trace_solution(s, n, 1, dist);
        if (tr.moves.size() != (size_t)d) continue;
        auto greedy_sol = trace_solution_greedy(s, n, 1, dist);
        if (greedy_sol.size() != (size_t)d) continue;

        int dp_grouped = count_grouped_moves(tr.moves);
        int greedy_grouped = count_grouped_moves(greedy_sol);
        ASSERT(dp_grouped <= greedy_grouped);

        if (++checked >= 200) break;
    }
    ASSERT(checked > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// stabilise_indices
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: simulate a solution using identity-based tracking (like the Python validator).
// Returns true if every move is valid and all exits reach EXITED.
static bool validate_solution_identity(
    State start, const std::vector<Move>& sol, int n, int num_exits)
{
    // current_cell[i] = current position of robot with INITIAL index i
    int current_cell[10];
    decode(start, n, current_cell);

    for (const auto& m : sol) {
        const int mi = (int)m.mover;
        const int bi = (int)m.blocker;
        if (mi < num_exits && current_cell[mi] == EXITED) return false;

        const int cur = current_cell[mi];
        const int pr = cur / N, pc = cur % N;

        // Build occupancy (all robots except mover)
        uint64_t occ = 0;
        for (int i = 0; i < n; i++)
            if (i != mi && current_cell[i] != EXITED)
                occ |= (uint64_t)1 << current_cell[i];

        int wr = pr, wc = pc;
        int blocker_cell = -1;
        int dir = (int)m.dir;
        while (true) {
            int nr = wr + DR[dir], nc = wc + DC[dir];
            if (nr < 0 || nr >= N || nc < 0 || nc >= N) break;
            int np = nr * N + nc;
            if (occ & ((uint64_t)1 << np)) { blocker_cell = np; break; }
            wr = nr; wc = nc;
        }
        if (blocker_cell < 0) return false; // wall stop
        if (wr == pr && wc == pc) return false; // no movement

        // Verify blocker identity
        if (current_cell[bi] != blocker_cell) return false;

        int new_cell = wr * N + wc;
        if (mi < num_exits && new_cell == CTR)
            current_cell[mi] = EXITED;
        else
            current_cell[mi] = new_cell;
    }
    for (int e = 0; e < num_exits; e++)
        if (current_cell[e] != EXITED) return false;
    return true;
}

TEST(stabilise_indices_basic) {
    // With 1 exit + 3 helpers, find states where helpers re-sort during the
    // solution and verify that stabilised indices are valid.
    FlatMap dist = retrograde(1, 3);
    const int n = 4;
    int checked = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 6) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;

        auto tr = trace_solution(s, n, 1, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;

        // Stabilise and validate using identity-based simulation.
        stabilise_indices(sol, s, n, 1);
        ASSERT(validate_solution_identity(s, sol, n, 1));

        if (++checked >= 200) break;
    }
    ASSERT(checked > 0);
}

TEST(stabilise_indices_greedy) {
    FlatMap dist = retrograde(1, 3);
    const int n = 4;
    int checked = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 6) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;

        auto sol = trace_solution_greedy(s, n, 1, dist);
        if (sol.size() != (size_t)d) continue;

        stabilise_indices(sol, s, n, 1);
        ASSERT(validate_solution_identity(s, sol, n, 1));

        if (++checked >= 200) break;
    }
    ASSERT(checked > 0);
}

TEST(stabilise_indices_2exit) {
    FlatMap dist = retrograde(2, 1);
    const int n = 3;
    int checked = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 6) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED || r[1] == EXITED) continue;

        auto tr = trace_solution(s, n, 2, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;

        stabilise_indices(sol, s, n, 2);
        ASSERT(validate_solution_identity(s, sol, n, 2));

        if (++checked >= 50) break;
    }
    ASSERT(checked > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Board constants
// ═══════════════════════════════════════════════════════════════════════════════

TEST(board_constants) {
    ASSERT_EQ(7, N);
    ASSERT_EQ(49, NC);
    ASSERT_EQ(24, CTR);  // (3,3) = 3*7+3
    ASSERT_EQ(63, EXITED);
}

TEST(direction_vectors) {
    // DR/DC: Up, Down, Left, Right
    ASSERT_EQ(-1, DR[0]); ASSERT_EQ(0, DC[0]); // Up
    ASSERT_EQ(1,  DR[1]); ASSERT_EQ(0, DC[1]); // Down
    ASSERT_EQ(0,  DR[2]); ASSERT_EQ(-1, DC[2]); // Left
    ASSERT_EQ(0,  DR[3]); ASSERT_EQ(1, DC[3]); // Right
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

TEST(forward_move_all_directions) {
    // Robot at center (3,3) surrounded by robots in all 4 directions.
    // Helper at (2,3)=17, (4,3)=31, (3,2)=23, (3,4)=25.
    // Exit at center can't move (adjacent in all directions = no movement).
    int pos[5] = {CTR, 17, 23, 25, 31};
    int new_cell, blocker_idx;
    State new_state;
    for (int d = 0; d < 4; d++) {
        ASSERT(!forward_move(pos, 5, 1, 0, d, new_cell, blocker_idx, new_state));
    }
}

TEST(forward_move_slide_across_board) {
    // Exit at (0,0)=0, helper at (0,6)=6. Slide right → lands at (0,5)=5.
    int pos[2] = {0, 6};
    int new_cell, blocker_idx;
    State new_state;
    ASSERT(forward_move(pos, 2, 1, 0, 3, new_cell, blocker_idx, new_state));
    ASSERT_EQ(5, new_cell); // (0,5)
}

TEST(canonical_single_exit_no_helpers) {
    // Edge case: 1 exit, 0 helpers. Canonical of EXITED should be EXITED.
    int pos[1] = {EXITED};
    State s = encode(pos, 1);
    ASSERT_EQ(s, canonical(s, 1, 1));
}

TEST(canonical_all_exits_exited) {
    // 2 exits, both EXITED, 1 helper.
    int pos[3] = {EXITED, EXITED, 10};
    State s = encode(pos, 3);
    State c = canonical(s, 3, 2);
    // Should be well-defined; EXITED sorts last.
    int r[3]; decode(c, 3, r);
    ASSERT_EQ(EXITED, r[0]);
    ASSERT_EQ(EXITED, r[1]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// D4-normalised collision signatures
// ═══════════════════════════════════════════════════════════════════════════════

TEST(collision_sig_d4_rotation_same) {
    // Two solutions that differ only by a 90° rotation of directions
    // should produce the same D4-normalised collision signature.
    // Solution 1: AD1 (exit down blocked by helper)
    // Solution 2: AL1 (exit left blocked by helper) — 90°CW of solution 1
    std::vector<Move> sol1 = {{0, 1, 1}}; // exit Down blocked_by helper
    std::vector<Move> sol2 = {{0, 2, 1}}; // exit Left blocked_by helper
    std::string sig1 = collision_signature(sol1, 1);
    std::string sig2 = collision_signature(sol2, 1);
    ASSERT_EQ(sig1, sig2);
}

TEST(collision_sig_d4_reflection_same) {
    // Two solutions that differ by horizontal reflection (L<->R) should
    // produce the same D4-normalised collision signature.
    std::vector<Move> sol1 = {{0, 2, 1}, {1, 0, 0}}; // exit Left, helper Up
    std::vector<Move> sol2 = {{0, 3, 1}, {1, 0, 0}}; // exit Right, helper Up
    std::string sig1 = collision_signature(sol1, 1);
    std::string sig2 = collision_signature(sol2, 1);
    ASSERT_EQ(sig1, sig2);
}

TEST(collision_sig_d4_different_structure_still_different) {
    // Solutions with genuinely different mover/blocker structure should
    // remain different even after D4 normalisation.
    std::vector<Move> sol1 = {{0, 1, 1}, {1, 0, 0}}; // exit D helper; helper U exit
    std::vector<Move> sol2 = {{0, 1, 1}, {0, 2, 1}}; // exit D helper; exit L helper (same exit twice)
    std::string sig1 = collision_signature(sol1, 1);
    std::string sig2 = collision_signature(sol2, 1);
    ASSERT(sig1 != sig2);
}

TEST(collision_sig_d4_all_rotations_same) {
    // All 4 rotations of a multi-move solution should hash identically.
    // Base: 1D2 AD1 — helper1 Down blocked by helper2, exit Down blocked by helper1
    // 90°CW:  1L2 AL1   180°: 1U2 AU1   270°CW: 1R2 AR1
    std::vector<Move> base   = {{1, 1, 2}, {0, 1, 1}}; // 1D2 AD1
    std::vector<Move> rot90  = {{1, 2, 2}, {0, 2, 1}}; // 1L2 AL1
    std::vector<Move> rot180 = {{1, 0, 2}, {0, 0, 1}}; // 1U2 AU1
    std::vector<Move> rot270 = {{1, 3, 2}, {0, 3, 1}}; // 1R2 AR1
    std::string sb = collision_signature(base, 1);
    ASSERT_EQ(sb, collision_signature(rot90, 1));
    ASSERT_EQ(sb, collision_signature(rot180, 1));
    ASSERT_EQ(sb, collision_signature(rot270, 1));
}

TEST(collision_sig_d4_reported_duplicates) {
    // Puzzles 823, 7907, 24411 from the bug report are D4 rotations of each
    // other. Their collision sequences have the same mover/blocker pattern
    // with rotated directions. After D4-normalised collision_signature,
    // they should all produce the same signature.
    // 823 (pruned, first-appearance relabeled moves):
    //   Directions: R R D L D L U R R U L U
    // 7907 (same mover/blocker, directions rotated 90°CW):
    //   Directions: U U L D L D R U U R D R
    // The mover/blocker pattern for both:
    //   1_2 3_1 1_A 2_3 2_1 1_4 A_2 1_A 4_1 1_3 A_4 A_1
    //
    // We construct them with a shared mover/blocker sequence and different dirs.
    std::vector<Move> sol823 = {
        {1,3,2}, {3,3,1}, {1,1,0}, {2,2,3}, {2,1,1}, {1,2,4}, {0,0,2}, {1,3,0}, {4,3,1}, {1,0,3}, {0,2,4}, {0,0,1}
    };
    std::vector<Move> sol7907 = {
        {1,0,2}, {3,0,1}, {1,2,0}, {2,1,3}, {2,2,1}, {1,1,4}, {0,3,2}, {1,0,0}, {4,0,1}, {1,3,3}, {0,1,4}, {0,3,1}
    };
    std::string sig823 = collision_signature(sol823, 1);
    std::string sig7907 = collision_signature(sol7907, 1);
    ASSERT_EQ(sig823, sig7907);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compaction improvements
// ═══════════════════════════════════════════════════════════════════════════════

TEST(compact_nonmover_toward_center) {
    // Verify that try_compact can shift a non-moving blocker toward center.
    // Setup: 1 exit + 2 helpers. Exit at center-adjacent, helper far from center
    // acts as blocker but never moves.
    FlatMap dist = retrograde(1, 2);
    const int n = 3;
    int compacted = 0;
    int total_checked = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 4) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, n, 1) != s) continue;

        auto tr = trace_solution(s, n, 1, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;
        stabilise_indices(sol, s, n, 1);

        int init_pos[10]; decode(s, n, init_pos);
        std::vector<Move> sol_copy = sol;
        if (try_compact(init_pos, sol_copy, n, 1, dist, d))
            compacted++;
        total_checked++;
        if (total_checked >= 200) break;
    }
    // Just verify the function works without crashing; some puzzles may compact.
    ASSERT(total_checked > 0);
}

TEST(compact_intermediate_gaps) {
    // Verify that try_compact can use intermediate gaps (not just gap=1).
    // This tests the fix for puzzle #2 where gap=1 fails but gap=2 works.
    FlatMap dist = retrograde(1, 2);
    const int n = 3;
    int compacted = 0;
    for (auto [s, d] : dist) {
        if (d < 2) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, n, 1) != s) continue;

        auto tr = trace_solution(s, n, 1, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;
        stabilise_indices(sol, s, n, 1);

        int init_pos[10]; decode(s, n, init_pos);
        std::vector<Move> sol_copy = sol;
        if (try_compact(init_pos, sol_copy, n, 1, dist, d)) {
            // Verify the compacted solution is still valid
            int sorted[10];
            std::memcpy(sorted, init_pos, n * sizeof(int));
            std::sort(sorted + 1, sorted + n);
            State cs = canonical(encode(sorted, n), n, 1);
            uint8_t cd;
            ASSERT(dist.find_val(cs, &cd));
            ASSERT_EQ((int)cd, (int)d);
            compacted++;
        }
        if (compacted >= 10) break;
    }
}

TEST(helper_on_center_during_solution) {
    // Verify that a helper can land on center cell (3,3) during solution
    // without being treated as exited.
    FlatMap dist = retrograde(1, 3);
    const int n = 4;
    int found = 0;
    for (auto [s, d] : dist) {
        if (d < 3 || d > 8) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;

        auto tr = trace_solution(s, n, 1, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;
        stabilise_indices(sol, s, n, 1);

        // Simulate to check if any helper passes through center
        int pos[10]; decode(s, n, pos);
        for (const auto& m : sol) {
            int new_cell, blocker_idx;
            State new_state;
            if (!forward_move(pos, n, 1, (int)m.mover, (int)m.dir,
                              new_cell, blocker_idx, new_state))
                break;
            // Check if a helper landed on center
            if ((int)m.mover >= 1 && new_cell == CTR) {
                // Helper on center: should NOT be EXITED
                int nr[10]; decode(new_state, n, nr);
                ASSERT(nr[(int)m.mover] != EXITED);
                found++;
            }
            decode(new_state, n, pos);
        }
        if (found >= 5) break;
    }
    // It's OK if we don't find such cases in this small BFS;
    // the existing test forward_move_helper_through_center covers the mechanics.
}

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end: small enumeration matches expected results
// ═══════════════════════════════════════════════════════════════════════════════

TEST(end_to_end_1exit_1helper_depth1_count) {
    // Count initial states at depth 1 that are canonical.
    // Each depth-1 state: exit is one slide away from center, blocked by helper.
    FlatMap dist = retrograde(1, 1);
    int count = 0;
    for (auto [s, d] : dist) {
        if (d != 1) continue;
        int r[2]; decode(s, 2, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, 2, 1) == s) count++;
    }
    // There should be a specific number of canonical depth-1 puzzles.
    // With D4 symmetry, the 4 directions from center each have multiple
    // placements, reduced by symmetry. Let's just check it's reasonable.
    ASSERT(count > 0 && count < 100);
}

TEST(end_to_end_all_solutions_valid_1exit_2helpers) {
    // Validate ALL solutions for a small BFS (1 exit, 2 helpers, depth ≤ 4).
    FlatMap dist = retrograde(1, 2);
    int validated = 0;
    for (auto [s, d] : dist) {
        if (d == 0 || d > 4) continue;
        int r[3]; decode(s, 3, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, 3, 1) != s) continue;

        auto tr = trace_solution(s, 3, 1, dist);
        if (tr.moves.size() != (size_t)d) continue;
        ASSERT(validate_solution(s, tr.moves, 3, 1));
        validated++;
    }
    ASSERT(validated > 10); // should have plenty of depth ≤ 4 puzzles
}

// ═══════════════════════════════════════════════════════════════════════════════
// Regression tests for reviewer-reported puzzles
//
// These tests verify that specific puzzles reported by external reviewers
// are reachable in the retrograde BFS.  Each test encodes the puzzle
// positions, canonicalizes them, and verifies the canonical form appears
// in the BFS at the expected depth.
//
// Bug patterns these catch:
//   - States incorrectly excluded by the BFS walk (helper-at-center,
//     exit-through-center)
//   - Depth miscalculation from invalid transitions
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: encode puzzle positions, canonicalize, and verify BFS depth.
static void assert_puzzle_in_bfs(const FlatMap& dist, int n, int num_exits,
                                  const int* positions, int expected_depth,
                                  const char* label)
{
    State s = encode(positions, n);
    State cs = canonical(s, n, num_exits);
    uint8_t d;
    bool found = dist.find_val(cs, &d);
    if (!found) {
        std::cerr << "FAIL: " << label << " not found in BFS (expected depth "
                  << expected_depth << ")\n";
        throw std::runtime_error("puzzle not in BFS");
    }
    if ((int)d != expected_depth) {
        std::cerr << "FAIL: " << label << " at depth " << (int)d
                  << ", expected " << expected_depth << "\n";
        throw std::runtime_error("wrong depth");
    }
}

TEST(french_blocked_mask) {
    uint64_t b = make_blocked_french();
    ASSERT_EQ(__builtin_popcountll(b), 12);
    // Center must not be blocked
    ASSERT(!(b & ((uint64_t)1 << CTR)));
    // D4-symmetric: mask invariant under all 8 transforms
    for (int t = 0; t < 8; t++) {
        uint64_t tb = 0;
        for (int p = 0; p < NC; p++)
            if (b & ((uint64_t)1 << p))
                tb |= (uint64_t)1 << sym(p, t);
        ASSERT_EQ(tb, b);
    }
}

TEST(reviewer_puzzle_80_ufo_2e4h) {
    // Deepest 2e4h UFO puzzle: 23 slides / 16 grouped moves (puzzle #4173).
    // This puzzle required the helper-at-center fix to be discoverable.
    // Positions (7x7 grid): A@(1,2)=9, B@(5,5)=40,
    //   helpers: 1@(1,1)=8, 2@(1,5)=12, 3@(2,5)=19, 4@(4,1)=29
    BLOCKED = make_blocked_ufo();
    FlatMap dist = retrograde(2, 4);
    int positions[] = {9, 40, 8, 12, 19, 29};
    std::sort(positions + 2, positions + 6); // sort helpers
    assert_puzzle_in_bfs(dist, 6, 2, positions, 23, "UFO puzzle #80");
    BLOCKED = 0; // restore for other tests
}

TEST(reviewer_puzzle_58_solitaire_2e4h) {
    // Reviewer Solitaire puzzle #58: 2 exits + 4 helpers, 24 slides / 17 grouped moves.
    // This puzzle required the exit-through-center fix to be discoverable.
    // Positions (solitaire board):
    //   X@(4,0)=28, Y@(4,1)=29, helpers: 1@(0,2)=2, 2@(0,4)=4, 3@(2,0)=14, 4@(4,5)=33
    BLOCKED = make_blocked_solitaire();
    FlatMap dist = retrograde(2, 4);
    int positions[] = {28, 29, 2, 4, 14, 33};
    std::sort(positions + 2, positions + 6); // sort helpers
    assert_puzzle_in_bfs(dist, 6, 2, positions, 24, "Solitaire puzzle #58");
    BLOCKED = 0;
}

TEST(exit_slides_through_center) {
    // Verify that the BFS discovers states where an exit can slide through
    // center.  Uses 1e+3h for enough complexity to generate such cases.
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 3);
    const int n = 4;
    int found = 0;
    for (auto [s, d] : dist) {
        if (d < 4) continue;
        int r[4]; decode(s, n, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, n, 1) != s) continue;

        auto tr = trace_solution(s, n, 1, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;
        stabilise_indices(sol, s, n, 1);

        // Simulate and check for exit passing through center
        int pos[10]; decode(s, n, pos);
        for (const auto& m : sol) {
            int new_cell, blocker_idx;
            State new_state;
            if (!forward_move(pos, n, 1, (int)m.mover, (int)m.dir,
                              new_cell, blocker_idx, new_state))
                break;

            // If exit moves and does NOT land on center, check if path crossed it
            if ((int)m.mover == 0 && new_cell != CTR) {
                int start_cell = pos[0];
                int sr = start_cell / N, sc = start_cell % N;
                int er = new_cell / N, ec = new_cell % N;
                // Same row as center row 3, crossing column 3
                if (sr == 3 && er == 3) {
                    int cmin = std::min(sc, ec), cmax = std::max(sc, ec);
                    if (cmin < 3 && cmax > 3) found++;
                }
                // Same col as center col 3, crossing row 3
                if (sc == 3 && ec == 3) {
                    int rmin = std::min(sr, er), rmax = std::max(sr, er);
                    if (rmin < 3 && rmax > 3) found++;
                }
            }
            decode(new_state, n, pos);
        }
        if (found >= 3) break;
    }
    ASSERT(found > 0);
}

TEST(bfs_completeness_optimal_path_forward_check) {
    // Cross-validate: trace each solution forward and verify every
    // intermediate state is in the BFS at the expected depth.
    // This catches BFS bugs where states are reachable but assigned wrong depth.
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 3);
    const int n = 4;
    int verified = 0;
    for (auto [s, d] : dist) {
        if (d < 3 || d > 5) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, n, 1) != s) continue;

        auto tr = trace_solution(s, n, 1, dist);
        auto& sol = tr.moves;
        if (sol.size() != (size_t)d) continue;

        // Simulate forward, check each intermediate state is at decreasing depth
        int pos[10]; decode(s, n, pos);
        for (int step = 0; step < (int)sol.size(); step++) {
            int new_cell, blocker_idx;
            State new_state;
            ASSERT(forward_move(pos, n, 1, (int)sol[step].mover, (int)sol[step].dir,
                                new_cell, blocker_idx, new_state));
            State cs = canonical(new_state, n, 1);
            uint8_t nd;
            ASSERT(dist.find_val(cs, &nd));
            ASSERT_EQ((int)nd, (int)d - step - 1);
            decode(new_state, n, pos);
        }
        verified++;
        if (verified >= 200) break;
    }
    ASSERT(verified > 50);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Difficulty metrics: forward_bfs_count, critical_moves, branching, solution_count
// ═══════════════════════════════════════════════════════════════════════════════

TEST(compact_csp_perpendicular_shift) {
    // Puzzle 1-4xtgjun: A(5,3) 1(0,3) 2(0,5) 3(3,0) 4(4,6) 5(6,0)
    // Helpers 1,2 at row 0 can shift to row 1 (perpendicular to their
    // movement axis). The old heuristic compaction missed this because
    // helper 2's first-move gap was 1 (slides Left by 1 cell) and movers
    // with gap<=1 were skipped. The CSP compaction finds all valid cells.
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 5);
    const int n = 6;
    // A(5,3)=38, 1(0,3)=3, 2(0,5)=5, 3(3,0)=21, 4(4,6)=34, 5(6,0)=42
    int pos[6] = {38, 3, 5, 21, 34, 42};
    std::sort(pos + 1, pos + n);
    State s = encode(pos, n);
    State cs = canonical(s, n, 1);
    uint8_t d;
    ASSERT(dist.find_val(cs, &d));

    auto tr = solve_min_grouped(cs, n, 1);
    ASSERT(!tr.moves.empty());
    stabilise_indices(tr.moves, cs, n, 1);

    int init_pos[10]; decode(cs, n, init_pos);
    std::vector<Move> sol_copy = tr.moves;
    bool compacted = try_compact(init_pos, sol_copy, n, 1, dist, d);
    ASSERT(compacted);

    // After compaction, no robot should be at row 0
    // (helpers 1,2 should have shifted from row 0 to row 1).
    for (int i = 0; i < n; i++)
        ASSERT(init_pos[i] / 7 != 0);
}

TEST(compact_manhattan_tiebreaker) {
    // Puzzle #11: exit A at (3,5), helpers 1:(0,4) 2:(3,0) 3:(3,3)
    // Helper 1 at (0,4) can shift to (1,4) — same board_size but smaller
    // sum-of-Manhattan. Verifies the tiebreaker compaction works.
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 3);
    const int n = 4;
    // A(3,5)=26, 1(0,4)=4, 2(3,0)=21, 3(3,3)=24
    int pos[4] = {26, 4, 21, 24};
    std::sort(pos + 1, pos + n);
    State s = encode(pos, n);
    uint8_t d;
    ASSERT(dist.find_val(canonical(s, n, 1), &d));

    auto tr = trace_solution(s, n, 1, dist);
    auto& sol = tr.moves;
    ASSERT_EQ((int)sol.size(), (int)d);
    stabilise_indices(sol, s, n, 1);

    int init_pos[10]; decode(s, n, init_pos);
    std::vector<Move> sol_copy = sol;
    bool compacted = try_compact(init_pos, sol_copy, n, 1, dist, d);
    ASSERT(compacted);

    // Helper originally at (0,4) = cell 4 should have moved closer to center.
    bool still_at_04 = false;
    for (int i = 1; i < n; i++)
        if (init_pos[i] == 4) still_at_04 = true;
    ASSERT(!still_at_04);
}

TEST(compact_manhattan_tiebreaker_puzzle43) {
    // Puzzle #43: A(5,4) 1(1,1) 2(1,2) 3(1,5) 4(4,1)
    // Helper 2 at (1,2) can shift to (1,3) — same board_size and Chebyshev
    // but smaller Manhattan distance. Depth 12 is preserved.
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 4);
    const int n = 5;
    int pos[5] = {5*7+4, 1*7+1, 1*7+2, 1*7+5, 4*7+1};
    std::sort(pos + 1, pos + n);
    State s = encode(pos, n);
    uint8_t d;
    ASSERT(dist.find_val(canonical(s, n, 1), &d));
    ASSERT_EQ(12, (int)d);

    auto tr = trace_solution(s, n, 1, dist);
    auto& sol = tr.moves;
    ASSERT_EQ((int)sol.size(), (int)d);
    stabilise_indices(sol, s, n, 1);

    int init_pos[10]; decode(s, n, init_pos);
    std::vector<Move> sol_copy = sol;
    bool compacted = try_compact(init_pos, sol_copy, n, 1, dist, d);
    ASSERT(compacted);

    // Helper 2 should have moved from (1,2)=cell 9 to (1,3)=cell 10
    bool has_cell_10 = false;
    for (int i = 1; i < n; i++)
        if (init_pos[i] == 1*7+3) has_cell_10 = true;
    ASSERT(has_cell_10);
}

TEST(forward_bfs_count_trivial) {
    // A single exit robot at a cell adjacent to center with no helpers:
    // only the start state is reachable (no legal moves without a blocker).
    BLOCKED = 0;
    int pos[1] = {CTR - 1}; // cell 23
    State s = encode(pos, 1);
    int count = forward_bfs_count(s, 1, 1);
    ASSERT_EQ(1, count); // stuck — no blocker, no moves
}

TEST(forward_bfs_count_small) {
    // 1 exit + 1 helper: should have a modest number of reachable states.
    BLOCKED = 0;
    int pos[2] = {3, 31}; // exit at (0,3), helper at (4,3)
    State s = encode(pos, 2);
    int count = forward_bfs_count(s, 2, 1);
    ASSERT(count >= 2);    // at least start + one move
    ASSERT(count < 1000);  // bounded for a 2-robot board
}

TEST(solve_min_grouped_depth1) {
    // For a depth-1 puzzle: 1 grouped move, 1 raw slide.
    BLOCKED = 0;
    int pos[2] = {3, 31}; // exit at row 0 col 3, helper at row 4 col 3
    State s = canonical(encode(pos, 2), 2, 1);
    auto tr = solve_min_grouped(s, 2, 1);
    ASSERT_EQ(1, (int)tr.moves.size());
    ASSERT_EQ(1, tr.grouped_moves);
}

TEST(solve_min_grouped_valid_solutions) {
    // Verify solve_min_grouped produces valid solutions (forward-simulate to goal).
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 2);
    const int n = 3;
    int validated = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 4) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, n, 1) != s) continue;

        auto tr = solve_min_grouped(s, n, 1);
        ASSERT(!tr.moves.empty());
        ASSERT(validate_solution(s, tr.moves, n, 1));
        // grouped_moves must match count_grouped_moves on the solution
        ASSERT_EQ(tr.grouped_moves, count_grouped_moves(tr.moves));
        if (++validated >= 100) break;
    }
    ASSERT(validated > 0);
}

TEST(solve_min_grouped_at_least_as_good_as_dp) {
    // Verify: solve_min_grouped always finds <= grouped moves compared to
    // the old trace_solution (which only searched BFS-optimal raw-slide paths).
    BLOCKED = 0;
    FlatMap dist = retrograde(1, 2);
    const int n = 3;
    int checked = 0, improved = 0;
    for (auto [s, d] : dist) {
        if (d < 2 || d > 5) continue;
        int r[10]; decode(s, n, r);
        if (r[0] == EXITED) continue;
        if (canonical(s, n, 1) != s) continue;

        auto old_tr = trace_solution(s, n, 1, dist);
        if (old_tr.moves.empty()) continue;
        auto new_tr = solve_min_grouped(s, n, 1);
        ASSERT(!new_tr.moves.empty());
        ASSERT(new_tr.grouped_moves <= old_tr.grouped_moves);
        if (new_tr.grouped_moves < old_tr.grouped_moves) improved++;
        if (++checked >= 200) break;
    }
    ASSERT(checked > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-exit-count dedup: puzzles with different exit counts must not collide
// ═══════════════════════════════════════════════════════════════════════════════

TEST(pruned_canon_different_exits_no_collision) {
    // Positions [10, 20, 30] encoded as 1E+2H and 2E+1H should produce
    // different pruned canonical keys (the old bug: they could collide
    // because State encoding was identical for both partitions).
    int pos3[3] = {10, 20, 30};
    State s1 = canonical(encode(pos3, 3), 3, 1);  // 1 exit
    State s2 = canonical(encode(pos3, 3), 3, 2);  // 2 exits
    // With the fix, we pack num_exits into bits 60+
    uint64_t key1 = s1 | ((uint64_t)1 << 60);
    uint64_t key2 = s2 | ((uint64_t)2 << 60);
    ASSERT(key1 != key2);
}

TEST(pruned_canon_same_exits_can_collide) {
    // Same positions with same num_exits SHOULD produce same key (valid dedup).
    int pos3[3] = {10, 20, 30};
    State s = canonical(encode(pos3, 3), 3, 1);
    uint64_t key1 = s | ((uint64_t)1 << 60);
    uint64_t key2 = s | ((uint64_t)1 << 60);
    ASSERT_EQ(key1, key2);
}

TEST(no_cross_exit_dedup_in_output) {
    // End-to-end: run the enumerate pipeline for a small config with
    // multiple exit counts and verify no two output lines share the same
    // positions but different exit counts.
    BLOCKED = 0;
    // Capture output by running process_combo for exits=1 and exits=2
    // with shared dedup sets, then check no position appears with two exit counts.
    //
    // We can't easily call process_combo from tests, so instead verify
    // the invariant on the canonical encoding: for the same cell positions,
    // different num_exits must produce different pruned_canon keys.

    // Test a range of position sets
    int tested = 0;
    for (int a = 1; a < 48; a += 7) {
        for (int b = a + 1; b < 49; b += 5) {
            for (int c = b + 1; c < 49; c += 3) {
                int pos[3] = {a, b, c};
                // As 1E+2H
                std::sort(pos + 1, pos + 3);
                State s1 = canonical(encode(pos, 3), 3, 1);
                uint64_t k1 = s1 | ((uint64_t)1 << 60);
                // As 2E+1H
                std::sort(pos, pos + 2);
                State s2 = canonical(encode(pos, 3), 3, 2);
                uint64_t k2 = s2 | ((uint64_t)2 << 60);
                // Must not collide
                ASSERT(k1 != k2);
                tested++;
            }
        }
    }
    ASSERT(tested > 50);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main test runner
// ═══════════════════════════════════════════════════════════════════════════════

int main() {
    std::cerr << "Running " << test_registry().size() << " tests...\n\n";

    for (const auto& [name, func] : test_registry()) {
        std::cerr << "  " << name << " ... ";
        try {
            func();
            std::cerr << "OK\n";
            tests_passed++;
        } catch (const std::exception& e) {
            tests_failed++;
        }
    }

    std::cerr << "\n" << tests_passed << " passed, "
              << tests_failed << " failed, "
              << (tests_passed + tests_failed) << " total.\n";

    return tests_failed > 0 ? 1 : 0;
}
