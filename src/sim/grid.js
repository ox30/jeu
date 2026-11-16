// Grid of lettered squares laid over the south of England, as on the plotting tables:
// columns are letters (I is skipped, as on British military grids), rows are numbers
// counted from the north. A reference such as "J5" names one square.

import { project } from './geo.js';

const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

export function createGrid(def) {
  if (!def) return null;
  const [x0, y0] = project(def.origin[0], def.origin[1]);
  return { x0, y0, size: def.sizeKm, cols: Math.min(def.cols, LETTERS.length), rows: def.rows };
}

export function columnLetter(index) {
  return LETTERS[index] || '?';
}

/** Reference of the square containing (x, y), or null outside the grid. */
export function gridRef(grid, x, y) {
  if (!grid) return null;
  const c = Math.floor((x - grid.x0) / grid.size);
  const r = Math.floor((grid.y0 - y) / grid.size);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
  return `${LETTERS[c]}${r + 1}`;
}

/** Square named by `ref` ("J5", "j 5"): { ref, x0, y0, x1, y1, cx, cy } or null. */
export function gridSquare(grid, ref) {
  if (!grid || typeof ref !== 'string') return null;
  const m = /^\s*([A-Za-z])\s*(\d{1,2})\s*$/.exec(ref);
  if (!m) return null;
  const c = LETTERS.indexOf(m[1].toUpperCase());
  const r = Number(m[2]) - 1;
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
  const x0 = grid.x0 + c * grid.size;
  const y1 = grid.y0 - r * grid.size;
  return {
    ref: `${LETTERS[c]}${r + 1}`,
    x0,
    x1: x0 + grid.size,
    y0: y1 - grid.size,
    y1,
    cx: x0 + grid.size / 2,
    cy: y1 - grid.size / 2,
  };
}

export function inSquare(square, x, y) {
  return x >= square.x0 && x <= square.x1 && y >= square.y0 && y <= square.y1;
}
