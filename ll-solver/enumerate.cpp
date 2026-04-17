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
#include <cstdio>
#include <deque>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <functional>
#include <iostream>
#include <numeric>
#include <string>
#include <unistd.h>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#ifdef _OPENMP
#  include <omp.h>
#endif

// ── Memory instrumentation ──────────────────────────────────────────────────
// Reset the kernel's peak-RSS high-water mark (VmHWM) for this process so
// that the next VmHWM read reflects only activity from now on. This uses the
// CLEAR_REFS_MM_HIWATER_RSS operation (Linux 4.0+). Silently no-ops if the
// file isn't writable (unsupported kernel / sandbox).
static void reset_peak_rss() {
    int fd = ::open("/proc/self/clear_refs", O_WRONLY);
    if (fd >= 0) {
        const char buf[] = "5\n";
        (void)::write(fd, buf, sizeof(buf) - 1);
        ::close(fd);
    }
}

// Log current RSS and peak (VmHWM) with a label. Call reset_peak_rss() at the
// start of each phase so the "peak" field reflects the peak during that phase.
static void log_mem(const char* label) {
    long rss_kb = 0, hwm_kb = 0;
    FILE* f = std::fopen("/proc/self/status", "r");
    if (!f) return;
    char line[256];
    while (std::fgets(line, sizeof(line), f)) {
        if (std::strncmp(line, "VmRSS:", 6) == 0)
            std::sscanf(line + 6, " %ld", &rss_kb);
        else if (std::strncmp(line, "VmHWM:", 6) == 0)
            std::sscanf(line + 6, " %ld", &hwm_kb);
    }
    std::fclose(f);
    std::cerr << "  mem[" << label << "] rss=" << rss_kb / 1024 << " MB"
              << " peak=" << hwm_kb / 1024 << " MB\n";
}

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

