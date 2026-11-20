// The search for a way by sea (C10 of the audit): typed arrays and whole-number costs. It must
// still find a shortest way over the sea cells, keep its routes at sea, keep the U-boats out
// of the closed waters, and be quick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';
import { project, unproject } from '../src/sim/geo.js';
import { CELL_KM, clearAtSea, landRaster, seaPath, shortestCells } from '../src/sim/searoute.js';
import { closedRaster, inClosedWaters, openForUboat, uboatPath } from '../src/sim/uboatnav.js';

const STRAIGHT = 70;
const DIAGONAL = 99;

function randomSource(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A point of open sea around the British Isles (not in the cell of a coast). */
function seaPoint(w, rnd, ok = () => true) {
  for (let i = 0; i < 1000; i++) {
    const p = project(-16 + rnd() * 18, 48 + rnd() * 12);
    if (!w.terrain.isLand(p[0], p[1]) && ok(p)) return p;
  }
  throw new Error('no sea point');
}

/** Cost of a path of cells, as the search counts it; fails if two cells are not neighbours. */
function cellsCost(cells) {
  let cost = 0;
  for (let i = 1; i < cells.length; i++) {
    const dx = Math.round((cells[i][0] - cells[i - 1][0]) / CELL_KM);
    const dy = Math.round((cells[i][1] - cells[i - 1][1]) / CELL_KM);
    assert.ok(Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy), 'neighbouring cells');
    cost += dx && dy ? DIAGONAL : STRAIGHT;
  }
  return cost;
}

/** The same question answered slowly: a plain Dijkstra over the same window and the same rules. */
function referenceCost(w, from, to, marginKm, closed = null) {
  const g = landRaster(w.terrain);
  const cell = (v, o) => Math.floor(v / CELL_KM) - o;
  const c0 = Math.max(0, cell(Math.min(from[0], to[0]) - marginKm, g.ix0));
  const c1 = Math.min(g.cols - 1, Math.ceil((Math.max(from[0], to[0]) + marginKm) / CELL_KM) - g.ix0);
  const r0 = Math.max(0, cell(Math.min(from[1], to[1]) - marginKm, g.iy0));
  const r1 = Math.min(g.rows - 1, Math.ceil((Math.max(from[1], to[1]) + marginKm) / CELL_KM) - g.iy0);
  const start = [cell(from[0], g.ix0), cell(from[1], g.iy0)];
  const goal = [cell(to[0], g.ix0), cell(to[1], g.iy0)];
  const key = (c, r) => r * g.cols + c;
  const shut = (c, r) => {
    const k = key(c, r);
    if (k === key(...start) || k === key(...goal)) return false;
    return g.data[k] === 1 || (closed && closed[k] === 1);
  };
  const dist = new Map([[key(...start), 0]]);
  const done = new Set();
  // Buckets by cost (whole numbers): a simple priority queue.
  const buckets = new Map([[0, [start]]]);
  let cost = 0;
  let pending = 1;
  while (pending > 0) {
    const bucket = buckets.get(cost);
    if (!bucket || !bucket.length) {
      buckets.delete(cost);
      cost++;
      continue;
    }
    const [c, r] = bucket.pop();
    pending--;
    const k = key(c, r);
    if (done.has(k) || dist.get(k) !== cost) continue;
    done.add(k);
    if (c === goal[0] && r === goal[1]) return cost;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nc = c + dx;
        const nr = r + dy;
        if (nc < c0 || nc > c1 || nr < r0 || nr > r1 || shut(nc, nr)) continue;
        if (dx && dy && (shut(c + dx, r) || shut(c, r + dy))) continue;
        const next = cost + (dx && dy ? DIAGONAL : STRAIGHT);
        const nk = key(nc, nr);
        if (next >= (dist.get(nk) ?? Infinity)) continue;
        dist.set(nk, next);
        if (!buckets.has(next)) buckets.set(next, []);
        buckets.get(next).push([nc, nr]);
        pending++;
      }
    }
  }
  return null;
}

test('the search finds a shortest way over the sea cells, round the British Isles', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const rnd = randomSource(7);
  let found = 0;
  let detours = 0;
  for (let i = 0; i < 40; i++) {
    const a = seaPoint(w, rnd);
    const b = seaPoint(w, rnd);
    const cells = shortestCells(w, a, b, 250);
    const reference = referenceCost(w, a, b, 250);
    if (reference === null) {
      assert.equal(cells, null, 'no way either');
      continue;
    }
    assert.ok(cells, 'a way exists');
    assert.equal(cellsCost(cells), reference, `pair ${i}: as short as the reference`);
    found++;
    if (!clearAtSea(w, a, b)) detours++;
  }
  assert.ok(found >= 30 && detours >= 8, `${found} ways, ${detours} of them round some land`);
});

