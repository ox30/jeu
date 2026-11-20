import { isDaylight } from '../src/sim/daylight.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachKm, isSubmerged } from '../src/sim/asw.js';
import { joinConvoy, setConvoySpeed, setEscortBehaviour, setZigzag, scramble } from '../src/sim/orders.js';
import { cargoShare, currentSpeed } from '../src/sim/convoy.js';
import { makeKanalkampf, run } from './helpers.js';

test('the two circles of a U-boat plot grow with its age, the submerged one is capped', () => {
  const world = makeKanalkampf();
  const r1 = reachKm(world, 3600);
  assert.ok(Math.abs(r1.surface - 17 * 1.852) < 0.1);
  assert.ok(Math.abs(r1.submerged - 5 * 1.852) < 0.1);
  const r30 = reachKm(world, 30 * 3600);
  assert.ok(Math.abs(r30.submerged - 70 * 1.852) < 0.1, 'battery limit');
});

test('a convoy driven at its best speed loses stragglers; slower, it keeps together', () => {
  let lost = 0;
  let slowLost = 0;
  for (let i = 0; i < 3; i++) {
    const world = makeKanalkampf();
    const hx = world.convoys.find((c) => c.id === 'hx57');
    setConvoySpeed(world, hx, hx.speedKn); // pushed to its best speed
    for (let k = 0; k <= i; k++) world.rng.next();
    run(world, 4 * 86400);
    lost += world.convoys.filter((c) => c.straggler && c.parentId === 'hx57').length;
    const share = cargoShare(hx, world);
    assert.ok(share > 0.5, 'the stragglers still count for the cargo');
    const slow = makeKanalkampf();
    const hx2 = slow.convoys.find((c) => c.id === 'hx57');
    assert.equal(hx2.orderedKn, 8, 'a safe speed by default');
    run(slow, 4 * 86400);
    slowLost += slow.convoys.filter((c) => c.straggler && c.parentId === 'hx57').length;
  }
  assert.ok(lost >= 1, `stragglers at full speed (${lost})`);
  assert.equal(slowLost, 0, 'none below 90 % of the best speed');
});

test('zigzag: slower progress', () => {
  const world = makeKanalkampf();
  const hx = world.convoys.find((c) => c.id === 'hx55');
  const v = currentSpeed(hx);
  setZigzag(world, hx, true);
  assert.ok(currentSpeed(hx) < v * 0.9);
});

test('Coastal Command over a U-boat on the surface makes it dive and lays a plot', () => {
  const world = makeKanalkampf();
  const anson = world.squadrons.find((s) => s.id === '502');
  const u = world.uboats.find((x) => x.id === 'u3');
  // Daylight, the Anson right over the U-boat.
  scramble(world, anson, { orbit: true });
  run(world, 400);
  anson.x = u.x + 3;
  anson.y = u.y;
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) {
    run(world, 60);
    anson.x = u.x + 3;
    anson.y = u.y;
    seen = world.uboatPlots.some((p) => p.uboatId === u.id);
  }
  assert.ok(seen, 'the U-boat is seen');
  assert.ok(isSubmerged(world, u) || u.state === 'sunk', 'it dives');
});

test('an escort group told to hunt leaves its convoy for a fresh contact, then comes back', () => {
  const world = makeKanalkampf();
  const eg = world.escorts.find((e) => e.id === 'eg1');
  const hx = world.convoys.find((c) => c.id === 'hx55');
  setEscortBehaviour(world, eg, 'hunt');
  joinConvoy(world, eg, hx.id);
  run(world, 4 * 86400, (e) => e.type === 'escortJoined');
  assert.equal(eg.state, 'escorting');
  // Wait for daylight: at night a surfaced U-boat is hard to see.
  for (let i = 0; i < 86400 && !isDaylight(world, eg.x, eg.y); i += 60) run(world, 60);
  assert.equal(eg.state, 'escorting');
  // A U-boat surfaces right beside the convoy, by day.
  const u = world.uboats.find((x) => x.id === 'u1');
  u.x = eg.x + 2;
  u.y = eg.y;
  u.state = 'shadow';
  u.target = hx.id;
  const events = run(world, 6 * 3600, (e) => e.type === 'escortHunting');
  assert.ok(events.some((e) => e.type === 'escortHunting' || e.type === 'uboatSunk'), 'hunts the contact');
  run(world, 6 * 3600);
  assert.ok(eg.state === 'escorting' || eg.joinTarget === hx.id || eg.state === 'atSea', `back toward the convoy (${eg.state})`);
});

