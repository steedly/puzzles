// enumerate.cpp — Lunar Lockout puzzle enumerator
//
// Finds every canonically unique, solvable starting position on a 7×7 board
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

// ── Board constants ───────────────────────────────────────────────────────────
static constexpr int N      = 7;
static constexpr int NC     = N * N;    // 49
static constexpr int CTR    = 3*N + 3; // center cell = 24
static constexpr int EXITED = 63;      // exit-robot "off board" sentinel

static constexpr int DR[4] = {-1, 1, 0, 0}; // up, down, left, right
static constexpr int DC[4] = { 0, 0,-1, 1};

// ── Board variant (blocked cells) ────────────────────────────────────────────
// Bitmask of cells that are walls — robots cannot occupy or slide through them.
// Set once in main() before any BFS runs; 0 = standard 7x7.
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

// ── D4 symmetry group ─────────────────────────────────────────────────────────
// The dihedral group D4 has 8 elements: 4 rotations × {identity, reflection}.
// sym(cell, transform) returns the cell after applying one transform.
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

// Canonical form: lex-min encoding over all 8 D4 transforms.
// Both exits and helpers are sorted after each transform so that:
//   - D4 spatial symmetries are removed (as before), AND
//   - permutations of exit pieces map to the same canonical form.
// EXITED (63) is larger than any valid cell (0-48), so exited robots
// naturally sort last.
// Used in the emit phase to filter self-canonical states (S == canonical(S)).
static State canonical(State s, int n, int num_exits) {
    int r[10];
    decode(s, n, r);
    State best = ~(State)0;
    for (int t = 0; t < 8; t++) {
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

    for (int d = 0; d < 4; d++) {
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

    for (int d = 0; d < 4; d++) {
        // ridx slid in direction d to reach center.
        // A blocker must exist one step past center in direction d.
        const int blr = 3 + DR[d], blc = 3 + DC[d];
        if (blr < 0 || blr >= N || blc < 0 || blc >= N) continue;
        const int blocker_cell = blr*N+blc;
        if (BLOCKED & ((uint64_t)1 << blocker_cell)) continue; // blocker can't be on a wall
        if (!(occ & ((uint64_t)1 << blocker_cell))) continue;

        // Walk AWAY from center (opposite of d) to find valid starting positions.
        // ridx was at (3 - k*DR[d], 3 - k*DC[d]) for k = 1, 2, ...
        for (int k = 1; ; k++) {
            const int wr = 3 - k*DR[d], wc = 3 - k*DC[d];
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
                for (int d = 0; d < 4; d++) {
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
            for (int d = 0; d < 4; d++) {
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
            for (int d = 0; d < 4; d++) {
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
            for (int d = 0; d < 4 && !found; d++) {
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
// To catch D4-equivalent puzzles whose collision sequences differ only by
// a rotation/reflection of directions, we compute the signature under all
// 8 D4 direction transforms and return the lexicographically smallest one.
// Each D4 spatial transform permutes {U,D,L,R} in a specific way:
//   identity:      U D L R        90 CW:     L R U D
//   180:           D U R L        270 CW:    R L D U
//   reflect-H:     U D R L        reflect-V: D U L R
//   reflect-diag:  L R D U        reflect-anti: R L U D
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

        char dc = "UDLR"[dir_map[(int)m.dir]];
        if (!sig.empty()) sig += ' ';
        sig += mc; sig += dc; sig += bc;
    }
    return sig;
}

static std::string collision_signature(const std::vector<Move>& sol, int num_exits) {
    std::string best;
    for (int t = 0; t < 8; t++) {
        std::string sig = collision_signature_for_transform(sol, num_exits, DIR_TRANSFORM[t]);
        if (best.empty() || sig < best) best = std::move(sig);
    }
    return best;
}

// Minimum odd board size (1, 3, 5, or 7) with center at (3,3) that fits all
// used robots.  Uses Chebyshev distance from center.
static int compute_board_size(const int* pos, const bool* used, int n) {
    int max_cheb = 0;
    for (int i = 0; i < n; i++) {
        if (!used[i]) continue;
        int cheb = std::max(std::abs(pos[i]/N - 3), std::abs(pos[i]%N - 3));
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

// Try to compact the starting position by reducing each mover's first-move
// gap to 1 (or an intermediate gap if 1 fails due to collisions), and by
// shifting non-moving robots toward center.  On success, modifies init_pos
// and sol in place (helpers re-sorted and solution indices remapped) and
// returns true.
static bool try_compact(int* init_pos, std::vector<Move>& sol,
                        int n, int num_exits, const FlatMap& dist,
                        int original_dist)
{
    // 1. Replay solution to find each mover's first-move gap and landing.
    int first_move[10]; // index into sol, or -1 if never moves
    int landing[10];    // landing cell at first move
    std::fill(first_move, first_move + 10, -1);

    int pos[10];
    std::memcpy(pos, init_pos, n * sizeof(int));

    // Track which robots appear as blockers in the solution, and for
    // non-movers, the first move where they act as blocker (to find
    // which direction the mover approaches from).
    int first_blocker_move[10]; // index into sol, or -1
    std::fill(first_blocker_move, first_blocker_move + 10, -1);

    for (int k = 0; k < (int)sol.size(); k++) {
        const int mover   = (int)sol[k].mover;
        const int dir     = (int)sol[k].dir;
        const int blocker = (int)sol[k].blocker;

        // Compute landing: one cell before blocker in the slide direction.
        const int br = pos[blocker] / N, bc = pos[blocker] % N;
        const int land_r = br - DR[dir], land_c = bc - DC[dir];
        const int land = land_r * N + land_c;

        if (first_move[mover] < 0) {
            first_move[mover] = k;
            landing[mover] = land;
        }
        if (first_blocker_move[blocker] < 0)
            first_blocker_move[blocker] = k;

        if (mover < num_exits && land == CTR)
            pos[mover] = EXITED;
        else
            pos[mover] = land;
    }

    // 2. Identify adjustable robots: movers with gap > 1 AND non-moving
    //    robots that can shift toward center.
    struct Adj {
        int robot;              // robot index
        int positions[7];       // candidate positions (most compact first)
        int npos;               // number of candidates
    };
    Adj adjustable[10];
    int nadj = 0;

    for (int r = 0; r < n; r++) {
        if (first_move[r] >= 0) {
            // Mover: try reducing gap from current to 1.
            const int dir  = (int)sol[first_move[r]].dir;
            const int land = landing[r];
            const int land_r = land / N, land_c = land % N;
            const int mr = init_pos[r] / N, mc = init_pos[r] % N;
            const int gap = std::abs(mr - land_r) + std::abs(mc - land_c);
            if (gap <= 1) continue;

            Adj& a = adjustable[nadj];
            a.robot = r;
            a.npos = 0;
            // Generate candidate positions from gap=1 up to gap-1
            // (most compact first).
            for (int g = 1; g < gap; g++) {
                const int sr = land_r - g * DR[dir];
                const int sc = land_c - g * DC[dir];
                if (sr < 0 || sr >= N || sc < 0 || sc >= N) break;
                const int sp = sr * N + sc;
                if (BLOCKED & ((uint64_t)1 << sp)) break; // can't place on or past wall
                a.positions[a.npos++] = sp;
                if (a.npos >= 7) break;
            }
            if (a.npos > 0) nadj++;
        } else {
            // Non-mover: try shifting toward center in each direction.
            // Only shift if the robot is used as a blocker.
            if (first_blocker_move[r] < 0) continue;

            const int cr = init_pos[r] / N, cc = init_pos[r] % N;
            const int cheb = std::max(std::abs(cr - 3), std::abs(cc - 3));
            if (cheb <= 1) continue; // already near center

            Adj& a = adjustable[nadj];
            a.robot = r;
            a.npos = 0;
            // Try multiple steps toward center along each axis direction.
            // Most-compact-first ordering so subset enumeration prefers
            // the tightest valid position.
            auto try_dir = [&](int dr, int dc) {
                for (int step = 1; step < N && a.npos < 7; step++) {
                    int nr = cr + step * dr, nc_val = cc + step * dc;
                    if (nr < 0 || nr >= N || nc_val < 0 || nc_val >= N) break;
                    int np = nr * N + nc_val;
                    if (BLOCKED & ((uint64_t)1 << np)) break;
                    int new_cheb = std::max(std::abs(nr - 3), std::abs(nc_val - 3));
                    if (new_cheb < cheb)
                        a.positions[a.npos++] = np;
                }
            };
            if (cr > 3) try_dir(-1, 0);
            if (cr < 3) try_dir( 1, 0);
            if (cc > 3) try_dir(0, -1);
            if (cc < 3) try_dir(0,  1);
            if (a.npos > 0) nadj++;
        }
    }

    if (nadj == 0) return false;

    // 3. Try subsets: for each adjustable robot, try its candidate positions
    //    (most compact first) or original.  Use subset enumeration over
    //    which robots to adjust, then for each adjusted robot pick its
    //    best candidate that validates.
    // Sum of Manhattan distances to center — tiebreaker for equal board_size.
    auto sum_manhattan = [&](const int* pos_arr) {
        int sum = 0;
        for (int i = 0; i < n; i++)
            sum += std::abs(pos_arr[i]/N - 3) + std::abs(pos_arr[i]%N - 3);
        return sum;
    };

    int best_board = 8;
    int best_sum = 999;
    int best_pos[10];
    bool found_better = false;

    // With up to ~7 adjustable robots, enumerate 2^nadj subsets.
    // For each subset, try the first valid candidate for each adjusted robot.
    const int total_masks = 1 << nadj;
    for (int mask = total_masks - 1; mask > 0; mask--) {
        int cand[10];
        std::memcpy(cand, init_pos, n * sizeof(int));

        // For each adjusted robot in this mask, try candidates in order.
        // Use backtracking for multi-candidate robots.
        // Simple approach: for each robot in mask, use its first candidate.
        // If that fails validation, try next candidate.
        // For simplicity (and because nadj <= ~7), just try first candidate.
        bool ok = true;
        for (int b = 0; b < nadj; b++) {
            if (!(mask & (1 << b))) continue;
            // Try candidates in order (most compact first)
            bool placed = false;
            for (int ci = 0; ci < adjustable[b].npos; ci++) {
                cand[adjustable[b].robot] = adjustable[b].positions[ci];
                // Quick collision check with already-placed robots
                bool collision = false;
                for (int i = 0; i < n && !collision; i++)
                    if (i != adjustable[b].robot && cand[i] == cand[adjustable[b].robot])
                        collision = true;
                if (!collision) { placed = true; break; }
            }
            if (!placed) { ok = false; break; }
        }
        if (!ok) continue;

        // Full position-collision check.
        bool collision = false;
        for (int i = 0; i < n && !collision; i++)
            for (int j = i + 1; j < n && !collision; j++)
                if (cand[i] == cand[j]) collision = true;
        if (collision) continue;

        if (!validate_collision_seq(cand, sol, n, num_exits)) continue;

        // FlatMap verification: encode with sorted helpers, canonicalize.
        int sorted[10];
        std::memcpy(sorted, cand, n * sizeof(int));
        std::sort(sorted + num_exits, sorted + n);
        const State cs = canonical(encode(sorted, n), n, num_exits);
        uint8_t d;
        if (!dist.find_val(cs, &d) || d != (uint8_t)original_dist) continue;

        // Compute board_size and sum-of-Manhattan for this candidate.
        bool all_used[10];
        std::fill(all_used, all_used + n, true);
        const int bs = compute_board_size(cand, all_used, n);
        const int sm = sum_manhattan(cand);
        if (bs < best_board || (bs == best_board && sm < best_sum)) {
            best_board = bs;
            best_sum = sm;
            std::memcpy(best_pos, cand, n * sizeof(int));
            found_better = true;
        }
    }

    if (!found_better) return false;

    // Check that compact version is actually better than original.
    {
        bool all_used[10];
        std::fill(all_used, all_used + n, true);
        const int orig_board = compute_board_size(init_pos, all_used, n);
        const int orig_sum = sum_manhattan(init_pos);
        if (best_board > orig_board) return false;
        if (best_board == orig_board && best_sum >= orig_sum) return false;
    }

    // 4. Apply compaction: re-sort helpers and remap solution indices.
    //    Exits keep their indices; helpers are sorted by position.
    int perm[10], inv[10];
    for (int e = 0; e < num_exits; e++) perm[e] = e;

    int helper_order[10];
    const int nh = n - num_exits;
    std::iota(helper_order, helper_order + nh, num_exits);
    std::sort(helper_order, helper_order + nh,
              [&](int a, int b) { return best_pos[a] < best_pos[b]; });
    for (int i = 0; i < nh; i++) perm[num_exits + i] = helper_order[i];

    for (int i = 0; i < n; i++) inv[perm[i]] = i;

    for (int i = 0; i < n; i++) init_pos[i] = best_pos[perm[i]];

    for (auto& m : sol) {
        m.mover   = (int8_t)inv[(int)m.mover];
        m.blocker = (int8_t)inv[(int)m.blocker];
    }

    return true;
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
    for (int i = 0; i < (int)recs.size(); i++) {
        if (!trace_ok[i]) continue;
        total_valid++;
        if (seen_sigs.count(sig_hashes[i])) continue; // globally already emitted
        auto [it, inserted] = local_best.emplace(sig_hashes[i], i);
        if (!inserted && board_sizes[i] < board_sizes[it->second])
            it->second = i; // found more compact representative
    }
    std::vector<int> survivors;
    survivors.reserve(local_best.size());
    for (auto& [hash, idx] : local_best) {
        seen_sigs.insert(hash);
        survivors.push_back(idx);
    }
    int dup_count = total_valid - (int)survivors.size();
    sig_hashes.clear();
    sig_hashes.shrink_to_fit();
    board_sizes.clear();
    board_sizes.shrink_to_fit();

    auto t2 = Clock::now();
    std::cerr << "  pass 2 (greedy dedup): " << survivors.size() << " unique, "
              << dup_count << " deduped, "
              << std::chrono::duration<double>(t2 - t1).count() << "s\n";

    // ── Pass 3: DP trace for survivors → compact → output ──
    std::vector<std::string> output_lines(survivors.size());
    std::vector<State> pruned_canons(survivors.size(), ~(State)0);
    std::vector<uint64_t> dp_sig_hashes(survivors.size(), 0);
    std::atomic<int> compact_count{0};

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
        if (try_compact(init_pos, tr.moves, n, num_exits, dist, recs[i].d))
            compact_count++;

        // Re-verify grouped moves after compaction.
        {
            int compact_pos[10];
            std::memcpy(compact_pos, init_pos, n * sizeof(int));
            std::sort(compact_pos + num_exits, compact_pos + n);
            State cs = encode(compact_pos, n);
            auto tr2 = solve_min_grouped(cs, n, num_exits);
            if (!tr2.moves.empty() && tr2.grouped_moves <= tr.grouped_moves) {
                tr = std::move(tr2);
                stabilise_indices(tr.moves, cs, n, num_exits);
                decode(cs, n, init_pos);
            }
        }

        sort_exits_and_remap(init_pos, tr.moves, num_exits);

        bool used[10];
        std::vector<Move> pruned;
        const int new_h = prune_unused_helpers(tr.moves, num_exits, n, pruned, used);
        const int grouped_moves = count_grouped_moves(pruned);
        const int raw_slides = (int)pruned.size();
        const int min_raw_slides = (int)recs[i].d;  // BFS depth

        // Compute forward reachable states from pruned starting position.
        int fwd_states;
        {
            int compact_pos[10];
            int ci = 0;
            for (int e = 0; e < num_exits; e++) compact_pos[ci++] = init_pos[e];
            for (int h = num_exits; h < n; h++)
                if (used[h]) compact_pos[ci++] = init_pos[h];
            State pruned_start = encode(compact_pos, ci);
            fwd_states = forward_bfs_count(pruned_start, ci, num_exits);
        }

        // Collision-sig hash of the grouped-optimal solution.
        {
            std::string sig = collision_signature(pruned, num_exits);
            std::string key = "e" + std::to_string(num_exits)
                            + "h" + std::to_string(new_h) + "|" + sig;
            dp_sig_hashes[j] = hash_dedup_key(key);
        }

        // Compute D4-canonical form of the PRUNED positions.
        {
            int compact[10];
            int ci = 0;
            for (int e = 0; e < num_exits; e++) compact[ci++] = init_pos[e];
            for (int h = num_exits; h < n; h++)
                if (used[h]) compact[ci++] = init_pos[h];
            pruned_canons[j] = canonical(encode(compact, ci), ci, num_exits);
        }

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
            line += "UDLR"[(int)m.dir];
            line += (m.blocker < num_exits) ? (char)('A' + m.blocker)
                                            : (char)('0' + m.blocker - num_exits + 1);
        }
        output_lines[j] = std::move(line);
    }

    // Sequential output with IDs.
    // Dedup by: (1) D4-canonical form of pruned positions (cross-combo dups),
    //           (2) collision-sig of DP solution (greedy/DP path differences).
    emitted = 0;
    deduped = dup_count;
    int pruned_dup_count = 0;
    int dp_sig_dup_count = 0;
    for (int j = 0; j < (int)output_lines.size(); j++) {
        if (output_lines[j].empty()) continue;
        if (!seen_pruned_canons.insert(pruned_canons[j]).second) {
            pruned_dup_count++;
            continue;
        }
        if (!seen_dp_sigs.insert(dp_sig_hashes[j]).second) {
            dp_sig_dup_count++;
            continue;
        }
        std::cout << ++id << '|' << output_lines[j] << '\n';
        emitted++;
    }

    auto t3 = Clock::now();
    std::cerr << "  pass 3 (DP trace + output): " << emitted << " emitted";
    if (compact_count.load() > 0)
        std::cerr << ", " << compact_count.load() << " compacted";
    if (pruned_dup_count > 0)
        std::cerr << ", " << pruned_dup_count << " cross-combo D4 dups removed";
    if (dp_sig_dup_count > 0)
        std::cerr << ", " << dp_sig_dup_count << " DP collision-sig dups removed";
    std::cerr << ", " << std::chrono::duration<double>(t3 - t2).count() << "s\n";
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    const int max_exits   = argc > 1 ? std::atoi(argv[1]) : 1;
    const int max_total   = argc > 2 ? std::atoi(argv[2]) : 6; // exits + helpers
    const int min_moves   = argc > 3 ? std::atoi(argv[3]) : 1;
    const int max_moves   = argc > 4 ? std::atoi(argv[4]) : 99;

    // Board variant: standard (default), solitaire (2x2 corners blocked),
    // ufo (5x5 center), french (3 cells per corner blocked)
    std::string variant = "standard";
    if (argc > 5) variant = argv[5];
    if (variant == "solitaire")     BLOCKED = make_blocked_solitaire();
    else if (variant == "ufo")      BLOCKED = make_blocked_ufo();
    else if (variant == "french")   BLOCKED = make_blocked_french();
    else if (variant != "standard") {
        std::cerr << "Unknown variant: " << variant
                  << " (use standard, solitaire, ufo, or french)\n";
        return 1;
    }

#ifdef _OPENMP
    std::cerr << "OpenMP enabled (" << omp_get_max_threads() << " threads)\n";
#else
    std::cerr << "OpenMP not available — single-threaded\n";
#endif
    if (BLOCKED) std::cerr << "Variant: " << variant << " (blocked mask: 0x"
                           << std::hex << BLOCKED << std::dec << ")\n";

    std::cout <<
        "# Lunar Lockout Puzzles\n"
        "# Generated by ll-solver/enumerate\n"
        "# Board: 7x7 (rows and cols 0-6), goal: all exits to center (3,3)\n"
        "# Variant: " << variant << "\n"
        "# Exit robots disappear when they reach center; helpers are blockers only.\n"
        "# Deduplicated by collision signature.\n"
        "#\n"
        "# Format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|positions|solution\n"
        "# positions: exit0_r,c [exit1...] [helper...]\n"
        "# solution: space-separated moves, each = moverDIRblocker\n"
        "#   A,B,C = exit robots (by ascending initial position)\n"
        "#   1-9   = helper robots (by ascending initial position)\n"
        "#   DIR: U=up  D=down  L=left  R=right\n"
        "#\n";

    std::unordered_set<uint64_t> seen_sigs;
    std::unordered_set<uint64_t> seen_pruned_canons;
    std::unordered_set<uint64_t> seen_dp_sigs;
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
                 k_emitted, k_deduped);

            std::cerr << "  emitted: " << k_emitted
                      << "  deduped by collision sig: " << k_deduped << "\n";
            total_emitted += k_emitted;
        }
    }

    std::cerr << "\nTotal unique puzzles: " << total_emitted << "\n";
    return 0;
}
