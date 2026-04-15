// bench_solver.cpp — benchmark solve_min_grouped variants on specific puzzles.
//
// Picks the hardest puzzles from a .llp file (by forwardStates descending as a
// hardness proxy) and runs each through two solvers, reporting per-puzzle wall
// time, solution cost, and speedup ratio.
//
// Usage:
//   ./bench_solver <variant> <n> <num_exits> --from-llp <file> --top <N>
//   ./bench_solver <variant> <n> <num_exits> --states <s1,s2,s3,...>
//
// Examples:
//   # Benchmark the 100 hardest 3E+4H puzzles from the run output:
//   ./bench_solver beehive 7 3 --from-llp puzzles-unified.llp --top 100
//
//   # Benchmark a specific state on 2E+5H beehive:
//   ./bench_solver beehive 7 2 --states 409039519
//
// For each state, runs two solvers:
//   1. solve_min_grouped            — current baseline (plain 0-1 BFS)
//   2. solve_min_grouped_with_ub    — branch-and-bound using the pass-2 greedy
//                                      trace's grouped-move count as an
//                                      initial upper bound. If this variant
//                                      finds no improvement over greedy, it
//                                      returns empty and caller falls back to
//                                      greedy's solution.
//
// An A*-style lower-bound variant was explored and dropped: any admissible
// lower bound for grouped moves we could cheaply compute (e.g.
// num_exits_remaining) combined with expand-time pruning corrupts the visited
// map that the forward DFS backtrace reads, producing incorrect solutions.
// The stage-1 retrograde distance (raw slides) is NOT a valid A* lower bound
// for grouped moves — grouped moves ≤ raw slides, so raw distance is an
// upper bound, not a lower bound.

// Rename enumerate's main so we can define our own.
#define main enumerate_main
#include "enumerate.cpp"
#undef main

#include <fstream>
#include <sstream>
#include <cstring>

using Clock = std::chrono::steady_clock;

static double us_since(Clock::time_point t0) {
    return std::chrono::duration<double, std::micro>(Clock::now() - t0).count();
}

// Variant 2: solve_min_grouped with an externally-provided initial upper
// bound on best_goal_cost. Useful for branch-and-bound: if pass 2's greedy
// solution gives N grouped moves, we only accept solutions with cost < N.
// If no improvement is found, returns empty (caller falls back to greedy).
static TraceResult solve_min_grouped_with_ub(State start, int n, int num_exits,
                                              int initial_ub)
{
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

    FlatMap visited(shift + 6);
    std::deque<uint64_t> queue;

    const uint64_t start_key = make_key(start, EXITED);
    visited.insert_new(start_key, 0);
    queue.push_back(start_key);

    uint64_t best_goal_key = 0;
    int best_goal_cost = initial_ub;  // <<< initial upper bound from greedy

    while (!queue.empty()) {
        const uint64_t key = queue.front();
        queue.pop_front();
        uint8_t stored_cost_u8;
        if (!visited.find_val(key, &stored_cost_u8)) continue;
        const int cost = (int)stored_cost_u8;
        if (cost >= best_goal_cost) continue;

        const State s = key & (((uint64_t)1 << shift) - 1);
        const int last_cell = (int)(key >> shift);

        int pos[10]; decode(s, n, pos);
        const uint64_t occ = make_occ(pos, n);

        for (int ridx = 0; ridx < n; ridx++) {
            for (int d = 0; d < NUM_DIRS; d++) {
                int nc, bi;
                State ns;
                if (!forward_move(pos, n, num_exits, ridx, d, nc, bi, ns, occ)) continue;

                const int mover_cell = pos[ridx];
                const int edge_cost = (mover_cell == last_cell) ? 0 : 1;
                const int new_cost = cost + edge_cost;
                if (new_cost >= best_goal_cost) continue;
                if (new_cost > 255) continue;

                const int landing = (ridx < num_exits && nc == CTR) ? EXITED : nc;
                const uint64_t nk = make_key(ns, landing);

                uint8_t existing_u8;
                if (visited.find_val(nk, &existing_u8) && (int)existing_u8 <= new_cost) continue;
                visited.upsert(nk, (uint8_t)new_cost);

                int npos[10]; decode(ns, n, npos);
                bool is_goal = true;
                for (int e = 0; e < num_exits; e++)
                    if (npos[e] != EXITED) { is_goal = false; break; }
                if (is_goal) {
                    if (new_cost < best_goal_cost) {
                        best_goal_cost = new_cost;
                        best_goal_key = nk;
                    }
                    continue;
                }
                if (edge_cost == 0) queue.push_front(nk);
                else                queue.push_back(nk);
            }
        }
    }

    if (best_goal_cost >= initial_ub) return {{}, 0};  // no improvement found

    std::vector<Move> sol;
    std::unordered_set<uint64_t> in_path;
    in_path.insert(start_key);
    if (!forward_dfs_trace(start_key, 0, best_goal_cost, n, num_exits,
                            shift, visited, in_path, sol))
        return {{}, 0};
    return {std::move(sol), best_goal_cost};
}

