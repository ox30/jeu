// Land and sea, from the map files built by tools/build-maps.mjs.

import { distance, polylineLength, project } from './geo.js';

/** Decodes a map file (delta-encoded integer rings) into rings of km coordinates. */
export function decodeMap(data) {
  const rings = data.rings.map((encoded, index) => {
    const pts = new Float64Array(encoded.length);
    let x = 0;
    let y = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < encoded.length; k += 2) {
      x += encoded[k];
      y += encoded[k + 1];
      const px = x * data.unit;
      const py = y * data.unit;
      pts[k] = px;
      pts[k + 1] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return { pts, box: [minX, minY, maxX, maxY], cuts: data.cuts[index] || null };
  });
  return { rings, box: data.box, clip: data.clip, source: data.source };
}

/** Even-odd point-in-polygon test over a set of rings (holes are handled by parity). */
export function pointInRings(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    const b = ring.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    const p = ring.pts;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1];
      const xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function createTerrain(coarseData, fineData) {
  const coarse = decodeMap(coarseData);
  const fine = decodeMap(fineData);
  const fb = fine.box;
  const inFine = (x, y) => x >= fb[0] && x <= fb[2] && y >= fb[1] && y <= fb[3];

  function isLand(x, y) {
    return inFine(x, y) ? pointInRings(fine.rings, x, y) : pointInRings(coarse.rings, x, y);
  }

  // Great Britain is the detailed ring that contains London.
  const [lx, ly] = project(-0.128, 51.507);
  const britain = fine.rings.find((ring) => pointInRings([ring], lx, ly)) || null;

  function isOverBritain(x, y) {
    return britain !== null && pointInRings([britain], x, y);
  }

  /**
   * First land point met along a route [[x, y], ...], or null. The first `skipStartKm` and
   * the last `skipEndKm` are ignored (leaving and entering a harbour).
   */
  function findLandOnRoute(points, skipStartKm = 0, skipEndKm = 0, stepKm = 3) {
    const total = polylineLength(points);
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const len = distance(ax, ay, bx, by);
      const steps = Math.max(1, Math.ceil(len / stepKm));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const along = travelled + f * len;
        if (along < skipStartKm || along > total - skipEndKm) continue;
        const x = ax + (bx - ax) * f;
        const y = ay + (by - ay) * f;
        if (isLand(x, y)) return [x, y];
      }
      travelled += len;
    }
    return null;
  }

  return { coarse, fine, isLand, isOverBritain, findLandOnRoute };
}
