import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, project } from '../src/sim/geo.js';
import { gridRef, gridSquare } from '../src/sim/grid.js';
import { parseLegEnd } from '../src/sim/navigation.js';
import { addLeg, departConvoy, planTrack, scramble, setAltitude, setVector } from '../src/sim/orders.js';
import { parseGameDate } from '../src/core/time.js';
import { makeWorld, run, runTo } from './helpers.js';

const at = (world, text) => (parseGameDate(text) - world.startMs) / 1000;

test('grid references name 25 km squares, I is skipped', () => {
  const world = makeWorld();
  const [x, y] = project(1.32, 51.12); // Dover
  const ref = gridRef(world.grid, x, y);
  assert.match(ref, /^[A-HJ-Z]\d{1,2}$/);
  const sq = gridSquare(world.grid, ref);
  assert.ok(x >= sq.x0 && x <= sq.x1 && y >= sq.y0 && y <= sq.y1);
  assert.equal(gridSquare(world.grid, 'I3'), null);
  assert.equal(gridSquare(world.grid, 'j5').ref, 'J5');
});

test('leg ends typed by the player', () => {
  const world = makeWorld();
  const opts = { grid: world.grid, defaultUnit: 'min' };
  assert.deepEqual(parseLegEnd('', opts), { ok: true, end: null });
  assert.deepEqual(parseLegEnd('6', opts).end, { kind: 'duration', s: 360 });
  assert.deepEqual(parseLegEnd('6 min', opts).end, { kind: 'duration', s: 360 });
  assert.deepEqual(parseLegEnd('1 h 30', opts).end, { kind: 'duration', s: 5400 });
  assert.deepEqual(parseLegEnd('30', { ...opts, defaultUnit: 'h' }).end, { kind: 'duration', s: 108000 });
  assert.deepEqual(parseLegEnd('14:20', opts).end, { kind: 'clock', hh: 14, mm: 20 });
  assert.deepEqual(parseLegEnd('à 9h05', opts).end, { kind: 'clock', hh: 9, mm: 5 });
  assert.deepEqual(parseLegEnd('J5', opts).end, { kind: 'square', ref: 'J5' });
  const pos = parseLegEnd("56°30'N 12°O", opts).end;
  assert.equal(pos.kind, 'position');
  assert.ok(Math.abs(pos.lat - 56.5) < 1e-9 && Math.abs(pos.lon + 12) < 1e-9);
  assert.equal(parseLegEnd('50.5N 1.5E', opts).end.lon, 1.5);
  assert.equal(parseLegEnd('n importe', opts).ok, false);
});

test('a squadron flies its legs: heading for a duration, then on to a grid square', () => {
  const world = makeWorld('standard');
  const sq = world.squadrons.find((s) => s.id === '32');
  assert.equal(addLeg(world, sq, { heading: 90, end: { kind: 'duration', s: 300 } }).ok, true);
  assert.equal(addLeg(world, sq, { heading: 180, end: { kind: 'square', ref: 'Q11' } }).ok, true);
  scramble(world, sq);
  const events = run(world, 3600, (e) => e.type === 'planEnded');
  assert.ok(events.some((e) => e.type === 'legDone'), 'first leg done');
  const ended = events.find((e) => e.type === 'planEnded');
  assert.ok(ended, 'plan ended');
  assert.equal(sq.plan.length, 0);
  assert.equal(sq.vector, 180, 'keeps the last heading');
});

test('a leg that misses its square says by how much', () => {
  const world = makeWorld('standard');
  const sq = world.squadrons.find((s) => s.id === '32');
  // Biggin Hill heading due north: a square to the south-east is never entered.
  const ref = gridRef(world.grid, ...project(1.0, 50.9));
  addLeg(world, sq, { heading: 0, end: { kind: 'square', ref } });
  scramble(world, sq);
  const events = run(world, 1800, (e) => e.type === 'legMissed' || e.type === 'planEnded');
  const missed = events.find((e) => e.type === 'legMissed');
  assert.ok(missed, 'leg missed');
  assert.ok(missed.km > 10);
});