static void setup_variant(const std::string& variant) {
    BLOCKED_MASK_SOLITAIRE = make_blocked_solitaire();
    BLOCKED_MASK_UFO       = make_blocked_ufo();
    BLOCKED_MASK_FRENCH    = make_blocked_french();
    if      (variant == "solitaire") BLOCKED = make_blocked_solitaire();
    else if (variant == "ufo")       BLOCKED = make_blocked_ufo();
    else if (variant == "french")    BLOCKED = make_blocked_french();
    else if (variant == "hex") {
        BOARD_TYPE = BOARD_HEX;
        N = 7; NC = 49; CTR = 24; NUM_DIRS = 6; NUM_SYMS = 4;
        SYM_INDICES[0] = 0; SYM_INDICES[1] = 2; SYM_INDICES[2] = 6; SYM_INDICES[3] = 7;
        BLOCKED = make_blocked_ufo();
    } else if (variant == "beehive") {
        BOARD_TYPE = BOARD_HEX;
        N = 7; NC = 49; CTR = 24; NUM_DIRS = 6; NUM_SYMS = 4;
        SYM_INDICES[0] = 0; SYM_INDICES[1] = 2; SYM_INDICES[2] = 6; SYM_INDICES[3] = 7;
    } else if (variant != "standard") {
        std::cerr << "Unknown variant: " << variant << "\n"; std::exit(1);
    }
}

// Parse "r,c r,c r,c" → vector of cell indices.
static std::vector<int> parse_positions(const std::string& s) {
    std::vector<int> cells;
    std::istringstream iss(s);
    std::string tok;
    while (iss >> tok) {
        int r, c;
        if (std::sscanf(tok.c_str(), "%d,%d", &r, &c) == 2)
            cells.push_back(r * N + c);
    }
    return cells;
}

// Extract the hardest puzzles from a .llp file for the given (ne, nh) combo.
// Returns encoded State values. Uses forwardStates as the hardness proxy.
// Note: .llp rows are PRUNED (after prune_unused_helpers), so the "helpers"
// field is post-prune. We match on (exits=ne, helpers=nh) which gives puzzles
// whose FINAL form has that shape — a reasonable approximation for testing.
struct LlpCandidate {
    State s;
    int   n, num_exits;
    int   grouped_moves;
    int   raw_slides;
    int   forward_states;
    int   id;
};

