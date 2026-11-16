// World geometry.
// The game world is a flat plane in kilometres (x = east, y = north), obtained with an
// equirectangular projection whose standard parallel is 50°N: distances are nearly exact
// over the Channel and stay within ~12 % across the North Atlantic, which is fine for a game.
// The map drawn on screen IS this plane, so headings measured on the map are the headings
// used by the simulation.

export const EARTH_RADIUS_KM = 6371;
export const LAT0 = 50;
export const LON0 = -25;
const DEG = Math.PI / 180;
const KX = EARTH_RADIUS_KM * Math.cos(LAT0 * DEG) * DEG; // km per degree of longitude
const KY = EARTH_RADIUS_KM * DEG; // km per degree of latitude

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

export function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
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
