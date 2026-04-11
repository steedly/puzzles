# Lunar Lockout

A web-based implementation of the [Lunar Lockout](https://en.wikipedia.org/wiki/Lunar_Lockout) sliding-block puzzle, built with React and Vite.

## Game Rules

Robots occupy a 7x7 grid. On each turn you select a robot and slide it in a cardinal direction. It travels until it hits **another robot** — sliding into a wall or off the board is not a valid move. **Exit robots** (colored) must reach the center cell (3,3), where they disappear from the board. **Helper robots** (gray) serve only as blockers. The puzzle is solved when all exit robots have exited. Consecutive slides of the same robot count as one "grouped move."

## Quick Start

```bash
npm install
npm run dev
```

The app loads puzzles from `public/puzzles.llp`. Variant puzzle files (`puzzles-french.llp`, `puzzles-solitaire.llp`, `puzzles-ufo.llp`) are loaded on demand when the user switches board variants. If the default file is missing or unreachable, a file picker appears so you can load one manually.

## Project Structure

```
spaceport-solitaire/
├── src/
│   ├── App.jsx                  Root layout (board + puzzle nav)
│   ├── index.css                Dark-theme styles, robot colors
│   ├── components/
│   │   ├── Board.jsx            7x7 game board grid
│   │   ├── Cell.jsx             Individual cell (center glow, landing preview)
│   │   ├── Robot.jsx            Robot sprite (color-coded by role)
│   │   ├── HUD.jsx              Move counter, undo/restart, solution toggle
│   │   ├── WinModal.jsx         Victory screen (star for optimal solve)
│   │   └── PuzzleNav.jsx        Collapsible filter/browse panel
│   ├── hooks/
│   │   ├── usePuzzleLibrary.js  Puzzle loader/parser (.llp format)
│   │   └── useGameState.js      Game reducer (select, slide, undo, win)
│   └── logic/
│       ├── gameEngine.js        Slide physics, exit-on-center, win detection
│       ├── solver.js            Forward BFS + DP solver
│       └── puzzleFilter.js      Multi-tier blocked-cell filtering
├── public/
│   ├── puzzles.llp              Standard puzzle library (positions only)
│   ├── puzzles-french.llp       French Solitaire variant (lazy-loaded)
│   ├── puzzles-solitaire.llp    Solitaire variant (lazy-loaded)
│   └── puzzles-ufo.llp          UFO 5×5 variant (lazy-loaded)
├── scripts/
│   └── bundle.cjs               Inlines all assets into a single HTML file
├── vite.config.js
└── package.json
```

## Puzzle Library

Puzzles are generated offline by the C++ enumerator in [`ll-solver/`](../ll-solver/). See the [ll-solver README](../ll-solver/README.md) for full details on the generation algorithm (retrograde BFS, D4 symmetry canonicalization, collision-signature deduplication, compaction, and DP-optimal solution tracing).

### Data format (.llp)

The enumerator outputs one puzzle per line in pipe-delimited format:

```
id|exits|helpers|minMoves|positions|solution
```

- **positions** — space-separated `row,col` pairs; exits first (ascending position), then helpers (ascending position)
- **solution** — space-separated moves, each encoded as `moverDIRblocker` (e.g., `AU1` means robot A slides Up, stopped by robot 1). `A`-`Z` are exit robots; `1`-`9` are helpers; directions are `U`/`D`/`L`/`R`.

To reduce file size, the committed `public/puzzles.llp` is **stripped** — solutions are removed, leaving five fields per line:

```
id|exits|helpers|minMoves|positions
```

The app accepts both formats. When solutions are present, they are used directly. When absent, the app's built-in solver computes them on demand (see below).

### Updating the puzzle library

Generate a new `.llp` file with the enumerator, strip solutions, and place it in `public/`:

```bash
cd ../ll-solver
./enumerate 4 6 > full.llp

# Strip solutions (keep only positions)
python3 -c "
import sys
for line in sys.stdin:
    line = line.rstrip('\n')
    if line.startswith('#'):
        print(line)
    else:
        parts = line.split('|')
        if len(parts) >= 6:
            print('|'.join(parts[:-1]))
        else:
            print(line)
" < full.llp > ../spaceport-solitaire/public/puzzles.llp
```

## On-the-Fly Solver

The app includes a JavaScript forward BFS solver (`src/logic/solver.js`) that computes optimal solutions in the browser. This is used in two situations:

1. **Stripped puzzle data.** The committed `puzzles.llp` omits solutions to keep file size manageable (~8.5 MB stripped vs. ~19 MB with solutions). When the user requests a solution hint, the solver runs on demand.

2. **Blocked cells.** Users can mark cells as blocked (walls that robots cannot pass through). Blocked cells invalidate the precomputed solution, so the solver recomputes one that respects the current board constraints.

### How the solver works

The solver mirrors the two-phase approach used by the C++ enumerator's solution tracer:

1. **Forward BFS** explores all reachable board states from the starting position, layer by layer, recording each state's minimum distance (individual slide count). This finds the optimal depth *D*.

2. **Layer-by-layer dynamic programming** then traces backward through the BFS layers, tracking an augmented state of *(board configuration, last robot moved)*. Continuing to move the same robot costs 0 additional grouped moves; switching robots costs 1. Among all slide-optimal paths (depth *D*), this finds the one with the fewest grouped moves — the metric that matters to the player.

The solver runs fast enough for interactive use: typical puzzles (up to 6 robots, depth ≤ 20) solve in under 100 ms.

## Features

### Board variants

The nav panel includes a board selector with four variants:

| Variant | Board | Puzzles | Description |
|---------|-------|---------|-------------|
| Standard | 7×7 | ~243K | Full board, no blocked cells |
| French | 7×7 | ~103K | Four inner-corner cells blocked |
| Solitaire | 7×7 | ~45K | Four 2×2 corners blocked |
| UFO | 5×5 | ~30K | Center 5×5 only (border blocked) |

Each variant has its own pre-generated puzzle library with correct optimal solutions and move counts. Variant puzzle files are lazy-loaded on first selection and cached in memory. Variant-blocked cells appear as dark inactive cells, visually distinct from user-blocked cells. The variants form a hierarchy — blocking more cells can only reduce the set of solvable positions and increase minimum move counts. See the [ll-solver README](../ll-solver/README.md#how-variants-relate-to-each-other) for a detailed explanation of why.

User-defined blocking (the Block button) is available only in Standard mode, since variant puzzles are already generated with their blocked cells baked in.

### Puzzle navigation

The nav panel supports filtering by number of exits, helpers, and minimum moves. Pagination, random selection, and jump-to-ID are available. Filters update the puzzle list in real time.

### Blocked cells (Standard mode)

Click **Block** in the HUD to enter block mode, then click empty cells to toggle them as obstacles (shown with a red hatched pattern). Blocked cells act as walls — robots cannot pass through them, but stopping against one is not a valid move (the "must be stopped by another robot" rule is preserved). The center cell cannot be blocked.

When blocks are active:
- The puzzle list filters to show only compatible puzzles
- **Solution** recomputes via the forward BFS solver, respecting the blocks
- **Clear (N)** removes all blocks

Blocks persist across puzzles and browser sessions via `localStorage`.

The filter uses a four-tier pipeline for efficiency over large libraries (~183K puzzles):

| Tier | Method | Cost |
|------|--------|------|
| 1. Position conflict | Reject puzzles with a robot on a blocked cell | < 1 ms |
| 2. Bounding box | Accept puzzles whose bounding box has no overlap with any block | < 2 ms |
| 3. Solution trace | Replay stored solution; accept if no slide path crosses a block | < 50 ms |
| 4. Lazy re-solve | Puzzles whose stored solution is invalidated are kept and re-solved on demand when selected | per-puzzle |

Tier 4 is lazy — puzzles are marked for re-solving but not actually solved during filtering, keeping the filter fast. The BFS solve runs only when the player selects a specific puzzle, ensuring puzzles with valid alternate solutions are not incorrectly removed.

## Building

### Standard build

```bash
npm run build
```

Produces `dist/` — deploy this directory to any static web server.

### Single-file bundle

```bash
npm run build:bundle
```

Creates `dist/index.bundle.html` — a self-contained HTML file (~2.2 MB) with all JavaScript, CSS, and puzzle data embedded as a gzip-compressed base64 blob. No server required; open directly in any browser.

### All scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server with hot module replacement |
| `npm run build` | Production build to `dist/` |
| `npm run build:bundle` | Production build + single-file bundle |
| `npm run bundle` | Bundle only (requires prior `build`) |
| `npm run preview` | Preview production build locally |
| `npm run lint` | ESLint |

## Hosting & Deployment

### GitHub Pages

The repo includes a GitHub Actions workflow ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) that builds and deploys on every push to `main`.

**One-time setup:**
1. Go to Settings → Pages → Source → select **GitHub Actions**
2. Push to `main`

The site deploys to `https://<user>.github.io/puzzles/`. The Vite `base` in `vite.config.js` is set to `/puzzles/` to match this URL.

**Updating puzzles:** commit the new `public/puzzles.llp` and push. The workflow rebuilds and redeploys automatically.

### Other static hosts

Run `npm run build` and deploy `dist/` to any static file server (Netlify, Vercel, S3, etc.). Update `base` in `vite.config.js` if the site is not served from `/puzzles/` (e.g., set `base: '/'` for a root deployment).

### Offline sharing

Run `npm run build:bundle` and distribute `dist/index.bundle.html` as a single file — via email, AirDrop, USB, or any file-sharing service.

### Puzzle data size

Current deployment uses up to 4 exits and ≤6 total robots:

| File | Puzzles | Raw | Gzipped |
|------|---------|-----|---------|
| Standard (stripped) | ~243K | ~8.5 MB | ~1.7 MB |
| French (stripped) | ~103K | ~3.5 MB | ~790 KB |
| Solitaire (stripped) | ~45K | ~1.5 MB | ~300 KB |
| UFO (stripped) | ~30K | ~1.0 MB | ~210 KB |

Variant files are lazy-loaded, so only the standard file is fetched on initial page load. GitHub Pages applies gzip `Content-Encoding` automatically.

## Tech Stack

- **Frontend:** React 19, Vite 7
- **Puzzle generator:** C++17, OpenMP (see [ll-solver](../ll-solver/))
- **Styling:** CSS custom properties (dark theme)
- **No runtime dependencies** beyond React
