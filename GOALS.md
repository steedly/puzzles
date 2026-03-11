# Project Goals & Principles

This file captures the design principles, quality standards, and architectural decisions for this project. It serves as a durable reference so that future development sessions maintain consistency — preserving lessons learned, avoiding repeated mistakes, and keeping the project aligned with its original intent even as it evolves.

## Overall Vision

This is a puzzle-solving project collection, with the primary focus on **Lunar Lockout**: a C++ enumerator that exhaustively finds every unique solvable puzzle, and a web UI that lets players browse, filter, and solve them. The project also includes solvers for Wordle (entropy-based decision tree), Sudoku (constraint propagation + backtracking), a peg game (state-space search with symmetry reduction), and an elastic collision simulator.

The Lunar Lockout project is inspired by and validated against the original UFO game. A key historical insight from the original game's developers: **finding solutions was easy; finding good problems was not.** This drives the emphasis on exhaustive enumeration, aggressive deduplication, and puzzle quality (compaction, difficulty classification).

## Correctness First

- **Validation catches bugs, not users.** The `validate_solutions.py` script and `test_enumerate` unit tests (80+) form a safety net that must catch any regression in puzzle generation. Every generated `.llp` file should pass the full `make test` pipeline before being committed. Lessons learned: subtle bugs in collision-signature dedup (missing D4 direction normalization) and compaction (helpers landing on center cell) were only caught through systematic validation and external review.
- **Solutions must be provably optimal.** The enumerator's 4-stage pipeline (retrograde BFS → collision-sig dedup → compaction → DP trace) guarantees that `minMoves` is the true grouped-move optimum. The UI solver must match this when recomputing. The distinction between individual slides and grouped moves (consecutive slides of the same robot = 1 grouped move) is critical — players experience grouped moves, not slides.
- **D4 dedup must be airtight.** No two output puzzles should be D4-equivalent (rotation/reflection). The `test_canonical` check enforces this. Collision-signature dedup must also be D4-normalised across directions — this was a bug that produced ~21K false-unique puzzles before being fixed.
- **Variant puzzles need variant-correct solutions.** Each board variant (Standard, Solitaire, UFO) has its own blocked-cell mask baked into the enumerator. Solutions, move counts, and filtering must all respect the variant's blocked cells — never mix data across variants. The 5x5 UFO variant was validated against the original UFO game: 1 exit + up to 5 helpers yields max 10 moves, matching the original.
- **Compaction must be thorough.** Puzzles should use the smallest board possible. This means reducing first-move gaps for movers (try all intermediate gap values, not just gap=1) and shifting non-moving blockers toward center. After compaction, re-verify that the collision sequence is preserved AND all exits actually reach center (a helper compacted onto center can block an exit's path).

## Scalability — Plan for 7–9 Total Pieces

- **Enumerator performance.** The retrograde BFS state count grows ~15–20× per additional helper. Current targets:
  - ≤7 total robots: must complete in minutes, <512 MB RAM
  - 8 total robots: feasible on a laptop (8–16 GB RAM, ~20 min)
  - 9 total robots: server-class hardware (64 GB RAM, hours)
  - ≥10 total robots: not supported (64-bit state packing limit)
- **Multi-exit scaling.** More exits dramatically increase both BFS states and unique puzzles. Measured for standard variant with 7 total robots: 1e+6h = 27M states → 961K puzzles; 2e+5h = 49M states → 4.5M puzzles; 3e+4h = 44M states → 4.7M puzzles. The collision-sig dedup pass (Stage 2) becomes the bottleneck — 45M states took ~14 minutes for a single exits×helpers combination.
- **The ≤6 to ≤7 cliff.** File sizes jump ~70× when adding the 7th robot. Standard variant: ≤6 total = 6 MB (145K puzzles), ≤7 total = 437 MB (10.3M puzzles). This makes ≤7 impractical for the hosted site without further filtering or splitting. Full 7-robot files are saved in `ll-solver/full/` for future work on quality-based filtering to bring the count down to a deployable size.
- **State packing.** States are packed into 64-bit integers (8 bytes each). This limits total robots to 9. Any format change here ripples through the entire BFS. The FlatMap maintains ≤75% load factor (~10.7 bytes per state actual).
- **UI loading.** Puzzle libraries may grow to hundreds of thousands of puzzles as higher robot counts are enumerated. Strategies to keep the UI responsive:
  - Lazy-load variant files (only fetch the selected variant's `.llp`)
  - Cache parsed puzzles in memory (avoid re-parsing on variant switch)
  - Strip solutions from committed `.llp` files to reduce size (~50% savings)
  - Parse performance is ~6µs/puzzle; 200K puzzles ≈ 1.2s parse time
- **Blocked-cell filtering.** The 4-tier filter pipeline must stay fast over large libraries. Tier 4 (re-solve) is lazy — it only runs when a puzzle is selected, not during filtering. This was a critical performance fix: solving all Tier 4 puzzles upfront caused noticeable UI lag.

## Puzzle Quality

- **Deduplication is the hardest problem.** The original game developers spent months whittling millions of generated problems down to "good" ones. The enumerator's multi-stage dedup (D4 spatial canonicalization → D4-normalised collision signatures → post-compaction re-dedup via DP trace) aims to automate this.
- **Difficulty is about branching, not just depth.** Reviewer feedback confirms: a puzzle's difficulty correlates with the number of non-solution moves available at each step, not just the move count. Many plausible wrong paths = harder puzzle. The current difficulty classification (easy/medium/hard/expert based on move count) is a rough proxy; a branching-factor metric could improve it.
- **Compaction improves aesthetics.** Tighter puzzles (robots closer to center) look cleaner and feel more intentional. The compaction stage should always prefer the smallest board that preserves the solution.

## UI Design Principles

- **Intuitive filtering.** Click-to-select / shift-click-to-toggle for filter chips. Dual-range slider for moves. Difficulty tiers. Filters should feel instant even with 50K+ puzzles.
- **Board variants are first-class.** Variant selector in the nav panel. Variant-blocked cells are visually distinct (dark/inactive) from user-blocked cells (red hatched). Block mode is only available in Standard.
- **Solver on demand.** The JS BFS solver runs in-browser for solution hints and blocked-cell re-solving. It must handle typical puzzles (≤6 robots, depth ≤20) in <100ms.
- **Let players explore.** The app should let players attempt solutions even past the optimal move count, rather than blocking non-optimal play. Victory feedback can indicate whether the solve was optimal (star rating) without preventing completion.
- **Dark theme, minimal dependencies.** CSS custom properties, no runtime dependencies beyond React.

## Documentation

- **The ll-solver README must serve multiple audiences.** It should be readable by someone curious about the algorithm who is not a computer scientist — using plain-English explanations, analogies, and concrete examples before introducing technical terminology. At the same time, it must be detailed enough for someone who wants to build, run, and extend the code: exact commands, parameter tables, output format specs, and performance data. Both goals in one document, layered so a casual reader can stop early and a technical reader can go deep.
- **Coherence matters.** The README should read as a single well-structured narrative, not a collection of disconnected sections. Each stage of the pipeline should flow logically into the next, with clear motivation for why each step exists.
- **Keep it accurate.** When the code changes (new dedup stages, new CLI parameters, updated puzzle counts), the README must be updated in the same commit. Stale documentation is worse than no documentation.

## Data Pipeline

```
ll-solver/enumerate → full.llp (with solutions)
                    → strip solutions → public/puzzles.llp
                    → validate_solutions.py (must pass)
                    → test_canonical (must pass)
```

- Always generate all three variants when updating puzzle data.
- The `.llp` format is the contract between enumerator and UI. Changes to it require updating both sides.
- Committed `.llp` files are stripped (no solutions) to save space. The UI's JS solver fills in solutions on demand.
- Current deployed puzzle files (3 exits, ≤6 total): Standard (~6 MB, 145K puzzles), Solitaire (~1 MB, 27K puzzles), UFO (~800 KB, 21K puzzles). Variant files are lazy-loaded; only Standard is fetched on initial page load.
- Full 7-total-robot files are saved in `ll-solver/full/` (untracked) for future filtering work: Standard (437 MB, 10.3M puzzles), Solitaire (16 MB, 402K), UFO (10 MB, 245K).

## Testing Requirements

- `make test` in ll-solver/ runs the full pipeline for all three variants: unit tests → generate → validate → D4 check.
- `npm run lint` in lunar-lockout/ must pass.
- `npm run build` must succeed before pushing — the GitHub Pages deploy depends on it.
- When changing the enumerator, always re-validate existing puzzle files against the new code.
- Regression tests should be added for specific bugs found (e.g., the 823/7907/24411 duplicate triple, helper-on-center compaction).

## Deployment

- GitHub Pages via Actions workflow, auto-deploys on push to main.
- Single-file bundle (`npm run build:bundle`) for offline sharing (~2.2 MB self-contained HTML).
- Vite `base` is `/puzzles/` for GitHub Pages URL structure.

## Other Projects

- **Wordle solver** — entropy-based decision tree for optimal guessing. Generates cheat sheets (decision trees) for both the full candidate list and the solution-only subset.
- **Sudoku solver** — constraint propagation + backtracking, also available as Jupyter notebook.
- **Peg game solver** — triangular board state-space search with mirror symmetry reduction.
- **Elastic collision simulator** — physics visualization with NumPy + Matplotlib.

Each project is independent with its own tech stack. There is no top-level build system.
