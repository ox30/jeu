// Routes by sea. A route the player draws is checked for land and refused if it crosses
// some; a route the game makes itself (back to port, off to meet a convoy, a hunt) must go
// around the land on its own. Straight when the water is open; otherwise a shortest path on
// a grid of sea cells (5 km), then straightened wherever a straight line stays at sea.
// The same grid gives, for each port, the distance by sea from anywhere around (a field
// worked out once): what the sheet of a group shows for « Rentrer au port », at no cost.

import { distance, polylineLength, scaleX } from './geo.js';

const CELL_KM = 5;
const MAX_EXPANDED = 80000;

/**
 * The land of the 5 km cells (from their centres), as one raster for the whole map: built
 * once (a scanline fill of the coastlines, the detailed ones where the map has them).
 */
function landGrid(terrain) {
  if (terrain.landGrid) return terrain.landGrid;
  const cb = terrain.coarse ? terrain.coarse.box : null;
  if (!cb) return (terrain.landGrid = null);
  const fb = terrain.fine.box;
  const ix0 = Math.floor(cb[0] / CELL_KM);
  const iy0 = Math.floor(cb[1] / CELL_KM);
  const cols = Math.ceil(cb[2] / CELL_KM) - ix0 + 1;
  const rows = Math.ceil(cb[3] / CELL_KM) - iy0 + 1;
  const data = new Uint8Array(cols * rows);
  const fill = (rings, y, row, keep) => {
    const xs = [];
    for (const ring of rings) {
      if (y < ring.box[1] || y > ring.box[3]) continue;
      const p = ring.pts;
      const n = p.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = p[2 * i + 1];
        const yj = p[2 * j + 1];
        if ((yi > y) !== (yj > y)) xs.push(p[2 * i] + ((p[2 * j] - p[2 * i]) * (y - yi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Cells whose centre lies between two crossings: x = (ix + 0.5) * CELL_KM.
      const c0 = Math.max(0, Math.ceil(xs[k] / CELL_KM - 0.5) - ix0);
      const c1 = Math.min(cols - 1, Math.floor(xs[k + 1] / CELL_KM - 0.5) - ix0);
      for (let c = c0; c <= c1; c++) {
        if (keep((ix0 + c + 0.5) * CELL_KM)) data[row * cols + c] = 1;
      }
    }
  };
  const inFineX = (x) => x >= fb[0] && x <= fb[2];
  for (let row = 0; row < rows; row++) {
    const y = (iy0 + row + 0.5) * CELL_KM;
    const fineRow = y >= fb[1] && y <= fb[3];
    // As terrain.isLand: the detailed coastlines inside their box, the coarse ones elsewhere.
    fill(terrain.coarse.rings, y, row, (x) => !fineRow || !inFineX(x));
    if (fineRow) fill(terrain.fine.rings, y, row, inFineX);
  }
  return (terrain.landGrid = { ix0, iy0, cols, rows, data });
}

/** Land of a 5 km cell, from its centre. */
function landCell(terrain, ix, iy) {
  const g = landGrid(terrain);
  if (g) {
    const c = ix - g.ix0;
    const r = iy - g.iy0;
    if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) return g.data[r * g.cols + c] === 1;
  }
  if (!terrain.landCells) terrain.landCells = new Map();
  const key = ix * 1000003 + iy;
  let land = terrain.landCells.get(key);
  if (land === undefined) {
    land = terrain.isLand((ix + 0.5) * CELL_KM, (iy + 0.5) * CELL_KM);
    terrain.landCells.set(key, land);
  }
  return land;
}

/** True if no 5 km cell of land lies under the line a-b (its first and last cell excepted). */
function rasterClear(terrain, a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.ceil(len / (CELL_KM / 2));
  for (let k = 1; k < n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n;
    const y = a[1] + ((b[1] - a[1]) * k) / n;
    if (Math.hypot(x - a[0], y - a[1]) < CELL_KM || Math.hypot(x - b[0], y - b[1]) < CELL_KM) continue;
    if (landCell(terrain, Math.floor(x / CELL_KM), Math.floor(y / CELL_KM))) return false;
  }
  return true;
}

/** True if the straight line a-b stays at sea (its ends excepted, by `endKm`), looked at every `stepKm`. */
export function clearAtSea(world, a, b, endKm = 0, stepKm = 1.5) {
  return !world.terrain.findLandOnRoute([a, b], endKm, endKm, stepKm);
}

// The ways the game works out itself are looked at closely (a rock, a narrow headland).
const FINE_KM = 0.5;

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

// A binary heap of (float priority, integer value) in typed arrays, for the big fields.
function floatHeap() {
  let pri = new Float32Array(1 << 16);
  let val = new Int32Array(1 << 16);
  let size = 0;
  return {
    get size() {
      return size;
    },
    topPriority() {
      return pri[0];
    },
    push(p, v) {
      if (size === pri.length) {
        const np = new Float32Array(size * 2);
        np.set(pri);
        pri = np;
        const nv = new Int32Array(size * 2);
        nv.set(val);
        val = nv;
      }
      let i = size++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (pri[parent] <= p) break;
        pri[i] = pri[parent];
        val[i] = val[parent];
        i = parent;
      }
      pri[i] = p;
      val[i] = v;
    },
    pop() {
      const top = val[0];
      size--;
      if (size > 0) {
        const p = pri[size];
        const v = val[size];
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= size) break;
          const m = l + 1 < size && pri[l + 1] < pri[l] ? l + 1 : l;
          if (pri[m] >= p) break;
          pri[i] = pri[m];
          val[i] = val[m];
          i = m;
        }
        pri[i] = p;
        val[i] = v;
      }
      return top;
    },
  };
}

