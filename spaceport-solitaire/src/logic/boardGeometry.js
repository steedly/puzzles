// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Board geometry definitions for different variants.
 *
 * Square boards (standard, solitaire, ufo, french): 7x7 grid, 4 directions.
 * Hex boards (hex, beehive): 7x7 grid rotated 45° to form a diamond,
 *   6 directions (4 cardinal + 2 diagonals).
 *   "hex" uses blocked border cells (like UFO) for a 5x5 inner board.
 */

const SQUARE_DIRS = [
  { dr: -1, dc:  0, name: 'up' },
  { dr:  1, dc:  0, name: 'down' },
  { dr:  0, dc: -1, name: 'left' },
  { dr:  0, dc:  1, name: 'right' },
];

const HEX_DIRS = [
  { dr: -1, dc:  0, name: 'nw' },    // "up" on grid = NW on hex
  { dr:  1, dc:  0, name: 'se' },    // "down" on grid = SE on hex
  { dr:  0, dc: -1, name: 'sw' },    // "left" on grid = SW on hex
  { dr:  0, dc:  1, name: 'ne' },    // "right" on grid = NE on hex
  { dr: -1, dc:  1, name: 'no' },    // diagonal: N on hex
  { dr:  1, dc: -1, name: 'so' },    // diagonal: S on hex
];

export const SQUARE_7x7 = {
  type: 'square',
  N: 7,
  centerRow: 3,
  centerCol: 3,
  dirs: SQUARE_DIRS,
};

export const HEX_7x7 = {
  type: 'hex',
  N: 7,
  centerRow: 3,
  centerCol: 3,
  dirs: HEX_DIRS,
};

const VARIANT_BOARDS = {
  standard:  SQUARE_7x7,
  solitaire: SQUARE_7x7,
  ufo:       SQUARE_7x7,
  french:    SQUARE_7x7,
  hex:       HEX_7x7,
  beehive:   HEX_7x7,
};

export function boardForVariant(variant) {
  return VARIANT_BOARDS[variant] || SQUARE_7x7;
}
