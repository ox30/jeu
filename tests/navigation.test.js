import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, project } from '../src/sim/geo.js';
import { gridRef, gridSquare } from '../src/sim/grid.js';
import { parseLegEnd } from '../src/sim/navigation.js';
import {
  addLeg, departConvoy, endChoices, planTrack, removeRoutePoint, scramble, setAltitude, setEndAction, setPointAltitude, setRoute,
  setVector, updateLeg,
} from '../src/sim/orders.js';
import { FOOT_M } from '../src/sim/geo.js';
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
  assert.equal(sq.orbit, true, 'orbits at the end by default');
});

test('end of the legs: hold the heading when asked, and legs carry an altitude', () => {
  const world = makeWorld('standard');
  const sq = world.squadrons.find((s) => s.id === '32');
  addLeg(world, sq, { heading: 90, end: { kind: 'duration', s: 300 }, altFt: 12000 });
  addLeg(world, sq, { heading: 180, end: { kind: 'duration', s: 300 }, altFt: 20000 });
  assert.equal(sq.plan[0].altFt, 12000);
  assert.equal(setEndAction(world, sq, { kind: 'hold' }), true);
  scramble(world, sq);
  run(world, 500);
  assert.ok(Math.abs(sq.targetAlt - 20000 * FOOT_M) < 1, 'second leg altitude');
  // The second leg is changed in flight.
  assert.equal(updateLeg(world, sq, 0, { heading: 200, end: { kind: 'duration', s: 120 }, altFt: 18000 }).ok, true);
  assert.equal(sq.plan[0].heading, 200);
  run(world, 600, (e) => e.type === 'planEnded');
  run(world, 2);
  assert.equal(sq.vector, 200, 'holds the last heading');
  assert.equal(sq.orbit, false);
});

test('a route ends by orbiting, or by landing at an aerodrome whose bubble it ends in', () => {
  const world = makeWorld('standard');
  const sq = world.squadrons.find((s) => s.id === '32');
  const field = world.byId.airfield.get(sq.airfield);
  const other = world.airfields.find((f) => f.id !== field.id && distance(f.x, f.y, field.x, field.y) > 30);
  scramble(world, sq, { route: [[field.x + 15, field.y, 18000 * FOOT_M], [other.x + 3, other.y + 2, null]] });
  assert.ok(Math.abs(sq.targetAlt - 18000 * FOOT_M) < 1, 'first point altitude');
  const choices = endChoices(world, sq);
  assert.ok(choices.some((c) => c.kind === 'land' && c.id === other.id), 'can land at the other aerodrome');
  assert.equal(sq.endAction.kind, 'orbit');
  assert.equal(setEndAction(world, sq, { kind: 'land', id: other.id }), true);
  assert.equal(setPointAltitude(world, sq, 1, 9000), 9000);
  const events = run(world, 3 * 3600, (e) => e.type === 'landed');
  assert.ok(events.some((e) => e.type === 'routeEnded' && e.action === 'land'));
  assert.equal(sq.airfield, other.id, 'landed at the other aerodrome');
  // A new route: the landing is no longer offered once the end is moved away.
  const sq2 = world.squadrons.find((s) => s.id !== sq.id && s.state === 'ready');
  const f2 = world.byId.airfield.get(sq2.airfield);
  scramble(world, sq2, { route: [[f2.x + 20, f2.y + 5]] });
  run(world, 200);
  setRoute(world, sq2, [[f2.x + 30, f2.y + 10, null], [f2.x + 40, f2.y + 20, null]]);
  assert.equal(removeRoutePoint(world, sq2, 0), true);
  assert.equal(sq2.route.length, 1);
  removeRoutePoint(world, sq2, 0);
  assert.equal(sq2.orbit, true, 'no point left: the end action is done');
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

test('a new leg after a leg under way is checked from where that leg will end, not from its whole length', () => {
  // Florian's convoy (HX 100 at the time, HX 102 since M2.7): 070° for 8 days 17 h, 28 h left; the whole leg from here would run into
  // the Hebrides, what is left of it stays at sea.
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 7 * 3600);
  const c = w.convoys.find((x) => x.state === 'atSea' && x.type !== 'coastal');
  [c.x, c.y] = project(-23.0, 53.6);
  c.route = [];
  c.destination = null;
  c.plan = [{ heading: 70, end: { kind: 'duration', s: (8 * 24 + 17) * 3600 } }];
  c.legState = { startT: w.t - (8 * 24 + 17 - 28) * 3600, best: Infinity, startX: c.x, startY: c.y };
  const r = addLeg(w, c, { heading: 84, end: { kind: 'duration', s: 25 * 3600 } });
  assert.ok(r.ok, `accepted (${r.reason || ''})`);
  assert.equal(c.plan.length, 2);
  // Edited, the leg under way starts again: then all of it counts, and it would run aground.
  const edit = updateLeg(w, c, 0, { heading: 70, end: { kind: 'duration', s: (8 * 24 + 17) * 3600 } });
  assert.equal(edit.reason, 'land');
});
