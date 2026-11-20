// N7: the attack of a patrol aircraft on a U-boat is told, hit or miss; one attack a sortie;
// the plot it leaves near a convoy sends a hunting group after the boat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, getTerrain, run, scenarioData } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { project } from '../src/sim/geo.js';
import { isSubmerged } from '../src/sim/asw.js';
import { isDaylight } from '../src/sim/daylight.js';
import { setEscortBehaviour } from '../src/sim/orders.js';
import { restore, snapshot } from '../src/save/game.js';

const H = 3600;

/** The winter Atlantic at midday, the aircraft sure to see what is in sight; `kill`: chance of a kill. */
function world(kill) {
  const rules = structuredClone(data.rules);
  rules.asw.pAircraft = 1;
  for (const spec of Object.values(rules.patrols)) spec.attackKill = kill;
  const w = createWorld({
    scenario: structuredClone(scenarioData('hiver-atlantique')), rules, settings: { ...data.presets.presets.standard, fatigue: 'off' }, terrain: getTerrain(),
  });
  run(w, 6.5 * H); // 12:30 by the clock
  for (const u of w.uboats) u.state = 'gone'; // the boats of the scenario are kept out of the trial
  return w;
}

function patrolAt(w, lon, lat) {
  const s = w.squadrons.find((x) => x.role === 'coastal');
  const [x, y] = project(lon, lat);
  Object.assign(s, { state: 'airborne', x, y, px: x, py: y, alt: 600, palt: 600, targetAlt: 600, orbit: true, fuel: 400, route: [], plan: [] });
  assert.ok(isDaylight(w, x, y), 'by day');
  return s;
}

function boatAt(w, id, x, y) {
  const u = w.uboats.find((b) => b.id === id) || w.uboats[0];
  Object.assign(u, { x, y, px: x, py: y, state: 'patrol', target: null, submergedUntil: 0, way: null, wx: x, wy: y, hx: x, hy: y, damaged: false });
  return u;
}

