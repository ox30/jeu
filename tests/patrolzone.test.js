// Idea B of the audit: at sea and from ×600 on, a Coastal Command patrol in the air is drawn
// as the zone it covers, at a place that does not move at each image, rather than as an
// aircraft that crosses the map in a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { scramble, setRoute } from '../src/sim/orders.js';
import { isDaylight } from '../src/sim/daylight.js';
import { ZONE_SPEED, patrolZone, shownAsZone } from '../src/ui/patrolZone.js';

/** The Atlantic, a convoy at sea, and a patrol of Coastal Command in the air by day. */
function atSea() {
  const w = makeWorld('standard', { seaComms: 'direct' }, 'hiver-atlantique');
  run(w, 8 * 3600); // the first convoy has sailed; it is the afternoon
  const convoy = w.convoys.find((c) => c.state === 'atSea');
  const sq = w.squadrons.find((s) => s.role === 'coastal');
  assert.ok(convoy && sq, 'a convoy at sea and a coastal squadron');
  return { w, convoy, sq, spec: w.rules.patrols[sq.type] };
}

test('on the ground, lost or not a coastal patrol: no zone', () => {
  const { w, sq } = atSea();
  assert.equal(patrolZone(w, sq), null, 'on the ground');
  const fighters = makeWorld('standard', {}, 'kanalkampf');
  const fighter = fighters.squadrons.find((s) => s.role === 'fighter');
  scramble(fighters, fighter, { orbit: true });
  run(fighters, 900);
  assert.equal(patrolZone(fighters, fighter), null, 'a fighter squadron is drawn as it always was');
  const watch = fighters.squadrons.find((s) => s.role === 'watch');
  if (watch) {
    scramble(fighters, watch, { orbit: true });
    run(fighters, 900);
    assert.equal(patrolZone(fighters, watch), null, 'the spotters over the Channel too');
  }
});

test('on a route: the zone stands at the end of the route, the way there is its path', () => {
  const { w, sq, spec } = atSea();
  const far = [sq.x - 300, sq.y + 40];
  assert.equal(scramble(w, sq, { route: [[sq.x - 150, sq.y + 20], far] }), true);
  run(w, 1800);
  assert.equal(sq.state, 'airborne');
  const z = patrolZone(w, sq);
  assert.equal(z.kind, 'route');
  assert.deepEqual(z.anchor, far, 'its mark stands where it is going, not on the aircraft');
  assert.deepEqual(z.path[0], [sq.x, sq.y], 'the way starts from the aircraft');
  assert.deepEqual(z.path[z.path.length - 1], far);
  const day = isDaylight(w, sq.x, sq.y);
  assert.equal(z.sees, day || Boolean(sq.asv && spec.asvKm));
  assert.equal(z.km, Math.max(day ? spec.uboatSightKm : 0, sq.asv ? spec.asvKm : 0, spec.uboatSightKm), 'the circle it will watch there');
  // A route that ends with a landing has no circle at its end.
  sq.endAction = { kind: 'land', id: sq.home };
  assert.equal(patrolZone(w, sq).km, 0);
  assert.equal(patrolZone(w, sq).airfield, sq.home);
  sq.endAction = { kind: 'home' };
  assert.equal(patrolZone(w, sq).km, 0);
});

test('over a convoy: the zone is the convoy\'s, wide of the circle flown and of what the patrol sees', () => {
  const { w, convoy, sq, spec } = atSea();
  scramble(w, sq, { orbit: true });
  run(w, 900);
  sq.orbit = false;
  sq.cover = convoy.id;
  // Far from the convoy still: the way to it is drawn.
  let z = patrolZone(w, sq);
  assert.equal(z.kind, 'cover');
  assert.equal(z.convoy, convoy.id);
  assert.deepEqual(z.anchor, [convoy.x, convoy.y]);
  assert.equal(z.km, spec.uboatSightKm + w.rules.squadron.coverRadiusKm, 'the circle flown around the convoy, and what is seen from it');
  assert.equal(z.watchedKm, z.km, 'by day the whole circle is watched');
  assert.equal(z.path.length, 2, 'from the aircraft to the convoy');
  // On station: the circle alone, and it follows the convoy.
  sq.x = convoy.x + 3;
  sq.y = convoy.y;
  z = patrolZone(w, sq);
  assert.deepEqual(z.path, []);
  convoy.x += 5;
  assert.deepEqual(patrolZone(w, sq).anchor, [convoy.x, convoy.y]);
  // The convoy arrived or lost: the patrol is on its own station again.
  convoy.state = 'arrived';
  assert.equal(patrolZone(w, sq).kind, 'station');
});

