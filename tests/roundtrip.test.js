// Save and restore, scenario by scenario, with every optional entity a game can hold: a
// mobile radar station, a formation with its rendezvous, an aircraft bought in America, a
// straggler. The restored game must be the saved one, and must go on exactly like it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTerrain, data, orders as O, sim } from '../tools/bot/game.mjs';
import { runAir } from '../tools/bot/air.mjs';
import { runSea } from '../tools/bot/sea.mjs';
import { addMobileRadar, deployMru } from '../src/sim/mru.js';
import { armRally, computeDepartures, newRally, setRallyPoint, setRallyTime } from '../src/sim/rally.js';

const HOUR = 3600;

function advance(world, seconds) {
  for (let i = 0; i < seconds && !world.ended; i++) {
    sim.world.step(world, 1);
    world.events.length = 0;
  }
}

/** A fresh world of the same scenario and settings, with the snapshot restored onto it. */
function restored(world, text) {
  const fresh = sim.world.createWorld({ scenario: structuredClone(world.scenario), rules: data.rules, settings: { ...world.settings }, terrain: getTerrain() });
  sim.events.drainEvents(fresh);
  sim.save.restore(fresh, JSON.parse(text), addMobileRadar);
  return fresh;
}

function airFormation(world, withRally) {
  const ready = world.squadrons.filter((s) => s.role === 'fighter' && s.state === 'ready' && !s.formation);
  if (ready.length < 2) return null;
  const f = O.newFormation(world, 'air', ready[0].id);
  O.addMember(world, f, ready[1].id);
  if (withRally) {
    newRally(world, f);
    setRallyPoint(world, f, ready[0].x + 20, ready[0].y + 15);
    setRallyTime(world, f, world.t + 2 * HOUR);
    computeDepartures(world, f);
    armRally(world, f);
  }
  return f;
}

function navalFormation(world) {
  const inPort = world.escorts.filter((e) => e.state === 'inPort' && !e.formation);
  if (inPort.length < 2) return null;
  const f = O.newFormation(world, 'naval', inPort[0].id);
  O.addMember(world, f, inPort[1].id);
  return f;
}

function station(world) {
  if (!world.mru || world.mru.available <= 0) return false;
  const field = world.byId.airfield.get('tangmere') || world.airfields[0];
  return deployMru(world, field.x, field.y - 6, 180).ok;
}

const CASES = [
  {
    scenario: 'm0-july-1940',
    play: () => runAir({ scenario: 'm0-july-1940', seed: 3, days: 0.4, returnWorld: true }),
    extras: (w) => ({ formation: Boolean(airFormation(w, true)) }),
    settle: 3 * HOUR,
    expect: ['formation'],
  },
  {
    scenario: 'kanalkampf',
    play: () => runAir({ scenario: 'kanalkampf', seed: 3, days: 4, returnWorld: true }),
    extras: (w) => ({ formation: Boolean(airFormation(w, false)), group: Boolean(navalFormation(w)), train: O.sendTrain(w, 'port:liverpool', 'airfield:biggin_hill', { fuel: 40 }) !== null }),
    settle: 5 * HOUR,
    expect: ['formation'],
  },
  {
    scenario: 'adlertag',
    play: () => runAir({ scenario: 'adlertag', seed: 3, days: 1.5, returnWorld: true }),
    extras: (w) => ({ station: station(w), formation: Boolean(airFormation(w, true)) }),
    settle: 7 * HOUR, // the station is installed in six hours
    expect: ['station', 'formation'],
    check: (w) => assert.ok(w.radars.some((r) => r.mobile), 'the mobile station is in the chain'),
  },
  {
    scenario: 'quinze-septembre',
    play: () => runAir({ scenario: 'quinze-septembre', seed: 3, days: 0.05, returnWorld: true }),
    extras: (w) => ({ station: station(w), formation: Boolean(airFormation(w, true)) }),
    settle: 3 * HOUR, // saved while the station is still being installed
    expect: ['station', 'formation'],
    check: (w) => assert.ok(w.mru.pending.length === 1, 'the mobile station is on its way'),
  },
  {
    scenario: 'hiver-atlantique',
    // Convoys pushed to their best speed lose stragglers; the Hudson bought on the first day
    // arrives on the twelfth.
    play: () => runSea({ seed: 3, days: 14, boost: true, buy: [{ id: 'hudson', day: 0 }], returnWorld: true }),
    extras: (w) => ({ group: Boolean(navalFormation(w)) }),
    settle: 6 * HOUR,
    expect: [],
    check: (w) => {
      assert.ok(w.squadrons.some((s) => s.type === 'Hudson'), 'the Hudson squadron has arrived');
      assert.ok(w.convoys.some((c) => c.straggler), 'a straggler is at sea');
    },
  },
];

for (const c of CASES) {
  test(`${c.scenario}: a save with its optional entities is restored exactly and goes on the same`, () => {
    const a = c.play();
    assert.equal(a.ended, false, 'the game is still going');
    const made = c.extras(a);
    for (const k of c.expect) assert.ok(made[k], `${k} created`);
    advance(a, c.settle);
    if (c.check) c.check(a);
    const text = JSON.stringify(sim.save.snapshot(a));
    const b = restored(a, text);
    assert.equal(JSON.stringify(sim.save.snapshot(b)), text, 'the restored game is the saved one');
    advance(a, 18 * HOUR);
    advance(b, 18 * HOUR);
    assert.equal(JSON.stringify(sim.save.snapshot(b)), JSON.stringify(sim.save.snapshot(a)), 'both go on the same');
  });
}

test('the same seed and the same orders give the same game', () => {
  const one = runAir({ scenario: 'adlertag', preset: 'realistic', seed: 5, days: 2, returnWorld: true });
  const two = runAir({ scenario: 'adlertag', preset: 'realistic', seed: 5, days: 2, returnWorld: true });
  assert.equal(JSON.stringify(sim.save.snapshot(two)), JSON.stringify(sim.save.snapshot(one)));
  const other = runAir({ scenario: 'adlertag', preset: 'realistic', seed: 6, days: 2, returnWorld: true });
  assert.notEqual(JSON.stringify(sim.save.snapshot(other)), JSON.stringify(sim.save.snapshot(one)), 'another seed, another game');
});
