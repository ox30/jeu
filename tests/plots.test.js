// The plotting table keeps one plot per U-boat (a hunt no longer piles up a pair of growing
// circles every ten minutes), a sunk U-boat leaves the table, and older saves are tidied up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { restore, snapshot } from '../src/save/game.js';

function plotsOf(w, u) {
  return w.uboatPlots.filter((p) => p.uboatId === u.id);
}

test('a U-boat held for hours by an escort has one plot on the table, which moves', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  const e = w.escorts[0];
  Object.assign(e, { state: 'atSea', x: u.x + 1, y: u.y });
  let most = 0;
  const times = new Set();
  for (let m = 0; m < 180; m++) {
    run(w, 60);
    // Keep the group on top of it, whatever happens to the hunt.
    if (e.state === 'atSea' || e.state === 'waiting' || e.state === 'hunting') Object.assign(e, { x: u.x + 1, y: u.y });
    const mine = plotsOf(w, u);
    most = Math.max(most, mine.length);
    if (mine.length) times.add(mine[0].t);
    if (u.state === 'sunk') break;
  }
  assert.ok(most <= 1, `at most one plot for this U-boat (${most})`);
  if (u.state !== 'sunk') assert.ok(times.size > 1, 'the plot was moved by newer fixes');
});

test('a U-boat sunk by an escort leaves the table at once', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  const e = w.escorts[0];
  Object.assign(e, { state: 'atSea', x: u.x + 1, y: u.y });
  const next = w.rng.next.bind(w.rng);
  w.rng.next = () => 0.001; // every look finds it, every pass sinks it
  let sunk = null;
  for (let m = 0; m < 60 && !sunk; m++) sunk = run(w, 60).find((x) => x.type === 'uboatSunk');
  w.rng.next = next;
  assert.ok(sunk, 'sunk by the depth charges');
  assert.equal(u.state, 'sunk');
  assert.equal(plotsOf(w, u).length, 0, 'no plot left for it');
  assert.equal(u.seen, null);
});

test('a save that piled up plots is tidied up when it is loaded', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const [a, b] = w.uboats;
  for (let k = 0; k < 3; k++) w.uboatPlots.push({ id: `A${k}`, uboatId: a.id, x: a.x, y: a.y, t: w.t - k * 600, source: 'asdic', by: 'EG 1', submerged: false });
  w.uboatPlots.push({ id: 'B0', uboatId: b.id, x: b.x, y: b.y, t: w.t, source: 'aircraft', by: '210 Sqn', submerged: false });
  b.state = 'sunk';
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const twin = makeWorld('standard', {}, 'hiver-atlantique');
  restore(twin, snap);
  assert.deepEqual(twin.uboatPlots.map((p) => p.id), ['A0'], 'the newest plot of the U-boat afloat only');
});
