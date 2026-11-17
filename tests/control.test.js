import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/sim/geo.js';
import { coverageQuality } from '../src/sim/control.js';
import { interceptRaid } from '../src/sim/orders.js';
import { makeKanalkampf, makeWorld, run } from './helpers.js';

test('coverage: heart of a radar beam, Observer Corps over land, nothing far out at sea', () => {
  const world = makeWorld('arcade');
  const [dx, dy] = project(1.6, 50.9); // off Dover, well inside the beam
  assert.ok(coverageQuality(world, dx, dy, 4000).q >= 0.95);
  const [kx, ky] = project(0.2, 51.3); // inland Kent, behind the radars
  const inland = coverageQuality(world, kx, ky, 4000);
  assert.equal(inland.source, 'observers');
  assert.ok(inland.q > 0.5 && inland.q < 0.9);
  const [ax, ay] = project(-20, 50); // mid-Atlantic
  assert.equal(coverageQuality(world, ax, ay, 4000).q, 0);
});

test('Arcade: the controller guides a squadron onto a raid, and it engages or misses', () => {
  let engaged = 0;
  let missed = 0;
  let tries = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const world = makeKanalkampf('arcade');
    const first = run(world, 12 * 3600, (e) => e.type === 'raidDetected');
    const det = first.find((e) => e.type === 'raidDetected');
    assert.ok(det, 'a raid is detected');
    const raid = world.raids.find((r) => r.id === det.raidId);
    // The nearest squadron that is ready.
    const ready = world.squadrons.filter((s) => s.state === 'ready' && s.role === 'fighter');
    ready.sort((a, b) => Math.hypot(a.x - raid.x, a.y - raid.y) - Math.hypot(b.x - raid.x, b.y - raid.y));
    const sq = ready[0];
    for (let k = 0; k < seed; k++) world.rng.next();
    const p = interceptRaid(world, sq, raid.id);
    assert.ok(p > 0, 'a chance is given');
    assert.ok(sq.intercept, 'guided');
    tries++;
    const events = run(world, 3600, (e) => (e.type === 'tallyHo' || e.type === 'missed') && e.squadronId === sq.id);
    if (events.some((e) => e.type === 'tallyHo' && e.squadronId === sq.id)) engaged++;
    else if (events.some((e) => e.type === 'missed' && e.squadronId === sq.id)) missed++;
  }
  assert.equal(engaged + missed, tries, 'every guided squadron either engages or misses');
  assert.ok(engaged >= tries / 2, `most guided interceptions succeed (${engaged}/${tries})`);
});

test('a spotter section reports a raid exactly and makes the guidance certain around it', async () => {
  const { coverageQuality } = await import('../src/sim/control.js');
  const { scramble } = await import('../src/sim/orders.js');
  const world = makeKanalkampf('standard');
  const guet = world.squadrons.find((s) => s.id === 'guet');
  assert.equal(guet.role, 'watch');
  // Inland Kent, behind the radars: the Observer Corps only, then the patrol over it.
  const [x, y] = project(0.6, 51.2);
  assert.equal(coverageQuality(world, x, y, 4000).source, 'observers');
  scramble(world, guet, { route: [[x, y]] });
  run(world, 1200);
  guet.alt = 4000;
  const q = coverageQuality(world, guet.x, guet.y, 4000);
  assert.equal(q.source, 'patrol');
  assert.equal(q.q, 1);
});
