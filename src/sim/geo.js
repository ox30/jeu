// World geometry.
// The game world is a plane in kilometres (x = east, y = north), obtained with an
// equirectangular projection whose standard parallel is 50°N. The map drawn on screen IS this
// plane, so headings measured on the map are the headings used by the simulation.
// Distances, though, are those of the globe: a kilometre of the plane east-west is worth
// cos(latitude) / cos(50°) real kilometres (0.85 at 57°N, 1.10 at 45°N). Ships and aircraft
// move at their real speed, so a route bent to the north (toward the great circle) is shorter
// than the straight line of the map, and a route to the south longer, as on the real ocean.

export const EARTH_RADIUS_KM = 6371;
export const LAT0 = 50;
export const LON0 = -25;
const DEG = Math.PI / 180;
const KX = EARTH_RADIUS_KM * Math.cos(LAT0 * DEG) * DEG; // km per degree of longitude
const KY = EARTH_RADIUS_KM * DEG; // km per degree of latitude
const COS0 = Math.cos(LAT0 * DEG);

export const KNOT_KMH = 1.852;
export const FOOT_M = 0.3048;

/** Longitude/latitude (degrees) → [x, y] in km. */
export function project(lon, lat) {
  return [(lon - LON0) * KX, (lat - LAT0) * KY];
}

/** [x, y] in km → [lon, lat] in degrees. */
export function unproject(x, y) {
  return [x / KX + LON0, y / KY + LAT0];
}

/** Real kilometres per kilometre of the plane, east-west, at plane latitude y. */
export function scaleX(y) {
  return Math.cos((LAT0 + y / KY) * DEG) / COS0;
}

/** Real distance in km (the plane's east-west kilometres corrected at the middle latitude). */
export function distance(ax, ay, bx, by) {
  return Math.hypot((bx - ax) * scaleX((ay + by) / 2), by - ay);
}

/** [dx, dy] on the plane for `km` real kilometres along map heading h, at plane latitude y. */
export function stepAlong(h, km, y) {
  const hx = Math.sin(h * DEG);
  const hy = Math.cos(h * DEG);
  const k = km / Math.hypot(hx * scaleX(y), hy);
  return [hx * k, hy * k];
}

/** Great-circle distance in km between two points of the plane (exact on the sphere). */
export function sphereKm(ax, ay, bx, by) {
  const [lo1, la1] = unproject(ax, ay);
  const [lo2, la2] = unproject(bx, by);
  const p1 = la1 * DEG;
  const p2 = la2 * DEG;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lo2 - lo1) * DEG) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The great circle (the shortest way on the globe) from a to b as points of the plane: on
 * the flat map it bends toward the pole.
 */
export function greatCircle(ax, ay, bx, by, n = 48) {
  const vec = (x, y) => {
    const [lo, la] = unproject(x, y);
    return [Math.cos(la * DEG) * Math.cos(lo * DEG), Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG)];
  };
  const va = vec(ax, ay);
  const vb = vec(bx, by);
  const om = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (om < 1e-9) return [[ax, ay], [bx, by]];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const s1 = Math.sin((1 - f) * om) / Math.sin(om);
    const s2 = Math.sin(f * om) / Math.sin(om);
    const v = [0, 1, 2].map((k) => s1 * va[k] + s2 * vb[k]);
    out.push(project(Math.atan2(v[1], v[0]) / DEG, Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG));
  }
  return out;
}

/** Heading in degrees (0 = north, clockwise) of the vector (dx, dy). */
export function headingOf(dx, dy) {
  const h = Math.atan2(dx, dy) / DEG;
  return (h + 360) % 360;
}

/** Heading from point a to point b. */
export function bearing(ax, ay, bx, by) {
  return headingOf(bx - ax, by - ay);
}

/** Unit vector [dx, dy] for a heading in degrees. */
export function headingVector(h) {
  return [Math.sin(h * DEG), Math.cos(h * DEG)];
}

/** Signed difference b − a between two headings, in ]−180, 180]. */
export function headingDiff(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/** Turns from heading `current` toward `target` by at most `maxDeg` degrees. */
export function turnToward(current, target, maxDeg) {
  const d = headingDiff(current, target);
  const step = Math.max(-maxDeg, Math.min(maxDeg, d));
  return (current + step + 360) % 360;
}

/** Index 0-7 of the compass octant (N, NE, E, SE, S, SW, W, NW) of a heading. */
export function octant(h) {
  return Math.round(((h % 360) + 360) % 360 / 45) % 8;
}

/** Length in km of a polyline given as [[x, y], ...]. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

/** Ramer–Douglas–Peucker simplification of an open polyline [[x, y], ...]. */
export function simplifyPolyline(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const d = len === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
