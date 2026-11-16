import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearing, headingDiff, octant, project, simplifyPolyline, turnToward, unproject } from '../src/sim/geo.js';
import { solveIntercept } from '../src/sim/intercept.js';
import { clockColorIndex, formatDate, formatTime, parseGameDate, splitDuration } from '../src/core/time.js';
import { createRandom } from '../src/core/random.js';
import { data } from './helpers.js';

test('projection round trip', () => {
  for (const [lon, lat] of [[-63.57, 44.65], [1.32, 51.12], [-25, 50], [10, 60]]) {
    const [x, y] = project(lon, lat);
    const [lon2, lat2] = unproject(x, y);
    assert.ok(Math.abs(lon - lon2) < 1e-9 && Math.abs(lat - lat2) < 1e-9);
  }
});

test('Dover to Calais is about 40 km', () => {
  const [ax, ay] = project(1.32, 51.12);
  const [bx, by] = project(1.858, 50.951);
  const d = Math.hypot(bx - ax, by - ay);
  assert.ok(d > 35 && d < 45, `got ${d}`);
});

test('headings', () => {
  assert.equal(bearing(0, 0, 0, 10), 0);
  assert.equal(bearing(0, 0, 10, 0), 90);
  assert.equal(bearing(0, 0, 0, -10), 180);
  assert.equal(bearing(0, 0, -10, 0), 270);
  assert.equal(headingDiff(350, 10), 20);
  assert.equal(headingDiff(10, 350), -20);
  assert.equal(turnToward(350, 20, 6), 356);
  assert.equal(turnToward(10, 12, 6), 12);
  assert.equal(octant(44), 1);
  assert.equal(octant(350), 0);
});

test('polyline simplification keeps the ends', () => {
  const line = [[0, 0], [1, 0.01], [2, 0], [3, 5], [4, 0]];
  const s = simplifyPolyline(line, 0.1);
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s[s.length - 1], [4, 0]);
  assert.ok(s.length < line.length);
});

test('interception of a stationary target', () => {
  const sol = solveIntercept(0, 0, 0.1, 30, 40, 0, 0);
  assert.ok(Math.abs(sol.time - 500) < 1e-6);
  assert.ok(Math.abs(sol.heading - bearing(0, 0, 30, 40)) < 1e-9);
});

test('interception of a crossing target, and impossible chase', () => {
  const sol = solveIntercept(0, 0, 0.14, 0, 50, 0.09, 0);
  assert.ok(sol && sol.time > 0);
  const dPursuer = Math.hypot(sol.x, sol.y);
  assert.ok(Math.abs(dPursuer - 0.14 * sol.time) < 1e-6);
  assert.equal(solveIntercept(0, 0, 0.05, 0, 50, 0, 0.1), null);
});

test('game calendar', () => {
  const ms = parseGameDate('1940-07-10T13:05');
  assert.equal(formatTime(ms), '13:05');
  assert.equal(formatDate(ms, data.fr.days, data.fr.months), 'mercredi 10 juillet 1940');
  assert.equal(clockColorIndex(parseGameDate('1940-07-10T13:02')), 0);
  assert.equal(clockColorIndex(parseGameDate('1940-07-10T13:07')), 1);
  assert.equal(clockColorIndex(parseGameDate('1940-07-10T13:14')), 2);
  assert.equal(clockColorIndex(parseGameDate('1940-07-10T13:15')), 0);
  assert.deepEqual(splitDuration(26 * 3600 + 5 * 60), { days: 1, hours: 2, minutes: 5 });
});

test('seeded random is repeatable', () => {
  const a = createRandom(42);
  const b = createRandom(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});
