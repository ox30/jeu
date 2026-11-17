import { isDaylight } from '../src/sim/patrols.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/sim/geo.js';
import { reachKm, isSubmerged } from '../src/sim/asw.js';
import { joinConvoy, setConvoySpeed, setEscortBehaviour, setZigzag, scramble, setCover } from '../src/sim/orders.js';
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
  for (let i = 0; i < 86400 && !isDaylight(world); i += 60) run(world, 60);
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
