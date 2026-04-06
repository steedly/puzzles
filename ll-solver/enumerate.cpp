// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// enumerate.cpp — Lunar Lockout puzzle enumerator
//
// Finds every canonically unique, solvable starting position on a board
// with E = 1..max_exits exit robots and H = 0..max_helpers helper robots,
// deduplicates by collision signature, and writes them as a compact .llp file.
//
// Game Mechanics
// --------------
// Robots slide in cardinal directions until blocked by another robot (wall
// stops are illegal — every move must be blocked by a robot).
// Exit robots: when one slides onto the center cell (3,3) it DISAPPEARS from
// the board (exits the puzzle).  Win condition: all exit robots have exited.
// Helper robots: blockers only; they never exit.
//
// Pipeline (for each exit/helper combination)
// -------------------------------------------
//   1. Retrograde BFS     — Starting from all goal states (every exit EXITED),
//                            explore backwards to discover every solvable config.
//                            Each state gets a "depth" = minimum individual slides
//                            to reach the goal.
//   2. Canonical filter   — Scan BFS states, keep only self-canonical ones
//                            (S == canonical(S)) under D4 symmetry + exit-label
//                            permutation.  No separate hash map needed because the
//                            BFS is D4-closed (goal set and transitions are both
//                            D4-symmetric), so canonical(S) is always reachable
//                            with the same distance as S.
//   3. Greedy dedup       — Fast greedy trace → collision signature hash.
//                            Deduplicate puzzles whose collision sequences match.
//   4. DP trace + output  — For surviving puzzles only, find the solution with
//                            minimum grouped moves via layer-by-layer DP, then
//                            write one line per unique puzzle to stdout.
//
// State Encoding
// --------------
// Cells are indexed 0–48 row-major (cell = row*7+col).
// A state is a uint64_t: 6 bits per robot.
//   Bits[0..6*E-1]       : exit robots 0..E-1 (not sorted).
//                          63 = EXITED sentinel (robot has left the board).
//   Bits[6*E..6*(E+H)-1] : helper robots, always SORTED by cell index.
// Supports up to 10 robots total (60 bits).
//
// Output Format (.llp)
// --------------------
//   id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
//   groupedMoves: minimum grouped moves (consecutive same-robot slides = 1 move)
//                 globally optimal — may use more raw slides than minimum
//   rawSlides:    number of individual slides in the grouped-optimal solution
//   minRawSlides: minimum possible individual slides (retrograde BFS depth)
//   forwardStates: total reachable board states from start position
//   positions: exit0_r,c [exit1_r,c ...] [helper_r,c ...]
//   solution: space-separated moves, each = moverDIRblocker
//     A,B,C = exit robots (by ascending initial position)
//     1-9   = helper robots (by ascending initial position)
//     DIR: U=up D=down L=left R=right
//
// Build
// -----
//   Linux / g++:
//     g++ -O3 -std=c++17 -fopenmp -o enumerate enumerate.cpp
//
//   macOS / Apple Clang (requires: brew install libomp):
//     g++ -O3 -std=c++17 -Xpreprocessor -fopenmp
//         -I$(brew --prefix libomp)/include
//         -L$(brew --prefix libomp)/lib -lomp
//         -o enumerate enumerate.cpp
//
//   Without OpenMP (slower canonicalisation step):
//     g++ -O3 -std=c++17 -o enumerate enumerate.cpp
//
// Usage
// -----
//   ./enumerate [max_exits=1] [max_total=6] [min_moves=1] [max_moves=99] [variant=standard]
//     max_exits : maximum number of exit robots (default 1)
//     max_total : maximum total robots = exits + helpers (default 6)
//                 helpers = total - exits; helpers may be 0
//     variant   : board variant — standard (7x7), solitaire (7x7 corners blocked),
//                 or ufo (5x5 center only). Default: standard.
//   Puzzle data goes to stdout; progress/stats go to stderr.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <climits>
#include <cstdint>
#include <deque>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <numeric>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#ifdef _OPENMP
#  include <omp.h>
#endif

// ── Board type ───────────────────────────────────────────────────────────────
enum BoardType { BOARD_SQUARE, BOARD_HEX };
static BoardType BOARD_TYPE = BOARD_SQUARE;

// ── Board constants (set once in main() before any BFS runs) ─────────────────
// Square boards: N=7, 4 directions (up/down/left/right), D4 symmetry (8).
// Hex boards:    N=7, 6 directions (+2 diagonals), 4 symmetries {id, 180°, diag, anti-diag}.
static int N      = 7;
static int NC     = 49;    // N * N
static int CTR    = 24;    // center cell = (N/2)*N + N/2
static constexpr int EXITED = 63;      // exit-robot "off board" sentinel

static int NUM_DIRS = 4;   // 4 for square, 6 for hex
static int NUM_SYMS = 8;   // 8 for square (D4), 4 for hex (Klein four-group)

// Directions: first 4 are up/down/left/right (shared by square and hex).
// Hex adds indices 4 and 5: "north" diagonal (-1,+1) and "south" diagonal (+1,-1).
static int DR[6] = {-1, 1, 0, 0, -1,  1};
static int DC[6] = { 0, 0,-1, 1,  1, -1};

// Symmetry transform indices (into the D4 sym() function).
// Square: all 8 D4 transforms.
// Hex: Klein four-group = {identity(0), 180°(2), diag(6), anti-diag(7)}.
static int SYM_INDICES[8] = {0,1,2,3,4,5,6,7};

// Direction permutation tables under symmetry transforms.
// Square: DIR_TRANSFORM[8][4] — how each of 8 D4 transforms permutes 4 dirs.
// Hex: HEX_DIR_TRANSFORM[4][6] — how each of 4 Klein transforms permutes 6 dirs.
// Directions: 0=up 1=down 2=left 3=right (square) or
//             0=NW 1=SE 2=SW 3=NE 4=N-diag 5=S-diag (hex, same DR/DC indices)

// ── Board variant (blocked cells) ────────────────────────────────────────────
// Bitmask of cells that are walls — robots cannot occupy or slide through them.
// Set once in main() before any BFS runs; 0 = standard 7x7 or any hex.
static uint64_t BLOCKED = 0;

static uint64_t make_blocked_solitaire() {
    // 2x2 corners: (0,0)(0,1)(1,0)(1,1) and 3 symmetric copies
    uint64_t b = 0;
    for (int r : {0,1,5,6})
        for (int c : {0,1,5,6})
            b |= (uint64_t)1 << (r*N+c);
    return b;
}

static uint64_t make_blocked_ufo() {
    // All border cells (row 0,6 or col 0,6)
    uint64_t b = 0;
    for (int r = 0; r < N; r++)
        for (int c = 0; c < N; c++)
            if (r == 0 || r == N-1 || c == 0 || c == N-1)
                b |= (uint64_t)1 << (r*N+c);
    return b;
}

static uint64_t make_blocked_french() {
    // 3 cells per corner: corner + 2 neighbors (12 total)
    uint64_t b = 0;
    for (auto [r, c] : {std::pair{0,0},{0,1},{1,0},
                         std::pair{0,6},{0,5},{1,6},
                         std::pair{6,0},{6,1},{5,0},
                         std::pair{6,6},{6,5},{5,6}})
        b |= (uint64_t)1 << (r*N+c);
    return b;
}

// ── Symmetry group ───────────────────────────────────────────────────────────
// The dihedral group D4 has 8 elements: 4 rotations × {identity, reflection}.
// sym(cell, transform) returns the cell after applying one transform.
// For hex boards, only transforms {0,2,6,7} are valid (Klein four-group).
static inline int sym(int p, int t) {
    const int r = p/N, c = p%N, m = N-1;
    switch (t) {
        case 0: return  r*N+c;           // identity
        case 1: return  c*N+(m-r);       // 90° clockwise
        case 2: return (m-r)*N+(m-c);    // 180°
        case 3: return (m-c)*N+r;        // 270° clockwise
        case 4: return  r*N+(m-c);       // reflect horizontally
        case 5: return (m-r)*N+c;        // reflect vertically
        case 6: return  c*N+r;           // reflect across main diagonal
        case 7: return (m-c)*N+(m-r);    // reflect across anti-diagonal
        default: return -1;
    }
}

// ── State encoding ────────────────────────────────────────────────────────────
using State = uint64_t;

static inline State encode(const int* r, int n) {
    State s = 0;
    for (int i = 0; i < n; i++) s |= (State)r[i] << (6*i);
    return s;
}

static inline void decode(State s, int n, int* r) {
    for (int i = 0; i < n; i++) r[i] = (int)((s >> (6*i)) & 63);
}

// Canonical form: lex-min encoding over all symmetry transforms.
// Both exits and helpers are sorted after each transform so that:
//   - spatial symmetries are removed, AND
//   - permutations of exit pieces map to the same canonical form.
// EXITED (63) is larger than any valid cell (0-48), so exited robots
// naturally sort last.
// Square: 8 D4 transforms.  Hex: 4 Klein four-group transforms.
static State canonical(State s, int n, int num_exits) {
    int r[10];
    decode(s, n, r);
    State best = ~(State)0;
    for (int ti = 0; ti < NUM_SYMS; ti++) {
        const int t = SYM_INDICES[ti];
        int tr[10];
        for (int e = 0; e < num_exits; e++)
            tr[e] = (r[e] == EXITED) ? EXITED : sym(r[e], t);
        for (int h = num_exits; h < n; h++)
            tr[h] = sym(r[h], t);
        std::sort(tr,            tr + num_exits); // exits sorted  (exit-perm dedup)
        std::sort(tr + num_exits, tr + n);        // helpers sorted (existing dedup)
        const State e = encode(tr, n);
        if (e < best) best = e;
    }
    return best;
}

