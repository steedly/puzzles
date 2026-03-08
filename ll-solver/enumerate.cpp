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
//   id|exits|helpers|minMoves|exit0_r,c [exit1_r,c ...] [helper_r,c ...]|solution
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
//     g++ -O3 -std=c++17 \
//         -Xpreprocessor -fopenmp \
//         -I$(brew --prefix libomp)/include \
//         -L$(brew --prefix libomp)/lib -lomp \
//         -o enumerate enumerate.cpp
//
//   Without OpenMP (slower canonicalisation step):
//     g++ -O3 -std=c++17 -o enumerate enumerate.cpp
//
// Usage
// -----
//   ./enumerate [max_exits=1] [max_total=6] [min_moves=1] [max_moves=99]
//     max_exits : maximum number of exit robots (default 1)
//     max_total : maximum total robots = exits + helpers (default 6)
//                 helpers = total - exits; helpers may be 0
//   Puzzle data goes to stdout; progress/stats go to stderr.

#include <algorithm>
#include <chrono>
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
        if (!(occ & ((uint64_t)1 << (br*N+bc)))) continue;

        // Walk backward (opposite direction) to find valid starting positions.
        int wr = pr, wc = pc;
        for (;;) {
            wr -= DR[d]; wc -= DC[d];
            if (wr < 0 || wr >= N || wc < 0 || wc >= N) break;
            const int wp = wr*N+wc;
            if (occ & ((uint64_t)1 << wp)) break;

            // Center cell (CTR) must never be a starting position:
            //   Exit at CTR: would have immediately exited in the forward game.
            //     Also, any position beyond CTR (further in this walk) is invalid
            //     because the exit would stop and exit at CTR before reaching pos.
            //   Helper at CTR: invalid game state (blocks all exits from reaching
            //     center).  Positions beyond CTR ARE valid (helper slides through
            //     center), so we skip only CTR itself and continue the walk.
            if (wp == CTR) {
                if (ridx < num_exits) break; // exit can't start at or past CTR
                else continue;               // helper: skip CTR, keep walking
            }

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
        if (!(occ & ((uint64_t)1 << blocker_cell))) continue;

        // Walk AWAY from center (opposite of d) to find valid starting positions.
        // ridx was at (3 - k*DR[d], 3 - k*DC[d]) for k = 1, 2, ...
        for (int k = 1; ; k++) {
            const int wr = 3 - k*DR[d], wc = 3 - k*DC[d];
            if (wr < 0 || wr >= N || wc < 0 || wc >= N) break;
            const int wp = wr*N+wc;
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
    for (int i = 0; i < NC; i++) if (i != CTR) pool.push_back(i);
    const int P = (int)pool.size();

    std::vector<State> cur;

    // Seed: all exits = EXITED(63), helpers at every valid combination.
    // Reserve for 2× the estimated seed count C(P, num_helpers); the BFS
    // will grow the table further via ensure_parallel_capacity as needed.
    // Using 2× (instead of the old 8×) dramatically reduces peak memory.
    {
        size_t seed_est = 1;
        for (int i = 0; i < num_helpers; i++) {
            seed_est = seed_est * (size_t)(P - i) / (size_t)(i + 1);
            if (seed_est > (size_t)1 << 28) { seed_est = (size_t)1 << 28; break; }
        }
        dist.reserve(std::max(seed_est * 2, (size_t)1 << 20));
    }

    // Enumerate all C(P, num_helpers) combinations of helper placements.
    // Each combination with all exits EXITED forms one goal state.
    {
        int chosen[9] = {};
        std::function<void(int,int)> seed = [&](int start, int rem) {
            if (rem == 0) {
                int pos[10];
                for (int e = 0; e < num_exits; e++) pos[e] = EXITED;
                for (int h = 0; h < num_helpers; h++) pos[num_exits + h] = chosen[h];
                const State s = encode(pos, n);
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
                for (const State pred : preds)
                    if (dist.atomic_emplace(pred, (uint8_t)depth))
                        my_nxt.push_back(pred);
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
            for (const State pred : preds)
                if (dist.insert_new(pred, (uint8_t)depth))
                    nxt.push_back(pred);
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
        if (occ & ((uint64_t)1 << np)) { blocker_cell = np; break; }
        wr = nr; wc = nc;
    }

    if (blocker_cell < 0)             return false; // wall stop
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
//   Augmented state = (board_positions, last_mover_index).
//   Layer k contains all augmented states reachable from start in exactly k
//   individual slides (retrograde dist = D-k).  Within each layer we keep
//   only the minimum grouped cost per augmented state.
//   Cost of a slide: 0 if the same robot continues, 1 if a new robot moves.
//
// This is much cheaper than augmenting the retrograde BFS itself (which
// would multiply memory by n) because it only explores states reachable
// from a single starting position.

struct Move { int8_t mover, dir, blocker; };

static std::vector<Move> trace_solution(State start, int n, int num_exits,
                                         const FlatMap& dist)
{
    uint8_t start_dist;
    if (!dist.find_val(start, &start_dist) || start_dist == 0) return {};
    const int D = (int)start_dist;

    struct Node {
        State    s;
        int8_t   last_mover;   // 0..n-1, or n = "none" (initial)
        int      grouped_cost; // minimum grouped moves to reach here
        int      prev_idx;     // index in previous layer (-1 for start)
        Move     move;         // the slide that got us here
    };

    // One layer per individual slide (0 = start, D = goal).
    std::vector<std::vector<Node>> layers(D + 1);
    layers[0].push_back({start, (int8_t)n, 0, -1, {-1, -1, -1}});

    // Pack (state, last_mover) into a collision-free uint64_t key.
    // State occupies bits [0, 6*n); last_mover occupies bits [6*n, 6*n+4).
    const int shift = 6 * n;
    auto make_key = [shift](State s, int last) -> uint64_t {
        return s | ((uint64_t)(unsigned)last << shift);
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
                    if (!dist.find_val(new_state, &nd) || nd != target_dist)
                        continue;

                    const int cost = node.grouped_cost +
                                     (ridx == (int)node.last_mover ? 0 : 1);
                    const Move mv{(int8_t)ridx, (int8_t)d, (int8_t)blocker_idx};
                    const uint64_t key = make_key(new_state, ridx);

                    auto it = next_map.find(key);
                    if (it == next_map.end()) {
                        next_map[key] = (int)layers[step + 1].size();
                        layers[step + 1].push_back(
                            {new_state, (int8_t)ridx, cost, i, mv});
                    } else if (cost < layers[step + 1][it->second].grouped_cost) {
                        layers[step + 1][it->second] =
                            {new_state, (int8_t)ridx, cost, i, mv};
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
    if (best_idx < 0) return {};

    // Walk back through layers to reconstruct the move sequence.
    std::vector<Move> sol;
    sol.reserve(D);
    int idx = best_idx;
    for (int step = D; step > 0; step--) {
        sol.push_back(layers[step][idx].move);
        idx = layers[step][idx].prev_idx;
    }
    std::reverse(sol.begin(), sol.end());
    return sol;
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
                if (!dist.find_val(new_state, &nd) || nd != (uint8_t)(step - 1))
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
static std::string collision_signature(const std::vector<Move>& sol, int num_exits) {
    // exit_label[i] = assigned output char index (-1 = unseen)
    int exit_label[10];   std::fill(exit_label,   exit_label+10,   -1);
    int helper_label[10]; std::fill(helper_label, helper_label+10, -1);
    int next_exit   = 0; // 0->'A', 1->'B', 2->'C', ...
    int next_helper = 1; // 1->'1', 2->'2', ...

    auto exit_char = [](int lbl) -> char {
        return (char)('A' + lbl);
    };
    auto helper_char = [](int lbl) -> char {
        return (char)('0' + lbl);
    };

    std::string sig;
    for (const auto& m : sol) {
        // Assign labels on first appearance.
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

        char dc = "UDLR"[(int)m.dir];
        if (!sig.empty()) sig += ' ';
        sig += mc; sig += dc; sig += bc;
    }
    return sig;
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

// ── Output emitter (three-pass pipeline) ─────────────────────────────────────
// Pass 1: Scan BFS FlatMap, collect self-canonical initial states.
//         The BFS is D4-closed, so S == canonical(S) identifies exactly one
//         representative per equivalence class — no separate hash map needed.
// Pass 2: Fast greedy trace → collision signature hash → dedup.
//         Eliminates ~85% of states cheaply before the expensive DP trace.
// Pass 3: Full DP trace for survivors → minimum grouped moves → output.
//         Only ~15% of canonical states reach this phase.
static void emit(const FlatMap& dist, int n, int num_exits, int num_helpers,
                 int min_moves, int max_moves,
                 int& id, std::unordered_set<uint64_t>& seen_sigs,
                 std::unordered_set<uint64_t>& seen_pruned_canons,
                 int& emitted, int& deduped)
{
    using Clock = std::chrono::steady_clock;
    auto t0 = Clock::now();

    // ── Pass 1: collect self-canonical initial states ──
    struct Rec { State s; uint8_t d; };
    std::vector<Rec> all_initial;
    all_initial.reserve(dist.size() / 4);
    for (auto [s, d] : dist) {
        if (d == 0 || d < (uint8_t)min_moves || d > (uint8_t)max_moves) continue;
        int r[10]; decode(s, n, r);
        bool ok = true;
        for (int e = 0; e < num_exits; e++)
            if (r[e] == EXITED) { ok = false; break; }
        if (!ok) continue;
        all_initial.push_back({s, d});
    }

    // Filter for self-canonical states (parallel).
    std::vector<Rec> recs;
    {
        std::vector<bool> is_canon(all_initial.size());
#ifdef _OPENMP
        #pragma omp parallel for schedule(dynamic, 4096)
#endif
        for (int i = 0; i < (int)all_initial.size(); i++)
            is_canon[i] = (canonical(all_initial[i].s, n, num_exits) == all_initial[i].s);
        for (int i = 0; i < (int)all_initial.size(); i++)
            if (is_canon[i]) recs.push_back(all_initial[i]);
    }
    all_initial.clear();
    all_initial.shrink_to_fit();

    std::sort(recs.begin(), recs.end(), [](const Rec& a, const Rec& b) {
        return a.d != b.d ? a.d < b.d : a.s < b.s;
    });

    auto t1 = Clock::now();
    std::cerr << "  pass 1 (canonical filter): " << recs.size() << " states, "
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

    // ── Pass 3: DP trace for survivors → output ──
    std::vector<std::string> output_lines(survivors.size());
    std::vector<State> pruned_canons(survivors.size(), ~(State)0);

#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic, 64)
#endif
    for (int j = 0; j < (int)survivors.size(); j++) {
        const int i = survivors[j];
        auto sol = trace_solution(recs[i].s, n, num_exits, dist);
        if (sol.size() != (size_t)recs[i].d) continue;
        stabilise_indices(sol, recs[i].s, n, num_exits);

        int init_pos[10];
        decode(recs[i].s, n, init_pos);
        sort_exits_and_remap(init_pos, sol, num_exits);

        bool used[10];
        std::vector<Move> pruned;
        const int new_h = prune_unused_helpers(sol, num_exits, n, pruned, used);
        const int grouped_moves = count_grouped_moves(pruned);

        // Compute D4-canonical form of the PRUNED positions.
        // This catches cross-combo duplicates where different full states
        // produce the same pruned puzzle after unused helpers are removed.
        {
            int compact[10];
            int ci = 0;
            for (int e = 0; e < num_exits; e++) compact[ci++] = init_pos[e];
            for (int h = num_exits; h < n; h++)
                if (used[h]) compact[ci++] = init_pos[h];
            pruned_canons[j] = canonical(encode(compact, ci), ci, num_exits);
        }

        // Format output line (ID assigned sequentially below).
        std::string line;
        line.reserve(128);
        line += std::to_string(num_exits);  line += '|';
        line += std::to_string(new_h);      line += '|';
        line += std::to_string(grouped_moves); line += '|';

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
    // Dedup by D4-canonical form of pruned positions (catches cross-combo
    // duplicates where different helper counts prune to the same puzzle).
    emitted = 0;
    deduped = dup_count;
    int pruned_dup_count = 0;
    for (int j = 0; j < (int)output_lines.size(); j++) {
        if (output_lines[j].empty()) continue;
        if (!seen_pruned_canons.insert(pruned_canons[j]).second) {
            pruned_dup_count++;
            continue;
        }
        std::cout << ++id << '|' << output_lines[j] << '\n';
        emitted++;
    }

    auto t3 = Clock::now();
    std::cerr << "  pass 3 (DP trace + output): " << emitted << " emitted";
    if (pruned_dup_count > 0)
        std::cerr << ", " << pruned_dup_count << " cross-combo D4 dups removed";
    std::cerr << ", " << std::chrono::duration<double>(t3 - t2).count() << "s\n";
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    const int max_exits   = argc > 1 ? std::atoi(argv[1]) : 1;
    const int max_total   = argc > 2 ? std::atoi(argv[2]) : 6; // exits + helpers
    const int min_moves   = argc > 3 ? std::atoi(argv[3]) : 1;
    const int max_moves   = argc > 4 ? std::atoi(argv[4]) : 99;

#ifdef _OPENMP
    std::cerr << "OpenMP enabled (" << omp_get_max_threads() << " threads)\n";
#else
    std::cerr << "OpenMP not available — single-threaded\n";
#endif

    std::cout <<
        "# Lunar Lockout Puzzles\n"
        "# Generated by ll-solver/enumerate\n"
        "# Board: 7x7 (rows and cols 0-6), goal: all exits to center (3,3)\n"
        "# Exit robots disappear when they reach center; helpers are blockers only.\n"
        "# Deduplicated by collision signature.\n"
        "#\n"
        "# Format: id|exits|helpers|minMoves|exit0_r,c [exit1...] [helper...]|solution\n"
        "# solution: space-separated moves, each = moverDIRblocker\n"
        "#   A,B,C = exit robots (by ascending initial position)\n"
        "#   1-9   = helper robots (by ascending initial position)\n"
        "#   DIR: U=up  D=down  L=left  R=right\n"
        "#\n";

    std::unordered_set<uint64_t> seen_sigs;
    std::unordered_set<uint64_t> seen_pruned_canons;
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
            emit(dist, ne + nh, ne, nh, min_moves, max_moves,
                 id, seen_sigs, seen_pruned_canons, k_emitted, k_deduped);

            std::cerr << "  emitted: " << k_emitted
                      << "  deduped by collision sig: " << k_deduped << "\n";
            total_emitted += k_emitted;
        }
    }

    std::cerr << "\nTotal unique puzzles: " << total_emitted << "\n";
    return 0;
}