function gridPath(world, from, to, marginKm, avoid = null) {
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
  // `avoid`: waters closed to this ship besides the land (a U-boat's: avoidance.js).
  const open = (ix, iy) => (ix === sx && iy === sy) || (ix === gx && iy === gy)
    || (!landCell(terrain, ix, iy) && !(avoid && avoid.cell((ix + 0.5) * CELL_KM, (iy + 0.5) * CELL_KM)));
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

/**
 * Straightens a path: from each point, on to the farthest one in a straight line at sea. Two
 * neighbouring cells of the grid may still have a sliver of land between their centres (a rock,
 * the tip of a headland): the step goes round it, a little to one side.
 */
function straighten(pts, clear) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(pts[i], pts[j])) j--;
    if (j === i + 1 && !clear(pts[i], pts[j])) {
      const via = aside(pts[i], pts[j], clear);
      if (via) out.push(via);
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** A point beside the middle of a-b from which both halves are clear, or null. */
function aside(a, b, clear) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  for (const k of [1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6]) {
    const p = [mx - (dy / len) * k, my + (dx / len) * k];
    if (clear(a, p) && clear(p, b)) return p;
  }
  return null;
}

/**
 * Points of a route by sea from `from` to `to` (both [x, y]), the start left out; null if
 * there is none (a lake, or too far around). `endKm`: the last km may touch the coast (a
 * harbour mouth). `avoid`: other waters to keep out of ({ cell(x, y), clear(a, b) }).
 */
export function seaPath(world, from, to, endKm = 0, avoid = null) {
  const open = (a, b) => !avoid || avoid.clear(a, b);
  if (open(from, to) && clearAtSea(world, from, to, endKm, FINE_KM)) return [[to[0], to[1]]];
  for (const margin of [250, 900]) {
    const cells = gridPath(world, from, to, margin, avoid);
    if (!cells) continue;
    cells[0] = [from[0], from[1]];
    cells[cells.length - 1] = [to[0], to[1]];
    // The raster first (cheap: most of the lines tried cross a whole island), then the coast itself.
    return straighten(cells, (a, b) => rasterClear(world.terrain, a, b) && open(a, b) && clearAtSea(world, a, b, 0, FINE_KM)).slice(1);
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

// ---- distance by sea to a port ---------------------------------------------------------

/** How far out (real km) from its channels the field of a port reaches; beyond, a straight line to a channel. */
const FIELD_KM = 900;
// The 16 moves of the field: the 8 neighbours and the knight's moves (a nearer straight line).
const MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

/** The points a ship can come into the port by, with what is left of the way: [[x, y, km]]. */
function portSeeds(world, port) {
  const seeds = [];
  for (const [ai, a] of (port.approaches || []).entries()) {
    const pts = a.points;
    let rest = polylineLength(pts);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const seg = distance(ax, ay, bx, by);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL_KM / 2)));
      for (let k = 0; k < n; k++) seeds.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, rest - (seg * k) / n, ai, i]);
      rest -= seg;
    }
  }
  if (!seeds.length) {
    // No charted channel: the port, and the water around it out to a few km.
    seeds.push([port.x, port.y, 0]);
    for (let km = CELL_KM; km <= 15; km += CELL_KM / 2) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * 2 * Math.PI;
        const x = port.x + (Math.sin(a) * km) / scaleX(port.y);
        const y = port.y + Math.cos(a) * km;
        if (!world.terrain.isLand(x, y)) seeds.push([x, y, km]);
      }
    }
  }
  return seeds;
}