// Per-variant block masks, initialized once in main(). Used by
// compute_variant_flags() to decide which variants a given puzzle position
// is valid for when emitting output. Independent of the active BLOCKED mask.
static uint64_t BLOCKED_MASK_SOLITAIRE = 0;
static uint64_t BLOCKED_MASK_UFO       = 0;
static uint64_t BLOCKED_MASK_FRENCH    = 0;

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
    FlatMap& operator=(FlatMap&& o) noexcept {
        if (this != &o) {
            std::free(data_);
            data_ = o.data_; cap_ = o.cap_; sz_ = o.sz_;
            km_ = o.km_; key_bits_ = o.key_bits_;
            o.data_ = nullptr; o.cap_ = o.sz_ = 0;
        }
        return *this;
    }

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

    [[noreturn]] void probe_panic(const char* fn, uint64_t k) const {
        std::fprintf(stderr,
            "FATAL FlatMap::%s: probe limit exhausted; key=0x%llx "
            "sz=%zu cap=%zu load=%.2f%% key_bits=%d\n",
            fn, (unsigned long long)k, sz_, cap_,
            cap_ ? 100.0 * (double)sz_ / (double)cap_ : 0.0, key_bits_);
        std::abort();
    }

    // Insert (k, v) if absent.  Returns true if newly inserted.
    bool insert_new(uint64_t k, uint8_t v) {
        if (__builtin_expect(sz_ * 4 >= cap_ * 3, 0))
            rehash(cap_ ? cap_ * 2 : 16);
        size_t h = hash(k) & (cap_ - 1);
        for (size_t probe = 0; probe < cap_; probe++) {
            if (data_[h] == EMPTY) {
                data_[h] = pack(k, v); ++sz_;
                return true;
            }
            if ((data_[h] & km_) == k) return false;
            h = (h + 1) & (cap_ - 1);
        }
        probe_panic("insert_new", k);
    }

    // Insert (k, v) or update existing entry's value.
    void upsert(uint64_t k, uint8_t v) {
        if (__builtin_expect(sz_ * 4 >= cap_ * 3, 0))
            rehash(cap_ ? cap_ * 2 : 16);
        size_t h = hash(k) & (cap_ - 1);
        for (size_t probe = 0; probe < cap_; probe++) {
            if (data_[h] == EMPTY) {
                data_[h] = pack(k, v); ++sz_;
                return;
            }
            if ((data_[h] & km_) == k) {
                data_[h] = pack(k, v);
                return;
            }
            h = (h + 1) & (cap_ - 1);
        }
        probe_panic("upsert", k);
    }

    // Prefetch the hash slot for key k into L1. Use this when you know you'll
    // soon call find_val/upsert/insert_new on k but want to overlap the
    // probable cache miss with compute. Linear probing usually stays within
    // one cache line, so prefetching the hash position covers most cases.
    void prefetch(uint64_t k) const {
        if (!cap_) return;
        size_t h = hash(k) & (cap_ - 1);
        __builtin_prefetch(&data_[h], 1 /*write*/, 0 /*NTA*/);
    }

    // Find k; if found sets *val and returns true.
    bool find_val(uint64_t k, uint8_t* val) const {
        if (!cap_) return false;
        size_t h = hash(k) & (cap_ - 1);
        for (size_t probe = 0; probe < cap_; probe++) {
            if (data_[h] == EMPTY) return false;
            if ((data_[h] & km_) == k) {
                *val = (uint8_t)(data_[h] >> key_bits_);
                return true;
            }
            h = (h + 1) & (cap_ - 1);
        }
        return false;
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
        for (size_t probe = 0; probe < cap_; probe++) {
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
        probe_panic("atomic_emplace", k);
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

// ── Augmented retrograde 0-1 BFS (grouped-move-optimal) ───────────────────────
//
// Computes the minimum GROUPED MOVES to goal for every reachable augmented
// state (positions, last_mover_cell).  This is a 0-1 BFS working backward
// from goal states, using the same augmentation as solve_min_grouped() but
// applied to ALL states simultaneously.
//
// Two-phase level-synchronous parallel BFS:
//   Phase A: saturate cost-0 edges (same robot continuing) at each cost level
//   Phase B: advance cost-1 edges to the next level
//
// Returns a FlatMap with key_bits = 6*(n+1): 6n bits for positions + 6 bits
// for last_mover_cell.  Value is the grouped-move cost (uint8_t).

// Canonicalize an augmented state: apply symmetry transforms to both
// positions AND last_mover_cell, pick the lexicographic minimum.
static uint64_t canonical_aug(State base_state, int last_cell, int n, int num_exits, int shift) {
    // For now: sort helpers only (no symmetry transforms) to match the
    // encoding convention, but don't apply D4/Klein spatial transforms.
    // This tests the core 0-1 BFS logic without canonicalization interference.
    // TODO: re-enable symmetry once the core logic is validated.
    int r[10];
    decode(base_state, n, r);
    std::sort(r,            r + num_exits);
    std::sort(r + num_exits, r + n);
    const State ts = encode(r, n);
    return ts | ((uint64_t)(unsigned)last_cell << shift);
}

// Generate augmented predecessors for state (S, L) at retrograde cost c.
// Only reverses the robot at L (the last mover in forward time).
// For each reverse-slide direction, emits:
//   (P, p_prev) at cost c+0 (same robot continuing) → appended to out_zero
//   (P, M) for each M ≠ p_prev at cost c+1 → appended to out_one
static void generate_augmented_predecessors(
    State s, int last_cell, int n, int num_exits, int shift,
    std::vector<uint64_t>& out_zero,
    std::vector<uint64_t>& out_one)
{
    int pos[10];
    decode(s, n, pos);

    uint64_t full_occ = 0;
    for (int j = 0; j < n; j++)
        if (pos[j] != EXITED) full_occ |= (uint64_t)1 << pos[j];

    // Find which robot is at last_cell.  If last_cell == EXITED, it's an
    // exited exit — we need to un-exit it.
    if (last_cell == EXITED) {
        // Un-exit: for each exit that's EXITED, try un-exiting it.
        // Center must be unoccupied.
        if (full_occ & ((uint64_t)1 << CTR)) return;

        for (int eidx = 0; eidx < num_exits; eidx++) {
            if (pos[eidx] != EXITED) continue;
            const int ctr_r = CTR / N, ctr_c = CTR % N;
            for (int d = 0; d < NUM_DIRS; d++) {
                // Exit slid in direction d to reach center.
                // Blocker must exist one step past center in direction d.
                const int blr = ctr_r + DR[d], blc = ctr_c + DC[d];
                if (blr < 0 || blr >= N || blc < 0 || blc >= N) continue;
                const int bp = blr * N + blc;
                if (BLOCKED & ((uint64_t)1 << bp)) continue;
                if (!(full_occ & ((uint64_t)1 << bp))) continue;

                // Walk away from center to find valid predecessor positions.
                for (int k = 1; ; k++) {
                    const int wr = ctr_r - k * DR[d], wc = ctr_c - k * DC[d];
                    if (wr < 0 || wr >= N || wc < 0 || wc >= N) break;
                    const int wp = wr * N + wc;
                    if (BLOCKED & ((uint64_t)1 << wp)) break;
                    if (full_occ & ((uint64_t)1 << wp)) break;

                    // Build predecessor positions with exit at wp.
                    int nr[10];
                    std::memcpy(nr, pos, n * sizeof(int));
                    nr[eidx] = wp;
                    std::sort(nr + num_exits, nr + n);
                    const State ps = encode(nr, n);

                    // Cost-0: same exit was continuing → pred last_cell = wp
                    out_zero.push_back(canonical_aug(ps, wp, n, num_exits, shift));

                    // Cost-1: exit was a new mover → pred last_cell = any other robot.
                    // The un-exited exit is now at wp; skip it (already cost-0).
                    for (int j = 0; j < n; j++) {
                        const int m = nr[j];
                        if (m == EXITED || m == wp) continue;
                        out_one.push_back(canonical_aug(ps, m, n, num_exits, shift));
                    }
                    // Multi-exit: if predecessor still has EXITED exits, emit (P, EXITED).
                    for (int e = 0; e < num_exits; e++) {
                        if (nr[e] == EXITED) {
                            out_one.push_back(canonical_aug(ps, EXITED, n, num_exits, shift));
                            break;
                        }
                    }
                }
            }
        }
        return;
    }

    // Normal case: last_cell is a valid board cell.  Find the robot there.
    int ridx = -1;
    for (int j = 0; j < n; j++) {
        if (pos[j] == last_cell) { ridx = j; break; }
    }
    if (ridx < 0) return;  // shouldn't happen in a valid augmented state

    const int pr = last_cell / N, pc = last_cell % N;
    const uint64_t occ_without_r = full_occ ^ ((uint64_t)1 << last_cell);

    for (int d = 0; d < NUM_DIRS; d++) {
        // Robot ridx slid in direction d to reach last_cell.
        // Blocker must exist one step past last_cell in direction d.
        const int blr = pr + DR[d], blc = pc + DC[d];
        if (blr < 0 || blr >= N || blc < 0 || blc >= N) continue;
        const int bp = blr * N + blc;
        if (BLOCKED & ((uint64_t)1 << bp)) continue;
        if (!(occ_without_r & ((uint64_t)1 << bp))) continue;

        // Walk backward (opposite direction) to find valid starting positions.
        int wr = pr, wc = pc;
        for (;;) {
            wr -= DR[d]; wc -= DC[d];
            if (wr < 0 || wr >= N || wc < 0 || wc >= N) break;
            const int wp = wr * N + wc;
            if (BLOCKED & ((uint64_t)1 << wp)) break;
            if (occ_without_r & ((uint64_t)1 << wp)) break;

            // Exit at center: skip (exit landing on center = exit event, not a
            // valid predecessor position for an exit), but continue walking.
            if (wp == CTR && ridx < num_exits) continue;

            int nr[10];
            std::memcpy(nr, pos, n * sizeof(int));
            nr[ridx] = wp;
            std::sort(nr + num_exits, nr + n);
            const State ps = encode(nr, n);

            // Cost-0: same robot was continuing → pred last_cell = wp
            out_zero.push_back(canonical_aug(ps, wp, n, num_exits, shift));

            // Cost-1: this robot was a new mover → pred last_cell = any other robot.
            // The reversed robot is now at position wp; skip it (already cost-0).
            // After sorting, the index may have changed, so identify by position.
            for (int j = 0; j < n; j++) {
                const int m = nr[j];
                if (m == EXITED || m == wp) continue;
                out_one.push_back(canonical_aug(ps, m, n, num_exits, shift));
            }
            // Multi-exit: if the predecessor has any EXITED exit, also emit
            // (P, EXITED) as a cost-1 predecessor. This represents "the last
            // forward move from P was an exit reaching center."
            for (int e = 0; e < num_exits; e++) {
                if (nr[e] == EXITED) {
                    out_one.push_back(canonical_aug(ps, EXITED, n, num_exits, shift));
                    break;  // one EXITED suffices
                }
            }
        }
    }
}

static FlatMap retrograde_grouped(int num_exits, int num_helpers)
{
    const int n = num_exits + num_helpers;
    const int shift = 6 * n;

    // Augmented key: 6n bits for positions + 6 bits for last_mover_cell.
    FlatMap dist(shift + 6);

    // Pool of valid non-center cells for helpers.
    std::vector<int> pool;
    pool.reserve(NC - 1);
    for (int i = 0; i < NC; i++)
        if (i != CTR && !(BLOCKED & ((uint64_t)1 << i))) pool.push_back(i);
    const int P = (int)pool.size();

    // Seed: insert all goal augmented states at cost 0.
    // Goal states have all exits EXITED.  The last move to reach a goal is
    // always an exit reaching center → last_mover_cell = EXITED (matching
    // solve_min_grouped's convention: landing = EXITED when exit reaches CTR).
    std::vector<uint64_t> cur_zero;  // cost-0 frontier for current level
    std::vector<uint64_t> cur_one;   // cost-1 frontier (deferred to next level)

    {
        int chosen[9] = {};
        size_t seed_count = 0;
        std::function<void(int,int)> seed = [&](int start, int rem) {
            if (rem == 0) {
                int pos[10];
                for (int e = 0; e < num_exits; e++) pos[e] = EXITED;
                for (int h = 0; h < num_helpers; h++) pos[num_exits + h] = chosen[h];
                const State s = encode(pos, n);
                const uint64_t aug_key = canonical_aug(s, EXITED, n, num_exits, shift);
                if (dist.insert_new(aug_key, (uint8_t)0)) {
                    cur_zero.push_back(aug_key);
                    seed_count++;
                }
                return;
            }
            for (int i = start; i <= P - rem; i++) {
                chosen[num_helpers - rem] = pool[i];
                seed(i+1, rem-1);
            }
        };

        // Reserve generously before seeding.
        size_t seed_est = 1;
        for (int i = 0; i < num_helpers; i++) {
            seed_est = seed_est * (size_t)(P - i) / (size_t)(i + 1);
            if (seed_est > (size_t)1 << 28) { seed_est = (size_t)1 << 28; break; }
        }
        dist.reserve(std::max(seed_est * 4, (size_t)1 << 20));
        seed(0, num_helpers);
        std::cerr << "  seeded " << seed_count << " augmented goal states at cost 0\n";
    }

    std::cerr << "  augmented seed: " << cur_zero.size() << " goal states at cost 0\n";

    // Two-phase level-synchronous 0-1 BFS.
    for (int cost = 0; cost <= 254; cost++) {
        // Phase A: saturate cost-0 edges at this level.
        // cur_zero holds states discovered at this cost level.
        // Expanding cost-0 edges may discover more states at the SAME cost.
        while (!cur_zero.empty()) {
            std::vector<uint64_t> next_zero, next_one;

#ifdef _OPENMP
            dist.ensure_parallel_capacity(dist.size() + cur_zero.size() * (size_t)NUM_DIRS * (size_t)n);
            const int nthreads = omp_get_max_threads();
            std::vector<std::vector<uint64_t>> tl_zero(nthreads), tl_one(nthreads);
            for (auto& v : tl_zero) v.clear();
            for (auto& v : tl_one) v.clear();

            #pragma omp parallel if(cur_zero.size() >= 4096)
            {
                const int tid = omp_get_thread_num();
                std::vector<uint64_t> my_z, my_o;
                my_z.reserve(128); my_o.reserve(512);

                #pragma omp for schedule(dynamic, 64)
                for (int i = 0; i < (int)cur_zero.size(); i++) {
                    const uint64_t key = cur_zero[i];
                    const State s = key & (((uint64_t)1 << shift) - 1);
                    const int lc = (int)(key >> shift) & 63;

                    my_z.clear(); my_o.clear();
                    generate_augmented_predecessors(s, lc, n, num_exits, shift, my_z, my_o);

                    for (const uint64_t k : my_z) {
                        if (dist.atomic_emplace(k, (uint8_t)cost))
                            tl_zero[tid].push_back(k);
                    }
                    for (const uint64_t k : my_o) {
                        if (cost + 1 <= 254 && dist.atomic_emplace(k, (uint8_t)(cost + 1)))
                            tl_one[tid].push_back(k);
                    }
                }
            }
            for (auto& v : tl_zero) next_zero.insert(next_zero.end(), v.begin(), v.end());
            for (auto& v : tl_one) next_one.insert(next_one.end(), v.begin(), v.end());
#else
            std::vector<uint64_t> z_buf, o_buf;
            z_buf.reserve(128); o_buf.reserve(512);
            for (const uint64_t key : cur_zero) {
                const State s = key & (((uint64_t)1 << shift) - 1);
                const int lc = (int)(key >> shift) & 63;

                z_buf.clear(); o_buf.clear();
                generate_augmented_predecessors(s, lc, n, num_exits, shift, z_buf, o_buf);

                for (const uint64_t k : z_buf) {
                    uint8_t existing;
                    if (!dist.find_val(k, &existing)) {
                        dist.insert_new(k, (uint8_t)cost);
                        next_zero.push_back(k);
                    } else if ((int)existing > cost) {
                        dist.upsert(k, (uint8_t)cost);
                        next_zero.push_back(k);  // re-expand at lower cost
                    }
                }
                for (const uint64_t k : o_buf) {
                    if (cost + 1 > 254) continue;
                    uint8_t existing;
                    if (!dist.find_val(k, &existing)) {
                        dist.insert_new(k, (uint8_t)(cost + 1));
                        next_one.push_back(k);
                    } else if ((int)existing > cost + 1) {
                        dist.upsert(k, (uint8_t)(cost + 1));
                        next_one.push_back(k);
                    }
                }
            }
#endif
            cur_zero.swap(next_zero);
            // Accumulate cost-1 discoveries for the next level.
            cur_one.insert(cur_one.end(), next_one.begin(), next_one.end());
        }

        if (cost % 5 == 0 || cur_one.empty())
            std::cerr << "  grouped cost " << cost
                      << ": total=" << dist.size() << "\n";

        if (cur_one.empty()) break;

        // Phase B: advance to next cost level.
        cur_zero.swap(cur_one);
        cur_one.clear();
    }

    std::cerr << "  augmented retrograde done: " << dist.size() << " augmented states\n";
    return dist;
}

// ── Forward-move simulation ───────────────────────────────────────────────────
// Slides robot ridx in direction dir from persistent positions pos[].
// Exit robots: position becomes EXITED if they land on center.
// Returns true if the move is legal (stopped by a robot, actually moved).
// new_state has helpers sorted; exits maintain their fixed indices.
// Precompute occupancy bitmask for all robots.  Callers that expand
// multiple robots from the same state should compute this once and pass it.
static inline uint64_t make_occ(const int* pos, int n) {
    uint64_t occ = 0;
    for (int i = 0; i < n; i++)
        if (pos[i] != EXITED) occ |= (uint64_t)1 << pos[i];
    return occ;
}

static bool forward_move(const int* pos, int n, int num_exits, int ridx, int dir,
                         int& new_cell, int& blocker_idx, State& new_state,
                         uint64_t all_occ = 0)
{
    if (ridx < num_exits && pos[ridx] == EXITED) return false; // already exited

    const int cur = pos[ridx];
    const int pr  = cur / N, pc = cur % N;

    // If caller passed precomputed occupancy, remove self; otherwise build from scratch.
    uint64_t occ = all_occ ? (all_occ & ~((uint64_t)1 << cur))
                           : make_occ(pos, n) & ~((uint64_t)1 << cur);

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
            const uint64_t occ = make_occ(pos, n);

            for (int ridx = 0; ridx < n; ridx++) {
                for (int d = 0; d < NUM_DIRS; d++) {
                    int new_cell, blocker_idx;
                    State new_state;
                    if (!forward_move(pos, n, num_exits, ridx, d,
                                      new_cell, blocker_idx, new_state, occ))
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
        const uint64_t occ = make_occ(pos, n);
        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns, occ))
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
    // FlatMap (~8-11 bytes/state with load factor) instead of unordered_set
    // (~50-80 bytes/state) — critical for parallel Layer 3 dedup where 16
    // threads each run this BFS on per-puzzle reachable state sets that can
    // reach 10M+ entries for hard 7-piece puzzles.
    FlatMap seen(6 * n);  // key = state bits; value slot unused (always 0)
    std::vector<State> queue;
    queue.push_back(start);
    seen.insert_new(start, 0);
    size_t head = 0;
    while (head < queue.size()) {
        State s = queue[head++];
        int pos[10];
        decode(s, n, pos);
        const uint64_t occ = make_occ(pos, n);
        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns, occ))
                    continue;
                if (seen.insert_new(ns, 0))
                    queue.push_back(ns);
            }
        }
    }
    std::sort(queue.begin(), queue.end());
    return queue;
}

