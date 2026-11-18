import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scramble, setAlert } from '../src/sim/orders.js';
import { effectiveAlert, formFactor, scrambleSeconds, strength } from '../src/sim/crews.js';
import { dispatchTrain } from '../src/sim/logistics.js';
import { makeKanalkampf, run } from './helpers.js';

test('alert states: two hours from rest; raising the readiness takes the difference, lowering it is immediate', () => {
  const world = makeKanalkampf('standard', { fatigue: 'on' });
  const sq = world.squadrons.find((s) => s.id === '32');
  setAlert(world, sq, 'rest');
  assert.equal(sq.alertAt, null, 'standing down is immediate');
  assert.equal(scrambleSeconds(world, sq), 7200, 'two hours to the air from rest');
  setAlert(world, sq, 'min5');
  assert.equal(sq.alertAt, world.t + 6900, 'the recall takes 1 h 55');
  assert.equal(effectiveAlert(world, sq), 'rest');
  assert.equal(scrambleSeconds(world, sq), 7200, 'still two hours to the air');
  run(world, 3600);
  assert.equal(scrambleSeconds(world, sq), 3600);
  const ev = run(world, 3360);
  assert.ok(ev.some((e) => e.type === 'alertReached'), 'the player is told the recall is over');
  assert.equal(effectiveAlert(world, sq), 'min5');
  assert.equal(scramble(world, sq, { vector: 90 }), true);
  assert.ok(sq.timer >= 300, 'five minutes at readiness');
  const other = world.squadrons.find((s) => s.id === '74');
  setAlert(world, other, 'min30');
  assert.equal(scrambleSeconds(world, other), 1800, 'thirty minutes when available');
  setAlert(world, other, 'cockpit');
  assert.equal(scrambleSeconds(world, other), 1800, 'into the cockpits: not faster than the thirty minutes');
  run(world, 1800);
  scramble(world, other, { vector: 90 });
  assert.ok(other.timer <= 130, 'two minutes from the cockpits');
});

test('fatigue grows in the air and falls at rest; a tired squadron fights less well', () => {
  const world = makeKanalkampf('standard', { fatigue: 'on' });
  const sq = world.squadrons.find((s) => s.id === '32');
  const f0 = sq.fatigue;
  scramble(world, sq, { orbit: true });
  run(world, 3600);
  assert.ok(sq.fatigue > f0 + 5, `tired by an hour in the air (${sq.fatigue})`);
  sq.fatigue = 90;
  assert.ok(formFactor(world, sq) < 0.7);
  const rest = world.squadrons.find((s) => s.id === '74');
  rest.fatigue = 50;
  setAlert(world, rest, 'rest');
  run(world, 3 * 3600);
  assert.ok(rest.fatigue < 30, `rested (${rest.fatigue})`);
});

test('Réaliste: pilots are killed with their aircraft; replacements arrive later', () => {
  const world = makeKanalkampf('realistic', { fatigue: 'losses' });
  const sq = world.squadrons.find((s) => s.id === '32');
  sq.pilots = 6;
  assert.equal(strength(world, sq), 6, 'only as many aircraft as pilots');
  run(world, 30 * 3600);
  assert.ok(sq.pilots > 6, 'replacement pilots joined');
});

test('rearming draws ammunition from the aerodrome; the depot sends more by train', () => {
  const world = makeKanalkampf('standard');
  const sq = world.squadrons.find((s) => s.id === '32');
  const field = world.byId.airfield.get(sq.airfield);
  const a0 = field.stocks.ammo;
  scramble(world, sq, { vector: 90 });
  run(world, 600);
  sq.ammo = 0.2;
  sq.state = 'returning';
  sq.returnReason = 'order';
  run(world, 3600, (e) => e.type === 'ready' && e.squadronId === sq.id);
  assert.ok(field.stocks.ammo < a0 - 0.4, 'ammunition drawn');
  assert.ok(sq.ammo > 0.95);
  const r = dispatchTrain(world, 'depot:chilmark', field.key, { ammo: 30 });
  assert.ok(r.ok, r.reason);
  run(world, 2 * 86400, (e) => e.type === 'trainArrived' && e.train === r.train.id);
  assert.ok(field.stocks.ammo > a0 + 20);
});

test('big wing: a squadron joins another in the air and keeps station with it', async () => {
  const { followSquadron } = await import('../src/sim/orders.js');
  const world = makeKanalkampf('standard');
  const lead = world.squadrons.find((s) => s.id === '32');
  const wing = world.squadrons.find((s) => s.id === '111');
  scramble(world, lead, { orbit: true });
  scramble(world, wing, { vector: 0 });
  run(world, 300);
  assert.equal(followSquadron(world, wing, lead.id), true);
  const events = run(world, 1800, (e) => e.type === 'formationJoined');
  assert.ok(events.some((e) => e.type === 'formationJoined'), 'joined');
  run(world, 300);
  assert.ok(Math.hypot(wing.x - lead.x, wing.y - lead.y) < 4, 'on station');
});
