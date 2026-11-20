// A group told to stay with its convoy goes only for a U-boat it can get over before the
// convoy calls it back (30 minutes, 15 km). A boat shadowing far astern is out of reach:
// leaving for it would only uncover the convoy. A group told to hunt goes anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, getTerrain, run } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { headingVector, project } from '../src/sim/geo.js';
import { isSubmerged, willCounter } from '../src/sim/asw.js';
import { setEscortBehaviour } from '../src/sim/orders.js';

/** Kanalkampf's sea with loaded dice: every attacker is seen, and a boat in place attacks at once. */
function seaWorld({ spot = 1 } = {}) {
  const rules = structuredClone(data.rules);
  rules.asw.pSpotAttacker = spot;
  rules.uboats.attackPerHourNight = 60;
  rules.uboats.attackPerHourDay = 60;
  rules.uboats.pDriveOffPerEscort = 0;
  return createWorld({
    scenario: structuredClone(data.kanalkampf), rules, settings: { ...data.presets.presets.standard, fatigue: 'off' }, terrain: getTerrain(),
  });
}

/** A convoy heading east in the open Atlantic with a group on station, and a boat `km` astern. */
function convoyGroupBoat(w, { km = 14, behaviour = 'stay', side = 'astern' } = {}) {
  const [x, y] = project(-14, 56);
  const c = w.convoys.find((v) => v.id === 'hx55');
  Object.assign(c, { state: 'atSea', x, y, px: x, py: y, heading: 90, route: [[x + 600, y]], plan: [] });
  const e = w.escorts.find((v) => v.id === 'eg1');
  Object.assign(e, { state: 'escorting', escorting: c.id, x: x + 1, y, px: x + 1, py: y, route: [], plan: [], berthed: false });
  setEscortBehaviour(w, e, behaviour);
  const [hx, hy] = headingVector(c.heading);
  const [dx, dy] = side === 'astern' ? [-hx, -hy] : side === 'ahead' ? [hx, hy] : [hy, -hx];
  const u = w.uboats.find((b) => b.id === 'u1');
  Object.assign(u, {
    state: 'shadow', target: c.id, x: x + dx * km, y: y + dy * km, px: x + dx * km, py: y + dy * km, submergedUntil: 0, deepUntil: 0, way: null, lastAttack: -Infinity, torpedoes: 4,
  });
  for (const b of w.uboats) if (b !== u) b.state = 'gone';
  return { c, e, u };
}

test('a group told to stay does not go for a boat far astern; one told to hunt does', () => {
  const w = seaWorld();
  const { c, e, u } = convoyGroupBoat(w, { km: 14 });
  assert.equal(willCounter(w, e, u, c), false, 'fourteen kilometres astern of a convoy sailing away: out of reach');
  setEscortBehaviour(w, e, 'hunt');
  assert.equal(willCounter(w, e, u, c), true, 'a hunting group goes');
  // Down to its reserve of depth charges, a hunting group is held as one told to stay.
  e.charges = Math.floor(e.chargesMax / 3);
  assert.equal(willCounter(w, e, u, c), false);
});

test('what comes close is counter-attacked by a group told to stay', () => {
  const reach = (setup) => {
    const w = seaWorld();
    const { c, e, u } = convoyGroupBoat(w, setup);
    return willCounter(w, e, u, c);
  };
  assert.equal(reach({ km: 4 }), true, 'four kilometres astern');
  // Ahead of the convoy, which comes up to it: farther still within reach.
  assert.equal(reach({ km: 12, side: 'ahead' }), true, 'twelve kilometres ahead');
  assert.equal(reach({ km: 12, side: 'astern' }), false, 'twelve kilometres astern');
  // Too far to be over it with time for a pass, wherever it is.
  assert.equal(reach({ km: 22, side: 'ahead' }), false, 'twenty-two kilometres ahead');
});

