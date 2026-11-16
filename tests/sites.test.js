import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scramble } from '../src/sim/orders.js';
import { sense } from '../src/sim/detection.js';
import { damageSite, isOperational, siteStatus } from '../src/sim/sites.js';
import { combatRound } from '../src/sim/combat.js';
import { parseGameDate } from '../src/core/time.js';
import { makeWorld, run, runTo } from './helpers.js';

const at = (world, text) => (parseGameDate(text) - world.startMs) / 1000;

test('a radar put out of service leaves a gap, and is repaired', () => {
  const world = makeWorld('arcade');
  runTo(world, at(world, '1940-07-10T13:20'));
  const raid = world.raids.find((r) => r.id === 'h01');
  assert.equal(sense(world, raid), 'radar');
  // Knock out every station that can see the raid.
  for (const radar of world.radars) damageSite(world, radar, 90, 'test');
  assert.equal(sense(world, raid), null);
  assert.equal(siteStatus(world, world.radars[0]), 'out');
  const events = run(world, 48 * 3600, (e) => e.type === 'siteRestored');
  assert.ok(events.some((e) => e.type === 'siteRestored'));
  assert.ok(isOperational(world, world.radars[0]));
});

test('a cratered aerodrome delays take-off; one out of service cannot launch', () => {
  const world = makeWorld();
  const sq = world.squadrons.find((s) => s.id === '32');
  const field = world.byId.airfield.get(sq.airfield);
  damageSite(world, field, 50, 'test');
  scramble(world, sq, { vector: 90 });
  assert.ok(sq.timer > world.rules.squadron.scrambleSeconds * 1.8, `timer ${sq.timer}`);

  const other = world.squadrons.find((s) => s.id === '74');
  damageSite(world, world.byId.airfield.get(other.airfield), 95, 'test');
  assert.equal(scramble(world, other, { vector: 90 }), false);
  assert.equal(other.state, 'ready');
});

test('an unopposed raid on an aerodrome damages it and catches aircraft on the ground', () => {
  let lostSome = false;
  for (let seed = 1; seed <= 6 && !lostSome; seed++) {
    const world = makeWorld('standard');
    const raid = world.raids.find((r) => r.id === 'h03');
    raid.target = 'airfield:biggin_hill';
    const field = world.byId.airfield.get('biggin_hill');
    raid.tx = field.x;
    raid.ty = field.y;
    raid.departure = 60 + seed * 7;
    const events = run(world, 3 * 3600, (e) => e.type === 'siteHit');
    const hit = events.find((e) => e.type === 'siteHit');
    assert.ok(hit, 'aerodrome bombed');
    assert.ok(field.damage > 5, `damage ${field.damage}`);
    const more = run(world, 5);
    lostSome = [...events, ...more].some((e) => e.type === 'groundLosses');
  }
  assert.ok(lostSome, 'aircraft lost on the ground in at least one attack');
});

test('a fight ends with a combat report', () => {
  const world = makeWorld('arcade');
  runTo(world, at(world, '1940-07-10T13:21'));
  const raid = world.raids.find((r) => r.id === 'h01');
  const sq = world.squadrons.find((s) => s.id === '32');
  sq.state = 'airborne';
  sq.x = raid.x;
  sq.y = raid.y;
  sq.alt = raid.alt + 500;
  const events = run(world, 6 * 60, (e) => e.type === 'combatReport');
  assert.ok(events.some((e) => e.type === 'tallyHo'));
  const report = events.find((e) => e.type === 'combatReport');
  assert.ok(report, 'report');
  assert.equal(report.above, true);
  assert.ok(['ammo', 'homeward', 'destroyed', 'lost', 'raidGone'].includes(report.end), report.end);
  assert.ok(sq.lastReport);
  assert.equal(typeof combatRound, 'function');
});