test('orbiting: the aircraft is the place; on its way home: the aerodrome, and it looks no more', () => {
  const { w, sq } = atSea();
  scramble(w, sq, { orbit: true });
  run(w, 1200);
  let z = patrolZone(w, sq);
  assert.equal(z.kind, 'station');
  assert.deepEqual(z.anchor, [sq.x, sq.y]);
  assert.deepEqual(z.path, []);
  sq.state = 'returning';
  z = patrolZone(w, sq);
  const field = w.byId.airfield.get(sq.airfield);
  assert.equal(z.kind, 'home');
  assert.deepEqual(z.anchor, [field.x, field.y]);
  assert.equal(z.sees, false);
  assert.equal(z.km, 0);
  assert.deepEqual(z.path, [[sq.x, sq.y], [field.x, field.y]]);
});

test('by night without radar the circle stays, empty; with ASV radar it sees', () => {
  const { w, sq, spec } = atSea();
  scramble(w, sq, { orbit: true });
  run(w, 1200);
  // Run on until it is night over the aircraft (the simulation flies it home when dry: put it back).
  for (let i = 0; i < 48 && isDaylight(w, sq.x, sq.y); i++) run(w, 1800);
  assert.equal(isDaylight(w, sq.x, sq.y), false, 'night has come');
  sq.state = 'airborne';
  sq.aircraft = Math.max(1, sq.aircraft);
  sq.asv = false;
  let z = patrolZone(w, sq);
  assert.equal(z.sees, false, 'blind by night without radar');
  assert.equal(z.km, spec.uboatSightKm, 'the circle keeps its size of the day');
  assert.equal(z.watchedKm, 0, 'and nothing of it is watched');
  sq.asv = true;
  z = patrolZone(w, sq);
  assert.equal(z.sees, Boolean(spec.asvKm));
  assert.equal(z.km, spec.uboatSightKm, 'with ASV radar the circle is the same');
  assert.equal(z.watchedKm, spec.asvKm, 'but only the reach of the radar is watched');
  assert.ok(z.watchedKm < z.km);
});

test('drawn as a zone from ×600 on, running or paused; never the unit in hand; a setting turns it off', () => {
  const { w, sq } = atSea();
  scramble(w, sq, { orbit: true });
  run(w, 900);
  const app = { world: w, settings: {}, speed: ZONE_SPEED, paused: false };
  assert.equal(ZONE_SPEED, 600);
  assert.equal(shownAsZone(app, sq), true);
  assert.equal(shownAsZone({ ...app, paused: true }, sq), true, 'a pause does not flip the image');
  assert.equal(shownAsZone({ ...app, speed: 60 }, sq), false, 'slow enough to follow the aircraft');
  assert.equal(shownAsZone({ ...app, speed: 14400 }, sq), true);
  assert.equal(shownAsZone(app, sq, true), false, 'the unit in hand keeps its aircraft and its route');
  assert.equal(shownAsZone({ ...app, settings: { patrolZones: false } }, sq), false);
  const fighter = { role: 'fighter', state: 'airborne', aircraft: 12 };
  assert.equal(shownAsZone(app, fighter), false);
  assert.equal(shownAsZone(app, { ...sq, state: 'ready' }), false, 'on the ground');
  assert.equal(shownAsZone(app, { ...sq, state: 'returning' }), true, 'on its way home');
  assert.equal(shownAsZone(app, { ...sq, aircraft: 0 }), false);
  // A route given to the patrol as the player's line does: still a zone, never an order of the page.
  assert.equal(setRoute(w, sq, [[sq.x - 80, sq.y]]), true);
  assert.equal(patrolZone(w, sq).kind, 'route');
});