test('the search keeps a U-boat out of the closed waters, and is still a shortest way', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const closed = closedRaster(w);
  const rnd = randomSource(11);
  const open = (p) => !inClosedWaters(w, p[0], p[1]);
  let round = 0;
  for (let i = 0; i < 25; i++) {
    const a = seaPoint(w, rnd, open);
    const b = seaPoint(w, rnd, open);
    const cells = shortestCells(w, a, b, 250, closed);
    const reference = referenceCost(w, a, b, 250, closed);
    if (reference === null) {
      assert.equal(cells, null);
      continue;
    }
    assert.equal(cellsCost(cells), reference, `pair ${i}`);
    for (const [x, y] of cells.slice(1, -1)) assert.ok(!inClosedWaters(w, x, y), 'no cell in closed waters');
    if (reference > referenceCost(w, a, b, 250)) round++;
  }
  assert.ok(round >= 2, `${round} ways made longer by the closed waters`);
});

test('routes by sea stay at sea, end where asked and are not much longer than the cells say', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const rnd = randomSource(3);
  const length = (pts) => pts.slice(1).reduce((km, p, i) => km + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  let checked = 0;
  for (let i = 0; i < 40; i++) {
    const a = seaPoint(w, rnd);
    const b = seaPoint(w, rnd);
    const path = seaPath(w, a, b);
    if (!path) continue;
    const full = [a, ...path];
    assert.deepEqual(path[path.length - 1], [b[0], b[1]], 'ends at the goal');
    for (let k = 1; k < full.length; k++) assert.ok(clearAtSea(w, full[k - 1], full[k], 0, 0.5), `pair ${i}, leg ${k}: at sea`);
    const cells = shortestCells(w, a, b, 250) || shortestCells(w, a, b, 900);
    if (cells) assert.ok(length(full) <= length(cells) + 1e-6, `pair ${i}: the straightened way is no longer than the cells'`);
    checked++;
  }
  assert.ok(checked >= 30);
  // A U-boat's way: at sea and out of the closed waters all along.
  for (let i = 0; i < 20; i++) {
    const a = seaPoint(w, rnd, (p) => openForUboat(w, p[0], p[1]));
    const b = seaPoint(w, rnd, (p) => openForUboat(w, p[0], p[1]));
    const path = uboatPath(w, a, b);
    if (!path) continue;
    const full = [a, ...path];
    for (let k = 1; k < full.length; k++) {
      const n = Math.ceil(Math.hypot(full[k][0] - full[k - 1][0], full[k][1] - full[k - 1][1]) / 2);
      for (let s = 0; s <= n; s++) {
        const x = full[k - 1][0] + ((full[k][0] - full[k - 1][0]) * s) / n;
        const y = full[k - 1][1] + ((full[k][1] - full[k - 1][1]) * s) / n;
        assert.ok(openForUboat(w, x, y), `U-boat pair ${i}: ${unproject(x, y).map((v) => v.toFixed(2))} is open to it`);
      }
    }
  }
});

test('the long ways of the game are found, and found quickly', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const P = (lon, lat) => project(lon, lat);
  const cases = [
    ['Liverpool to the west of Ireland', () => seaPath(w, P(-3.2, 53.45), P(-15, 55.5))],
    ['mid-Atlantic to Liverpool', () => seaPath(w, P(-30, 52), P(-3.2, 53.45))],
    ['Halifax to the North Channel', () => seaPath(w, P(-63, 44.3), P(-6.5, 55.5))],
    ['a U-boat from the north-western approaches to Lorient', () => uboatPath(w, P(-15.28, 56.55), P(-3.4, 47.6))],
    ['a U-boat from Biscay to the north-western approaches', () => uboatPath(w, P(-6, 46), P(-12.5, 57.5))],
  ];
  for (const [name, run] of cases) {
    assert.ok(run(), `${name}: a way`); // the first run warms the code up
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      run();
      best = Math.min(best, performance.now() - t0);
    }
    // 2.6.1 took 35 to 200 ms for these (and gave up on the longest); the limit of a step is 20 ms.
    assert.ok(best < 20, `${name}: ${best.toFixed(1)} ms`);
  }
});

test('land or sea: the raster answers as the coastlines do, everywhere', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const t = w.terrain;
  const rnd = randomSource(5);
  const cb = t.coarse.box;
  const fb = t.fine.box;
  let land = 0;
  const same = (x, y) => {
    const fast = t.isLand(x, y);
    if (fast) land++;
    assert.equal(fast, t.isLandExact(x, y), `at ${unproject(x, y).map((v) => v.toFixed(3))}`);
  };
  for (let i = 0; i < 30000; i++) same(cb[0] + rnd() * (cb[2] - cb[0]), cb[1] + rnd() * (cb[3] - cb[1]));
  // Around the detailed map and its edge, where the coastline changes.
  for (let i = 0; i < 30000; i++) same(fb[0] - 30 + rnd() * (fb[2] - fb[0] + 60), fb[1] - 30 + rnd() * (fb[3] - fb[1] + 60));
  // Right beside the coastlines themselves.
  for (const rings of [t.coarse.rings, t.fine.rings]) {
    for (const ring of rings) {
      for (let k = 0; k < ring.pts.length; k += 2) same(ring.pts[k] + (rnd() - 0.5) * 6, ring.pts[k + 1] + (rnd() - 0.5) * 6);
    }
  }
  assert.ok(land > 10000, 'land and sea were both asked about');
});