/**
 * Distance by sea (real km) from each 5 km cell around a port into it: a Dijkstra over the
 * sea cells, out from the port's channels (each point of a channel starts with what is left
 * of it), up to FIELD_KM. Built once per port, the first time it is asked for.
 */
function portField(world, port) {
  const terrain = world.terrain;
  // Kept with the coastlines: the same port in another game (a new game, a test) is the same field.
  if (!terrain.portFields) terrain.portFields = new Map();
  const key = fieldKey(port);
  const known = terrain.portFields.get(key);
  if (known) return known;
  const seeds = portSeeds(world, port);
  let seedMax = 0;
  for (const s of seeds) seedMax = Math.max(seedMax, s[2]);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of seeds) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  // East-west a km of the plane is worth less than a real km in the north: a wider box.
  const padY = FIELD_KM;
  const padX = FIELD_KM / Math.max(0.3, scaleX(y1 + padY));
  const ix0 = Math.floor((x0 - padX) / CELL_KM);
  const iy0 = Math.floor((y0 - padY) / CELL_KM);
  const cols = Math.ceil((x1 + padX) / CELL_KM) - ix0 + 1;
  const rows = Math.ceil((y1 + padY) / CELL_KM) - iy0 + 1;
  const n = cols * rows;
  const dist = new Float32Array(n).fill(Infinity);
  // The sea of the box (1), the channels open even along a coast.
  const sea = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) sea[r * cols + c] = landCell(terrain, ix0 + c, iy0 + r) ? 0 : 1;
  }
  const cx = (c) => (ix0 + c + 0.5) * CELL_KM;
  const cy = (r) => (iy0 + r + 0.5) * CELL_KM;
  const queue = floatHeap();
  const seedOf = new Map(); // cell → the seed it starts from (where a way in joins a channel)
  seeds.forEach(([x, y, km], k) => {
    const c = Math.floor(x / CELL_KM) - ix0;
    const r = Math.floor(y / CELL_KM) - iy0;
    const i = r * cols + c;
    sea[i] = 1;
    const d = Math.fround(km + distance(x, y, cx(c), cy(r))); // as stored (32 bits)
    if (d < dist[i]) {
      dist[i] = d;
      seedOf.set(i, k);
      queue.push(d, i);
    }
  });
  // Real length of each move, row by row (east-west a cell is worth scaleX of its latitude).
  const cost = new Float64Array(rows * MOVES.length);
  for (let r = 0; r < rows; r++) {
    MOVES.forEach(([dc, dr], m) => {
      cost[r * MOVES.length + m] = Math.hypot(dc * CELL_KM * scaleX(cy(r) + (dr * CELL_KM) / 2), dr * CELL_KM);
    });
  }
  // For each move: the cells it passes by, which must be at sea too (no cutting a corner).
  const by = MOVES.map(([dc, dr]) => {
    if (Math.abs(dc) + Math.abs(dr) === 1) return [];
    if (Math.abs(dc) === 1 && Math.abs(dr) === 1) return [[dc, 0], [0, dr]];
    if (Math.abs(dc) === 2) return [[Math.sign(dc), 0], [Math.sign(dc), dr]];
    return [[0, Math.sign(dr)], [dc, Math.sign(dr)]];
  });
  const limit = FIELD_KM + seedMax; // (the box keeps it within FIELD_KM of the channels)
  while (queue.size) {
    const d = queue.topPriority();
    const i = queue.pop();
    if (d > dist[i]) continue;
    if (d > limit) break;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let m = 0; m < MOVES.length; m++) {
      const nc = c + MOVES[m][0];
      const nr = r + MOVES[m][1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!sea[j]) continue;
      let blocked = false;
      for (const [bc, br] of by[m]) {
        const k = (r + br) * cols + (c + bc);
        if (!sea[k]) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const nd = Math.fround(d + cost[r * MOVES.length + m]);
      if (nd < dist[j]) {
        dist[j] = nd;
        queue.push(nd, j);
      }
    }
  }
  const field = { ix0, iy0, cols, rows, dist, sea, cost, by, seeds, seedOf };
  terrain.portFields.set(key, field);
  return field;
}

