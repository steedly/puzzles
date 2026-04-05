# Puzzle Filtering — How We Pick the Best Puzzles

## The Problem

The puzzle generator is exhaustive — it finds *every* solvable starting position, which can produce millions of puzzles. For the Bee Hive board (7×7 hex diamond), this means over 5 million puzzles and a 500+ MB file. That's far too many to ship in a web app, and most players would never notice the difference between 5 million puzzles and 50,000.

But we can't just grab the first 50,000 and call it a day. If we did, we'd end up with a bunch of easy 2-move puzzles and almost nothing challenging. We need a smart way to pick a representative set that covers every difficulty level and feels varied to play.

## The Approach: Bucketing + Diversity Sampling

The filtering works in two steps:

### Step 1: Group puzzles into buckets

Every puzzle falls into a bucket based on four properties:

| Property | What it means | Example values |
|---|---|---|
| **Exit count** | How many pieces need to reach the center | 1, 2, 3, or 4 |
| **Helper count** | How many blocker pieces are on the board | 1 through 5 |
| **Solution length** | Minimum grouped moves to solve | 1 through 29 |
| **Difficulty tier** | Based on helper count | Easy, Medium, Hard, Expert |

For example, one bucket might be "2 exits, 4 helpers, 10 moves, Hard." Another might be "1 exit, 3 helpers, 3 moves, Medium."

Across all our variants, there are typically 80–130 buckets. We keep up to N puzzles from each bucket (default N = 1,000). This guarantees that every combination of piece count and solution length is well represented — you won't end up with all easy puzzles or all hard ones.

### Step 2: Pick the most *different* puzzles within each bucket

This is the key insight. Within a single bucket (say, "1 exit, 4 helpers, 5 moves"), there might be 3,000 puzzles that all require exactly 5 moves to solve. But many of them look similar — the pieces are in roughly the same arrangement, just shifted around. We want to pick the 1,000 that feel the most different from each other.

**How we measure "different":**

For each puzzle, we compute a *position fingerprint* — a list of all the distances between every pair of pieces on the board. Two puzzles where the pieces are arranged in similar patterns will have similar fingerprints, even if the whole arrangement is rotated or shifted. Two puzzles with fundamentally different piece layouts will have very different fingerprints.

Think of it like describing a constellation of stars. Instead of saying "there's a star at position (3,5)," you say "there are two stars 4 apart, two stars 7 apart, and two stars 2 apart." This description captures the *shape* of the constellation without depending on where it is in the sky.

**How we pick diverse puzzles:**

We use an algorithm called *farthest-point sampling*. It works like choosing seats in an empty movie theater:

1. **First person** sits in the seat with the best view (we pick the puzzle with the most spread-out piece arrangement).
2. **Second person** sits as far as possible from the first (we pick the puzzle whose fingerprint is most different from the first one).
3. **Third person** sits as far as possible from *both* of the first two. Not just far from one — far from whichever of the two they're closest to.
4. **Continue** until we've picked N puzzles.

This naturally produces a set where every selected puzzle is maximally different from all the others. No two puzzles will feel like minor variations of each other.

**Handling very large buckets:**

Some buckets contain hundreds of thousands of puzzles. Computing distances between all of them would be too slow. For buckets larger than 10× the selection size, we first randomly sample 10× candidates, then run farthest-point sampling on that subset. This keeps the runtime reasonable (minutes instead of hours) while still producing excellent diversity.

## What This Looks Like in Practice

Results with N = 1,000 (default), max_pieces = 7:

| Variant | Board | Before | After | Buckets | Kept | File size |
|---|---|---|---|---|---|---|
| Hex (5×5) | 5×5 hex diamond | 125,797 | 24,649 | 84 | 19.6% | ~2 MB |
| UFO | 7×7 square (12 blocked) | 314,649 | 45,259 | 141 | 14.4% | 4.4 MB |
| Solitaire | 7×7 square (4 blocked) | 881,332 | 78,729 | 186 | 8.9% | 8.3 MB |
| Beehive (7×7) | 7×7 hex diamond | 5,416,861 | 82,776 | 149 | 1.5% | 9.1 MB |
| French | 7×7 square (12 blocked) | 3,158,591 | 99,854 | 197 | 3.2% | 12 MB |

Every difficulty level and solution length that existed before filtering is still represented. The filtered set covers the full range of the puzzle space — from trivial 1-move warmups to the most challenging puzzles in each variant.

## Usage

```bash
# Default: keep up to 1,000 per bucket
python3 filter_puzzles.py puzzles-beehive.llp -o puzzles-beehive-filtered.llp

# Smaller set for faster loading
python3 filter_puzzles.py puzzles-beehive.llp --n 100 -o puzzles-beehive-small.llp

# Maximum variety
python3 filter_puzzles.py puzzles-beehive.llp --n 5000 -o puzzles-beehive-large.llp
```

The filtered file is a standard `.llp` file — same format, sequential IDs, ready to drop into the web app.