static std::vector<LlpCandidate> parse_llp(const std::string& path, int ne, int nh, int top_n) {
    std::ifstream f(path);
    if (!f) { std::cerr << "cannot open " << path << "\n"; std::exit(1); }
    std::vector<LlpCandidate> all;
    std::string line;
    while (std::getline(f, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::vector<std::string> fields;
        size_t prev = 0, pos;
        while ((pos = line.find('|', prev)) != std::string::npos) {
            fields.push_back(line.substr(prev, pos - prev));
            prev = pos + 1;
        }
        fields.push_back(line.substr(prev));
        if (fields.size() < 9) continue;
        int id         = std::atoi(fields[0].c_str());
        int exits      = std::atoi(fields[1].c_str());
        int helpers    = std::atoi(fields[2].c_str());
        if (exits != ne || helpers != nh) continue;
        int grouped    = std::atoi(fields[3].c_str());
        int raw        = std::atoi(fields[4].c_str());
        int fwd_states = std::atoi(fields[6].c_str());
        // Positions are in fields[8] (10-field unified) or fields[7] (9-field legacy).
        const std::string& positions = (fields.size() >= 10) ? fields[8] : fields[7];
        std::vector<int> cells = parse_positions(positions);
        int n = (int)cells.size();
        if (n != exits + helpers) continue;
        int arr[10]; for (int i = 0; i < n; i++) arr[i] = cells[i];
        // helpers are already sorted in .llp output, but re-sort for safety
        std::sort(arr + exits, arr + n);
        State s = encode(arr, n);
        all.push_back({s, n, exits, grouped, raw, fwd_states, id});
    }
    std::sort(all.begin(), all.end(), [](const LlpCandidate& a, const LlpCandidate& b) {
        return a.forward_states > b.forward_states;
    });
    if ((int)all.size() > top_n) all.resize(top_n);
    return all;
}

int main(int argc, char* argv[]) {
    if (argc < 4) {
        std::cerr << "Usage: " << argv[0]
                  << " <variant> <n> <num_exits> [--from-llp <file> --top <N>] [--states s1,s2,...]\n";
        return 1;
    }
    std::string variant = argv[1];
    int n        = std::atoi(argv[2]);
    int num_exits = std::atoi(argv[3]);

    std::string llp_path;
    int top_n = 20;
    std::vector<State> manual_states;
    for (int i = 4; i < argc; i++) {
        if (std::strcmp(argv[i], "--from-llp") == 0 && i+1 < argc) {
            llp_path = argv[++i];
        } else if (std::strcmp(argv[i], "--top") == 0 && i+1 < argc) {
            top_n = std::atoi(argv[++i]);
        } else if (std::strcmp(argv[i], "--states") == 0 && i+1 < argc) {
            std::string s = argv[++i];
            size_t prev = 0, pos;
            while ((pos = s.find(',', prev)) != std::string::npos) {
                manual_states.push_back((State)std::stoull(s.substr(prev, pos - prev)));
                prev = pos + 1;
            }
            if (prev < s.size()) manual_states.push_back((State)std::stoull(s.substr(prev)));
        }
    }

    setup_variant(variant);

    int nh = n - num_exits;
    std::cerr << "Bench: variant=" << variant << " n=" << n << " ne=" << num_exits
              << " nh=" << nh << "\n";

    // Run retrograde BFS once for the combo (needed for greedy trace and as
    // potential A* heuristic source).
    auto t0 = Clock::now();
    FlatMap dist = retrograde(num_exits, nh);
    std::cerr << "  retrograde BFS: " << dist.size() << " states, "
              << us_since(t0)/1e6 << "s\n";

    std::vector<LlpCandidate> candidates;
    if (!llp_path.empty()) {
        candidates = parse_llp(llp_path, num_exits, nh, top_n);
        std::cerr << "  loaded " << candidates.size() << " candidates from "
                  << llp_path << " (top " << top_n << " by forwardStates)\n";
    }
    for (State s : manual_states) {
        candidates.push_back({s, n, num_exits, 0, 0, 0, 0});
    }

    if (candidates.empty()) {
        std::cerr << "no candidates to test\n"; return 1;
    }

    // Header
    std::cout << "idx  id        state           baseline_us  ub_us        "
              << "base_cost ub_cost  greedy_cost  ub_speedup\n";

    double total_base = 0, total_ub = 0;
    int pass = 0, fail = 0;
    for (size_t idx = 0; idx < candidates.size(); idx++) {
        const auto& c = candidates[idx];
        int cn = c.n; int cne = c.num_exits;

        // Compute greedy solution for this state to establish the initial
        // upper bound. trace_solution_greedy walks the stage-1 BFS distance-
        // decreasing DAG taking any valid move; the resulting solution has
        // optimal RAW slides but not necessarily optimal grouped moves.
        //
        // IMPORTANT: stabilise_indices must be called before count_grouped_moves,
        // because trace_solution_greedy records Move.mover as the ridx at the
        // decoded-state level inside forward_move, which drifts across steps
        // due to helper re-sorting. stabilise_indices rewrites movers to the
        // initial state's indices, which are stable.
        auto greedy_sol = trace_solution_greedy(c.s, cn, cne, dist);
        int greedy_groups = INT_MAX;
        if (!greedy_sol.empty()) {
            stabilise_indices(greedy_sol, c.s, cn, cne);
            greedy_groups = count_grouped_moves(greedy_sol);
        }

        // Run baseline.
        auto tb = Clock::now();
        auto base = solve_min_grouped(c.s, cn, cne);
        double base_us = us_since(tb);

        // Run greedy-UB variant (initial_ub = greedy_groups+1 so the BFS
        // must strictly improve on greedy to return a non-empty trace).
        auto tub = Clock::now();
        auto ub = solve_min_grouped_with_ub(c.s, cn, cne,
                                             greedy_groups == INT_MAX ? INT_MAX : greedy_groups+1);
        double ub_us = us_since(tub);

        int base_cost = base.moves.empty() ? -1 : base.grouped_moves;
        // ub_cost == -1 means greedy was already optimal (no strict improvement).
        int ub_cost   = ub.moves.empty()   ? -1 : ub.grouped_moves;

        // Sanity check: when ub returns a trace, its cost must equal baseline
        // (both compute optimal). When ub returns empty, greedy was optimal
        // and greedy_groups must equal base_cost.
        bool ok = (ub_cost == -1)
            ? (greedy_groups == base_cost)
            : (ub_cost == base_cost);
        if (ok) pass++; else fail++;

        total_base += base_us;
        total_ub   += ub_us;

        printf("%3zu  %-8d  %-14lu  %12.1f  %12.1f  %9d  %7d  %11d  %9.2fx\n",
               idx, c.id, (unsigned long)c.s,
               base_us, ub_us,
               base_cost, ub_cost, greedy_groups,
               base_us / std::max(ub_us, 1.0));
        std::fflush(stdout);
    }

    printf("\ntotals:  base=%.1fs  ub=%.1fs    ub_speedup=%.2fx    pass=%d fail=%d\n",
           total_base / 1e6, total_ub / 1e6,
           total_base / std::max(total_ub, 1.0),
           pass, fail);

    return 0;
}