// ── Fast flat hash map: State → uint8_t ──────────────────────────────────────
// Open addressing with linear probing, load factor ≤ 75%.
//
// Memory layout: key and value are PACKED into a single uint64_t per slot.
//   bits [0,      key_bits) : state key  (6 × n_robots bits)
//   bits [key_bits, key_bits+8) : depth value (uint8_t, 0–254)
//   bits [key_bits+8, 63]   : always zero in valid entries
//
// This requires key_bits ≤ 56 (i.e. n ≤ 9 robots).  For n=7 (key_bits=42)
// each slot costs 8 bytes vs. the old 9-byte two-array layout — an 11% saving
// that also improves cache locality because key and value share one cache line.
//
// EMPTY sentinel = ~0ULL: safe because valid packed values have at least the
// top 2 bits (62–63) zero, while EMPTY has all bits set. ✓
//
// For n > 9 the program prints an error and exits at construction time.
struct FlatMap {
    static constexpr uint64_t EMPTY = ~(uint64_t)0;

    uint64_t* data_     = nullptr;
    size_t    cap_      = 0;
    size_t    sz_       = 0;
    uint64_t  km_       = 0;   // key mask = (1ULL << key_bits) - 1
    int       key_bits_ = 0;

    explicit FlatMap(int key_bits) : km_(((uint64_t)1 << key_bits) - 1), key_bits_(key_bits) {
        if (key_bits > 56) {
            std::cerr << "FlatMap: key_bits=" << key_bits
                      << " requires n > 9 robots; packed format only supports n ≤ 9.\n";
            std::exit(1);
        }
    }
    ~FlatMap() { std::free(data_); }
    FlatMap(const FlatMap&)            = delete;
    FlatMap& operator=(const FlatMap&) = delete;
    FlatMap(FlatMap&& o) noexcept
        : data_(o.data_), cap_(o.cap_), sz_(o.sz_), km_(o.km_), key_bits_(o.key_bits_)
    { o.data_ = nullptr; o.cap_ = o.sz_ = 0; }

    size_t size() const { return sz_; }
    size_t cap()  const { return cap_; }

    // Pack key + val into one word.
    uint64_t pack(uint64_t k, uint8_t v) const { return k | ((uint64_t)v << key_bits_); }

    // Ensure the table can hold at least n entries without rehashing.
    void reserve(size_t n) {
        size_t c = 16;
        while (c * 3 < n * 4) c <<= 1;
        if (c > cap_) rehash(c);
    }

    // Insert (k, v) if absent.  Returns true if newly inserted.
    bool insert_new(uint64_t k, uint8_t v) {
        if (__builtin_expect(sz_ * 4 >= cap_ * 3, 0))
            rehash(cap_ ? cap_ * 2 : 16);
        size_t h = hash(k) & (cap_ - 1);
        while (data_[h] != EMPTY && (data_[h] & km_) != k)
            h = (h + 1) & (cap_ - 1);
        if (data_[h] != EMPTY) return false;
        data_[h] = pack(k, v); ++sz_;
        return true;
    }

    // Find k; if found sets *val and returns true.
    bool find_val(uint64_t k, uint8_t* val) const {
        if (!cap_) return false;
        size_t h = hash(k) & (cap_ - 1);
        while (data_[h] != EMPTY && (data_[h] & km_) != k)
            h = (h + 1) & (cap_ - 1);
        if (data_[h] == EMPTY) return false;
        *val = (uint8_t)(data_[h] >> key_bits_);
        return true;
    }

    // Forward iterator — yields (key, value) pairs, skipping empty slots.
    struct Iter {
        const FlatMap* m; size_t i;
        bool operator!=(const Iter& o) const { return i != o.i; }
        Iter& operator++() {
            do ++i; while (i < m->cap_ && m->data_[i] == EMPTY);
            return *this;
        }
        std::pair<uint64_t, uint8_t> operator*() const {
            return {m->data_[i] & m->km_, (uint8_t)(m->data_[i] >> m->key_bits_)};
        }
    };
    Iter begin() const {
        size_t i = 0;
        while (i < cap_ && data_[i] == EMPTY) ++i;
        return {this, i};
    }
    Iter end() const { return {this, cap_}; }