// Parallel level-synchronous variant of forward_bfs_states. Uses a shared
// FlatMap with lock-free atomic_emplace and per-thread next-frontier vectors
// merged after each level. This is the same pattern as Stage 1's retrograde()
// (parallel BFS over plain states).
//
// Designed for use inside Layer 3 (Stage 4 dedup) under a 4-outer × 4-inner
// nested OpenMP scheme. inner_threads bounds the inner parallel region.
//
// On trivial puzzles (frontiers <256) the inner parallel region degenerates
// to serial via `if(cur.size() >= 256)`, so easy puzzles don't pay
// thread-spawn overhead.
static std::vector<State>
forward_bfs_states_parallel(State start, int n, int num_exits, int inner_threads)
{
    FlatMap seen(6 * n);  // key = state bits; value slot unused (always 0)
    seen.insert_new(start, 0);
    std::vector<State> cur, nxt;
    cur.push_back(start);

    if (inner_threads < 1) inner_threads = 1;
    std::vector<std::vector<State>> nxt_locals(inner_threads);

    while (!cur.empty()) {
        // Pre-grow seen to keep load factor ≤75% during the parallel section.
        // Worst-case branching per source state is NUM_DIRS × n (every robot,
        // every direction produces a unique successor). The old factor of 8
        // was wildly too small for hex 6-piece (branching = 36), and when
        // atomic_emplace runs out of slots mid-parallel the probe loop
        // spins forever. Factor = NUM_DIRS × n + headroom covers any variant.
        const size_t branch_bound = (size_t)(NUM_DIRS * n) + 4;
        seen.ensure_parallel_capacity(seen.size() + cur.size() * branch_bound + 64);
        for (auto& v : nxt_locals) v.clear();

#ifdef _OPENMP
        #pragma omp parallel num_threads(inner_threads) if(cur.size() >= 256)
#endif
        {
#ifdef _OPENMP
            const int tid = omp_get_thread_num();
#else
            const int tid = 0;
#endif
            std::vector<State>& my_nxt = nxt_locals[tid];

#ifdef _OPENMP
            #pragma omp for schedule(dynamic, 64)
#endif
            for (int i = 0; i < (int)cur.size(); i++) {
                State s = cur[i];
                int pos[10];
                decode(s, n, pos);
                const uint64_t occ = make_occ(pos, n);
                for (int ridx = 0; ridx < n; ridx++) {
                    for (int d = 0; d < NUM_DIRS; d++) {
                        int nc, bi;
                        State ns;
                        if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns, occ))
                            continue;
                        if (seen.atomic_emplace(ns, 0))
                            my_nxt.push_back(ns);
                    }
                }
            }
        }

        nxt.clear();
        for (auto& v : nxt_locals)
            nxt.insert(nxt.end(), v.begin(), v.end());
        cur.swap(nxt);
    }

    // Materialize the seen set as a sorted vector (same return contract as
    // the serial version). The state portion of each FlatMap key is the low
    // 6n bits; the upper bits hold the (unused) value slot.
    const uint64_t state_mask = (n >= 10) ? ~(uint64_t)0 : ((uint64_t)1 << (6 * n)) - 1;
    std::vector<State> out;
    out.reserve(seen.size());
    for (auto kv : seen) out.push_back((State)(kv.first & state_mask));
    std::sort(out.begin(), out.end());
    return out;
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
// Forward DFS through the BFS DAG to reconstruct a solution path.
// `visited` contains cost for each augmented (state, last_cell) key.
// We walk forward from cur_key using forward_move, taking only edges that
// match the expected cost in `visited`, until we reach a goal state.
//
// The `in_path` set prevents revisiting states during this DFS (avoids
// cycles in the edge_cost=0 subgraph). On dead-end, we backtrack.
static bool forward_dfs_trace(
    uint64_t cur_key, int cur_cost, int target_cost,
    int n, int num_exits, int shift,
    const FlatMap& visited,
    std::unordered_set<uint64_t>& in_path,
    std::vector<Move>& sol)
{
    const uint64_t km = ((uint64_t)1 << shift) - 1;
    const State s = cur_key & km;
    const int last_cell = (int)(cur_key >> shift);

    // Goal check: all exits are EXITED.
    {
        int pos[10]; decode(s, n, pos);
        bool at_goal = true;
        for (int e = 0; e < num_exits; e++)
            if (pos[e] != EXITED) { at_goal = false; break; }
        if (at_goal && cur_cost == target_cost) return true;
    }

    int pos[10];
    decode(s, n, pos);
    const uint64_t occ = make_occ(pos, n);

    for (int ridx = 0; ridx < n; ridx++) {
        for (int d = 0; d < NUM_DIRS; d++) {
            int nc, bi;
            State ns;
            if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns, occ))
                continue;

            const int mover_cell = pos[ridx];
            const int edge_cost = (mover_cell == last_cell) ? 0 : 1;
            const int new_cost = cur_cost + edge_cost;
            if (new_cost > target_cost) continue;

            const int landing = (ridx < num_exits && nc == CTR) ? EXITED : nc;
            const uint64_t nk = ns | ((uint64_t)(unsigned)landing << shift);

            // Only take edges that match the BFS-optimal cost at the next node.
            uint8_t stored;
            if (!visited.find_val(nk, &stored)) continue;
            if ((int)stored != new_cost) continue;

            if (in_path.count(nk)) continue;  // avoid cycles

            sol.push_back({(int8_t)ridx, (int8_t)d, (int8_t)bi});
            in_path.insert(nk);
            if (forward_dfs_trace(nk, new_cost, target_cost, n, num_exits,
                                    shift, visited, in_path, sol))
                return true;
            in_path.erase(nk);
            sol.pop_back();
        }
    }
    return false;
}

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

    // Augmented key layout: state (6n bits) | last_cell (6 bits).
    // FlatMap packs (key, 1-byte cost) into a single 64-bit word per slot —
    // ~7x smaller than std::unordered_map with a 24-byte NodeInfo value.
    // The solution path is reconstructed via find_predecessor_for_backtrace
    // so we don't need to store parent pointers.
    FlatMap visited(shift + 6);
    std::deque<uint64_t> queue;

    const uint64_t start_key = make_key(start, EXITED);
    visited.insert_new(start_key, 0);
    queue.push_back(start_key);

    uint64_t best_goal_key = 0;
    int best_goal_cost = INT_MAX;

    while (!queue.empty()) {
        const uint64_t key = queue.front();
        queue.pop_front();

        uint8_t stored_cost_u8;
        if (!visited.find_val(key, &stored_cost_u8)) continue;
        const int cost = (int)stored_cost_u8;
        if (cost >= best_goal_cost) continue;  // prune

        const State s = key & (((uint64_t)1 << shift) - 1);
        const int last_cell = (int)(key >> shift);

        int pos[10];
        decode(s, n, pos);
        const uint64_t occ = make_occ(pos, n);

        // ── Two-phase successor expansion with FlatMap prefetching ──
        //
        // Phase 1 generates all successors into a small stack buffer and
        // issues a prefetch for each successor's hash slot. This overlaps
        // ~40 potential cache misses with compute-heavy work (forward_move,
        // decode, goal check). By the time Phase 2 does the find_val/upsert,
        // the cache lines have arrived, turning ~40 serialized misses into
        // a near-pipelined single-miss equivalent.
        //
        // The order of successors in `succs` is preserved into Phase 2, so
        // deque push order (and thus 0-1 BFS correctness) is unchanged.
        struct Succ {
            uint64_t nk;
            int      new_cost;
            bool     edge_is_zero;
            bool     is_goal;
        };
        Succ succs[64];  // max successors = n * NUM_DIRS ≤ 9 * 6 = 54
        int num_succs = 0;

        // Phase 1: generate + prefetch.
        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns, occ))
                    continue;

                const int mover_cell = pos[ridx];
                const int edge_cost = (mover_cell == last_cell) ? 0 : 1;
                const int new_cost = cost + edge_cost;
                if (new_cost >= best_goal_cost) continue;
                if (new_cost > 255) continue;  // FlatMap value is uint8_t

                const int landing = (ridx < num_exits && nc == CTR) ? EXITED : nc;
                const uint64_t nk = make_key(ns, landing);

                // Goal check (stack-only, no cache impact).
                int npos[10];
                decode(ns, n, npos);
                bool is_goal = true;
                for (int e = 0; e < num_exits; e++)
                    if (npos[e] != EXITED) { is_goal = false; break; }

                succs[num_succs++] = {nk, new_cost, edge_cost == 0, is_goal};

                // Prefetch the hash slot that find_val/upsert will probe.
                visited.prefetch(nk);
            }
        }

        // Phase 2: relax visited map + enqueue (cache is warm).
        for (int i = 0; i < num_succs; i++) {
            const Succ& s = succs[i];

            // Re-check cost bound: an earlier Phase-2 iteration may have
            // improved best_goal_cost and made this successor obsolete.
            if (s.new_cost >= best_goal_cost) continue;

            uint8_t existing_u8;
            if (visited.find_val(s.nk, &existing_u8) && (int)existing_u8 <= s.new_cost)
                continue;

            visited.upsert(s.nk, (uint8_t)s.new_cost);

            if (s.is_goal) {
                if (s.new_cost < best_goal_cost) {
                    best_goal_cost = s.new_cost;
                    best_goal_key  = s.nk;
                }
                continue;  // don't expand goal states
            }

            if (s.edge_is_zero) queue.push_front(s.nk);
            else                queue.push_back(s.nk);
        }
    }

    if (best_goal_cost == INT_MAX) return {{}, 0};

    // Forward DFS from start_key to goal using the BFS costs as a guide.
    std::vector<Move> sol;
    std::unordered_set<uint64_t> in_path;
    in_path.insert(start_key);
    if (!forward_dfs_trace(start_key, 0, best_goal_cost, n, num_exits,
                            shift, visited, in_path, sol)) {
        std::cerr << "SOLVE_DFS_FAIL start=" << start << " bgc=" << best_goal_cost << "\n";
        return {{}, 0};
    }
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
        const uint64_t occ = make_occ(pos, n);
        bool found = false;
        for (int ridx = 0; ridx < n && !found; ridx++) {
            for (int d = 0; d < NUM_DIRS && !found; d++) {
                int new_cell, blocker_idx;
                State new_state;
                if (!forward_move(pos, n, num_exits, ridx, d,
                                  new_cell, blocker_idx, new_state, occ))
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

// Compute FNV-1a hash of the "e{num_exits}h{new_h}|{sig}" dedup key directly,
// without materializing the key string. Byte-for-byte equivalent to:
//   hash_dedup_key("e" + to_string(num_exits) + "h" + to_string(new_h) + "|" + sig)
// but skips 4-5 heap allocations per call — a big deal in the pass 2 hot loop
// that runs once per BFS survivor (hundreds of millions for large combos).
static uint64_t compute_dedup_hash(const std::string& sig, int num_exits, int new_h) {
    uint64_t h = 0xcbf29ce484222325ULL;
    auto feed = [&](unsigned char c) { h ^= c; h *= 0x100000001b3ULL; };
    auto feed_int = [&](int v) {
        char buf[12];
        int n = std::snprintf(buf, sizeof(buf), "%d", v);
        for (int i = 0; i < n; i++) feed((unsigned char)buf[i]);
    };
    feed('e');
    feed_int(num_exits);
    feed('h');
    feed_int(new_h);
    feed('|');
    for (unsigned char c : sig) feed(c);
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

// Build a collision signature for a single direction transform into `out`.
// `out` is .clear()'d first so the caller can provide a reusable scratch buffer
// (no heap alloc per call after the first few — critical in the pass 2 hot loop).
static void collision_signature_for_transform(
    const std::vector<Move>& sol, int num_exits, const int* dir_map,
    std::string& out)
{
    int exit_label[10];   std::fill(exit_label,   exit_label+10,   -1);
    int helper_label[10]; std::fill(helper_label, helper_label+10, -1);
    int next_exit   = 0;
    int next_helper = 1;

    out.clear();
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

        char mc = (m.mover < num_exits)
            ? (char)('A' + exit_label[(int)m.mover])
            : (char)('0' + helper_label[(int)m.mover - num_exits]);
        char bc = (m.blocker < num_exits)
            ? (char)('A' + exit_label[(int)m.blocker])
            : (char)('0' + helper_label[(int)m.blocker - num_exits]);

        int mapped_dir = dir_map[(int)m.dir];
        if (!out.empty()) out += ' ';
        out += mc;
        if (BOARD_TYPE == BOARD_HEX) {
            static const char* HEX_DIR_CHARS[6] = {"Nw","Se","Sw","Ne","No","So"};
            out += HEX_DIR_CHARS[mapped_dir];
        } else {
            out += "UDLR"[mapped_dir];
        }
        out += bc;
    }
}

// Build the D4-minimal collision signature into `best`. Uses a thread-local
// scratch buffer so each call reuses the same heap allocation instead of
// allocating a fresh string per symmetry transform. Caller provides `best`,
// also reusable.
static void collision_signature(const std::vector<Move>& sol, int num_exits,
                                  std::string& best)
{
    thread_local std::string scratch;
    best.clear();
    for (int ti = 0; ti < NUM_SYMS; ti++) {
        const int* dir_map = (BOARD_TYPE == BOARD_HEX)
            ? HEX_DIR_TRANSFORM[ti]
            : DIR_TRANSFORM[SYM_INDICES[ti]];
        collision_signature_for_transform(sol, num_exits, dir_map, scratch);
        if (best.empty() || scratch < best) best = scratch;
    }
}

// Legacy convenience wrapper for tests and anything that wants a return-by-value.
// Not used by the hot loops — they call the 3-arg form directly with a
// thread-local scratch buffer.
static std::string collision_signature(const std::vector<Move>& sol, int num_exits) {
    std::string out;
    collision_signature(sol, num_exits, out);
    return out;
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

// ── Variant flags for unified output ─────────────────────────────────────────
// Each bit indicates which variant this puzzle is valid for. Bits are:
//   0: fits standard   (always 1 — no blocks)
//   1: fits solitaire  (pieces avoid solitaire corner masks)
//   2: fits ufo        (pieces all in the 5x5 inner)
//   3: fits french     (pieces avoid french corner masks)
//   4: fits hex        (same geometric constraint as ufo: 5x5 inner)
//   5: fits beehive    (always 1 — full 7x7 hex diamond)
//   6: requires diagonal (solution uses dir >= 4; disqualifies cardinal variants)
// The web app's runtime filter combines these — cardinal variants
// (standard/solitaire/ufo/french) additionally require !requires_diagonal.
static int compute_variant_flags(const int* pos, int n,
                                  const std::vector<Move>& final_sol) {
    int flags = 0;
    auto fits_blocks = [&](uint64_t blocked) {
        for (int i = 0; i < n; i++) {
            if (pos[i] == EXITED) continue;
            if (blocked & ((uint64_t)1 << pos[i])) return false;
        }
        return true;
    };
    flags |= 1 << 0;                                            // fits standard
    if (fits_blocks(BLOCKED_MASK_SOLITAIRE)) flags |= 1 << 1;   // fits solitaire
    if (fits_blocks(BLOCKED_MASK_UFO))       flags |= 1 << 2;   // fits ufo
    if (fits_blocks(BLOCKED_MASK_FRENCH))    flags |= 1 << 3;   // fits french
    if (fits_blocks(BLOCKED_MASK_UFO))       flags |= 1 << 4;   // fits hex (same as ufo)
    flags |= 1 << 5;                                            // fits beehive
    for (const auto& m : final_sol)
        if ((int)m.dir >= 4) { flags |= 1 << 6; break; }
    return flags;
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

// Shared state record for passes 1-3. Lives at file scope so prefilter_diverse
// can access it directly without copying into parallel vectors.
struct Rec { State s; uint8_t d; };

// ── Pre-filter: farthest-point sampling by position diversity ────────────────
// Buckets survivors by minRawSlides, then selects at most max_per_bucket
// using farthest-point sampling on position fingerprints (sorted pairwise
// Manhattan distances).  Returns indices into the input vector to keep.
//
// FP is a fixed-size struct (no per-entry heap allocation) — this is critical
// for large combos where we can have 100M+ survivors; using std::vector<int>
// for each fingerprint would allocate ~8 GB of heap overhead.
// For n ≤ 10 robots, max pairs = n*(n-1)/2 = 45, so dists[45] handles any size.
static std::vector<int> prefilter_diverse(
    const std::vector<int>& survivor_indices,
    const std::vector<Rec>& recs,
    int n, int max_per_bucket)
{
    if (max_per_bucket <= 0)
        return survivor_indices; // no filtering

    using Clock = std::chrono::steady_clock;
    auto t0 = Clock::now();

    // Compute position fingerprints: sorted pairwise Manhattan distances.
    // Also compute centered odd square size per puzzle — used as a second
    // bucket dimension so 5x5-fitting puzzles get their own sub-bucket
    // rather than being crowded out by 7x7-spread puzzles in the same
    // minRawSlides bucket.
    struct FP {
        uint8_t n_dists;      // count of valid entries (≤ n*(n-1)/2)
        int8_t  dists[45];    // sorted pairwise Manhattan distances
    };
    std::vector<FP> fps(survivor_indices.size());
    std::vector<int8_t> square_sizes(survivor_indices.size(), 7);
#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic, 256)
#endif
    for (int k = 0; k < (int)survivor_indices.size(); k++) {
        int i = survivor_indices[k];
        int pos[10];
        decode(recs[i].s, n, pos);
        auto& fp = fps[k];
        fp.n_dists = 0;
        int max_cheb = 0;
        const int cr = CTR / N, cc = CTR % N;
        for (int a = 0; a < n; a++) {
            if (pos[a] == EXITED) continue;
            int ra = pos[a] / N, ca = pos[a] % N;
            int ch = std::max(std::abs(ra - cr), std::abs(ca - cc));
            if (ch > max_cheb) max_cheb = ch;
            for (int b = a + 1; b < n; b++) {
                if (pos[b] == EXITED) continue;
                int d = std::abs(ra - pos[b]/N) + std::abs(ca - pos[b]%N);
                fp.dists[fp.n_dists++] = (int8_t)d;
            }
        }
        std::sort(fp.dists, fp.dists + fp.n_dists);
        square_sizes[k] = (int8_t)(2 * max_cheb + 1);
    }

    // Bucket by (minRawSlides, square_size). Packing both into a 16-bit key:
    // high 12 bits = depth, low 4 bits = square_size (1, 3, 5, or 7).
    auto bucket_key = [&](int k) -> int {
        return ((int)recs[survivor_indices[k]].d << 4) | (int)square_sizes[k];
    };
    std::unordered_map<int, std::vector<int>> buckets;
    for (int k = 0; k < (int)survivor_indices.size(); k++)
        buckets[bucket_key(k)].push_back(k);

    // Farthest-point sampling within each bucket.
    auto fp_dist_sq = [](const FP& a, const FP& b) -> int64_t {
        int64_t total = 0;
        int n = std::max((int)a.n_dists, (int)b.n_dists);
        for (int i = 0; i < n; i++) {
            int va = i < a.n_dists ? a.dists[i] : 0;
            int vb = i < b.n_dists ? b.dists[i] : 0;
            int64_t d = va - vb;
            total += d * d;
        }
        return total;
    };

    std::vector<int> kept;
    kept.reserve(survivor_indices.size());
    int filtered_count = 0;

    for (auto& [bkey, kindices] : buckets) {
        int bsz = (int)kindices.size();
        if (bsz <= max_per_bucket) {
            for (int k : kindices) kept.push_back(survivor_indices[k]);
            continue;
        }

        // Farthest-point sampling.
        // For large buckets, subsample 10*N candidates first.
        std::vector<int>* pool = &kindices;
        std::vector<int> subsampled;
        if (bsz > max_per_bucket * 10) {
            // Deterministic subsample using hash.
            subsampled.reserve(max_per_bucket * 10);
            uint64_t step = (uint64_t)bsz / (max_per_bucket * 10);
            for (uint64_t j = 0; j < (uint64_t)(max_per_bucket * 10) && j * step < (uint64_t)bsz; j++)
                subsampled.push_back(kindices[(int)(j * step)]);
            pool = &subsampled;
        }
        int psz = (int)pool->size();

        // Seed: most spread-out position.
        int best_seed = 0;
        int best_sum = 0;
        for (int j = 0; j < psz; j++) {
            int s = 0;
            const auto& fp = fps[(*pool)[j]];
            for (int m = 0; m < fp.n_dists; m++) s += fp.dists[m];
            if (s > best_sum) { best_sum = s; best_seed = j; }
        }

        std::vector<int> selected;
        selected.push_back(best_seed);
        std::vector<int64_t> min_dist(psz, INT64_MAX);
        for (int j = 0; j < psz; j++)
            min_dist[j] = fp_dist_sq(fps[(*pool)[j]], fps[(*pool)[best_seed]]);
        min_dist[best_seed] = -1;

        for (int sel = 1; sel < max_per_bucket; sel++) {
            int best = -1;
            int64_t best_d = -1;
            for (int j = 0; j < psz; j++) {
                if (min_dist[j] > best_d) { best_d = min_dist[j]; best = j; }
            }
            if (best < 0 || best_d <= 0) break;
            selected.push_back(best);
            for (int j = 0; j < psz; j++) {
                if (min_dist[j] <= 0) continue;
                int64_t d = fp_dist_sq(fps[(*pool)[j]], fps[(*pool)[best]]);
                if (d < min_dist[j]) min_dist[j] = d;
            }
            min_dist[best] = -1;
        }

        for (int j : selected)
            kept.push_back(survivor_indices[(*pool)[j]]);
        filtered_count += bsz - (int)selected.size();
    }

    auto t1 = Clock::now();
    std::cerr << "  pre-filter: " << survivor_indices.size() << " → " << kept.size()
              << " (" << filtered_count << " filtered, "
              << std::chrono::duration<double>(t1 - t0).count() << "s)\n";
    return kept;
}

static void emit(FlatMap dist, int n, int num_exits,
                 int min_moves, int max_moves, int max_per_bucket,
                 int& id, std::unordered_set<uint64_t>& seen_sigs,
                 std::unordered_set<uint64_t>& seen_pruned_canons,
                 std::unordered_set<uint64_t>& seen_dp_sigs,
                 std::unordered_set<uint64_t>& seen_state_sets,
                 int& emitted, int& deduped)
{
    using Clock = std::chrono::steady_clock;
    auto t0 = Clock::now();

    // Reset peak RSS at the start of emit() so per-phase peaks are local.
    reset_peak_rss();
    log_mem("emit_start");

    // ── Pass 1: collect initial states (all canonical from BFS) ──
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
    log_mem("pass1_done");
    reset_peak_rss();

    // ── Pass 2: greedy trace → collision sig hash → dedup ──
    std::vector<uint64_t> sig_hashes(recs.size(), 0);
    std::vector<int8_t>  board_sizes(recs.size(), 7);

    {
    std::atomic<int> p2_done{0};
    auto p2_start = Clock::now();
    auto p2_last_report = p2_start;
    const int p2_total = (int)recs.size();
#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic, 256)
#endif
    for (int i = 0; i < p2_total; i++) {
        auto sol = trace_solution_greedy(recs[i].s, n, num_exits, dist);
        if (sol.size() != (size_t)recs[i].d) {
            // Greedy trace failure — this indicates a bug (likely in the
            // symmetry group or canonicalization).  Dump debug info and abort.
            int pos[10]; decode(recs[i].s, n, pos);
            #pragma omp critical
            {
                std::cerr << "\nFATAL: greedy trace failed for state " << recs[i].s
                          << " (expected " << (int)recs[i].d << " slides, got "
                          << sol.size() << ")\n  positions:";
                for (int j = 0; j < n; j++)
                    std::cerr << " " << pos[j] << "(" << pos[j]/N << "," << pos[j]%N << ")";
                std::cerr << "\n  canonical: " << canonical(recs[i].s, n, num_exits)
                          << " (self=" << (recs[i].s == canonical(recs[i].s, n, num_exits))
                          << ")\n";
            }
            std::exit(1);
        }
        stabilise_indices(sol, recs[i].s, n, num_exits);

        int init_pos[10];
        decode(recs[i].s, n, init_pos);
        sort_exits_and_remap(init_pos, sol, num_exits);

        bool used[10];
        // Thread-local scratch buffers — reused across iterations instead
        // of heap-allocating per iteration (critical in this hot loop).
        thread_local std::vector<Move> pruned;
        thread_local std::string sig;
        pruned.clear();
        const int new_h = prune_unused_helpers(sol, num_exits, n, pruned, used);
        collision_signature(pruned, num_exits, sig);
        sig_hashes[i] = compute_dedup_hash(sig, num_exits, new_h);
        board_sizes[i] = (int8_t)compute_board_size(init_pos, used, n);
        int done = p2_done.fetch_add(1, std::memory_order_relaxed) + 1;
        if (done % 1000 == 0) {
            auto now = Clock::now();
            #ifdef _OPENMP
            if (omp_get_thread_num() == 0)
            #endif
            {
                double elapsed = std::chrono::duration<double>(now - p2_start).count();
                double since_last = std::chrono::duration<double>(now - p2_last_report).count();
                if (since_last >= 5.0) {
                    std::cerr << "    pass 2 progress: " << done << "/" << p2_total
                              << " (" << (100*done/p2_total) << "%), "
                              << elapsed << "s elapsed\n";
                    p2_last_report = now;
                }
            }
        }
    }
    }

    // Sequential dedup — prefer the most compact representative
    // (smallest board_size) among states sharing the same collision signature.
    std::unordered_map<uint64_t, int> local_best; // sig_hash → best recs index
    for (int i = 0; i < (int)recs.size(); i++) {
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
    int dup_count = (int)recs.size() - (int)local_best.size();
    sig_hashes.clear();
    sig_hashes.shrink_to_fit();
    board_sizes.clear();
    board_sizes.shrink_to_fit();

    // Free the pass 2 dedup map (~30 bytes/entry × tens of millions for large combos).
    std::unordered_map<uint64_t, int>().swap(local_best);

    // Pass 3 doesn't need the retrograde BFS map — free it now to save memory.
    dist = FlatMap(0);

    auto t2 = Clock::now();
    std::cerr << "  pass 2 (greedy dedup): " << survivors.size() << " unique, "
              << dup_count << " deduped, "
              << std::chrono::duration<double>(t2 - t1).count() << "s\n";
    log_mem("pass2_done");
    reset_peak_rss();

    // ── Pre-filter: keep at most max_per_bucket diverse puzzles per raw-slide bucket ──
    // prefilter_diverse reads recs directly — no wasteful all_states/all_depths copy.
    if (max_per_bucket > 0) {
        survivors = prefilter_diverse(survivors, recs, n, max_per_bucket);
    }
    log_mem("prefilter_done");

    // Shrink recs to just the survivor states — pass 3 only visits these.
    // For large combos this can free several GB of memory.
    std::vector<State>   survivor_states(survivors.size());
    std::vector<uint8_t> survivor_min_rs(survivors.size());
    for (int j = 0; j < (int)survivors.size(); j++) {
        survivor_states[j] = recs[survivors[j]].s;
        survivor_min_rs[j] = recs[survivors[j]].d;
    }
    std::vector<Rec>().swap(recs);
    log_mem("recs_shrunk");
    reset_peak_rss();

    // ── LPT (Longest Processing Time First) scheduling ──
    // Sort survivor_states + survivor_min_rs descending by retrograde BFS
    // depth (raw slides to goal), which is a direct proxy for solver
    // hardness. Benefits:
    //   * Early failure detection — OOM on hard puzzles surfaces in minutes
    //     instead of after 20+ min of solve work.
    //   * Monotonically decreasing memory profile — peak hits early, then
    //     drops as easier puzzles take over.
    //   * Better OpenMP dynamic-scheduling tail packing.
    // All other per-j arrays below are allocated AFTER this sort and written
    // inside the pass 3 loop at the post-sort index j, so no other arrays
    // need reordering. Downstream dedup loops also iterate by post-sort j.
    {
        std::vector<int> order(survivor_states.size());
        std::iota(order.begin(), order.end(), 0);
        std::sort(order.begin(), order.end(), [&](int a, int b) {
            return survivor_min_rs[a] > survivor_min_rs[b];
        });
        std::vector<State>   sorted_states(survivor_states.size());
        std::vector<uint8_t> sorted_min_rs(survivor_min_rs.size());
        for (int j = 0; j < (int)order.size(); j++) {
            sorted_states[j] = survivor_states[order[j]];
            sorted_min_rs[j] = survivor_min_rs[order[j]];
        }
        survivor_states = std::move(sorted_states);
        survivor_min_rs = std::move(sorted_min_rs);
    }

    // ── Pass 3: DP trace for survivors → dedup → output ──
    std::vector<std::string> output_lines(survivors.size());
    // D4-canonical form of pruned positions (with num_exits packed in bits 60-63).
    std::vector<uint64_t> pruned_canons(survivors.size(), ~(uint64_t)0);
    // Collision-sig hash of the DP (min-grouped) solution.
    std::vector<uint64_t> dp_sig_hashes(survivors.size(), 0);
    // State-set hashes for third-layer dedup.
    std::vector<uint64_t> state_set_hashes(survivors.size(), 0);
    // Pruned start state and robot count — for deferred forward BFS.
    std::vector<State> pruned_starts(survivors.size(), 0);
    std::vector<int>   pruned_ns(survivors.size(), 0);
    // Bounding area + Manhattan for picking most compact representative.
    std::vector<int> bounding_areas(survivors.size(), 99);
    std::vector<int> manhattan_sums(survivors.size(), 999);
    // Post-Stage-4 re-bucket fields: pruned helper count, min raw slides,
    // centered odd square of pruned positions, and variant flag byte.
    std::vector<int8_t> survivor_new_h(survivors.size(), 0);
    std::vector<uint8_t> survivor_min_raw(survivors.size(), 0);
    std::vector<int8_t> survivor_square_size(survivors.size(), 7);
    std::vector<int16_t> survivor_variant_flags(survivors.size(), 0);
    // Per-puzzle forward-0-1-BFS solve time for reporting (distribution of effort).
    std::vector<double> solve_times_us(survivors.size(), 0.0);

    std::atomic<int> p3_done{0};
    auto p3_start = Clock::now();
    auto p3_last_report = p3_start;
    const int p3_total = (int)survivors.size();
#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic, 64)
#endif
    for (int j = 0; j < p3_total; j++) {
        {
            int done = p3_done.fetch_add(1, std::memory_order_relaxed) + 1;
            if (done % 500 == 0) {
                auto now = Clock::now();
                #ifdef _OPENMP
                if (omp_get_thread_num() == 0)
                #endif
                {
                    double elapsed = std::chrono::duration<double>(now - p3_start).count();
                    double since_last = std::chrono::duration<double>(now - p3_last_report).count();
                    if (since_last >= 5.0) {
                        std::cerr << "    pass 3 progress: " << done << "/" << p3_total
                                  << " (" << (100*done/p3_total) << "%), "
                                  << elapsed << "s elapsed\n";
                        p3_last_report = now;
                    }
                }
            }
        }
        const State survivor_state = survivor_states[j];
        // Solve for minimum grouped moves (0-1 BFS, allows more raw slides).
        auto solve_t0 = Clock::now();
        auto tr = solve_min_grouped(survivor_state, n, num_exits);
        solve_times_us[j] =
            std::chrono::duration<double, std::micro>(Clock::now() - solve_t0).count();
        if (tr.moves.empty()) continue;
        stabilise_indices(tr.moves, survivor_state, n, num_exits);

        int init_pos[10];
        decode(survivor_state, n, init_pos);
        sort_exits_and_remap(init_pos, tr.moves, num_exits);

        bool used[10];
        std::vector<Move> pruned;
        const int new_h = prune_unused_helpers(tr.moves, num_exits, n, pruned, used);
        int grouped_moves = count_grouped_moves(pruned);
        int raw_slides = (int)pruned.size();
        int min_raw_slides = (int)survivor_min_rs[j];  // BFS depth (unpruned)

        // Previously: hex puzzles whose solution used only cardinal directions
        // were skipped because they belonged in square variants. In the unified
        // pipeline we keep them and tag each puzzle with a "requires_diagonal"
        // flag so the web app can filter at runtime. No skip here.

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
                decode(ps, ci, pruned_pos);
                sort_exits_and_remap(pruned_pos, tr2.moves, num_exits);
                pruned = std::move(tr2.moves);
                grouped_moves = count_grouped_moves(pruned);
                raw_slides = (int)pruned.size();
                min_raw_slides = raw_slides;
            }
        }

        // D4-canonical form of pruned positions (cross-combo D4 dedup).
        pruned_canons[j] = canonical(encode(pruned_pos, ci), ci, num_exits)
                         | ((uint64_t)num_exits << 60);

        // Collision-sig hash of the DP solution (catches greedy/DP path differences).
        {
            thread_local std::string sig;
            collision_signature(pruned, num_exits, sig);
            dp_sig_hashes[j] = compute_dedup_hash(sig, num_exits, new_h);
        }

        // Store pruned start for deferred forward BFS (state-set dedup).
        State pruned_start = encode(pruned_pos, ci);
        pruned_starts[j] = pruned_start;
        pruned_ns[j] = ci;

        // Bounding area and Manhattan for picking most compact representative.
        bounding_areas[j] = compute_bounding_area(pruned_pos, ci);
        manhattan_sums[j] = sum_manhattan(pruned_pos, ci);

        // Compute per-puzzle variant flags from pruned positions and the
        // DP-optimal solution. Bits indicate which variants this puzzle is
        // valid for; bit 6 = requires_diagonal (any slide in dir >= 4).
        const int variant_flags = compute_variant_flags(pruned_pos, ci, pruned);

        // Populate per-survivor arrays used by the post-Stage-4 re-bucket pass.
        // (Stored by position index j — each slot is owned by a distinct loop iter.)
        survivor_new_h[j]         = (int8_t)new_h;
        survivor_min_raw[j]       = (uint8_t)min_raw_slides;
        survivor_square_size[j]   = (int8_t)compute_board_size(init_pos, used, n);
        survivor_variant_flags[j] = (int16_t)variant_flags;

        // Format output line (ID assigned sequentially below).
        // forwardStates placeholder "0" — filled in after dedup for surviving puzzles.
        // Format: exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|variantFlags|positions|solution
        std::string line;
        line.reserve(160);
        line += std::to_string(num_exits);       line += '|';
        line += std::to_string(new_h);           line += '|';
        line += std::to_string(grouped_moves);   line += '|';
        line += std::to_string(raw_slides);      line += '|';
        line += std::to_string(min_raw_slides);  line += '|';
        line += "0|"; // placeholder for forwardStates
        line += std::to_string(variant_flags);   line += '|';

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

    // Per-puzzle forward-0-1-BFS solve time distribution.
    // Emits full 1%-percentile bucket values (101 entries: p00..p100) plus
    // summary stats on a separate line for quick reading.
    {
        std::vector<double> sorted_times = solve_times_us;
        std::sort(sorted_times.begin(), sorted_times.end());
        const size_t ns = sorted_times.size();
        double sum = std::accumulate(sorted_times.begin(), sorted_times.end(), 0.0);
        auto pct = [&](double p) -> double {
            if (ns == 0) return 0.0;
            size_t idx = (size_t)(p * (ns - 1));
            return sorted_times[idx];
        };
        std::cerr << "  solve times (us): p50=" << (int64_t)pct(0.50)
                  << " p90=" << (int64_t)pct(0.90)
                  << " p99=" << (int64_t)pct(0.99)
                  << " max=" << (ns == 0 ? 0.0 : sorted_times.back())
                  << " cpu_total=" << sum / 1e6 << "s"
                  << " count=" << ns << "\n";
        if (ns > 0) {
            std::cerr << "  solve times p-dist (us):";
            for (int p = 0; p <= 100; p++) {
                double frac = (double)p / 100.0;
                std::cerr << " " << (int64_t)pct(frac);
            }
            std::cerr << "\n";
        }
        // Top-N hardest puzzles: the specific survivor_states and their solve
        // times, for targeted replay in bench_solver. Partial-sort via
        // nth_element is O(survivors) vs O(survivors log survivors) for a
        // full sort. Extra memory: one int per survivor (~120 KB for
        // 30K candidates) — negligible.
        if (ns > 0) {
            const int TOP_N = 20;
            int k = std::min((int)ns, TOP_N);
            std::vector<int> top_idx(ns);
            std::iota(top_idx.begin(), top_idx.end(), 0);
            std::nth_element(top_idx.begin(), top_idx.begin() + k, top_idx.end(),
                [&](int a, int b) { return solve_times_us[a] > solve_times_us[b]; });
            top_idx.resize(k);
            std::sort(top_idx.begin(), top_idx.end(),
                [&](int a, int b) { return solve_times_us[a] > solve_times_us[b]; });
            std::cerr << "  solve times top-" << k << " (us=state):";
            for (int j : top_idx)
                std::cerr << " " << (int64_t)solve_times_us[j]
                          << "=" << survivor_states[j];
            std::cerr << "\n";
        }
    }
    log_mem("pass3_solve_done");

    // Free per-puzzle timing memory before dedup allocations.
    std::vector<double>().swap(solve_times_us);

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

    // Deferred forward BFS: compute state-set hashes only for DP-sig survivors.
    // This avoids running forward_bfs_states for puzzles already eliminated
    // by D4 or collision-sig dedup (~30% savings).
    // Also stores state counts for output.
    std::vector<int> fwd_state_counts(survivors.size(), 0);
    reset_peak_rss();
    {
        std::vector<int> need_bfs;
        for (auto& [sig, j] : best_for_dp_sig)
            if (j >= 0) need_bfs.push_back(j);
        // Layer 3 forward BFS allocates a per-puzzle reachable-state set.
        // The parallel variant forward_bfs_states_parallel pre-grows the
        // shared FlatMap to `seen.size() + cur.size() * (NUM_DIRS*n + 4)`
        // at each level so atomic_emplace has guaranteed headroom. That
        // worst-case factor (46 for hex 7pc) is wildly over-provisioned
        // for deep BFS levels where most successors are duplicates, and
        // at peak frontier (cur.size() ~10-30M for a 500M-state BFS) the
        // pre-grow target is 500M-1.4B entries — so each concurrent
        // FlatMap in a heavy puzzle can balloon to 5-11 GB. Two of them
        // blow the 32 GB cap together (observed: v9 + v10 both OOM'd
        // at 29.85 GB in 3+4 Layer 3).
        //
        // Memory-aware partition:
        //   * heavy (pruned_ns >= 7): use SERIAL forward_bfs_states with
        //     4-wide outer parallelism. The serial variant grows via
        //     FlatMap::insert_new's natural 2× rehash, which never
        //     over-provisions. Matches v7's known-safe point.
        //   * light (pruned_ns <= 6): use PARALLEL forward_bfs_states_parallel
        //     with 4 outer × 4 inner (16 cores). Light BFSes are small
        //     (<1M states), so pre-grow overhead is negligible.
        //
        // Heavy runs first so peak RSS drops before the 16-wide light
        // phase fan-out.
        std::vector<int> heavy_jobs, light_jobs;
        for (int j : need_bfs) {
            if (pruned_ns[j] >= 7) heavy_jobs.push_back(j);
            else                   light_jobs.push_back(j);
        }
#ifdef _OPENMP
        const int saved_threads = omp_get_max_threads();
        const int saved_levels  = omp_get_max_active_levels();
        omp_set_max_active_levels(2);
        omp_set_num_threads(std::min(saved_threads, 4));
        #pragma omp parallel for schedule(dynamic, 1)
#endif
        for (int k = 0; k < (int)heavy_jobs.size(); k++) {
            int j = heavy_jobs[k];
            auto fwd = forward_bfs_states(pruned_starts[j], pruned_ns[j],
                                           num_exits);
            state_set_hashes[j] = forward_state_set_hash(fwd);
            fwd_state_counts[j] = (int)fwd.size();
        }
#ifdef _OPENMP
        omp_set_num_threads(std::min(saved_threads, 4));
        #pragma omp parallel for schedule(dynamic, 1)
#endif
        for (int k = 0; k < (int)light_jobs.size(); k++) {
            int j = light_jobs[k];
            auto fwd = forward_bfs_states_parallel(
                pruned_starts[j], pruned_ns[j], num_exits, /*inner=*/4);
            state_set_hashes[j] = forward_state_set_hash(fwd);
            fwd_state_counts[j] = (int)fwd.size();
        }
#ifdef _OPENMP
        omp_set_num_threads(saved_threads);
        omp_set_max_active_levels(saved_levels);
#endif
    }
    log_mem("layer3_done");

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

    // Collect winners from the third dedup layer.
    std::unordered_set<int> winners;
    for (auto& [h, j] : best_for_hash) {
        if (j >= 0) winners.insert(j);
    }

    // ── Post-Stage-4 re-bucket pass (unified pipeline) ──
    // Split winners into (helpers, minRawSlides, square_size, requires_diagonal)
    // sub-buckets and cap each at max_per_bucket. This is what makes each
    // variant's runtime-filter slice hit full saturation in the unified library.
    // Use bounding_areas + manhattan_sums as a tiebreaker to keep the most
    // compact representatives when the bucket overflows. Deterministic order.
    int rebucket_dup_count = 0;
    if (max_per_bucket > 0 && !winners.empty()) {
        struct Key { int h, mrs, sq, diag; };
        auto pack_key = [](int h, int mrs, int sq, int diag) -> uint64_t {
            return ((uint64_t)h << 32) | ((uint64_t)mrs << 16)
                 | ((uint64_t)sq << 4)  | (uint64_t)diag;
        };
        std::unordered_map<uint64_t, std::vector<int>> sub_buckets;
        for (int j : winners) {
            const int diag = (survivor_variant_flags[j] >> 6) & 1;
            const uint64_t k = pack_key(
                survivor_new_h[j], survivor_min_raw[j],
                survivor_square_size[j], diag);
            sub_buckets[k].push_back(j);
        }
        std::unordered_set<int> kept;
        for (auto& [k, js] : sub_buckets) {
            if ((int)js.size() <= max_per_bucket) {
                for (int j : js) kept.insert(j);
                continue;
            }
            // Sort by compactness (smaller bounding area, then smaller manhattan,
            // then lower j for determinism). Keep the first max_per_bucket.
            std::sort(js.begin(), js.end(), [&](int a, int b) {
                if (bounding_areas[a] != bounding_areas[b])
                    return bounding_areas[a] < bounding_areas[b];
                if (manhattan_sums[a] != manhattan_sums[b])
                    return manhattan_sums[a] < manhattan_sums[b];
                return a < b;
            });
            for (int i = 0; i < max_per_bucket; i++) kept.insert(js[i]);
            rebucket_dup_count += (int)js.size() - max_per_bucket;
        }
        winners.swap(kept);
    }

    // Emit winners — fill in forwardStates count (was placeholder "0").
    for (int j = 0; j < (int)output_lines.size(); j++) {
        if (!winners.count(j)) continue;
        auto& line = output_lines[j];
        // Replace "0|" placeholder after the 5th pipe with actual forwardStates.
        int pipes = 0;
        size_t pos = 0;
        for (; pos < line.size() && pipes < 5; pos++)
            if (line[pos] == '|') pipes++;
        size_t end = line.find('|', pos);
        line.replace(pos, end - pos, std::to_string(fwd_state_counts[j]));
        std::cout << ++id << '|' << line << '\n';
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
    if (rebucket_dup_count > 0)
        std::cerr << ", " << rebucket_dup_count << " post-rebucket cap drops";
    std::cerr << ", " << std::chrono::duration<double>(t3 - t2).count() << "s\n";
    log_mem("emit_done");
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

    // Optional: max puzzles per (exits, helpers, rawSlides) bucket.
    // 0 = no limit (full enumeration).  Positive value enables pre-filtering
    // with farthest-point diversity sampling before the expensive DP solve.
    const int max_per_bucket = argc > 6 ? std::atoi(argv[6]) : 0;

    // Optional flags
    int only_exits = -1, only_helpers = -1;
    bool validate_augmented = false;
    for (int i = 1; i < argc; i++) {
        const char* a = argv[i];
        if (std::strncmp(a, "--only=", 7) == 0) {
            if (std::sscanf(a + 7, "%d,%d", &only_exits, &only_helpers) != 2) {
                std::cerr << "--only expects E,H (e.g. --only=3,4)\n";
                return 1;
            }
        }
        if (std::strcmp(a, "--validate-augmented") == 0)
            validate_augmented = true;
    }

    // Per-variant block masks — computed once regardless of the active variant
    // so compute_variant_flags() can tag each puzzle with cross-variant validity.
    BLOCKED_MASK_SOLITAIRE = make_blocked_solitaire();
    BLOCKED_MASK_UFO       = make_blocked_ufo();
    BLOCKED_MASK_FRENCH    = make_blocked_french();

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

    // ── Validate augmented retrograde BFS ──────────────────────────────────
    if (validate_augmented) {
        const int ne = only_exits > 0 ? only_exits : 1;
        const int nh = only_helpers > 0 ? only_helpers : 2;
        const int nt = ne + nh;
        std::cerr << "=== Validating augmented retrograde BFS: " << ne << "+" << nh << " ===\n";

        // Run base retrograde to get all reachable states.
        auto base_dist = retrograde(ne, nh);
        std::cerr << "  base retrograde: " << base_dist.size() << " states\n";

        // Run augmented retrograde.
        auto aug_dist = retrograde_grouped(ne, nh);
        std::cerr << "  augmented retrograde: " << aug_dist.size() << " augmented states\n";

        // For each base state, extract min grouped cost from augmented map,
        // compare with solve_min_grouped.
        const int shift = 6 * nt;
        int checked = 0, mismatches = 0, skipped = 0;

        // Iterate all base states from the base_dist map.
        for (size_t slot = 0; slot < base_dist.cap(); slot++) {
            if (base_dist.data_[slot] == FlatMap::EMPTY) continue;
            const State s = base_dist.data_[slot] & base_dist.km_;

            // The forward solver starts with last_cell = EXITED (no previous mover),
            // so the first move always costs 1 grouped move.  From the augmented map,
            // we compute: real_cost(S) = 1 + min over first moves { aug_cost(S', landing) }.
            // Try each possible first move and look up the result in the augmented map.
            int pos[10];
            decode(s, nt, pos);
            const uint64_t occ = make_occ(pos, nt);
            int min_aug = 999;
            for (int ridx = 0; ridx < nt; ridx++) {
                for (int d = 0; d < NUM_DIRS; d++) {
                    int nc, bi;
                    State ns;
                    if (!forward_move(pos, nt, ne, ridx, d, nc, bi, ns, occ))
                        continue;
                    const int landing = (ridx < ne && nc == CTR) ? EXITED : nc;
                    // Canonicalize the successor augmented state.
                    const uint64_t aug_key = canonical_aug(ns, landing, nt, ne, shift);
                    uint8_t val;
                    if (aug_dist.find_val(aug_key, &val)) {
                        const int total = 1 + (int)val;  // first move costs 1
                        min_aug = std::min(min_aug, total);
                    }
                }
            }

            if (min_aug == 999) {
                // Augmented BFS didn't reach this state — could be a goal state.
                // Check if it's a goal.
                bool is_goal = true;
                for (int e = 0; e < ne; e++) if (pos[e] != EXITED) { is_goal = false; break; }
                if (is_goal) { skipped++; continue; }  // goal has cost 0 by definition
                int dp2[10]; decode(s, nt, dp2);
                std::cerr << "  MISS: state " << s << " positions:";
                for (int j=0;j<nt;j++) std::cerr << " (" << dp2[j]/N << "," << dp2[j]%N << ")" << (dp2[j]==EXITED?"X":"");
                std::cerr << "\n";
                // Run forward solve and trace the entire path in the aug map.
                auto tr_miss = solve_min_grouped(s, nt, ne);
                std::cerr << "    forward solve: " << tr_miss.grouped_moves << " grouped, " << tr_miss.moves.size() << " slides\n";
                if (!tr_miss.moves.empty()) {
                    const char* DN[] = {"U","D","L","R","NW","SE"};
                    int cp[10]; std::memcpy(cp, dp2, nt*sizeof(int));
                    int prev_l = EXITED;
                    for (int mi=0; mi<(int)tr_miss.moves.size(); mi++) {
                        auto& mv = tr_miss.moves[mi];
                        int nc_,bi_; State ns_;
                        if (!forward_move(cp,nt,ne,mv.mover,mv.dir,nc_,bi_,ns_,make_occ(cp,nt))) break;
                        int land_ = (mv.mover<ne&&nc_==CTR)?EXITED:nc_;
                        int ec_ = (cp[mv.mover]==prev_l)?0:1;
                        uint64_t ak_ = canonical_aug(ns_,land_,nt,ne,shift);
                        uint8_t v_; bool f_ = aug_dist.find_val(ak_,&v_);
                        std::cerr << "    slide " << mi << ": r" << (int)mv.mover << " " << DN[(int)mv.dir]
                                  << " land=" << land_ << " edge=" << ec_ << " aug_found=" << f_;
                        if(f_) std::cerr << " aug=" << (int)v_;
                        std::cerr << "\n";
                        decode(ns_,nt,cp); prev_l = land_;
                    }
                }
                // Show all possible first moves and whether successor is found.
                for (int ridx=0;ridx<nt;ridx++) for (int d=0;d<NUM_DIRS;d++) {
                    int nc,bi; State ns;
                    if (!forward_move(pos,nt,ne,ridx,d,nc,bi,ns,occ)) continue;
                    int landing=(ridx<ne&&nc==CTR)?EXITED:nc;
                    uint64_t ak = canonical_aug(ns,landing,nt,ne,shift);
                    uint8_t v; bool found = aug_dist.find_val(ak,&v);
                    std::cerr << "    robot" << ridx << " dir" << d << " → landing=" << landing
                              << " found=" << found;
                    if(found) std::cerr << " cost=" << (int)v;
                    std::cerr << "\n";
                }
                mismatches++;
                if (mismatches >= 5) break;
                continue;
            }

            // Compare with forward solve.
            auto tr = solve_min_grouped(s, nt, ne);
            const int fwd_cost = tr.moves.empty() ? 0 : tr.grouped_moves;
            // For states already at goal, solve_min_grouped returns 0.
            bool is_goal = true;
            for (int e = 0; e < ne; e++) if (pos[e] != EXITED) { is_goal = false; break; }
            if (is_goal) { skipped++; continue; }

            if (min_aug != fwd_cost) {
                mismatches++;
                int dp[10]; decode(s, nt, dp);
                std::cerr << "  MISMATCH: state " << s
                          << " aug=" << min_aug << " fwd=" << fwd_cost
                          << "  positions:";
                for (int j = 0; j < nt; j++) {
                    if (dp[j] == EXITED) std::cerr << " X";
                    else std::cerr << " (" << dp[j]/N << "," << dp[j]%N << ")";
                }
                std::cerr << "\n";
                // Print the forward solution moves.
                if (!tr.moves.empty()) {
                    const char* DNAME[] = {"U","D","L","R","NW","SE"};
                    std::cerr << "    fwd solution (" << tr.moves.size() << " slides, "
                              << fwd_cost << " grouped):";
                    for (const auto& mv : tr.moves)
                        std::cerr << " [robot" << (int)mv.mover << " " << DNAME[(int)mv.dir]
                                  << " blocked_by_" << (int)mv.blocker << "]";
                    std::cerr << "\n";
                    // Trace each move through the augmented map.
                    int cur_pos[10];
                    std::memcpy(cur_pos, dp, nt * sizeof(int));
                    int prev_landing = EXITED;
                    for (int mi = 0; mi < (int)tr.moves.size() && mi < 4; mi++) {
                        const auto& mv = tr.moves[mi];
                        int nc_m, bi_m; State ns_m;
                        if (!forward_move(cur_pos, nt, ne, mv.mover, mv.dir, nc_m, bi_m, ns_m, make_occ(cur_pos, nt)))
                            break;
                        int landing_m = (mv.mover < ne && nc_m == CTR) ? EXITED : nc_m;
                        int edge_cost_m = (cur_pos[mv.mover] == prev_landing) ? 0 : 1;
                        uint64_t aug_key_m = canonical_aug(ns_m, landing_m, nt, ne, shift);
                        uint8_t v_m;
                        bool found_m = aug_dist.find_val(aug_key_m, &v_m);
                        std::cerr << "    move " << mi << ": robot" << (int)mv.mover
                                  << " lands=" << landing_m << " (cell " << landing_m/N << "," << landing_m%N << ")"
                                  << " edge=" << edge_cost_m
                                  << " aug_found=" << found_m;
                        if (found_m) std::cerr << " aug_cost=" << (int)v_m;
                        std::cerr << "\n";
                        decode(ns_m, nt, cur_pos);
                        prev_landing = landing_m;
                    }
                }
                if (mismatches >= 5) {
                    std::cerr << "  ... stopping after 5 mismatches\n";
                    break;
                }
            }
            checked++;
            if (checked % 100 == 0)
                std::cerr << "  checked " << checked << " / " << base_dist.size()
                          << " (mismatches=" << mismatches << ")\n";
        }

        // Spot-check: is key 528610000 in the augmented map?
        {
            uint8_t v; bool f = aug_dist.find_val(528610000ULL, &v);
            std::cerr << "  spot check key 528610000: found=" << f;
            if(f) std::cerr << " cost=" << (int)v;
            std::cerr << "\n";
            // Also check the base state 8516304 with other last_cells.
            for (int lc : {11,16,31,32,63}) {
                uint64_t k = 8516304ULL | ((uint64_t)lc << 24);
                bool f2 = aug_dist.find_val(k, &v);
                std::cerr << "    base 8516304 last=" << lc << ": found=" << f2;
                if(f2) std::cerr << " cost=" << (int)v;
                std::cerr << "\n";
            }
        }

        // Check: for each base state, does the aug map have at least one entry?
        int base_covered = 0, base_missing = 0;
        for (size_t slot = 0; slot < base_dist.cap(); slot++) {
            if (base_dist.data_[slot] == FlatMap::EMPTY) continue;
            const State bs = base_dist.data_[slot] & base_dist.km_;
            int pp[10]; decode(bs, nt, pp);
            bool is_goal = true;
            for (int e = 0; e < ne; e++) if (pp[e] != EXITED) { is_goal = false; break; }
            if (is_goal) continue;
            bool found_any = false;
            // Check each robot position as last_cell.
            for (int j = 0; j < nt; j++) {
                if (pp[j] == EXITED) continue;
                uint64_t ak = canonical_aug(bs, pp[j], nt, ne, shift);
                uint8_t v; if (aug_dist.find_val(ak, &v)) { found_any = true; break; }
            }
            if (found_any) base_covered++; else base_missing++;
        }
        std::cerr << "  base states with aug coverage: " << base_covered
                  << "  missing: " << base_missing << "\n";

        // Check: how many augmented states have a robot at center?
        int center_count = 0;
        for (size_t slot = 0; slot < aug_dist.cap(); slot++) {
            if (aug_dist.data_[slot] == FlatMap::EMPTY) continue;
            uint64_t key = aug_dist.data_[slot] & aug_dist.km_;
            State bs = key & (((uint64_t)1 << shift) - 1);
            int rr[10]; decode(bs, nt, rr);
            for (int j = 0; j < nt; j++) {
                if (rr[j] == CTR) { center_count++; break; }
            }
        }
        std::cerr << "  augmented states with a robot at center: " << center_count << "\n";

        std::cerr << "\n=== VALIDATION RESULT ===\n"
                  << "  checked: " << checked << "\n"
                  << "  skipped (goals): " << skipped << "\n"
                  << "  mismatches: " << mismatches << "\n"
                  << "  " << (mismatches == 0 ? "PASS" : "FAIL") << "\n";
        return mismatches == 0 ? 0 : 1;
    }

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
        "# Format: id|exits|helpers|groupedMoves|rawSlides|minRawSlides|forwardStates|variantFlags|positions|solution\n"
        "# variantFlags: bit0=fits_standard, bit1=fits_solitaire, bit2=fits_ufo,\n"
        "#               bit3=fits_french, bit4=fits_hex, bit5=fits_beehive, bit6=requires_diagonal\n"
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
        if (only_exits >= 0 && ne != only_exits) continue;
        // Skip 0-helper combos: Lunar Lockout requires a blocker to stop any
        // slide, and multi-exit configurations without helpers can't reach
        // goal states (once the first exit exits, remaining exits have no
        // blockers to help them reach CTR). Every 0-helper combo emits 0.
        for (int nt = ne + 1; nt <= max_total; nt++) { // nt = total robots
            const int nh = nt - ne;                    // helpers = total - exits
            if (only_helpers >= 0 && nh != only_helpers) continue;
            const auto t0 = std::chrono::steady_clock::now();
            std::cerr << "\n=== exits=" << ne << "  helpers=" << nh
                      << "  total=" << nt << " ===\n";

            reset_peak_rss();
            auto dist = retrograde(ne, nh);

            const double bfs_secs = std::chrono::duration<double>(
                std::chrono::steady_clock::now() - t0).count();
            std::cerr << "  BFS done: " << dist.size() << " states, "
                      << bfs_secs << "s\n";
            log_mem("bfs_done");


            int k_emitted = 0, k_deduped = 0;
            emit(std::move(dist), ne + nh, ne, min_moves, max_moves, max_per_bucket,
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