test('seen attacking from out of reach, the boat is made to dive and the group keeps its station', () => {
  const w = seaWorld();
  const { c, e, u } = convoyGroupBoat(w, { km: 14, behaviour: 'stay' });
  w.t = 23 * 3600; // night or day: the dice are loaded for both
  const events = run(w, 300, (ev) => ev.type === 'uboatAttack');
  const attack = events.find((ev) => ev.type === 'uboatAttack');
  assert.ok(attack, 'the boat attacked');
  assert.equal(attack.convoyId, c.id);
  assert.ok(attack.escorts > 0, 'against an escorted convoy');
  assert.ok(!events.some((ev) => ev.type === 'escortEngaged'), 'no counter-attack');
  assert.equal(e.state, 'escorting', 'the group stays with its convoy');
  assert.equal(e.charges, e.chargesMax, 'and spends nothing');
  assert.ok(isSubmerged(w, u), 'seen, the boat dives');
  assert.ok(w.uboatPlots.some((p) => p.uboatId === u.id), 'and leaves a plot on the table');
});

test('seen attacking, the boat is hunted by a group told to hunt, which leaves its convoy', () => {
  const w = seaWorld();
  const { c, e, u } = convoyGroupBoat(w, { km: 14, behaviour: 'hunt' });
  w.t = 23 * 3600;
  const events = run(w, 300, (ev) => ev.type === 'escortEngaged');
  const engaged = events.find((ev) => ev.type === 'escortEngaged');
  assert.ok(engaged, 'the group goes for it');
  assert.equal(engaged.how, 'flash');
  assert.equal(e.state, 'hunting');
  assert.equal(e.huntFor, c.id);
  assert.equal(e.huntStay, false, 'a hunt, not a short counter-attack');
  assert.ok(isSubmerged(w, u));
});

test('unseen, the boat is not made to dive', () => {
  const w = seaWorld({ spot: 0 });
  const { e, u } = convoyGroupBoat(w, { km: 14, behaviour: 'stay' });
  w.t = 23 * 3600;
  const events = run(w, 300, (ev) => ev.type === 'uboatAttack');
  assert.ok(events.some((ev) => ev.type === 'uboatAttack'));
  assert.equal(e.state, 'escorting');
  assert.ok(!isSubmerged(w, u), 'nobody saw it');
});

test('on its way back to a convoy far ahead, a group told to stay reports a contact and sails on', () => {
  const w = seaWorld();
  const { c, e, u } = convoyGroupBoat(w, { km: 14, behaviour: 'stay' });
  // The group is forty kilometres astern of its convoy, rejoining; the boat lies on its way.
  const [hx, hy] = headingVector(c.heading);
  Object.assign(e, { state: 'atSea', escorting: null, joinTarget: c.id, x: c.x - hx * 40, y: c.y - hy * 40 });
  Object.assign(u, { state: 'patrol', target: null, x: e.x + 1, y: e.y, submergedUntil: w.t + 7200, wx: e.x + 1, wy: e.y, hx: e.x + 1, hy: e.y });
  w.rules.asw.pAsdic = 1;
  const events = run(w, 600);
  assert.ok(events.some((ev) => ev.type === 'uboatSighted' && ev.byId === e.id), 'the ASDIC has it');
  assert.ok(!events.some((ev) => ev.type === 'escortEngaged'), 'no attack it would have to break off at once');
  assert.equal(w.navalReports.length, 0, 'and no engagement report for nothing');
  assert.notEqual(e.state, 'hunting');
  // A group on its own (no convoy to go back to) attacks what it finds.
  const w2 = seaWorld();
  const alone = convoyGroupBoat(w2, { km: 14, behaviour: 'stay' });
  Object.assign(alone.e, { state: 'atSea', escorting: null, joinTarget: null, x: alone.c.x - 300, y: alone.c.y });
  Object.assign(alone.u, { state: 'patrol', target: null, x: alone.e.x + 1, y: alone.e.y, submergedUntil: w2.t + 7200, wx: alone.e.x + 1, wy: alone.e.y, hx: alone.e.x + 1, hy: alone.e.y });
  w2.rules.asw.pAsdic = 1;
  const events2 = run(w2, 600, (ev) => ev.type === 'escortEngaged');
  assert.ok(events2.some((ev) => ev.type === 'escortEngaged' && ev.escortId === alone.e.id), 'it attacks');
});