    // Lock-free insert for use inside a parallel region.
    // Key and value are committed in a single CAS — no window where key is
    // visible but value is not (improvement over the old two-array design).
    // Caller must have called ensure_parallel_capacity() first.
    bool atomic_emplace(uint64_t k, uint8_t v) {
        const uint64_t packed = pack(k, v);
        size_t h = hash(k) & (cap_ - 1);
        for (;;) {
            uint64_t expected = EMPTY;
            if (__atomic_compare_exchange_n(
                    &data_[h], &expected, packed,
                    /*weak=*/false, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
                __atomic_fetch_add(&sz_, (size_t)1, __ATOMIC_RELAXED);
                return true;
            }
            if ((expected & km_) == k) return false; // already present
            h = (h + 1) & (cap_ - 1);
        }
    }

    // Ensure capacity for `needed` entries before entering a parallel section.
    void ensure_parallel_capacity(size_t needed) {
        size_t c = cap_ ? cap_ : 16;
        while (c * 3 < needed * 4) c <<= 1;
        if (c > cap_) rehash(c);
    }

private:
    static size_t hash(uint64_t k) {
        k = (k ^ (k >> 30)) * 0xbf58476d1ce4e5b9ULL;
        k = (k ^ (k >> 27)) * 0x94d049bb133111ebULL;
        return (size_t)(k ^ (k >> 31));
    }
    void rehash(size_t new_cap) {
        uint64_t* old = data_; size_t oc = cap_;
        data_ = (uint64_t*)std::malloc(new_cap * sizeof(uint64_t));
        std::fill(data_, data_ + new_cap, EMPTY);
        cap_ = new_cap;
        for (size_t i = 0; i < oc; i++) {
            if (old[i] == EMPTY) continue;
            uint64_t k = old[i] & km_;
            size_t h = hash(k) & (new_cap - 1);
            while (data_[h] != EMPTY) h = (h + 1) & (new_cap - 1);
            data_[h] = old[i];
        }
        std::free(old);
    }
};

// ── Normal reverse-move generation ───────────────────────────────────────────
// Generates predecessor states by sliding robot ridx BACKWARD from its current
// position.  Takes a pre-decoded position array r[] and occupancy bitmask occ
// that already excludes ridx (caller computes this once and passes it in).
// Exits are not sorted; helpers are sorted after the move.
static void reverse_moves_normal(const int* r, int n, int num_exits, int ridx,
                                  uint64_t occ, std::vector<State>& out)
{
    const int pos = r[ridx];

    const int pr = pos/N, pc = pos%N;

    for (int d = 0; d < NUM_DIRS; d++) {
        // ridx was slid in direction d to reach pos.
        // There must be a blocker one step past pos in direction d.
        const int br = pr + DR[d], bc = pc + DC[d];
        if (br < 0 || br >= N || bc < 0 || bc >= N) continue;
        const int bp = br*N+bc;
        if (BLOCKED & ((uint64_t)1 << bp)) continue; // blocker can't be on a wall
        if (!(occ & ((uint64_t)1 << bp))) continue;

        // Walk backward (opposite direction) to find valid starting positions.
        int wr = pr, wc = pc;
        for (;;) {
            wr -= DR[d]; wc -= DC[d];
            if (wr < 0 || wr >= N || wc < 0 || wc >= N) break;
            const int wp = wr*N+wc;
            if (BLOCKED & ((uint64_t)1 << wp)) break; // wall stops walk
            if (occ & ((uint64_t)1 << wp)) break;

            // Center cell (CTR) handling for exits:
            //   In the forward game, an exit that LANDS on center exits
            //   immediately.  But an exit that merely PASSES THROUGH center
            //   (center is unoccupied and the exit continues past it to pos)
            //   does NOT exit.  So:
            //     - Exit at CTR: SKIP emitting (exit starting at center is
            //       a degenerate puzzle, and arriving at center = exit).
            //       But CONTINUE walking — positions beyond center are valid
            //       predecessors where the exit slides through center.
            //     - Helper at CTR: valid intermediate state — helper may
            //       temporarily occupy center and be moved away before an
            //       exit needs to reach it.  Emit and continue.
            if (wp == CTR && ridx < num_exits) continue; // skip CTR, keep walking

            int nr[10];
            std::memcpy(nr, r, n * sizeof(int));
            nr[ridx] = wp;
            // Sort helpers (not exits).
            std::sort(nr + num_exits, nr + n);
            out.push_back(encode(nr, n));
        }
    }
}

// ── Un-exit reverse-move generation ──────────────────────────────────────────
// Generates predecessor states by "un-exiting" an exited exit robot ridx:
// places it back on the board at a position from which it would have slid to
// the center cell and exited.
// Takes a pre-decoded position array r[] and full occupancy occ (ridx is
// EXITED so it contributes nothing to occ — caller already excludes it).
static void reverse_moves_unexit(const int* r, int n, int num_exits, int ridx,
                                  uint64_t occ, std::vector<State>& out)
{
    // Center must be unoccupied by other pieces (exit ridx will be placed there).
    if (occ & ((uint64_t)1 << CTR)) return;

    const int ctr_r = CTR / N, ctr_c = CTR % N;
    for (int d = 0; d < NUM_DIRS; d++) {
        // ridx slid in direction d to reach center.
        // A blocker must exist one step past center in direction d.
        const int blr = ctr_r + DR[d], blc = ctr_c + DC[d];
        if (blr < 0 || blr >= N || blc < 0 || blc >= N) continue;
        const int blocker_cell = blr*N+blc;
        if (BLOCKED & ((uint64_t)1 << blocker_cell)) continue; // blocker can't be on a wall
        if (!(occ & ((uint64_t)1 << blocker_cell))) continue;

        // Walk AWAY from center (opposite of d) to find valid starting positions.
        // ridx was at (ctr_r - k*DR[d], ctr_c - k*DC[d]) for k = 1, 2, ...
        for (int k = 1; ; k++) {
            const int wr = ctr_r - k*DR[d], wc = ctr_c - k*DC[d];
            if (wr < 0 || wr >= N || wc < 0 || wc >= N) break;
            const int wp = wr*N+wc;
            if (BLOCKED & ((uint64_t)1 << wp)) break; // wall stops walk
            if (occ & ((uint64_t)1 << wp)) break; // path blocked

            int nr[10];
            std::memcpy(nr, r, n * sizeof(int));
            nr[ridx] = wp;
            // Exits not sorted; sort helpers.
            std::sort(nr + num_exits, nr + n);
            out.push_back(encode(nr, n));
        }
    }
}

// ── Predecessor generation (shared by parallel and serial BFS) ───────────────
// Decodes state s, computes occupancy, and appends all predecessor states
// (one reverse slide per robot × direction) to `preds`.
static void generate_predecessors(State s, int n, int num_exits,
                                   std::vector<State>& preds)
{
    int r[10];
    decode(s, n, r);

    // Build occupancy bitmask (one bit per occupied cell).
    // EXITED robots (pos == 63) are off the board, so skip them.
    uint64_t full_occ = 0;
    for (int j = 0; j < n; j++)
        if (r[j] != EXITED) full_occ |= (uint64_t)1 << r[j];

    for (int ridx = 0; ridx < n; ridx++) {
        if (ridx < num_exits && r[ridx] == EXITED) {
            // Un-exit: place this exited robot back on the board.
            reverse_moves_unexit(r, n, num_exits, ridx, full_occ, preds);
        } else {
            // Normal reverse slide: exclude this robot from occupancy.
            const uint64_t occ = full_occ ^ ((uint64_t)1 << r[ridx]);
            reverse_moves_normal(r, n, num_exits, ridx, occ, preds);
        }
    }
}

// ── Retrograde BFS ────────────────────────────────────────────────────────────
static FlatMap retrograde(int num_exits, int num_helpers)
{
    const int n = num_exits + num_helpers;

    // key_bits = 6 bits × n robots; packed FlatMap requires n ≤ 9.
    FlatMap dist(6 * n);

    // Pool of valid non-center cells for helpers (helpers never exit).
    std::vector<int> pool;
    pool.reserve(NC - 1);
    for (int i = 0; i < NC; i++)
        if (i != CTR && !(BLOCKED & ((uint64_t)1 << i))) pool.push_back(i);
    const int P = (int)pool.size();

    std::vector<State> cur;

    // Seed: only D4-canonical goal states (all exits EXITED, helpers at
    // every valid combination).  Canonical BFS explores ~1/8th the states.
    // Reserve for C(P, num_helpers)/4 ≈ 2× the canonical seed count.
    {
        size_t seed_est = 1;
        for (int i = 0; i < num_helpers; i++) {
            seed_est = seed_est * (size_t)(P - i) / (size_t)(i + 1);
            if (seed_est > (size_t)1 << 28) { seed_est = (size_t)1 << 28; break; }
        }
        dist.reserve(std::max(seed_est / 4, (size_t)1 << 20));
    }

    // Enumerate all C(P, num_helpers) combinations of helper placements.
    // Only self-canonical states are seeded; the rest are D4-equivalent.
    {
        int chosen[9] = {};
        std::function<void(int,int)> seed = [&](int start, int rem) {
            if (rem == 0) {
                int pos[10];
                for (int e = 0; e < num_exits; e++) pos[e] = EXITED;
                for (int h = 0; h < num_helpers; h++) pos[num_exits + h] = chosen[h];
                const State s = encode(pos, n);
                if (canonical(s, n, num_exits) != s) return; // skip non-canonical
                dist.insert_new(s, (uint8_t)0);
                cur.push_back(s);
                return;
            }
            for (int i = start; i <= P - rem; i++) {
                chosen[num_helpers - rem] = pool[i];
                seed(i+1, rem-1);
            }
        };
        seed(0, num_helpers);
    }

    std::cerr << "  seeded " << cur.size() << " goal states\n";

    std::vector<State> nxt;

#ifdef _OPENMP
    // Parallel BFS using lock-free atomic_emplace on FlatMap.
    //
    // Before each level we call ensure_parallel_capacity() to guarantee the
    // table won't exceed 75% load.  Thread-local nxt vectors are merged after
    // each level to avoid contention on a shared vector.
    const int nthreads = omp_get_max_threads();
    std::vector<std::vector<State>> nxt_locals(nthreads);

    for (int depth = 1; !cur.empty(); ++depth) {
        // Serial grow check before parallel section.
        // Reserve for current entries + 2× frontier (actual new discoveries
        // per level are almost always less than frontier size).
        dist.ensure_parallel_capacity(dist.size() + (size_t)cur.size() * 2);

        for (auto& v : nxt_locals) v.clear();

        // Only spawn threads when the frontier is large enough to amortize
        // thread-launch and memory-synchronization overhead.
        #pragma omp parallel if(cur.size() >= 65536)
        {
            const int tid = omp_get_thread_num();
            std::vector<State>& my_nxt = nxt_locals[tid];
            std::vector<State> preds;
            preds.reserve(64);

            #pragma omp for schedule(dynamic, 256)
            for (int i = 0; i < (int)cur.size(); i++) {
                preds.clear();
                generate_predecessors(cur[i], n, num_exits, preds);
                for (const State pred : preds) {
                    const State cpred = canonical(pred, n, num_exits);
                    if (dist.atomic_emplace(cpred, (uint8_t)depth))
                        my_nxt.push_back(cpred);
                }
            }
        }

        nxt.clear();
        for (auto& v : nxt_locals) nxt.insert(nxt.end(), v.begin(), v.end());

        if (!nxt.empty())
            std::cerr << "  depth " << depth
                      << ": frontier=" << nxt.size()
                      << "  total=" << dist.size() << "\n";
        cur.swap(nxt);
        if (depth == 254) break;
    }
#else
    // Serial BFS (single-threaded fallback).
    std::vector<State> preds;
    preds.reserve(64);

    for (int depth = 1; !cur.empty(); ++depth) {
        nxt.clear();
        for (const State s : cur) {
            preds.clear();
            generate_predecessors(s, n, num_exits, preds);
            for (const State pred : preds) {
                const State cpred = canonical(pred, n, num_exits);
                if (dist.insert_new(cpred, (uint8_t)depth))
                    nxt.push_back(cpred);
            }
        }
        if (!nxt.empty())
            std::cerr << "  depth " << depth
                      << ": frontier=" << nxt.size()
                      << "  total=" << dist.size() << "\n";
        cur.swap(nxt);
        if (depth == 254) break;
    }
#endif

    return dist;
}

// ── Forward-move simulation ───────────────────────────────────────────────────
// Slides robot ridx in direction dir from persistent positions pos[].
// Exit robots: position becomes EXITED if they land on center.
// Returns true if the move is legal (stopped by a robot, actually moved).
// new_state has helpers sorted; exits maintain their fixed indices.
static bool forward_move(const int* pos, int n, int num_exits, int ridx, int dir,
                         int& new_cell, int& blocker_idx, State& new_state)
{
    if (ridx < num_exits && pos[ridx] == EXITED) return false; // already exited

    const int cur = pos[ridx];
    const int pr  = cur / N, pc = cur % N;

    uint64_t occ = 0;
    for (int i = 0; i < n; i++)
        if (i != ridx && pos[i] != EXITED) occ |= (uint64_t)1 << pos[i];

    int wr = pr, wc = pc;
    int blocker_cell = -1;

    while (true) {
        int nr = wr + DR[dir], nc = wc + DC[dir];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) break; // wall = illegal
        int np = nr * N + nc;
        if (BLOCKED & ((uint64_t)1 << np)) break;         // blocked cell = wall
        if (occ & ((uint64_t)1 << np)) { blocker_cell = np; break; }
        wr = nr; wc = nc;
    }

    if (blocker_cell < 0)             return false; // wall stop (or blocked cell)
    if (wr == pr && wc == pc)         return false; // no movement

    blocker_idx = -1;
    for (int i = 0; i < n; i++)
        if (i != ridx && pos[i] == blocker_cell) { blocker_idx = i; break; }
    if (blocker_idx < 0) return false;

    new_cell = wr * N + wc;

