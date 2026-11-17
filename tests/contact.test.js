import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKanalkampf, run } from './helpers.js';
import { contactEstimate } from '../src/sim/query.js';
import { seeUboat } from '../src/sim/contact.js';
import { distance } from '../src/sim/geo.js';
import { isActive } from '../src/sim/raid.js';

/** Steps until `cond()` holds (or `max` seconds have passed). */
function stepUntil(world, max, cond) {
  for (let i = 0; i < max && !cond(); i++) run(world, 1);
}

/** Runs to the first raid in the air and returns it. */
function firstRaid(world) {
  stepUntil(world, 12 * 3600, () => world.raids.some((r) => !r.phantom && isActive(r)));
  return world.raids.find((r) => !r.phantom && isActive(r));
}

test('a squadron that sees a raid follows it live, with its real force, until it loses it', () => {
  const w = makeKanalkampf();
  const r = firstRaid(w);
  assert.ok(r, 'a raid in the air');
  const s = w.squadrons.find((x) => x.role === 'fighter');
  Object.assign(s, { state: 'airborne', x: r.x + 15, y: r.y, alt: r.alt, targetAlt: r.alt, orbit: true, route: [], plan: [] });
  const events = run(w, 10);
  assert.ok(r.seen && r.seen.byId === s.id, 'seen by the squadron');
  const sighted = events.find((e) => e.type === 'raidSighted');
  assert.ok(sighted && sighted.bombers === r.bombers && sighted.escortType === r.escortType);
  run(w, 60);
  const est = contactEstimate(w, w.contacts.get(r.id));
  assert.ok(est.live && est.exact, 'live estimate');
  assert.ok(distance(est.x, est.y, r.x, r.y) < 0.01, 'real position');
  assert.equal(est.force.bombers, r.bombers);
  // The squadron flies far away: the raid is lost from sight, the plots take over again.
  Object.assign(s, { x: r.x + 200, y: r.y + 200 });
  const later = run(w, 10);
  assert.equal(r.seen, null);
  assert.ok(later.some((e) => e.type === 'raidSightLost'));
});

test('an installation sees the raid that bombs it', () => {
  const w = makeKanalkampf();
  const r = firstRaid(w);
  stepUntil(w, 4 * 3600, () => r.phase === 'bombing');
  assert.equal(r.phase, 'bombing');
  run(w, 5);
  assert.ok(r.seen, 'seen over its target');
  assert.ok(r.seen.kind === 'site' || r.seen.kind === 'squadron' || r.seen.kind === 'convoy' || r.seen.kind === 'escort');
});

test('a U-boat lost from sight leaves an exact plot where it was last seen', () => {
  const w = makeKanalkampf();
  const u = w.uboats[0];
  const e = w.escorts[0];
  Object.assign(e, { state: 'atSea', x: u.x + 1, y: u.y });
  u.submergedUntil = w.t + 3600;
  seeUboat(w, u, { by: e.name, byId: e.id, kind: 'escort', how: 'asdic' });
  run(w, 10);
  assert.ok(u.seen, 'held by the ASDIC within 2 km');
  // The escort is called away: the contact is lost.
  Object.assign(e, { x: u.x + 30, y: u.y });
  const ux = u.x;
  const uy = u.y;
  const events = run(w, 6);
  assert.equal(u.seen, null);
  const lost = events.find((x) => x.type === 'uboatContactLost');
  assert.ok(lost, 'contact lost');
  const plot = w.uboatPlots.find((p) => p.id === lost.plotId);
  assert.ok(plot && plot.lastSeen);
  assert.ok(distance(plot.x, plot.y, ux, uy) < 2, 'at the last position seen');
});
