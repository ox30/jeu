// In a long scenario the U-boat command fills the gap left by a boat that was sunk: another
// one sails for the same patrol area three weeks later. Sinking a boat relieves the player
// for a while; it does not empty the sea for the rest of the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, getTerrain, makeKanalkampf, makeWorld, run, scenarioData } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { project } from '../src/sim/geo.js';
import { engage } from '../src/sim/asw.js';
import { setEscortBehaviour } from '../src/sim/orders.js';
import { restore, snapshot } from '../src/save/game.js';

const DAY = 86400;

/** The Atlantic with dice loaded so that the first depth-charge pass sinks the boat. */
function atlantic(engagement = { pKillPerShip: 1 }) {
  const rules = structuredClone(data.rules);
  Object.assign(rules.asw.engagement, engagement);
  return createWorld({
    scenario: structuredClone(scenarioData('hiver-atlantique')), rules, settings: { ...data.presets.presets.standard }, terrain: getTerrain(),
  });
}

/** A group over a boat in the open Atlantic: it attacks at once. */
function sinkOne(w, id = 'u1') {
  const e = w.escorts[0];
  const [x, y] = project(-15, 56);
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], berthed: false });
  const u = w.uboats.find((b) => b.id === id);
  Object.assign(u, { x: x + 1, y, px: x + 1, py: y, state: 'patrol', target: null, submergedUntil: 0, way: null });
  // The other boats are kept at their base: the trial is about this one.
  for (const b of w.uboats) if (b !== u) Object.assign(b, { state: 'gone', goneAt: null, target: null });
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  const events = run(w, 180, (ev) => ev.type === 'uboatSunk');
  assert.ok(events.some((ev) => ev.type === 'uboatSunk'), 'sunk by the first pass');
  assert.equal(u.state, 'sunk');
  return u;
}

test('the hour of a sinking is kept, and the boat stays sunk until its replacement is due', () => {
  const w = atlantic();
  const u = sinkOne(w);
  assert.ok(Number.isFinite(u.sunkAt) && w.t - u.sunkAt <= 180);
  assert.equal(w.stats.uboatsSunk, 1);
  const days = w.rules.uboats.replaceDays;
  assert.ok(days >= 14 && days <= 35, `replaced after ${days} days`);
  // The day before: still nothing in its place.
  u.sunkAt = w.t - (days - 1) * DAY;
  run(w, 300);
  assert.equal(u.state, 'sunk');
});

test('three weeks after a sinking another boat sails from the Biscay bases for the same patrol area', () => {
  const w = atlantic();
  const u = sinkOne(w);
  const [hx, hy] = [u.hx, u.hy];
  u.known = true;
  u.torpedoes = 1;
  u.sunkAt = w.t - w.rules.uboats.replaceDays * DAY + 120; // due in two minutes
  const events = run(w, 300);
  assert.equal(u.state, 'patrol', 'a new boat on patrol');
  const [bx, by] = project(w.rules.uboats.reentry.lon, w.rules.uboats.reentry.lat);
  assert.ok(Math.hypot(u.x - bx, u.y - by) < 5, 'it leaves from the Biscay bases');
  assert.ok(Math.hypot(u.hx - hx, u.hy - hy) < 150, 'for the same patrol area');
  assert.equal(u.torpedoes, u.torpedoesFull, 'with all its torpedoes');
  assert.equal(u.known, false, 'unknown to the Admiralty');
  assert.equal(u.boat, 2, 'the second boat to hold this area');
  assert.equal(u.sunkAt, null);
  assert.equal(u.damaged, false);
  assert.equal(w.stats.uboatsSunk, 1, 'the sinking stays in the tally');
  assert.ok(!w.uboatPlots.some((p) => p.uboatId === u.id), 'no plot of it on the table');
  // The player is told nothing of the newcomer.
  assert.ok(!events.some((ev) => /uboat/i.test(ev.type) && ev.type !== 'uboatPlot'), events.map((ev) => ev.type).join(' '));
});

test('a short battle has no replacement: a boat sunk off the Channel stays sunk', () => {
  const w = makeKanalkampf();
  assert.ok(!w.scenario.uboatRotation);
  const u = w.uboats[0];
  Object.assign(u, { state: 'sunk', sunkAt: w.t - 60 * DAY });
  run(w, 300);
  assert.equal(u.state, 'sunk');
});

test('a sinking of a game saved before the hour was kept counts from the loading', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  u.state = 'sunk';
  delete u.sunkAt;
  run(w, 120);
  assert.equal(u.state, 'sunk');
  assert.ok(Number.isFinite(u.sunkAt) && w.t - u.sunkAt <= 120, 'counted from now');
});

test('the replacement comes at the same minute after a save and a reload', () => {
  const w = atlantic();
  const u = sinkOne(w);
  u.sunkAt = w.t - w.rules.uboats.replaceDays * DAY + 600;
  const copy = atlantic();
  restore(copy, JSON.parse(JSON.stringify(snapshot(w))));
  run(w, 1200);
  run(copy, 1200);
  const v = copy.uboats.find((b) => b.id === u.id);
  assert.equal(u.state, 'patrol');
  assert.equal(v.state, 'patrol');
  assert.deepEqual([v.x, v.y, v.hx, v.hy, v.boat], [u.x, u.y, u.hx, u.hy, u.boat]);
  assert.deepEqual(snapshot(copy), snapshot(w), 'the same world after');
});

test('a boat that has never attacked says so with a number a save can keep', () => {
  const w = atlantic();
  for (const u of w.uboats) {
    assert.ok(Number.isFinite(u.lastAttack) && u.lastAttack < -86400 * 365, 'long ago, not minus infinity');
    assert.ok(Number.isFinite(u.lastReport));
  }
  const copy = atlantic();
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  restore(copy, snap);
  assert.deepEqual(copy.uboats.map((u) => [u.lastAttack, u.lastReport]), w.uboats.map((u) => [u.lastAttack, u.lastReport]));
  // A game saved by an earlier version: the infinity came back as nothing.
  for (const u of snap.uboats) Object.assign(u, { lastAttack: null, lastReport: null });
  const old = atlantic();
  restore(old, snap);
  for (const u of old.uboats) assert.ok(Number.isFinite(u.lastAttack) && Number.isFinite(u.lastReport) && u.lastAttack < 0);
});