    int tmp[10];
    std::memcpy(tmp, pos, n * sizeof(int));
    // Exit landing on center: set EXITED sentinel.
    if (ridx < num_exits && new_cell == CTR)
        tmp[ridx] = EXITED;
    else
        tmp[ridx] = new_cell;
    // Sort helpers only; exits keep fixed order.
    std::sort(tmp + num_exits, tmp + n);
    new_state = encode(tmp, n);

    return true;
}

// ── Solution tracing (minimum grouped moves) ────────────────────────────────
//
// Given a start state whose retrograde distance is D (minimum individual
// slides to reach the goal), find the solution path that minimises the number
// of "grouped" moves — consecutive slides by the same robot count as one move.
//
// Algorithm: layer-by-layer DP on the distance-decreasing DAG.
//   Augmented state = (board_positions, last_mover_cell).
//   Layer k contains all augmented states reachable from start in exactly k
//   individual slides (retrograde dist = D-k).  Within each layer we keep
//   only the minimum grouped cost per augmented state.
//   Cost of a slide: 0 if the same robot continues, 1 if a new robot moves.
//
// "Same robot" is identified by cell: the previous mover's landing cell must
// equal the current mover's starting cell.  This is correct even when helpers
// are re-sorted internally, unlike an index-based comparison.
//
// This is much cheaper than augmenting the retrograde BFS itself (which
// would multiply memory by n) because it only explores states reachable
// from a single starting position.

struct Move { int8_t mover, dir, blocker; };

// Forward declaration (defined below, near output emitter).
static int count_grouped_moves(const std::vector<Move>& sol);

struct TraceResult {
    std::vector<Move> moves;
    int grouped_moves;     // minimum grouped moves (global optimum via 0-1 BFS)
};

static TraceResult trace_solution(State start, int n, int num_exits,
                                   const FlatMap& dist)
{
    uint8_t start_dist;
    if (!dist.find_val(start, &start_dist) || start_dist == 0) return {{}, 0};
    const int D = (int)start_dist;

    struct Node {
        State    s;
        int8_t   last_mover_cell; // cell the last mover landed on; 63 = none/EXITED
        int      grouped_cost;    // minimum grouped moves to reach here
        int      prev_idx;        // index in previous layer (-1 for start)
        Move     move;            // the slide that got us here
    };

    // One layer per individual slide (0 = start, D = goal).
    std::vector<std::vector<Node>> layers(D + 1);
    layers[0].push_back({start, (int8_t)EXITED, 0, -1, {-1, -1, -1}});

    // Pack (state, last_mover_cell) into a collision-free uint64_t key.
    // State occupies bits [0, 6*n); last_mover_cell (0-63) uses 6 bits.
    const int shift = 6 * n;
    auto make_key = [shift](State s, int cell) -> uint64_t {
        return s | ((uint64_t)(unsigned)cell << shift);
    };

    for (int step = 0; step < D; step++) {
        // Map from augmented key → index in layers[step+1] (for dedup).
        std::unordered_map<uint64_t, int> next_map;
        const uint8_t target_dist = (uint8_t)(start_dist - step - 1);

        for (int i = 0; i < (int)layers[step].size(); i++) {
            const Node& node = layers[step][i];
            int pos[10];
            decode(node.s, n, pos);

            for (int ridx = 0; ridx < n; ridx++) {
                for (int d = 0; d < NUM_DIRS; d++) {
                    int new_cell, blocker_idx;
                    State new_state;
                    if (!forward_move(pos, n, num_exits, ridx, d,
                                      new_cell, blocker_idx, new_state))
                        continue;
                    uint8_t nd;
                    if (!dist.find_val(canonical(new_state, n, num_exits), &nd)
                        || nd != target_dist)
                        continue;

                    // Same-robot test: does this mover's current cell match
                    // the previous mover's landing cell?
                    const int mover_cell = pos[ridx];
                    const int cost = node.grouped_cost +
                                     (mover_cell == (int)node.last_mover_cell ? 0 : 1);

                    // Landing cell for the augmented state key.
                    const int landing = (ridx < num_exits && new_cell == CTR)
                                        ? EXITED : new_cell;
                    const Move mv{(int8_t)ridx, (int8_t)d, (int8_t)blocker_idx};
                    const uint64_t key = make_key(new_state, landing);

                    auto it = next_map.find(key);
                    if (it == next_map.end()) {
                        next_map[key] = (int)layers[step + 1].size();
                        layers[step + 1].push_back(
                            {new_state, (int8_t)landing, cost, i, mv});
                    } else if (cost < layers[step + 1][it->second].grouped_cost) {
                        layers[step + 1][it->second] =
                            {new_state, (int8_t)landing, cost, i, mv};
                    }
                }
            }
        }
    }

    // Find the goal augmented state with minimum grouped cost.
    int best_idx = -1, best_cost = INT_MAX;
    for (int i = 0; i < (int)layers[D].size(); i++) {
        if (layers[D][i].grouped_cost < best_cost) {
            best_cost = layers[D][i].grouped_cost;
            best_idx  = i;
        }
    }
    if (best_idx < 0) return {{}, 0};

    // Walk back through layers to reconstruct the move sequence.
    std::vector<Move> sol;
    sol.reserve(D);
    int idx = best_idx;
    for (int step = D; step > 0; step--) {
        sol.push_back(layers[step][idx].move);
        idx = layers[step][idx].prev_idx;
    }
    std::reverse(sol.begin(), sol.end());
    int gm = count_grouped_moves(sol);
    return {std::move(sol), gm};
}

// ── Forward BFS: count all reachable states from a starting position ─────────
static int forward_bfs_count(State start, int n, int num_exits) {
    std::unordered_set<State> visited;
    std::vector<State> queue;
    queue.push_back(start);
    visited.insert(start);
    size_t head = 0;
    while (head < queue.size()) {
        State s = queue[head++];
        int pos[10];
        decode(s, n, pos);
        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns))
                    continue;
                if (visited.insert(ns).second)
                    queue.push_back(ns);
            }
        }
    }
    return (int)visited.size();
}

// ── Forward BFS: collect all reachable states ────────────────────────────────
static std::vector<State> forward_bfs_states(State start, int n, int num_exits) {
    std::unordered_set<State> seen;
    std::vector<State> queue;
    queue.push_back(start);
    seen.insert(start);
    size_t head = 0;
    while (head < queue.size()) {
        State s = queue[head++];
        int pos[10];
        decode(s, n, pos);
        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns))
                    continue;
                if (seen.insert(ns).second)
                    queue.push_back(ns);
            }
        }
    }
    std::sort(queue.begin(), queue.end());
    return queue;
}

// ── Forward state-set hash ────────────────────────────────────────────────────
// Hash the sorted set of forward-reachable states.  Since we only process
// self-canonical starting states (D4 equivalents share the same canonical
// start and thus the same forward states), no D4 transform is needed here.
// Cross-combo D4 dedup is handled by canonicalizing the pruned positions
// and including num_exits in the hash.
static uint64_t forward_state_set_hash(const std::vector<State>& states) {
    uint64_t h = 14695981039346656037ULL; // FNV offset basis
    for (auto s : states) {
        h ^= s;
        h *= 1099511628211ULL; // FNV prime
    }
    // Mix in the count to distinguish empty/small sets
    h ^= (uint64_t)states.size();
    h *= 1099511628211ULL;
    return h;
}

// ── Minimum grouped moves via 0-1 BFS ────────────────────────────────────────
// Finds the solution with minimum GROUPED moves (consecutive slides by the
// same robot = 1 move), allowing any number of raw slides.  This is the
// metric players actually count.
//
// Uses a 0-1 BFS on augmented state (board_state, last_mover_cell):
//   - Cost 0 edge: same robot continues sliding
//   - Cost 1 edge: different robot starts sliding
// Explores ALL legal forward moves, not just BFS-depth-decreasing ones.
static TraceResult solve_min_grouped(State start, int n, int num_exits) {
    // Check if already at goal.
    {
        int pos[10]; decode(start, n, pos);
        bool at_goal = true;
        for (int e = 0; e < num_exits; e++)
            if (pos[e] != EXITED) { at_goal = false; break; }
        if (at_goal) return {{}, 0};
    }

    const int shift = 6 * n;
    auto make_key = [shift](State s, int cell) -> uint64_t {
        return s | ((uint64_t)(unsigned)cell << shift);
    };

    struct NodeInfo {
        int      cost;        // grouped moves to reach this augmented state
        uint64_t parent_key;  // key of predecessor (0 = start)
        Move     move;        // the slide that got us here
    };

    std::unordered_map<uint64_t, NodeInfo> visited;
    std::deque<uint64_t> queue;

    const uint64_t start_key = make_key(start, EXITED);
    visited[start_key] = {0, 0, {-1, -1, -1}};
    queue.push_back(start_key);

    uint64_t best_goal_key = 0;
    int best_goal_cost = INT_MAX;

    while (!queue.empty()) {
        const uint64_t key = queue.front();
        queue.pop_front();

        const auto it = visited.find(key);
        if (it == visited.end()) continue;
        const int cost = it->second.cost;
        if (cost >= best_goal_cost) continue;  // prune

        const State s = key & (((uint64_t)1 << shift) - 1);
        const int last_cell = (int)(key >> shift);

        int pos[10];
        decode(s, n, pos);

        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns))
                    continue;

                const int mover_cell = pos[ridx];
                const int edge_cost = (mover_cell == last_cell) ? 0 : 1;
                const int new_cost = cost + edge_cost;
                if (new_cost >= best_goal_cost) continue;

                const int landing = (ridx < num_exits && nc == CTR) ? EXITED : nc;
                const uint64_t nk = make_key(ns, landing);

                auto nit = visited.find(nk);
                if (nit != visited.end() && nit->second.cost <= new_cost)
                    continue;

                visited[nk] = {new_cost, key, {(int8_t)ridx, (int8_t)d, (int8_t)bi}};

                // Check if this is a goal state.
                int npos[10];
                decode(ns, n, npos);
                bool is_goal = true;
                for (int e = 0; e < num_exits; e++)
                    if (npos[e] != EXITED) { is_goal = false; break; }
                if (is_goal) {
                    if (new_cost < best_goal_cost) {
                        best_goal_cost = new_cost;
                        best_goal_key = nk;
                    }
                    continue;  // don't expand goal states
                }

                if (edge_cost == 0)
                    queue.push_front(nk);
                else
                    queue.push_back(nk);
            }
        }
    }

    if (best_goal_cost == INT_MAX) return {{}, 0};

    // Backtrack to reconstruct solution.
    std::vector<Move> sol;
    uint64_t cur = best_goal_key;
    while (cur != start_key) {
        const auto& node = visited[cur];
        sol.push_back(node.move);
        cur = node.parent_key;
    }
    std::reverse(sol.begin(), sol.end());
    return {std::move(sol), best_goal_cost};
}

