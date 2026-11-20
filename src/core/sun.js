// The sun: its height above the horizon for a date, a time and a place, from the usual
// formulas (declination and equation of time as short Fourier series of the day of the year).
// Good to a few minutes of sunrise, which is all the game needs. Times are true UTC timestamps;
// longitudes are east-positive, in degrees.

const DEG = Math.PI / 180;

/** It is day while the sun's centre is above this height: refraction and the sun's own radius. */
export const DAY_LIMIT_DEG = -0.833;
/** Below this height the sky is dark: the end of civil twilight. */
export const DARK_LIMIT_DEG = -6;

// The sun moves slowly: its position is worked out once a minute and kept.
let cachedMinute = NaN;
let cached = null;

/**
 * Where the sun is at `utcMs`: sine and cosine of its declination, and the longitude (degrees)
 * where it is noon, true solar time.
 */
export function sunPosition(utcMs) {
  const minute = Math.floor(utcMs / 60000);
  if (minute === cachedMinute) return cached;
  const d = new Date(minute * 60000);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const leap = new Date(Date.UTC(d.getUTCFullYear(), 1, 29)).getUTCMonth() === 1;
  const dayMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dayOfYear = Math.floor((minute * 60000 - yearStart) / 86400000); // 0 on 1 January
  const g = ((2 * Math.PI) / (leap ? 366 : 365)) * (dayOfYear + (dayMinutes / 60 - 12) / 24);
  const equationMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  cachedMinute = minute;
  cached = {
    declination,
    sinDecl: Math.sin(declination),
    cosDecl: Math.cos(declination),
    // True solar time (minutes) = minutes of the day + equation of time + 4 × longitude: noon
    // where it is 720.
    noonLon: (720 - dayMinutes - equationMin) / 4,
  };
  return cached;
}

/** Height of the sun (degrees above the horizon) at `utcMs`, longitude and latitude in degrees. */
export function sunElevationDeg(utcMs, lon, lat) {
  const sun = sunPosition(utcMs);
  const hourAngle = (lon - sun.noonLon) * DEG;
  const phi = lat * DEG;
  const sinHeight = Math.sin(phi) * sun.sinDecl + Math.cos(phi) * sun.cosDecl * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinHeight))) / DEG;
}

/** Is it day there (the sun above the horizon)? */
export function isSunUp(utcMs, lon, lat) {
  return sunElevationDeg(utcMs, lon, lat) > DAY_LIMIT_DEG;
}

/**
 * The longitudes in daylight on the parallel `lat` at `utcMs`: { west, east } in degrees (east
 * positive, not wrapped: the sun is highest half-way between them), or 'day' / 'night' when
 * the whole parallel is lit or dark. `limitDeg`: the height of the sun that counts as the edge
 * (the horizon by default; lower for the end of twilight).
 * From sin(limit) = sin(lat) sinDecl + cos(lat) cosDecl cos(H), solved for the hour angle H.
 */
export function daylightLongitudes(utcMs, lat, limitDeg = DAY_LIMIT_DEG) {
  const sun = sunPosition(utcMs);
  const phi = lat * DEG;
  const denominator = Math.cos(phi) * sun.cosDecl;
  if (Math.abs(denominator) < 1e-12) return Math.sin(phi) * sun.sinDecl > Math.sin(limitDeg * DEG) ? 'day' : 'night';
  const cosH = (Math.sin(limitDeg * DEG) - Math.sin(phi) * sun.sinDecl) / denominator;
  if (cosH <= -1) return 'day';
  if (cosH >= 1) return 'night';
  const half = Math.acos(cosH) / DEG;
  return { west: sun.noonLon - half, east: sun.noonLon + half };
}

/** Hours of daylight on the day of `utcMs` at this place (0 to 24), counted minute by minute. */
export function daylightHours(utcMs, lon, lat) {
  const start = Math.floor(utcMs / 86400000) * 86400000;
  let minutes = 0;
  for (let m = 0; m < 1440; m++) if (isSunUp(start + m * 60000, lon, lat)) minutes++;
  return minutes / 60;
}
