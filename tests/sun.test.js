// Day and night by the sun (N6): the height of the sun for a date, a time and a place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DARK_LIMIT_DEG, DAY_LIMIT_DEG, daylightHours, daylightLongitudes, isSunUp, sunElevationDeg, sunPosition } from '../src/core/sun.js';

const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const DEG = Math.PI / 180;

/** First minute of the day (UTC) when the sun is up, and the first when it is down again. */
function riseAndSet(y, m, d, lon, lat) {
  let rise = null;
  let set = null;
  for (let min = 0; min < 1440; min++) {
    const up = isSunUp(utc(y, m, d, 0, min), lon, lat);
    if (up && rise === null) rise = min;
    if (!up && rise !== null && set === null) set = min;
  }
  return { rise, set };
}
const hm = (h, m) => h * 60 + m;

test('the declination of the sun follows the seasons', () => {
  assert.ok(Math.abs(sunPosition(utc(1940, 6, 21, 12)).declination / DEG - 23.44) < 0.1, 'summer solstice');
  assert.ok(Math.abs(sunPosition(utc(1940, 12, 21, 12)).declination / DEG + 23.44) < 0.1, 'winter solstice');
  assert.ok(Math.abs(sunPosition(utc(1941, 3, 21, 0)).declination / DEG) < 0.5, 'spring equinox');
});

test('at noon on the equator at the equinox the sun is overhead; at midnight it is under the earth', () => {
  const noonLon = sunPosition(utc(1941, 3, 21, 12)).noonLon;
  assert.ok(Math.abs(noonLon) < 3, 'noon near Greenwich at 12:00 UTC');
  assert.ok(sunElevationDeg(utc(1941, 3, 21, 12), noonLon, 0) > 89);
  assert.ok(sunElevationDeg(utc(1941, 3, 21, 0), noonLon, 0) < -89);
});

test('London, 15 September 1940: sunrise about 05:35 and sunset about 18:14 GMT, 12 h 40 of day', () => {
  const { rise, set } = riseAndSet(1940, 9, 15, -0.1, 51.5);
  assert.ok(Math.abs(rise - hm(5, 35)) <= 4, `sunrise at ${Math.floor(rise / 60)}:${rise % 60}`);
  assert.ok(Math.abs(set - hm(18, 14)) <= 4, `sunset at ${Math.floor(set / 60)}:${set % 60}`);
  const day = daylightHours(utc(1940, 9, 15), -0.1, 51.5);
  assert.ok(Math.abs(day - 12.65) < 0.12, `${day.toFixed(2)} h of day`);
});

test('at 55° N the night shrinks from about 16 h in mid-January to about 11 h at the end of March', () => {
  const january = 24 - daylightHours(utc(1941, 1, 15), -10, 55);
  const march = 24 - daylightHours(utc(1941, 3, 31), -10, 55);
  assert.ok(Math.abs(january - 16.2) < 0.4, `${january.toFixed(2)} h of night in January`);
  assert.ok(Math.abs(march - 11.0) < 0.4, `${march.toFixed(2)} h of night at the end of March`);
});

test('the sun rises later in the west: an hour for fifteen degrees', () => {
  const east = riseAndSet(1941, 2, 1, -5, 54).rise;
  const west = riseAndSet(1941, 2, 1, -20, 54).rise;
  assert.ok(Math.abs(west - east - 60) <= 2, `${west - east} minutes for 15°`);
});

test('summer nights of the high north have no night, winter days no day', () => {
  assert.equal(daylightHours(utc(1940, 6, 21), 15, 70), 24);
  assert.equal(daylightHours(utc(1940, 12, 21), 15, 70), 0);
});

test('the edge of the night: on it the sun stands on the horizon, and the day lies between its two sides', () => {
  for (const [when, lat] of [[utc(1941, 1, 15, 17), 55], [utc(1941, 1, 15, 8), 40], [utc(1940, 9, 15, 5), 51.5], [utc(1941, 3, 20, 19), 60]]) {
    const span = daylightLongitudes(when, lat);
    assert.equal(typeof span, 'object', 'this parallel has a day side and a night side');
    for (const lon of [span.west, span.east]) assert.ok(Math.abs(sunElevationDeg(when, lon, lat) - DAY_LIMIT_DEG) < 1e-6);
    assert.ok(isSunUp(when, (span.west + span.east) / 2, lat), 'day in the middle');
    assert.ok(!isSunUp(when, span.east + 5, lat), 'night to the east of the evening edge');
    assert.ok(!isSunUp(when, span.west - 5, lat), 'night to the west of the morning edge');
  }
  // On 15 January at 17:00 GMT the evening edge at 55° N lies west of Ireland, near 15° W (the
  // sun sets about 16:00 GMT on the meridian of Greenwich, an hour later for 15° of longitude).
  const evening = daylightLongitudes(utc(1941, 1, 15, 17), 55);
  assert.ok(evening.east > -17 && evening.east < -12, `evening edge at ${evening.east.toFixed(1)}°`);
  // The far north in June is all day, in December all night; twilight lasts longer than the day.
  assert.equal(daylightLongitudes(utc(1940, 6, 21, 12), 70), 'day');
  assert.equal(daylightLongitudes(utc(1940, 12, 21, 12), 70), 'night');
  const day = daylightLongitudes(utc(1941, 2, 1, 12), 55);
  const twilight = daylightLongitudes(utc(1941, 2, 1, 12), 55, DARK_LIMIT_DEG);
  assert.ok(twilight.east - twilight.west > day.east - day.west + 10, 'civil twilight reaches further');
});