// ── Fast greedy solution trace ───────────────────────────────────────────────
// Picks the first valid forward move at each step (no DP, no per-layer maps).
// Used for collision-signature dedup — much faster than the DP trace.
// The solution has minimum individual slides but NOT necessarily minimum
// grouped moves; that's fine for dedup purposes.
static std::vector<Move> trace_solution_greedy(State start, int n, int num_exits,
                                                const FlatMap& dist)
{
    uint8_t start_dist;
    if (!dist.find_val(start, &start_dist) || start_dist == 0) return {};
    std::vector<Move> sol;
    sol.reserve(start_dist);
    State cur = start;
    for (int step = (int)start_dist; step > 0; step--) {
        int pos[10];
        decode(cur, n, pos);
        bool found = false;
        for (int ridx = 0; ridx < n && !found; ridx++) {
            for (int d = 0; d < NUM_DIRS && !found; d++) {
                int new_cell, blocker_idx;
                State new_state;
                if (!forward_move(pos, n, num_exits, ridx, d,
                                  new_cell, blocker_idx, new_state))
                    continue;
                uint8_t nd;
                if (!dist.find_val(canonical(new_state, n, num_exits), &nd)
                    || nd != (uint8_t)(step - 1))
                    continue;
                sol.push_back({(int8_t)ridx, (int8_t)d, (int8_t)blocker_idx});
                cur = new_state;
                found = true;
            }
        }
        if (!found) return {};
    }
    return sol;
}

// ── Stabilise solution indices ─────────────────────────────────────────────
// The DP and greedy traces record Move indices relative to the decoded
// position array at each step.  But forward_move() re-sorts helpers after
// each slide, so the same index may refer to a different physical robot
// across steps.  This function rewrites mover/blocker to use the INITIAL
// state's indices so they stay stable for output.
static void stabilise_indices(std::vector<Move>& sol, State start,
                               int n, int num_exits)
{
    // identity[i] = initial-state index of the robot currently at position i
    int identity[10];
    for (int i = 0; i < n; i++) identity[i] = i;

    State cur = start;
    for (auto& m : sol) {
        int pos[10];
        decode(cur, n, pos);

        // Record the initial-state identities of mover and blocker.
        const int init_mover   = identity[(int)m.mover];
        const int init_blocker = identity[(int)m.blocker];

        // Apply the move to get the next encoded state.
        int new_cell, blocker_idx;
        State new_state;
        forward_move(pos, n, num_exits, (int)m.mover, (int)m.dir,
                     new_cell, blocker_idx, new_state);

        // Build the position array AFTER the move but BEFORE helper re-sort.
        int moved[10];
        std::memcpy(moved, pos, n * sizeof(int));
        if ((int)m.mover < num_exits && new_cell == CTR)
            moved[(int)m.mover] = EXITED;
        else
            moved[(int)m.mover] = new_cell;

        // Decode the new (re-sorted) state to find how helpers were permuted.
        int new_pos[10];
        decode(new_state, n, new_pos);

        int new_id[10];
        // Exits keep their indices (never sorted).
        for (int e = 0; e < num_exits; e++) new_id[e] = identity[e];
        // Match each new helper position to the old (pre-sort) helper.
        bool used[10] = {};
        for (int h = num_exits; h < n; h++) {
            for (int oh = num_exits; oh < n; oh++) {
                if (!used[oh] && moved[oh] == new_pos[h]) {
                    new_id[h] = identity[oh];
                    used[oh] = true;
                    break;
                }
            }
        }
        std::memcpy(identity, new_id, n * sizeof(int));

        // Rewrite the move to use initial-state indices.
        m.mover   = (int8_t)init_mover;
        m.blocker = (int8_t)init_blocker;
        cur = new_state;
    }
}

// ── Dedup key hashing ────────────────────────────────────────────────────────
// Hashes a collision-signature dedup key to uint64_t (FNV-1a).
// Collision probability for ~4M keys in 2^64 space is negligible (~10^-12).
static uint64_t hash_dedup_key(const std::string& key) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (unsigned char c : key) {
        h ^= c;
        h *= 0x100000001b3ULL;
    }
    return h;
}

// ── Collision signature ───────────────────────────────────────────────────────
// Normalises exit and helper labels separately by order of first appearance.
//   Exit  0 (first seen) → 'A',  exit  1 → 'B',  exit  2 → 'C', ...
//   Helper 0 (first seen)→ '1', helper 1 → '2', ...
// To catch symmetry-equivalent puzzles whose collision sequences differ only by
// a rotation/reflection of directions, we compute the signature under all
// symmetry direction transforms and return the lexicographically smallest one.

// Square (D4): 8 transforms permuting {U,D,L,R} (dirs 0-3).
static const int DIR_TRANSFORM[8][4] = {
    {0, 1, 2, 3},  // identity
    {2, 3, 1, 0},  // 90 CW:  U->L, D->R, L->D, R->U
    {1, 0, 3, 2},  // 180:    U->D, D->U, L->R, R->L
    {3, 2, 0, 1},  // 270 CW: U->R, D->L, L->U, R->D
    {0, 1, 3, 2},  // reflect-H: U->U, D->D, L->R, R->L
    {1, 0, 2, 3},  // reflect-V: U->D, D->U, L->L, R->R
    {2, 3, 0, 1},  // reflect main diag: U->L, D->R, L->U, R->D
    {3, 2, 1, 0},  // reflect anti-diag: U->R, D->L, L->D, R->U
};

// Hex (Klein four-group): 4 direction-preserving transforms permuting 6 dirs.
// Only {identity, 180°, diag, anti-diag} preserve all 6 hex directions.
// H-flip and V-flip map (-1,+1) to (-1,-1) or (+1,+1), which aren't valid hex dirs.
// Dirs: 0=NW(-1,0) 1=SE(+1,0) 2=SW(0,-1) 3=NE(0,+1) 4=N-diag(-1,+1) 5=S-diag(+1,-1)
// Identity:     NW SE SW NE N  S   → same
// 180°:         NW SE SW NE N  S   → SE NW NE SW S  N  (swap all opposite pairs)
// Diag-reflect: NW SE SW NE N  S   → SW NE NW SE S  N  (swap r↔c: NW↔SW, SE↔NE, N↔S)
// Anti-diag:    NW SE SW NE N  S   → NE SW SE NW N  S  (negate+swap: NW↔NE, SE↔SW, N=N, S=S)
static const int HEX_DIR_TRANSFORM[4][6] = {
    {0, 1, 2, 3, 4, 5},  // identity       (t0)
    {1, 0, 3, 2, 5, 4},  // 180°           (t2)
    {2, 3, 0, 1, 5, 4},  // diag-reflect   (t6)
    {3, 2, 1, 0, 4, 5},  // anti-diag      (t7)
};

static std::string collision_signature_for_transform(
    const std::vector<Move>& sol, int num_exits, const int* dir_map)
{
    int exit_label[10];   std::fill(exit_label,   exit_label+10,   -1);
    int helper_label[10]; std::fill(helper_label, helper_label+10, -1);
    int next_exit   = 0;
    int next_helper = 1;

    auto exit_char = [](int lbl) -> char {
        return (char)('A' + lbl);
    };
    auto helper_char = [](int lbl) -> char {
        return (char)('0' + lbl);
    };

    std::string sig;
    for (const auto& m : sol) {
        auto assign = [&](int idx) {
            if (idx < num_exits) {
                if (exit_label[idx] < 0) exit_label[idx] = next_exit++;
            } else {
                int hi = idx - num_exits;
                if (helper_label[hi] < 0) helper_label[hi] = next_helper++;
            }
        };
        assign((int)m.mover);
        assign((int)m.blocker);

        char mc, bc;
        if (m.mover < num_exits) mc = exit_char(exit_label[(int)m.mover]);
        else                     mc = helper_char(helper_label[(int)m.mover - num_exits]);
        if (m.blocker < num_exits) bc = exit_char(exit_label[(int)m.blocker]);
        else                       bc = helper_char(helper_label[(int)m.blocker - num_exits]);

        int mapped_dir = dir_map[(int)m.dir];
        if (!sig.empty()) sig += ' ';
        sig += mc;
        if (BOARD_TYPE == BOARD_HEX) {
            static const char* HEX_DIR_CHARS[6] = {"Nw","Se","Sw","Ne","No","So"};
            sig += HEX_DIR_CHARS[mapped_dir];
        } else {
            sig += "UDLR"[mapped_dir];
        }
        sig += bc;
    }
    return sig;
}

