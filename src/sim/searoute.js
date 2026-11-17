// Routes by sea. A route the player draws is checked for land and refused if it crosses
// some; a route the game makes itself (back to port, off to meet a convoy, a hunt) must go
// around the land on its own. Straight when the water is open; otherwise a shortest path on
// a grid of sea cells (5 km), then straightened wherever a straight line stays at sea.

import { distance } from './geo.js';

const CELL_KM = 5;
const MAX_EXPANDED = 80000;

/** Land of a 5 km cell, from its centre; remembered for the whole game. */
function landCell(terrain, ix, iy) {
  if (!terrain.landCells) terrain.landCells = new Map();
  const key = ix * 1000003 + iy;
  let land = terrain.landCells.get(key);
  if (land === undefined) {
    land = terrain.isLand((ix + 0.5) * CELL_KM, (iy + 0.5) * CELL_KM);
    terrain.landCells.set(key, land);
  }
  return land;
}

/** True if the straight line a-b stays at sea (its ends excepted, by `endKm`). */
export function clearAtSea(world, a, b, endKm = 0) {
  return !world.terrain.findLandOnRoute([a, b], endKm, endKm, 1.5);
}

// A small binary heap of [priority, value].
function heap() {
  const items = [];
  return {
    get size() {
      return items.length;
    },
    push(p, v) {
      items.push([p, v]);
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (items[parent][0] <= items[i][0]) break;
        [items[parent], items[i]] = [items[i], items[parent]];
        i = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < items.length && items[l][0] < items[m][0]) m = l;
          if (r < items.length && items[r][0] < items[m][0]) m = r;
          if (m === i) break;
          [items[m], items[i]] = [items[i], items[m]];
          i = m;
        }
      }
      return top[1];
    },
  };
}

function gridPath(world, from, to, marginKm) {
  const terrain = world.terrain;
  const minX = Math.floor((Math.min(from[0], to[0]) - marginKm) / CELL_KM);
  const maxX = Math.ceil((Math.max(from[0], to[0]) + marginKm) / CELL_KM);
  const minY = Math.floor((Math.min(from[1], to[1]) - marginKm) / CELL_KM);
  const maxY = Math.ceil((Math.max(from[1], to[1]) + marginKm) / CELL_KM);
  const w = maxX - minX + 1;
  const sx = Math.floor(from[0] / CELL_KM);
  const sy = Math.floor(from[1] / CELL_KM);
  const gx = Math.floor(to[0] / CELL_KM);
  const gy = Math.floor(to[1] / CELL_KM);
  // The cells of the start and of the end are open even on a coast (a harbour, a beach).
  const open = (ix, iy) => (ix === sx && iy === sy) || (ix === gx && iy === gy) || !landCell(terrain, ix, iy);
  const id = (ix, iy) => (iy - minY) * w + (ix - minX);
  const g = new Map();
  const came = new Map();
  const h = (ix, iy) => Math.hypot(ix - gx, iy - gy);
  const queue = heap();
  const start = id(sx, sy);
  g.set(start, 0);
  queue.push(h(sx, sy), [sx, sy]);
  let expanded = 0;
  while (queue.size) {
    const [ix, iy] = queue.pop();
    if (ix === gx && iy === gy) {
      const cells = [];
      let k = id(ix, iy);
      while (k !== undefined) {
        cells.push(k);
        k = came.get(k);
      }
      return cells.reverse().map((c) => [((c % w) + minX + 0.5) * CELL_KM, (Math.floor(c / w) + minY + 0.5) * CELL_KM]);
    }
    if (++expanded > MAX_EXPANDED) return null;
    const here = g.get(id(ix, iy));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        if (!open(nx, ny)) continue;
        // No cutting across a corner of land.
        if (dx && dy && (!open(ix + dx, iy) || !open(ix, iy + dy))) continue;
        const cost = here + (dx && dy ? Math.SQRT2 : 1);
        const k = id(nx, ny);
        if (cost >= (g.get(k) ?? Infinity)) continue;
        g.set(k, cost);
        came.set(k, id(ix, iy));
        queue.push(cost + h(nx, ny), [nx, ny]);
      }
    }
  }
  return null;
}

/** Straightens a path: from each point, on to the farthest one in a straight line at sea. */
function straighten(world, pts) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearAtSea(world, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/**
 * Points of a route by sea from `from` to `to` (both [x, y]), the start left out; null if
 * there is none (a lake, or too far around). `endKm`: the last km may touch the coast (a
 * harbour mouth).
 */
export function seaPath(world, from, to, endKm = 0) {
  if (clearAtSea(world, from, to, endKm)) return [[to[0], to[1]]];
  for (const margin of [250, 900]) {
    const cells = gridPath(world, from, to, margin);
    if (!cells) continue;
    cells[0] = [from[0], from[1]];
    cells[cells.length - 1] = [to[0], to[1]];
    return straighten(world, cells).slice(1);
  }
  return null;
}

/** Length (km) of a route by sea, or Infinity. */
export function seaPathKm(world, from, to) {
  const path = seaPath(world, from, to);
  if (!path) return Infinity;
  let km = 0;
  let prev = from;
  for (const p of path) {
    km += distance(prev[0], prev[1], p[0], p[1]);
    prev = p;
  }
  return km;
}
