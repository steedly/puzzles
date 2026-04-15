// Integration test for unified .llp format:
// 1. Parse every row of the unified puzzles.llp
// 2. For each of the 6 variants, verify at least one puzzle passes fitsVariant()
// 3. For one puzzle per variant, replay its stored solution through gameEngine and confirm win

import { readFileSync } from 'fs';
import { fitsVariant, VARIANT_FLAG_BITS } from './hooks/usePuzzleLibrary.js';
import { slideRobot, isWon } from './logic/gameEngine.js';
import { boardForVariant } from './logic/boardGeometry.js';

const VARIANTS = ['standard', 'solitaire', 'ufo', 'french', 'hex', 'beehive'];

// Minimal parseLine (duplicates the hook's logic for Node context)
const SQUARE_DIR_MAP = { U: 'up', D: 'down', L: 'left', R: 'right' };
const HEX_DIR_MAP = { Nw: 'nw', Se: 'se', Sw: 'sw', Ne: 'ne', No: 'no', So: 'so' };
const DIAGONAL_BIT = 1 << 6;
const CARDINAL_VARIANTS_SET = new Set(['standard', 'solitaire', 'ufo', 'french']);

function robotLabel(ch) {
  if (ch >= 'A' && ch <= 'Z') {
    const idx = ch.charCodeAt(0) - 65;
    return idx === 0 ? 'target' : `exit${idx}`;
  }
  return `r${ch}`;
}

function parseLine(line) {
  const parts = line.split('|');
  if (parts.length !== 10) return null; // only unified format

  const numExits = parseInt(parts[1], 10);
  const variantFlags = parseInt(parts[7], 10);
  const posStr = parts[8];
  const solStr = parts[9];

  const rawPositions = posStr.trim().split(' ');
  const robots = rawPositions.map((p, i) => {
    const [r, c] = p.split(',').map(Number);
    if (i < numExits) {
      const id = i === 0 ? 'target' : `exit${i}`;
      return { id, row: r, col: c, isExit: true };
    }
    return { id: `r${i - numExits + 1}`, row: r, col: c, isExit: false };
  });

  const solTokens = solStr ? solStr.trim().split(' ').filter(Boolean) : [];
  const solution = solTokens.map(mv => {
    if (mv.length === 4) {
      return { mover: robotLabel(mv[0]), dir: HEX_DIR_MAP[mv.slice(1, 3)] || mv.slice(1, 3), blocker: robotLabel(mv[3]) };
    }
    return { mover: robotLabel(mv[0]), dir: SQUARE_DIR_MAP[mv[1]] || mv[1], blocker: robotLabel(mv[2]) };
  });

  return { numExits, variantFlags, robots, solution };
}

function replaySolution(puzzle, board) {
  const exitIds = new Set(puzzle.robots.filter(r => r.isExit).map(r => r.id));
  let positions = {};
  for (const r of puzzle.robots) {
    positions[r.id] = { row: r.row, col: r.col };
  }

  for (let i = 0; i < puzzle.solution.length; i++) {
    const move = puzzle.solution[i];
    const result = slideRobot(positions, move.mover, move.dir, exitIds, null, board);
    if (!result) {
      return { ok: false, error: `Move ${i} (${move.mover} ${move.dir}) returned null` };
    }
    positions = result;
  }

  if (!isWon(positions, exitIds)) {
    return { ok: false, error: 'Solution did not reach win state' };
  }
  return { ok: true };
}

// --- Main ---
const llpPath = process.argv[2] || 'public/puzzles.llp';
const text = readFileSync(llpPath, 'utf-8');
const lines = text.split('\n').filter(l => l && !l.startsWith('#'));

console.log(`Loaded ${lines.length} lines from ${llpPath}`);

let parseErrors = 0;
const puzzles = [];
for (const line of lines) {
  const p = parseLine(line);
  if (!p) { parseErrors++; continue; }
  puzzles.push(p);
}

if (parseErrors > 0) {
  console.error(`FAIL: ${parseErrors} lines failed to parse as 10-field unified format`);
  process.exit(1);
}
console.log(`Parsed ${puzzles.length} puzzles (0 parse errors)`);

// Check each variant has puzzles
let allVariantsOk = true;
const variantCounts = {};
for (const v of VARIANTS) {
  const bit = VARIANT_FLAG_BITS[v];
  const matching = puzzles.filter(p => {
    if (!(p.variantFlags & bit)) return false;
    if (CARDINAL_VARIANTS_SET.has(v) && (p.variantFlags & DIAGONAL_BIT)) return false;
    return true;
  });
  variantCounts[v] = matching.length;
  if (matching.length === 0) {
    console.error(`FAIL: variant "${v}" has 0 puzzles`);
    allVariantsOk = false;
  } else {
    console.log(`  ${v}: ${matching.length} puzzles`);
  }
}

if (!allVariantsOk) {
  process.exit(1);
}

// Replay one solution per variant
console.log('\nReplaying one solution per variant...');
let replayOk = true;
for (const v of VARIANTS) {
  const board = boardForVariant(v);
  const bit = VARIANT_FLAG_BITS[v];
  const puzzle = puzzles.find(p => {
    if (!(p.variantFlags & bit)) return false;
    if (CARDINAL_VARIANTS_SET.has(v) && (p.variantFlags & DIAGONAL_BIT)) return false;
    return p.solution.length > 0;
  });
  if (!puzzle) {
    console.error(`  ${v}: FAIL — no puzzle with solution found`);
    replayOk = false;
    continue;
  }
  const result = replaySolution(puzzle, board);
  if (result.ok) {
    console.log(`  ${v}: PASS (replayed ${puzzle.solution.length}-slide solution)`);
  } else {
    console.error(`  ${v}: FAIL — ${result.error}`);
    replayOk = false;
  }
}

if (!replayOk) {
  console.error('\nFAIL: solution replay errors');
  process.exit(1);
}

console.log('\nAll checks passed.');
