// Day and night, by the sun: one function for the patrols, the lookouts, the Condors, the
// U-boats' attacks and the shadow drawn on the map. It is day where the sun is above the
// horizon, at the date and the hour of the game and at the place asked.
// The clock of the game keeps British time: GMT+1 in the summer of 1940 and all through the
// winter of 1941 (summer time was kept on); a scenario can give another offset (clockOffsetH).

import { DAY_LIMIT_DEG, sunElevationDeg } from '../core/sun.js';
import { unproject } from './geo.js';

/** The true UTC time (ms) of the game's clock. */
export function utcMs(world) {
  return world.startMs + world.t * 1000 - (world.clockOffsetH ?? 1) * 3600000;
}

/** Height of the sun (degrees) above the horizon at a point of the plane, now. */
export function sunHeight(world, x, y) {
  const [lon, lat] = unproject(x, y);
  return sunElevationDeg(utcMs(world), lon, lat);
}

/** Is it day at (x, y) now? */
export function isDaylight(world, x, y) {
  return sunHeight(world, x, y) > DAY_LIMIT_DEG;
}

/** Is it night at (x, y) now? */
export function isNight(world, x, y) {
  return !isDaylight(world, x, y);
}
