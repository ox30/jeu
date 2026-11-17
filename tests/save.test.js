import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restore, snapshot } from '../src/save/game.js';
import { scramble, sendTrain } from '../src/sim/orders.js';
import { makeKanalkampf, run } from './helpers.js';

test('a saved game goes on exactly as the game it was taken from', () => {
  const a = makeKanalkampf('standard', { fatigue: 'on' });
  scramble(a, a.squadrons[0], { vector: 120 });
  sendTrain(a, 'port:liverpool', 'airfield:biggin_hill', { fuel: 60 });
  run(a, 20 * 3600);
  const snap = JSON.parse(JSON.stringify(snapshot(a)));
  const size = JSON.stringify(snap).length;
  assert.ok(size < 1_500_000, `snapshot size ${size}`);
  const b = makeKanalkampf('standard', { fatigue: 'on' });
  restore(b, snap);
  assert.equal(b.t, a.t);
  run(a, 30 * 3600);
  run(b, 30 * 3600);
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(snapshot(a)), 'same state after the same time');
});

test('a mobile radar is installed in some hours, joins the chain, and survives a save', async () => {
  const { deployMru, addMobileRadar } = await import('../src/sim/mru.js');
  const { project } = await import('../src/sim/geo.js');
  const { coverageQuality } = await import('../src/sim/control.js');
  const w = makeKanalkampf('standard');
  w.mru.available = 1;
  const [sx, sy] = project(-0.35, 50.0); // at sea: refused
  assert.equal(deployMru(w, sx, sy, 180).ok, false);
  const [x, y] = project(-1.30, 50.68); // Isle of Wight
  assert.ok(deployMru(w, x, y, 200).ok);
  run(w, 6 * 3600 + 120);
  assert.ok(w.radars.some((r) => r.mobile), 'in the chain');
  const [tx, ty] = project(-1.6, 50.2);
  assert.equal(coverageQuality(w, tx, ty, 4000).source, 'radar');
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const b = makeKanalkampf('standard');
  restore(b, snap, addMobileRadar);
  assert.ok(b.radars.some((r) => r.mobile), 'restored');
});
