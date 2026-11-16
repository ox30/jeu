// Describes a position the way a controller would: "15 km south-east of Dover (J5)".

import { bearing, distance, octant } from './geo.js';
import { gridRef } from './grid.js';

/** { place, of, km, dir, grid } where dir is an octant index (0 = north), or null. */
export function describeLocation(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const l of world.landmarks) {
    const d = distance(x, y, l.x, l.y);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  const grid = gridRef(world.grid, x, y);
  if (!best) return grid ? { place: null, grid } : null;
  if (bestD < 4) return { place: best.name, of: best.of || null, km: 0, dir: null, grid };
  return { place: best.name, of: best.of || null, km: Math.round(bestD), dir: octant(bearing(best.x, best.y, x, y)), grid };
}
