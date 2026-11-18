// Where the U-boats may go, and by which way.
// By early 1941 some waters were closed to them: the Irish Sea behind the minefields of the
// North Channel and of St George's Channel, the Firth of Clyde, the sounds of the Hebrides and
// the Minch, the Channel, the Bristol Channel (rules: uboats.closedWaters). They waited for the
// convoys out in the approaches. And they go round the land like any ship: their way is worked
// out on the grid of sea cells (searoute.js), keeping out of the closed waters.

import { bearing, distance, project, scaleX } from './geo.js';
import { seaPath } from './searoute.js';

const CACHE = new WeakMap(); // the rules' list → its polygons on the plane

/** The closed waters, as polygons of the plane with their boxes. */
function closedWaters(world) {
  const list = (world.rules.uboats && world.rules.uboats.closedWaters) || [];
  let known = CACHE.get(list);
  if (!known) {
    known = list.map((w) => {
      const pts = w.area.map(([lon, lat]) => project(lon, lat));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { name: w.name, pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    CACHE.set(list, known);
  }
  return known;
}

function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True if (x, y) lies in waters closed to the U-boats. */
export function inClosedWaters(world, x, y) {
  for (const w of closedWaters(world)) {
    const b = w.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (inPolygon(w.pts, x, y)) return true;
  }
  return false;
}

/** True if a U-boat may be at (x, y): at sea, out of the closed waters. */
export function openForUboat(world, x, y) {
  return !inClosedWaters(world, x, y) && !world.terrain.isLand(x, y);
}

function crosses(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True if the straight line a-b keeps out of the closed waters. */
function clearOfClosed(world, a, b) {
  for (const w of closedWaters(world)) {
    const bx = w.box;
    if (Math.max(a[0], b[0]) < bx[0] || Math.min(a[0], b[0]) > bx[2] || Math.max(a[1], b[1]) < bx[1] || Math.min(a[1], b[1]) > bx[3]) continue;
    if (inPolygon(w.pts, a[0], a[1]) || inPolygon(w.pts, b[0], b[1])) return false;
    for (let i = 0, j = w.pts.length - 1; i < w.pts.length; j = i++) if (crosses(a, b, w.pts[j], w.pts[i])) return false;
  }
  return true;
}

/**
 * The way of a U-boat from `from` to `to` ([x, y]): its points, `to` last; null if there is
 * none. A boat already in closed waters (an old save) may leave them.
 */
export function uboatPath(world, from, to) {
  const avoid = inClosedWaters(world, from[0], from[1]) ? null : {
    cell: (x, y) => inClosedWaters(world, x, y),
    clear: (a, b) => clearOfClosed(world, a, b),
  };
  return seaPath(world, from, to, 0, avoid);
}

/**
 * The nearest point to (x, y) where a U-boat may wait (out to `maxKm`): (x, y) itself when it
 * is open sea; null if there is none.
 */
export function uboatSpot(world, x, y, maxKm = 150) {
  if (openForUboat(world, x, y)) return [x, y];
  for (let km = 10; km <= maxKm; km += 10) {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 2 * Math.PI;
      const px = x + (Math.sin(a) * km) / scaleX(y);
      const py = y + Math.cos(a) * km;
      // Of the points at that distance, the one farthest out to sea (west).
      if (openForUboat(world, px, py) && (!best || px < best[0])) best = [px, py];
    }
    if (best) return best;
  }
  return null;
}

/** Straight toward (tx, ty) at `speedKmS` for `dt` s; true once there. */
export function moveTo(u, tx, ty, speedKmS, dt) {
  const d = distance(u.x, u.y, tx, ty);
  const step = speedKmS * dt;
  if (d > 1e-6 && step > 0) u.heading = bearing(u.x, u.y, tx, ty);
  if (d <= step) {
    u.x = tx;
    u.y = ty;
    return true;
  }
  u.x += ((tx - u.x) / d) * step;
  u.y += ((ty - u.y) / d) * step;
  return false;
}

/**
 * One step of a U-boat toward (tx, ty), by its way round the land and the closed waters. The
 * way is worked out again only when the goal has moved well away from where it was (a convoy
 * moves on). 'arrived', 'moving', or 'blocked' when there is no way there.
 */
export function steerUboat(world, u, tx, ty, speedKmS, dt) {
  let way = u.way;
  if (!way || distance(way.tx, way.ty, tx, ty) > Math.max(5, distance(u.x, u.y, tx, ty) * 0.1)) {
    way = { tx, ty, pts: uboatPath(world, [u.x, u.y], [tx, ty]) };
    u.way = way;
  }
  if (!way.pts) return 'blocked';
  if (way.pts.length > 1) {
    const [wx, wy] = way.pts[0];
    if (moveTo(u, wx, wy, speedKmS, dt)) way.pts.shift();
    return 'moving';
  }
  return moveTo(u, tx, ty, speedKmS, dt) ? 'arrived' : 'moving';
}

/**
 * A boat (of a game saved by an earlier version) found ashore or in closed waters: back to the
 * nearest open sea, its station too.
 */
export function bringToSea(world, u) {
  if (u.state === 'gone' || u.state === 'sunk') return;
  if (!openForUboat(world, u.x, u.y)) {
    const spot = uboatSpot(world, u.x, u.y, 600);
    if (spot) [u.x, u.y] = spot;
    u.way = null;
  }
  if (!openForUboat(world, u.hx, u.hy)) {
    [u.hx, u.hy] = uboatSpot(world, u.hx, u.hy, 600) || [u.x, u.y];
    [u.wx, u.wy] = [u.hx, u.hy];
    u.way = null;
  }
}