// ---- C13: the escort radar, a dated datum of each group ----

test('the first radar sets come in March 1941, on two groups, fitted in port', async () => {
  const { makeWorld: make, run: go } = await import('./helpers.js');
  const w = make('standard', {}, 'hiver-atlantique');
  assert.ok(w.escorts.every((e) => !e.radar), 'none in January');
  const dated = w.escorts.filter((e) => e.radarFrom !== null);
  assert.deepEqual(dated.map((e) => e.id), ['eg1', 'eg3']);
  for (const e of dated) {
    const date = new Date(w.startMs + e.radarFrom * 1000);
    assert.equal(date.getUTCFullYear(), 1941);
    assert.equal(date.getUTCMonth(), 2, 'in March');
  }
  // Nobody sails: on the day, the group in port gets its set, and says so once.
  const eg1 = w.escorts.find((e) => e.id === 'eg1');
  go(w, 3600);
  assert.ok(!eg1.radar);
  w.t = eg1.radarFrom - 300; // the clock is put forward to the day
  const events = go(w, 600, (e) => e.type === 'escortRadar');
  const told = events.filter((e) => e.type === 'escortRadar');
  assert.equal(told.length, 1);
  assert.equal(told[0].escortId, 'eg1');
  assert.ok(eg1.radar);
  assert.ok(!w.escorts.find((e) => e.id === 'eg3').radar, 'the other one later');
  assert.ok(!w.escorts.find((e) => e.id === 'eg2').radar && w.escorts.find((e) => e.id === 'eg2').radarFrom === null);
});

test('a group at sea on the day gets its radar when it comes back into port', async () => {
  const { makeWorld: make, run: go } = await import('./helpers.js');
  const { project: proj } = await import('../src/sim/geo.js');
  const { escortHome } = await import('../src/sim/orders.js');
  const w = make('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.id === 'eg1');
  const [x, y] = proj(-5.5, 53.6);
  w.t = e.radarFrom - 600;
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], berthed: false });
  go(w, 1800);
  assert.ok(!e.radar, 'not at sea');
  assert.ok(escortHome(w, e, 'liverpool'));
  const events = go(w, 30 * 3600, (ev) => ev.type === 'escortRadar');
  assert.ok(events.some((ev) => ev.type === 'escortRadar' && ev.escortId === e.id));
  assert.ok(e.radar);
  assert.ok(['refit', 'inPort'].includes(e.state));
});

test('with a radar the escort catches the U-boat that has just attacked on the surface more often', async () => {
  const { makeKanalkampf: make } = await import('./helpers.js');
  const { spotAttacker } = await import('../src/sim/asw.js');
  const spotted = (radar) => {
    const w = make();
    const c = w.convoys.find((x) => x.id === 'hx55');
    const e = w.escorts[0];
    Object.assign(c, { state: 'atSea' });
    Object.assign(e, { state: 'escorting', escorting: c.id, x: c.x + 4, y: c.y, radar });
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const u = w.uboats[0];
      Object.assign(u, { state: 'shadow', x: c.x - 14, y: c.y, submergedUntil: 0, seen: null });
      w.uboatPlots = [];
      w.t += 3600;
      if (spotAttacker(w, u, c)) n++;
    }
    return n / 2000;
  };
  const eyes = spotted(false);
  const set = spotted(true);
  const A = (await import('./helpers.js')).data.rules.asw;
  assert.ok(Math.abs(eyes - A.pSpotAttacker) < 0.04, `lookouts: ${eyes}`);
  assert.ok(Math.abs(set - A.radar.pSpotAttacker) < 0.04, `radar: ${set}`);
  assert.ok(set > eyes * 1.4);
});
