import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { project } from '../src/sim/geo.js';
import { addMember, newFormation } from '../src/sim/formations.js';
import {
  armRally, arrivalOf, computeDepartures, newRally, setDeparture, setRallyMissing, setRallyPoint, setRallyRoute, setRallyTime,
} from '../src/sim/rally.js';
import { answerQuestion } from '../src/sim/engagement.js';
import { addLeg } from '../src/sim/orders.js';
import { restore, snapshot } from '../src/save/game.js';

/** A wing of three squadrons from three aerodromes, with a rendezvous over Chelmsford. */
function wing(preset) {
  const w = makeWorld(preset, {}, 'quinze-septembre');
  const f = newFormation(w, 'air', '17', 'Wing de Debden'); // Debden
  addMember(w, f, '249'); // North Weald
  addMember(w, f, '603'); // Hornchurch
  newRally(w, f);
  const [x, y] = project(0.47, 51.73);
  setRallyPoint(w, f, x, y);
  setRallyRoute(w, f, [project(0.9, 51.4), project(1.2, 51.2)]);
  return { w, f };
}

const sq = (w, id) => w.squadrons.find((s) => s.id === id);

test('Arcade: the departures are worked out so that the wing gathers on time, then flies its route', () => {
  const { w, f } = wing('arcade');
  setRallyTime(w, f, w.t + 40 * 60);
  computeDepartures(w, f);
  const deps = f.rally.departures;
  assert.ok(deps['17'] !== deps['603'], 'not all at the same time: the farthest goes first');
  const arrivals = ['17', '249', '603'].map((id) => arrivalOf(w, f, sq(w, id)));
  assert.ok(Math.max(...arrivals) - Math.min(...arrivals) < 90, 'all due at the point together');
  assert.equal(armRally(w, f), 3);
  const ev = run(w, 50 * 60, (e) => e.type === 'rallyDeparted');
  const gone = ev.find((e) => e.type === 'rallyDeparted');
  assert.ok(gone, 'the wing leaves its rendezvous');
  assert.equal(gone.n, 3, 'complete');
  run(w, 30);
  assert.equal(sq(w, '17').route.length >= 1, true, 'the leader takes the route after the rendezvous');
  assert.equal(sq(w, '249').follow, '17');
  assert.equal(sq(w, '603').follow, '17');
});

test('a latecomer: the wing asks, waits as planned, then goes; the latecomer catches up', () => {
  const { w, f } = wing('standard');
  setRallyTime(w, f, w.t + 25 * 60);
  setRallyMissing(w, f, 'wait', 5);
  setDeparture(w, f, '17', w.t);
  setDeparture(w, f, '249', w.t);
  setDeparture(w, f, '603', w.t + 30 * 60); // far too late
  armRally(w, f);
  const ev = run(w, 40 * 60, (e) => e.type === 'question' && e.kind === 'rally');
  const q = ev.find((e) => e.type === 'question' && e.kind === 'rally');
  assert.ok(q, 'the wing asks what to do');
  assert.match(q.missing, /603/);
  assert.equal(f.rally.phase, 'deciding');
  // No answer: the plan's choice (wait 5 min), then it goes without the latecomer.
  const later = run(w, 10 * 60, (e) => e.type === 'rallyDeparted');
  assert.ok(later.some((e) => e.type === 'rallyWaiting'));
  const gone = later.find((e) => e.type === 'rallyDeparted');
  assert.ok(gone && gone.n === 2 && /603/.test(gone.late));
  // The latecomer takes off at its time, follows the plan at full speed and catches up.
  const catchUp = run(w, 60 * 60, (e) => e.type === 'rallyCaughtUp');
  assert.ok(catchUp.some((e) => e.type === 'rallyCaughtUp'), 'it catches the wing');
  assert.equal(sq(w, '603').follow, '17');
});

test('answered "go": the wing leaves at once, slowed if "slow" is chosen', () => {
  const { w, f } = wing('standard');
  setRallyTime(w, f, w.t + 25 * 60);
  setDeparture(w, f, '17', w.t);
  setDeparture(w, f, '249', w.t);
  setDeparture(w, f, '603', w.t + 30 * 60);
  armRally(w, f);
  const ev = run(w, 40 * 60, (e) => e.type === 'question' && e.kind === 'rally');
  const q = ev.find((e) => e.type === 'question');
  assert.ok(answerQuestion(w, q.questionId, 'slow'));
  assert.equal(f.rally.phase, 'gone');
  assert.equal(sq(w, '17').rallySlow, w.rules.formations.slowFactor, 'slowed for the latecomer');
});

test('a support group meets at a point at sea and sails on together', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const f = newFormation(w, 'naval', 'eg1', 'Groupe Walker'); // Liverpool
  addMember(w, f, 'eg2'); // the Clyde
  newRally(w, f);
  const [x, y] = project(-6.6, 55.6);
  setRallyPoint(w, f, x, y);
  setRallyRoute(w, f, [project(-12, 56.5)]);
  setDeparture(w, f, 'eg1', w.t);
  setDeparture(w, f, 'eg2', w.t);
  assert.equal(armRally(w, f), 2);
  const ev = run(w, 3 * 86400, (e) => e.type === 'rallyDeparted');
  const gone = ev.find((e) => e.type === 'rallyDeparted');
  assert.ok(gone, 'the group leaves its rendezvous');
  assert.equal(gone.n, 2);
  const eg1 = w.escorts.find((e) => e.id === 'eg1');
  assert.equal(eg1.state, 'atSea');
  assert.ok(eg1.route.length >= 1, 'the leader sails the route after the rendezvous');
});

test('a support group gathered on its leader: the leader sails its legs, the other group joins it at sea', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const f = newFormation(w, 'naval', 'eg1', 'Groupe Walker'); // Liverpool
  addMember(w, f, 'eg2'); // the Clyde
  const eg1 = w.escorts.find((e) => e.id === 'eg1');
  const eg2 = w.escorts.find((e) => e.id === 'eg2');
  newRally(w, f);
  setDeparture(w, f, 'eg1', w.t + 600);
  setDeparture(w, f, 'eg2', w.t + 3600);
  assert.equal(armRally(w, f), 2);
  // The leader's own orders, prepared in port: out to the west for a day.
  assert.ok(addLeg(w, eg1, { heading: 300, end: { kind: 'duration', s: 86400 }, speedKn: eg1.speedKn }).ok);
  run(w, 20 * 60);
  assert.equal(eg1.state, 'atSea', 'the leader sails at its time, with its own legs');
  assert.equal(eg2.state, 'inPort', 'the other group waits for its own time');
  run(w, 40 * 3600);
  assert.equal(f.rally, null, 'the plan is done once every group has sailed');
  assert.equal(eg2.state, 'atSea');
  assert.ok(Math.hypot(eg2.x - eg1.x, eg2.y - eg1.y) < 30, 'the other group has caught up with its leader');
});

test('a rendezvous plan under way is saved and goes on exactly the same after a restore', () => {
  const { w, f } = wing('standard');
  setRallyTime(w, f, w.t + 40 * 60);
  setDeparture(w, f, '17', w.t + 5 * 60);
  setDeparture(w, f, '249', w.t + 8 * 60);
  setDeparture(w, f, '603', w.t + 30 * 60); // late: the wing will ask
  armRally(w, f);
  run(w, 15 * 60);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const { w: b } = wing('standard');
  restore(b, snap);
  assert.equal(b.formations[0].rally.phase, 'armed');
  run(w, 60 * 60);
  run(b, 60 * 60);
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(snapshot(w)), 'same state after the same time');
});