static std::string collision_signature(const std::vector<Move>& sol, int num_exits) {
    std::string best;
    for (int ti = 0; ti < NUM_SYMS; ti++) {
        const int* dir_map = (BOARD_TYPE == BOARD_HEX)
            ? HEX_DIR_TRANSFORM[ti]
            : DIR_TRANSFORM[SYM_INDICES[ti]];
        std::string sig = collision_signature_for_transform(sol, num_exits, dir_map);
        if (best.empty() || sig < best) best = std::move(sig);
    }
    return best;
}

// Minimum odd board size (1, 3, 5, or 7) with center that fits all
// used robots.  Uses Chebyshev distance from center.
static int compute_board_size(const int* pos, const bool* used, int n) {
    const int cr = CTR / N, cc = CTR % N;
    int max_cheb = 0;
    for (int i = 0; i < n; i++) {
        if (!used[i]) continue;
        int cheb = std::max(std::abs(pos[i]/N - cr), std::abs(pos[i]%N - cc));
        if (cheb > max_cheb) max_cheb = cheb;
    }
    return 2 * max_cheb + 1;
}

// ── Compaction ──────────────────────────────────────────────────────────────
// After collision-signature dedup picks a representative, try to construct an
// even more compact starting position by reducing the "gap" (distance each
// mover travels on its first slide) to 1.  The collision sequence is preserved
// and the BFS distance is verified via FlatMap lookup.

// Replay the solution with the given positions and check that each move
// produces the same (mover, direction, blocker) triple as in sol.
static bool validate_collision_seq(const int* init_pos,
                                    const std::vector<Move>& sol,
                                    int n, int num_exits)
{
    // Check for position collisions and blocked-cell conflicts in initial config.
    for (int i = 0; i < n; i++) {
        if (BLOCKED & ((uint64_t)1 << init_pos[i])) return false;
        for (int j = i + 1; j < n; j++)
            if (init_pos[i] == init_pos[j]) return false;
    }

    int pos[10];
    std::memcpy(pos, init_pos, n * sizeof(int));

    for (const auto& m : sol) {
        const int mover   = (int)m.mover;
        const int dir     = (int)m.dir;
        const int blocker = (int)m.blocker;

        if (mover < num_exits && pos[mover] == EXITED) return false;

        const int mr = pos[mover] / N, mc = pos[mover] % N;

        // Build occupancy bitmask (all robots except mover).
        uint64_t occ = 0;
        for (int i = 0; i < n; i++)
            if (i != mover && pos[i] != EXITED) occ |= (uint64_t)1 << pos[i];

        // Slide mover in direction dir.
        int wr = mr, wc = mc;
        int blocker_cell = -1;
        while (true) {
            int nr = wr + DR[dir], nc = wc + DC[dir];
            if (nr < 0 || nr >= N || nc < 0 || nc >= N) break;
            int np = nr * N + nc;
            if (BLOCKED & ((uint64_t)1 << np)) break;         // blocked cell = wall
            if (occ & ((uint64_t)1 << np)) { blocker_cell = np; break; }
            wr = nr; wc = nc;
        }

        if (blocker_cell < 0) return false;            // wall stop (or blocked cell)
        if (wr == mr && wc == mc) return false;         // no movement
        if (pos[blocker] != blocker_cell) return false;  // wrong blocker

        const int land = wr * N + wc;
        if (mover < num_exits && land == CTR)
            pos[mover] = EXITED;
        else
            pos[mover] = land;
    }
    // Verify all exits actually exited (reached center).
    for (int e = 0; e < num_exits; e++)
        if (pos[e] != EXITED) return false;
    return true;
}

// ── Bounding area metric (used for picking most compact representative) ──────
static int compute_bounding_area(const int* pos, int n) {
    int minR=N-1, maxR=0, minC=N-1, maxC=0;
    for (int i = 0; i < n; i++) {
        if (pos[i] == EXITED) continue;
        int r = pos[i]/N, c = pos[i]%N;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
    }
    return (maxR - minR + 1) * (maxC - minC + 1);
}

static int sum_manhattan(const int* pos, int n) {
    const int cr = CTR / N, cc = CTR % N;
    int sum = 0;
    for (int i = 0; i < n; i++) {
        if (pos[i] == EXITED) continue;
        sum += std::abs(pos[i]/N - cr) + std::abs(pos[i]%N - cc);
    }
    return sum;
}


// ── Output helpers ──────────────────────────────────────────────────────────

// Sort exit robots by ascending cell index and remap all references in the
// solution accordingly.  This ensures a canonical output order independent of
// the internal BFS representation.
static void sort_exits_and_remap(int* init_pos, std::vector<Move>& sol,
                                  int num_exits)
{
    // perm[new_exit_idx] = old_exit_idx
    int perm[10], inv[10];
    std::iota(perm, perm + num_exits, 0);
    std::sort(perm, perm + num_exits,
        [&](int a, int b){ return init_pos[a] < init_pos[b]; });
    for (int e = 0; e < num_exits; e++) inv[perm[e]] = e;

    int tmp[10];
    for (int e = 0; e < num_exits; e++) tmp[e] = init_pos[perm[e]];
    for (int e = 0; e < num_exits; e++) init_pos[e] = tmp[e];

    for (auto& m : sol) {
        if (m.mover  < num_exits) m.mover  = (int8_t)inv[(int)m.mover];
        if (m.blocker < num_exits) m.blocker = (int8_t)inv[(int)m.blocker];
    }
}

// Remove helper robots that never appear as mover or blocker in the solution.
// Returns the pruned helper count and remapped solution.
static int prune_unused_helpers(const std::vector<Move>& sol,
                                 int num_exits, int n,
                                 std::vector<Move>& pruned_sol,
                                 bool* used)
{
    std::fill(used, used + n, false);
    for (int e = 0; e < num_exits; e++) used[e] = true; // exits always kept
    for (const auto& m : sol) {
        used[(int)m.mover]   = true;
        used[(int)m.blocker] = true;
    }

    // Compact helper indices: remap[old_idx] = new_idx (or -1 if pruned).
    int remap[10];
    for (int e = 0; e < num_exits; e++) remap[e] = e;
    int new_h = 0;
    for (int h = num_exits; h < n; h++)
        remap[h] = used[h] ? num_exits + new_h++ : -1;

    pruned_sol.clear();
    pruned_sol.reserve(sol.size());
    for (const auto& m : sol)
        pruned_sol.push_back({(int8_t)remap[(int)m.mover],
                               m.dir,
                              (int8_t)remap[(int)m.blocker]});
    return new_h;
}

// Count grouped moves: consecutive slides by the same robot count as one move.
static int count_grouped_moves(const std::vector<Move>& sol) {
    int groups = 0, last_mover = -1;
    for (const auto& m : sol) {
        if (m.mover != last_mover) { groups++; last_mover = m.mover; }
    }
    return groups;
}

