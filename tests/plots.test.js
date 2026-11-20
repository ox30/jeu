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

test('a contact held at the ASDIC is reported now and then with a depth and a course, not as new dives', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  const e = w.escorts[0];
  Object.assign(e, { state: 'atSea', x: u.x + 1, y: u.y });
  u.submergedUntil = w.t + 6 * 3600; // down before the group comes
  const events = [];
  for (let m = 0; m < 120 && u.state !== 'sunk'; m++) {
    events.push(...run(w, 60));
    if (e.state === 'atSea' || e.state === 'waiting' || e.state === 'hunting') Object.assign(e, { x: u.x + 1, y: u.y });
  }
  const sightings = events.filter((x) => x.type === 'uboatSighted' && x.byId === e.id);
  assert.ok(sightings.length <= 2, `one sighting for a contact held (${sightings.length})`);
  assert.ok(sightings.every((x) => x.dived === false), 'found under water: no dive announced');
  const reports = events.filter((x) => x.type === 'asdicContact');
  if (u.state !== 'sunk') assert.ok(reports.length >= 1, 'reports while it is held');
  for (const r of [...sightings, ...reports]) {
    assert.ok(r.depthM >= 40 && r.depthM <= 150, `depth ${r.depthM}`);
  }
});

test('a group waiting for orders holds its contact like the others: one sighting, not one a minute', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  const e = w.escorts[0];
  // A boat hit and going home (the groups let it go), under a group that has finished its orders.
  Object.assign(u, { damaged: true, state: 'leaving', submergedUntil: w.t + 6 * 3600 });
  Object.assign(e, { state: 'waiting', x: u.x + 1, y: u.y, route: [], plan: [], berthed: false });
  const events = [];
  for (let m = 0; m < 45; m++) {
    events.push(...run(w, 60));
    Object.assign(e, { x: u.x + 1, y: u.y });
  }
  const sightings = events.filter((x) => x.type === 'uboatSighted' && x.byId === e.id);
  assert.equal(sightings.length, 1, `${sightings.length} sightings of the same contact`);
  assert.equal(events.filter((x) => x.type === 'uboatContactLost').length, 0, 'held all along');
  assert.ok(!events.some((x) => x.type === 'escortEngaged'), 'a boat going home is let go');
});

test('the ASDIC loses a boat that goes deep, and finds it again when it comes back up', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  const e = w.escorts[0];
  Object.assign(u, { damaged: true, state: 'leaving', submergedUntil: w.t + 6 * 3600 });
  Object.assign(e, { state: 'waiting', x: u.x + 1, y: u.y, route: [], plan: [], berthed: false });
  const hold = (minutes) => {
    const out = [];
    for (let m = 0; m < minutes; m++) {
      out.push(...run(w, 60));
      Object.assign(e, { x: u.x + 1, y: u.y });
    }
    return out;
  };
  const before = hold(20);
  assert.equal(before.filter((x) => x.type === 'uboatSighted').length, 1);
  assert.ok(u.seen, 'held');
  u.deepUntil = w.t + 1800;
  const deep = hold(25);
  assert.equal(deep.filter((x) => x.type === 'uboatContactLost').length, 1, 'the contact is lost once');
  assert.equal(deep.filter((x) => x.type === 'uboatSighted').length, 0, 'nothing heard while it is deep');
  assert.ok(w.uboatPlots.some((p) => p.uboatId === u.id && p.lastSeen), 'its last position stays on the table');
  const after = hold(40);
  assert.ok(after.some((x) => x.type === 'uboatSighted' && x.byId === e.id), 'heard again once it is back up');
});