test('an aircraft attacks a U-boat it sees close by: the miss is told, and it attacks once a sortie', () => {
  const w = world(0);
  const s = patrolAt(w, -12, 56);
  assert.equal(s.uboatAttacks, 0);
  const a = boatAt(w, w.uboats[0].id, s.x + 2, s.y);
  const first = run(w, 120, (e) => e.type === 'aircraftAttack');
  const attack = first.find((e) => e.type === 'aircraftAttack');
  assert.ok(attack, 'the attack is an event');
  assert.equal(attack.byId, s.id);
  assert.equal(attack.uboatId, a.id);
  assert.ok(first.some((e) => e.type === 'uboatSighted' && e.byId === s.id));
  assert.ok(isSubmerged(w, a) && a.state !== 'sunk', 'missed: it dived');
  assert.equal(s.uboatAttacks, 1);
  // A second boat in the same sortie: it dives, but nothing is left to drop.
  const b = boatAt(w, w.uboats[1].id, s.x - 2, s.y);
  const second = run(w, 180, (e) => e.type === 'uboatSighted' && e.uboatId === b.id);
  assert.ok(second.some((e) => e.type === 'uboatSighted' && e.uboatId === b.id), 'seen');
  assert.ok(isSubmerged(w, b), 'it dives all the same');
  assert.ok(!second.some((e) => e.type === 'aircraftAttack'), 'no second attack');
  assert.equal(s.uboatAttacks, 1);
  // Saved with the game.
  const copy = createWorld({ scenario: structuredClone(scenarioData('hiver-atlantique')), rules: w.rules, settings: w.settings, terrain: getTerrain() });
  restore(copy, JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(copy.squadrons.find((x) => x.id === s.id).uboatAttacks, 1);
});

test('a kill is told as a sinking, not as an attack of unknown result', () => {
  const w = world(1);
  const s = patrolAt(w, -12, 56);
  const u = boatAt(w, w.uboats[0].id, s.x + 2, s.y);
  const events = run(w, 120, (e) => e.type === 'uboatSunk');
  assert.equal(u.state, 'sunk');
  assert.ok(events.some((e) => e.type === 'uboatSunk' && e.by === s.name));
  assert.ok(!events.some((e) => e.type === 'aircraftAttack'));
  assert.equal(s.uboatAttacks, 1);
});

test('a U-boat seen beyond attack range dives, without an attack', () => {
  const w = world(0);
  const s = patrolAt(w, -12, 56);
  const u = boatAt(w, w.uboats[0].id, s.x + 9, s.y);
  const events = run(w, 120, (e) => e.type === 'uboatSighted');
  assert.ok(events.some((e) => e.type === 'uboatSighted'));
  assert.ok(isSubmerged(w, u));
  assert.ok(!events.some((e) => e.type === 'aircraftAttack'));
  assert.equal(s.uboatAttacks, 0, 'its load is still on board');
});

test('back on the ground, the aircraft is rearmed for its next sortie', () => {
  const w = world(0);
  const s = patrolAt(w, -12, 56);
  boatAt(w, w.uboats[0].id, s.x + 2, s.y);
  run(w, 120, (e) => e.type === 'aircraftAttack');
  assert.equal(s.uboatAttacks, 1);
  // Brought over its base, short of fuel: it lands.
  const field = w.byId.airfield.get(s.airfield);
  Object.assign(s, { x: field.x + 3, y: field.y, px: field.x + 3, py: field.y, fuel: 1, orbit: false });
  const events = run(w, 2 * H, (e) => e.type === 'landed' && e.squadronId === s.id);
  assert.ok(events.some((e) => e.type === 'landed'), 'landed');
  assert.equal(s.uboatAttacks, 0);
});

test('the plot of an aircraft within 30 km of a convoy sends its hunting group after the boat', () => {
  const setup = (behaviour, km) => {
    const w = world(0);
    const s = patrolAt(w, -12, 56);
    const c = w.convoys.find((x) => x.state === 'atSea' && x.type !== 'coastal') || w.convoys[0];
    Object.assign(c, { state: 'atSea', x: s.x, y: s.y - km + 3, px: s.x, py: s.y - km + 3, heading: 90, route: [[s.x + 400, s.y - km + 3]] });
    const e = w.escorts[0];
    Object.assign(e, { state: 'escorting', escorting: c.id, x: c.x + 4, y: c.y, px: c.x + 4, py: c.y, route: [], plan: [], berthed: false });
    setEscortBehaviour(w, e, behaviour);
    boatAt(w, w.uboats[0].id, s.x + 3, s.y + 2);
    return { w, e, c, events: run(w, 180, (ev) => ev.type === 'uboatSighted') };
  };
  const near = setup('hunt', 25);
  assert.ok(near.events.some((ev) => ev.type === 'escortHunting' && ev.escortId === near.e.id), 'the group leaves for the plot');
  assert.equal(near.e.state, 'hunting');
  assert.equal(near.e.huntFor, near.c.id);
  const staying = setup('stay', 25);
  assert.equal(staying.e.state, 'escorting', 'a group told to stay stays');
  const far = setup('hunt', 45);
  assert.equal(far.e.state, 'escorting', 'too far from the convoy: it stays');
  // With no more than its reserve of depth charges, it stays too.
  const low = setup('hunt', 25);
  assert.equal(low.e.state, 'hunting');
  const spent = (() => {
    const w = world(0);
    const s = patrolAt(w, -12, 56);
    const c = w.convoys.find((x) => x.state === 'atSea' && x.type !== 'coastal') || w.convoys[0];
    Object.assign(c, { state: 'atSea', x: s.x, y: s.y - 22, px: s.x, py: s.y - 22, heading: 90, route: [[s.x + 400, s.y - 22]] });
    const e = w.escorts[0];
    Object.assign(e, { state: 'escorting', escorting: c.id, x: c.x + 4, y: c.y, px: c.x + 4, py: c.y, route: [], plan: [], berthed: false, charges: 40 });
    setEscortBehaviour(w, e, 'hunt');
    boatAt(w, w.uboats[0].id, s.x + 3, s.y + 2);
    run(w, 180, (ev) => ev.type === 'uboatSighted');
    return e;
  })();
  assert.equal(spent.state, 'escorting', 'its reserve is for the convoy');
});
