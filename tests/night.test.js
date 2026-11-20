// N2: the night's shadow drawn on the map is the night of the simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';
import { DARK_LIMIT_DEG, DAY_LIMIT_DEG } from '../src/core/sun.js';
import { isNight } from '../src/sim/daylight.js';
import { project } from '../src/sim/geo.js';
import { readFileSync } from 'node:fs';
import { createCamera, toWorld, viewFrame, setFrame } from '../src/render/camera.js';

// The views of the map are data since 2.9.
const VIEWS = JSON.parse(readFileSync(new URL('../data/campaign.json', import.meta.url), 'utf8')).views;
import { nightSamples, shadowShare } from '../src/render/night.js';

function atlanticCamera() {
  const cam = createCamera();
  Object.assign(cam, { width: 1280, height: 720 });
  setFrame(cam, viewFrame(cam, VIEWS.atlantic));
  return cam;
}

test('the shadow grows through twilight: none by day, full once civil twilight is over', () => {
  assert.equal(shadowShare(10), 0);
  assert.equal(shadowShare(DAY_LIMIT_DEG + 0.01), 0);
  assert.equal(shadowShare(DARK_LIMIT_DEG), 1);
  assert.equal(shadowShare(-40), 1);
  const mid = shadowShare((DAY_LIMIT_DEG + DARK_LIMIT_DEG) / 2);
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
  assert.ok(shadowShare(-2) < shadowShare(-4));
});

test('where the map is shaded, the simulation says night, and nowhere else', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const cam = atlanticCamera();
  const cell = 40;
  let mixed = 0;
  // Every two hours for two days: dusk and dawn cross the Atlantic.
  for (let h = 0; h < 48; h += 2) {
    w.t = h * 3600 + 1200;
    const n = nightSamples(w, cam, cell);
    for (let j = 0; j < n.rows; j++) {
      for (let i = 0; i < n.cols; i++) {
        const [x, y] = toWorld(cam, i * cell, j * cell);
        assert.equal(n.share[j * n.cols + i] > 0, isNight(w, x, y), `hour ${h}, sample ${i},${j}`);
      }
    }
    assert.equal(n.lit, n.share.every((s) => s === 0));
    assert.equal(n.dark, n.share.every((s) => s === 1));
    if (!n.lit && !n.dark) mixed++;
  }
  assert.ok(mixed >= 6, `the terminator crosses the map at ${mixed} of the hours tried`);
});

test('dusk comes from the east: at 18:00 in January the shadow is over Liverpool, not yet off Newfoundland', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  w.t = 12 * 3600; // 18:00 by the clock, 17:00 GMT (the sun sets at 16:15 GMT in Liverpool)
  const cam = atlanticCamera();
  const n = nightSamples(w, cam, 40);
  assert.ok(!n.lit && !n.dark);
  assert.ok(isNight(w, ...project(-3, 53.4)) && !isNight(w, ...project(-50, 47)));
  // Along one row of the map, the shadow never lightens toward the east at dusk.
  const row = Math.floor(n.rows / 2);
  for (let i = 1; i < n.cols; i++) assert.ok(n.share[row * n.cols + i] >= n.share[row * n.cols + i - 1] - 1e-6);
});