// ── Output emitter (three-pass pipeline) ─────────────────────────────────────
// Pass 1: Scan BFS FlatMap, collect self-canonical initial states.
//         The BFS is D4-closed, so S == canonical(S) identifies exactly one
//         representative per equivalence class — no separate hash map needed.
// Pass 2: Fast greedy trace → collision signature hash → dedup.
//         Eliminates ~85% of states cheaply before the expensive DP trace.
// Pass 3: Full DP trace for survivors → minimum grouped moves → output.
//         Only ~15% of canonical states reach this phase.
static void emit(const FlatMap& dist, int n, int num_exits,
                 int min_moves, int max_moves,
                 int& id, std::unordered_set<uint64_t>& seen_sigs,
                 std::unordered_set<uint64_t>& seen_pruned_canons,
                 std::unordered_set<uint64_t>& seen_dp_sigs,
                 std::unordered_set<uint64_t>& seen_state_sets,
                 int& emitted, int& deduped)
{
    using Clock = std::chrono::steady_clock;
    auto t0 = Clock::now();

    // ── Pass 1: collect initial states (all canonical from BFS) ──
    struct Rec { State s; uint8_t d; };
    std::vector<Rec> recs;
    recs.reserve(dist.size() / 4);
    for (auto [s, d] : dist) {
        if (d == 0 || d < (uint8_t)min_moves || d > (uint8_t)max_moves) continue;
        int r[10]; decode(s, n, r);
        bool ok = true;
        for (int e = 0; e < num_exits; e++)
            if (r[e] == EXITED) { ok = false; break; }
        if (!ok) continue;
        recs.push_back({s, d});
    }

    std::sort(recs.begin(), recs.end(), [](const Rec& a, const Rec& b) {
        return a.d != b.d ? a.d < b.d : a.s < b.s;
    });

    auto t1 = Clock::now();
    std::cerr << "  pass 1 (collect + sort): " << recs.size() << " states, "
              << std::chrono::duration<double>(t1 - t0).count() << "s\n";

    // ── Pass 2: greedy trace → collision sig hash → dedup ──
    std::vector<uint64_t> sig_hashes(recs.size(), 0);
    std::vector<int8_t>  board_sizes(recs.size(), 7);
    std::vector<bool> trace_ok(recs.size(), false);

#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic, 256)
#endif
    for (int i = 0; i < (int)recs.size(); i++) {
        auto sol = trace_solution_greedy(recs[i].s, n, num_exits, dist);
        if (sol.size() != (size_t)recs[i].d) continue;
        stabilise_indices(sol, recs[i].s, n, num_exits);

        int init_pos[10];
        decode(recs[i].s, n, init_pos);
        sort_exits_and_remap(init_pos, sol, num_exits);

        bool used[10];
        std::vector<Move> pruned;
        const int new_h = prune_unused_helpers(sol, num_exits, n, pruned, used);

        std::string sig = collision_signature(pruned, num_exits);
        std::string key = "e" + std::to_string(num_exits)
                        + "h" + std::to_string(new_h) + "|" + sig;
        sig_hashes[i] = hash_dedup_key(key);
        board_sizes[i] = (int8_t)compute_board_size(init_pos, used, n);
        trace_ok[i] = true;
    }

    // Sequential dedup — prefer the most compact representative
    // (smallest board_size) among states sharing the same collision signature.
    std::unordered_map<uint64_t, int> local_best; // sig_hash → best recs index
    int total_valid = 0;
    int greedy_failures = 0;
    for (int i = 0; i < (int)recs.size(); i++) {
        if (!trace_ok[i]) { greedy_failures++; continue; }
        total_valid++;
        if (seen_sigs.count(sig_hashes[i])) continue; // globally already emitted
        auto [it, inserted] = local_best.emplace(sig_hashes[i], i);
        if (!inserted && board_sizes[i] < board_sizes[it->second])
            it->second = i; // found more compact representative
    }
    std::vector<int> survivors;
    survivors.reserve(local_best.size() + greedy_failures);
    for (auto& [hash, idx] : local_best) {
        seen_sigs.insert(hash);
        survivors.push_back(idx);
    }
    // States where the greedy trace failed are forwarded to Pass 3 where
    // the full 0-1 BFS will solve them.  Without this, solvable states
    // are silently dropped from the pipeline.
    for (int i = 0; i < (int)recs.size(); i++) {
        if (!trace_ok[i]) survivors.push_back(i);
    }
    int dup_count = total_valid - (int)local_best.size();
    sig_hashes.clear();
    sig_hashes.shrink_to_fit();
    board_sizes.clear();
    board_sizes.shrink_to_fit();

    auto t2 = Clock::now();
    std::cerr << "  pass 2 (greedy dedup): " << local_best.size() << " unique, "
              << dup_count << " deduped, "
              << greedy_failures << " greedy failures forwarded, "
              << std::chrono::duration<double>(t2 - t1).count() << "s\n";

    // ── Pass 3: DP trace for survivors → dedup → output ──
    std::vector<std::string> output_lines(survivors.size());
    // D4-canonical form of pruned positions (with num_exits packed in bits 60-63).
    std::vector<uint64_t> pruned_canons(survivors.size(), ~(uint64_t)0);
    // Collision-sig hash of the DP (min-grouped) solution.
    std::vector<uint64_t> dp_sig_hashes(survivors.size(), 0);
    // State-set hashes for third-layer dedup.
    std::vector<uint64_t> state_set_hashes(survivors.size(), 0);
    // Bounding area + Manhattan for picking most compact representative.
    std::vector<int> bounding_areas(survivors.size(), 99);
    std::vector<int> manhattan_sums(survivors.size(), 999);

#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic, 64)
#endif
    for (int j = 0; j < (int)survivors.size(); j++) {
        const int i = survivors[j];
        // Solve for minimum grouped moves (0-1 BFS, allows more raw slides).
        auto tr = solve_min_grouped(recs[i].s, n, num_exits);
        if (tr.moves.empty()) continue;
        stabilise_indices(tr.moves, recs[i].s, n, num_exits);

        int init_pos[10];
        decode(recs[i].s, n, init_pos);
        sort_exits_and_remap(init_pos, tr.moves, num_exits);

        bool used[10];
        std::vector<Move> pruned;
        const int new_h = prune_unused_helpers(tr.moves, num_exits, n, pruned, used);
        int grouped_moves = count_grouped_moves(pruned);
        int raw_slides = (int)pruned.size();
        int min_raw_slides = (int)recs[i].d;  // BFS depth (unpruned)

        // Skip hex puzzles whose solution uses only cardinal directions —
        // these are playable on a square board and belong in square variants.
        if (BOARD_TYPE == BOARD_HEX) {
            bool uses_diagonal = false;
            for (const auto& m : pruned)
                if (m.dir >= 4) { uses_diagonal = true; break; }
            if (!uses_diagonal) continue;
        }

        // Compute forward reachable states from pruned starting position.
        int pruned_pos[10];
        int ci = 0;
        for (int e = 0; e < num_exits; e++) pruned_pos[ci++] = init_pos[e];
        for (int h = num_exits; h < n; h++)
            if (used[h]) pruned_pos[ci++] = init_pos[h];

        // If helpers were pruned, the board has fewer obstacles and the optimal
        // solution may use fewer grouped moves or raw slides.  Re-solve on
        // the pruned positions to find the true optimum.
        if (new_h < n - num_exits) {
            State ps = encode(pruned_pos, ci);
            auto tr2 = solve_min_grouped(ps, ci, num_exits);
            if (!tr2.moves.empty()) {
                stabilise_indices(tr2.moves, ps, ci, num_exits);
                // Re-decode (stabilise doesn't change positions, but we need
                // fresh init_pos for the pruned robot set).
                decode(ps, ci, pruned_pos);
                sort_exits_and_remap(pruned_pos, tr2.moves, num_exits);
                pruned = std::move(tr2.moves);
                grouped_moves = count_grouped_moves(pruned);
                raw_slides = (int)pruned.size();
                min_raw_slides = raw_slides; // upper bound for pruned state
            }
        }

        State pruned_start = encode(pruned_pos, ci);

        auto fwd_states_vec = forward_bfs_states(pruned_start, ci, num_exits);
        int fwd_states = (int)fwd_states_vec.size();

        // D4-canonical form of pruned positions (cross-combo D4 dedup).
        pruned_canons[j] = canonical(encode(pruned_pos, ci), ci, num_exits)
                         | ((uint64_t)num_exits << 60);

        // Collision-sig hash of the DP solution (catches greedy/DP path differences).
        {
            std::string sig = collision_signature(pruned, num_exits);
            std::string key = "e" + std::to_string(num_exits)
                            + "h" + std::to_string(new_h) + "|" + sig;
            dp_sig_hashes[j] = hash_dedup_key(key);
        }

        // Forward state-set hash for third-layer dedup.
        state_set_hashes[j] = forward_state_set_hash(fwd_states_vec);

        // Bounding area and Manhattan for picking most compact representative.
        bounding_areas[j] = compute_bounding_area(pruned_pos, ci);
        manhattan_sums[j] = sum_manhattan(pruned_pos, ci);

        // Format output line (ID assigned sequentially below).
        // Format: exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution
        std::string line;
        line.reserve(160);
        line += std::to_string(num_exits);       line += '|';
        line += std::to_string(new_h);           line += '|';
        line += std::to_string(grouped_moves);   line += '|';
        line += std::to_string(raw_slides);      line += '|';
        line += std::to_string(min_raw_slides);  line += '|';
        line += std::to_string(fwd_states);      line += '|';

        line += std::to_string(init_pos[0]/N); line += ',';
        line += std::to_string(init_pos[0]%N);
        for (int e = 1; e < num_exits; e++) {
            line += ' ';
            line += std::to_string(init_pos[e]/N); line += ',';
            line += std::to_string(init_pos[e]%N);
        }
        for (int h = num_exits; h < n; h++) {
            if (!used[h]) continue;
            line += ' ';
            line += std::to_string(init_pos[h]/N); line += ',';
            line += std::to_string(init_pos[h]%N);
        }
        line += '|';

        for (int k = 0; k < (int)pruned.size(); k++) {
            if (k) line += ' ';
            const auto& m = pruned[k];
            line += (m.mover < num_exits) ? (char)('A' + m.mover)
                                          : (char)('0' + m.mover - num_exits + 1);
            if (BOARD_TYPE == BOARD_HEX) {
                static const char* HEX_DIR_NAMES[6] = {"Nw","Se","Sw","Ne","No","So"};
                line += HEX_DIR_NAMES[(int)m.dir];
            } else {
                line += "UDLR"[(int)m.dir];
            }
            line += (m.blocker < num_exits) ? (char)('A' + m.blocker)
                                            : (char)('0' + m.blocker - num_exits + 1);
        }
        output_lines[j] = std::move(line);
    }

    // Sequential output with IDs.
    // Two-layer dedup:
    //   (1) D4-canonical form of pruned positions (catches D4 positional dups)
    //   (2) Forward state-set hash (catches collision-sig dups with same reachable states)
    // Among state-set dups, keep the most compact representative.
    emitted = 0;
    deduped = dup_count;
    int pruned_dup_count = 0;
    int state_set_dup_count = 0;

    // Layer 1: D4-canonical dedup — filter out positional D4 duplicates.
    // Among D4 dups, keep the most compact representative.
    std::unordered_map<uint64_t, int> best_for_canon; // pruned_canon → best j
    for (int j = 0; j < (int)output_lines.size(); j++) {
        if (output_lines[j].empty()) continue;
        auto it = best_for_canon.find(pruned_canons[j]);
        if (it == best_for_canon.end()) {
            best_for_canon[pruned_canons[j]] = j;
        } else {
            int prev = it->second;
            if (bounding_areas[j] < bounding_areas[prev] ||
                (bounding_areas[j] == bounding_areas[prev] &&
                 manhattan_sums[j] < manhattan_sums[prev])) {
                it->second = j;
            }
            pruned_dup_count++;
        }
    }
    // Cross-combo D4 dedup.
    for (auto& [canon, j] : best_for_canon) {
        if (!seen_pruned_canons.insert(canon).second) {
            best_for_canon[canon] = -1; // mark as cross-combo dup
            pruned_dup_count++;
        }
    }

    // Layer 2: DP collision-sig dedup — among D4 survivors, catch greedy/DP divergences.
    int dp_sig_dup_count = 0;
    std::unordered_map<uint64_t, int> best_for_dp_sig; // dp_sig_hash → best j
    for (auto& [canon, j] : best_for_canon) {
        if (j < 0) continue; // D4-deduped
        auto it = best_for_dp_sig.find(dp_sig_hashes[j]);
        if (it == best_for_dp_sig.end()) {
            best_for_dp_sig[dp_sig_hashes[j]] = j;
        } else {
            int prev = it->second;
            if (bounding_areas[j] < bounding_areas[prev] ||
                (bounding_areas[j] == bounding_areas[prev] &&
                 manhattan_sums[j] < manhattan_sums[prev])) {
                it->second = j;
            }
            dp_sig_dup_count++;
        }
    }
    // Cross-combo DP sig dedup.
    for (auto& [h, j] : best_for_dp_sig) {
        if (!seen_dp_sigs.insert(h).second) {
            best_for_dp_sig[h] = -1;
            dp_sig_dup_count++;
        }
    }

    // Layer 3: State-set hash dedup — among DP-sig survivors, catch remaining dups.
    std::unordered_map<uint64_t, int> best_for_hash; // state_set_hash → best j
    for (auto& [sig, j] : best_for_dp_sig) {
        if (j < 0) continue; // DP-sig-deduped
        uint64_t h = state_set_hashes[j];
        h ^= ((uint64_t)num_exits * 0x9e3779b97f4a7c15ULL);
        auto it = best_for_hash.find(h);
        if (it == best_for_hash.end()) {
            best_for_hash[h] = j;
        } else {
            int prev = it->second;
            if (bounding_areas[j] < bounding_areas[prev] ||
                (bounding_areas[j] == bounding_areas[prev] &&
                 manhattan_sums[j] < manhattan_sums[prev])) {
                it->second = j;
            }
            state_set_dup_count++;
        }
    }
    // Cross-combo state-set dedup.
    for (auto& [h, j] : best_for_hash) {
        if (!seen_state_sets.insert(h).second) {
            best_for_hash[h] = -1;
            state_set_dup_count++;
        }
    }

    // Emit winners.
    std::unordered_set<int> winners;
    for (auto& [h, j] : best_for_hash) {
        if (j >= 0) winners.insert(j);
    }
    for (int j = 0; j < (int)output_lines.size(); j++) {
        if (!winners.count(j)) continue;
        std::cout << ++id << '|' << output_lines[j] << '\n';
        emitted++;
    }

    auto t3 = Clock::now();
    std::cerr << "  pass 3 (solve + dedup + output): " << emitted << " emitted";
    if (pruned_dup_count > 0)
        std::cerr << ", " << pruned_dup_count << " D4 dups removed";
    if (dp_sig_dup_count > 0)
        std::cerr << ", " << dp_sig_dup_count << " DP collision-sig dups removed";
    if (state_set_dup_count > 0)
        std::cerr << ", " << state_set_dup_count << " state-set dups removed";
    std::cerr << ", " << std::chrono::duration<double>(t3 - t2).count() << "s\n";
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    const int max_exits   = argc > 1 ? std::atoi(argv[1]) : 1;
    const int max_total   = argc > 2 ? std::atoi(argv[2]) : 6; // exits + helpers
    const int min_moves   = argc > 3 ? std::atoi(argv[3]) : 1;
    const int max_moves   = argc > 4 ? std::atoi(argv[4]) : 99;

    // Board variant: standard (default), solitaire, ufo, french, hex, beehive
    std::string variant = "standard";
    if (argc > 5) variant = argv[5];
    if (variant == "solitaire")     BLOCKED = make_blocked_solitaire();
    else if (variant == "ufo")      BLOCKED = make_blocked_ufo();
    else if (variant == "french")   BLOCKED = make_blocked_french();
    else if (variant == "hex") {
        BOARD_TYPE = BOARD_HEX;
        N = 7; NC = 49; CTR = 24; NUM_DIRS = 6; NUM_SYMS = 4;
        SYM_INDICES[0] = 0; SYM_INDICES[1] = 2; SYM_INDICES[2] = 6; SYM_INDICES[3] = 7;
        BLOCKED = make_blocked_ufo(); // border ring blocked → 5x5 inner diamond
    }
    else if (variant == "beehive") {
        BOARD_TYPE = BOARD_HEX;
        N = 7; NC = 49; CTR = 24; NUM_DIRS = 6; NUM_SYMS = 4;
        SYM_INDICES[0] = 0; SYM_INDICES[1] = 2; SYM_INDICES[2] = 6; SYM_INDICES[3] = 7;
    }
    else if (variant != "standard") {
        std::cerr << "Unknown variant: " << variant
                  << " (use standard, solitaire, ufo, french, hex, or beehive)\n";
        return 1;
    }

#ifdef _OPENMP
    std::cerr << "OpenMP enabled (" << omp_get_max_threads() << " threads)\n";
#else
    std::cerr << "OpenMP not available — single-threaded\n";
#endif
    if (BLOCKED) std::cerr << "Variant: " << variant << " (blocked mask: 0x"
                           << std::hex << BLOCKED << std::dec << ")\n";
    if (BOARD_TYPE == BOARD_HEX) std::cerr << "Variant: " << variant
        << " (N=" << N << ", " << NUM_DIRS << " dirs, " << NUM_SYMS << " syms)\n";

    const int cr = CTR / N, cc = CTR % N;
    std::cout <<
        "# Lunar Lockout Puzzles\n"
        "# Generated by ll-solver/enumerate\n"
        "# Board: " << N << "x" << N;
    if (BOARD_TYPE == BOARD_HEX)
        std::cout << " hex diamond (rotated square grid)";
    else
        std::cout << " (rows and cols 0-" << (N-1) << ")";
    std::cout << ", goal: all exits to center (" << cr << "," << cc << ")\n"
        "# Variant: " << variant << "\n"
        "# Exit robots disappear when they reach center; helpers are blockers only.\n"
        "# Deduplicated by collision signature.\n"
        "#\n"
        "# Format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution\n"
        "# positions: exit0_r,c [exit1...] [helper...]\n"
        "# solution: space-separated moves, each = moverDIRblocker\n"
        "#   A,B,C = exit robots (by ascending initial position)\n"
        "#   1-9   = helper robots (by ascending initial position)\n";
    if (BOARD_TYPE == BOARD_HEX)
        std::cout <<
        "#   DIR: Nw=(-1,0) Se=(+1,0) Sw=(0,-1) Ne=(0,+1) No=(-1,+1) So=(+1,-1)\n";
    else
        std::cout <<
        "#   DIR: U=up  D=down  L=left  R=right\n";
    std::cout << "#\n";

    std::unordered_set<uint64_t> seen_sigs;
    std::unordered_set<uint64_t> seen_pruned_canons;
    std::unordered_set<uint64_t> seen_dp_sigs;
    std::unordered_set<uint64_t> seen_state_sets;
    int id = 0, total_emitted = 0;

    for (int ne = 1; ne <= max_exits; ne++) {
        for (int nt = ne; nt <= max_total; nt++) { // nt = total robots
            const int nh = nt - ne;                // helpers = total - exits
            const auto t0 = std::chrono::steady_clock::now();
            std::cerr << "\n=== exits=" << ne << "  helpers=" << nh
                      << "  total=" << nt << " ===\n";

            auto dist = retrograde(ne, nh);

            const double bfs_secs = std::chrono::duration<double>(
                std::chrono::steady_clock::now() - t0).count();
            std::cerr << "  BFS done: " << dist.size() << " states, "
                      << bfs_secs << "s\n";


            int k_emitted = 0, k_deduped = 0;
            emit(dist, ne + nh, ne, min_moves, max_moves,
                 id, seen_sigs, seen_pruned_canons, seen_dp_sigs,
                 seen_state_sets, k_emitted, k_deduped);

            std::cerr << "  emitted: " << k_emitted
                      << "  deduped by collision sig: " << k_deduped << "\n";
            total_emitted += k_emitted;
        }
    }

    std::cerr << "\nTotal unique puzzles: " << total_emitted << "\n";
    return 0;
}