const KEYS = new WeakMap();
function fieldKey(port) {
  if (KEYS.has(port)) return KEYS.get(port);
  const ways = (port.approaches || []).map((a) => a.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
  const key = `${port.id}|${port.x.toFixed(2)},${port.y.toFixed(2)}|${ways.join('|')}`;
  KEYS.set(port, key);
  return key;
}

/**
 * Distance by sea (real km) from (x, y) into the port, by one of its channels: from the
 * port's field where it reaches, else straight to the nearest channel's entrance and up the
 * channel. null when the port cannot be reached from there (a lake).
 */
export function seaKmToPort(world, port, x, y) {
  const f = portField(world, port);
  const c = Math.floor(x / CELL_KM) - f.ix0;
  const r = Math.floor(y / CELL_KM) - f.iy0;
  if (c >= 0 && r >= 0 && c < f.cols && r < f.rows) {
    let best = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= f.cols || rr >= f.rows) continue;
        const v = f.dist[rr * f.cols + cc];
        if (v < Infinity) best = Math.min(best, v + distance(x, y, (f.ix0 + cc + 0.5) * CELL_KM, (f.iy0 + rr + 0.5) * CELL_KM));
      }
    }
    if (best < Infinity) return best;
  }
  // Far out: the open ocean to a channel's entrance, then the channel.
  let best = null;
  for (const a of port.approaches || []) {
    const [gx, gy] = a.points[0];
    const km = distance(x, y, gx, gy) + polylineLength(a.points);
    if (best === null || km < best) best = km;
  }
  return best === null ? distance(x, y, port.x, port.y) : best;
}

/**
 * Where the shortest way by sea from (x, y) meets one of the port's channels, down the
 * port's field: { join: [x, y], tail: [the channel's points after it], km } or null when
 * (x, y) is beyond the field (or cannot reach the port).
 */
export function fieldJoin(world, port, x, y) {
  const f = portField(world, port);
  const { cols, rows, dist, sea, cost, by } = f;
  let c = Math.floor(x / CELL_KM) - f.ix0;
  let r = Math.floor(y / CELL_KM) - f.iy0;
  if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) return null;
  let i = r * cols + c;
  if (dist[i] === Infinity) {
    // On the coast: from the nearest cell of the field.
    let best = -1;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const j = (r + dr) * cols + (c + dc);
        if (dist[j] < Infinity && (best < 0 || dist[j] < dist[best])) best = j;
      }
    }
    if (best < 0) return null;
    i = best;
  }
  const km = seaKmToPort(world, port, x, y);
  for (let guard = 0; guard < cols * rows && !f.seedOf.has(i); guard++) {
    c = i % cols;
    r = (i - c) / cols;
    let next = -1;
    let nextD = dist[i];
    for (let m = 0; m < MOVES.length; m++) {
      const nc = c + MOVES[m][0];
      const nr = r + MOVES[m][1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!sea[j] || dist[j] >= nextD) continue;
      if (by[m].some(([bc, br]) => !sea[(r + br) * cols + (c + bc)])) continue;
      const via = dist[j] + cost[r * MOVES.length + m];
      if (via <= dist[i] + 0.01) {
        next = j;
        nextD = dist[j];
      }
    }
    if (next < 0) return null;
    i = next;
  }
  const seed = f.seeds[f.seedOf.get(i)];
  if (!seed || seed[3] === undefined) return { join: [port.x, port.y], tail: [], km };
  const pts = port.approaches[seed[3]].points;
  return { join: [seed[0], seed[1]], tail: pts.slice(seed[4] + 1).map(([px, py]) => [px, py]), km };
}

/** Works out the field of one more port ahead of need (for idle moments); false when all are done. */
export function warmPortField(world) {
  const done = world.terrain.portFields;
  const port = (world.ports || []).find((p) => !p.foreign && (p.convoys || p.coastal) && !(done && done.has(fieldKey(p))));
  if (!port) return false;
  portField(world, port);
  return true;
}