test('the projected track of a plan ends where the squadron really goes', () => {
  const world = makeWorld('standard');
  const sq = world.squadrons.find((s) => s.id === '74');
  addLeg(world, sq, { heading: 120, end: { kind: 'duration', s: 600 } });
  const track = planTrack(world, sq);
  scramble(world, sq);
  run(world, world.rules.squadron.scrambleSeconds + 600 - 1);
  const end = track[track.length - 1];
  assert.ok(distance(end.x, end.y, sq.x, sq.y) < 3, `${distance(end.x, end.y, sq.x, sq.y).toFixed(1)} km off`);
});

test('a convoy steered by legs sails, and a leg over land is refused', () => {
  const world = makeWorld();
  const convoy = world.convoys[0];
  const bad = addLeg(world, convoy, { heading: 300, end: { kind: 'duration', s: 40 * 3600 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'land');
  const good = addLeg(world, convoy, { heading: 100, end: { kind: 'duration', s: 10 * 3600 } });
  assert.equal(good.ok, true);
  assert.equal(convoy.state, 'inPort', 'waits for the order to sail');
  assert.equal(departConvoy(world, convoy), true);
  const x0 = convoy.x;
  run(world, 3600);
  assert.ok(convoy.x > x0 + 10, 'sailing east');
});

test('a convoy steered to the North Channel takes a pilot into Liverpool', () => {
  const world = makeWorld();
  const convoy = world.convoys[0];
  // Placed in mid-ocean, then steered onto the channel entrance at 56.1N 8.3W.
  [convoy.x, convoy.y] = project(-20, 56.6);
  convoy.state = 'atSea';
  convoy.portId = null;
  const end = parseLegEnd('56.1N 8.3O', { grid: world.grid }).end;
  const [gx, gy] = project(-8.3, 56.1);
  const heading = (Math.atan2(gx - convoy.x, gy - convoy.y) * 180 / Math.PI + 360) % 360;
  assert.equal(addLeg(world, convoy, { heading, end }).ok, true);
  const events = run(world, 8 * 86400, (e) => e.type === 'convoyArrived');
  assert.ok(events.some((e) => e.type === 'pilotAboard'), 'pilot aboard');
  const arrived = events.find((e) => e.type === 'convoyArrived');
  assert.ok(arrived, 'arrived');
  assert.ok(arrived.port === 'Liverpool' || arrived.port === 'la Clyde');
});

test('altitudes are ordered in feet, by steps of 1000 ft', () => {
  const world = makeWorld();
  const sq = world.squadrons[0];
  assert.equal(setAltitude(world, sq, 18200), 18000);
  assert.equal(setAltitude(world, sq, 50000), world.rules.squadron.maxAltitudeFt);
  assert.equal(setAltitude(world, sq, 0), world.rules.squadron.minAltitudeFt);
});

test('a squadron passing under a raid is told it missed, and by how much', () => {
  const world = makeWorld('arcade');
  runTo(world, at(world, '1940-07-10T13:21'));
  const raid = world.raids.find((r) => r.id === 'h01');
  const sq = world.squadrons.find((s) => s.id === '32');
  // Put the squadron 20 km west of the raid, far too low, flying at it.
  sq.state = 'airborne';
  sq.x = raid.x - 20;
  sq.y = raid.y;
  sq.alt = 600;
  setAltitude(world, sq, 2000);
  setVector(world, sq, 90);
  sq.heading = 90;
  const events = run(world, 15 * 60, (e) => e.type === 'missed');
  const missed = events.find((e) => e.type === 'missed');
  assert.ok(missed, 'missed reported');
  assert.equal(missed.raidId, 'h01');
  assert.ok(missed.dzM < -1200, 'far below');
  assert.ok(missed.problem === 'below' || missed.problem === 'wideBelow');
  assert.ok(!events.some((e) => e.type === 'tallyHo'));
});
