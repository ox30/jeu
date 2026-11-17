import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKanalkampf, makeWorld, run } from './helpers.js';
import { planGroundRoute, setAlert } from '../src/sim/orders.js';
import { effectiveAlert } from '../src/sim/crews.js';
import {
  addRoster, cancelTakeoff, removeRoster, scheduleSail, scheduleTakeoff, scheduleWing,
} from '../src/sim/timetable.js';
import { routeConvoy } from '../src/sim/convoy.js';
import { project } from '../src/sim/geo.js';
import { addMember, newFormation, scrambleFormation } from '../src/sim/formations.js';
import { restore, snapshot } from '../src/save/game.js';

const at = (w, minutes) => w.t + minutes * 60;

test('duty roster: alert changes at their hour, once or every day', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  setAlert(w, s, 'rest');
  addRoster(w, s, at(w, 10), 'thirty', true);
  const once = addRoster(w, s, at(w, 20), 'cockpit');
  assert.equal(s.roster.length, 2);
  const ev = run(w, 11 * 60);
  assert.ok(ev.some((e) => e.type === 'rosterApplied' && e.alert === 'thirty'));
  assert.equal(s.alert, 'thirty');
  assert.equal(effectiveAlert(w, s), 'rest', 'the recall from rest takes its time');
  assert.equal(s.roster.length, 2, 'the daily change stays for tomorrow');
  assert.ok(removeRoster(w, s, once.id));
  assert.equal(s.roster.length, 1);
  assert.ok(s.roster[0].at > w.t + 23 * 3600, 'tomorrow at the same hour');
});

test('a take-off scheduled with a route prepared on the ground; the order at its time, airborne after the alert delay', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  setAlert(w, s, 'available');
  const sched = scheduleTakeoff(w, s, at(w, 30), { daily: true });
  assert.ok(sched);
  const route = [project(0.9, 51.0), project(-0.5, 50.7)];
  assert.ok(planGroundRoute(w, s, route));
  assert.equal(s.state, 'ready', 'a prepared route does not send it off');
  run(w, 29 * 60);
  assert.equal(s.state, 'ready');
  const ev = run(w, 2 * 60);
  assert.ok(ev.some((e) => e.type === 'scheduledTakeoff'));
  assert.equal(s.state, 'scrambling', 'the order is given at its time');
  assert.ok(s.timer > 200, 'and the squadron needs its five minutes');
  run(w, 6 * 60);
  assert.equal(s.state, 'airborne');
  assert.equal(s.route.length, 2, 'it flies the prepared route');
  assert.ok(s.schedule && s.schedule.at > w.t + 22 * 3600, 'the patrol is set for tomorrow');
  assert.equal(s.schedule.route.length, 2, 'with the same route');
  cancelTakeoff(w, s);
  assert.equal(s.schedule, null);
});

test('a scheduled take-off that cannot go at its time waits and tells the player', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  scheduleTakeoff(w, s, at(w, 5));
  s.state = 'refuelling';
  s.timer = 15 * 60;
  const ev = run(w, 7 * 60);
  const late = ev.filter((e) => e.type === 'scheduleDelayed');
  assert.equal(late.length, 1, 'told once');
  assert.equal(late[0].reason, 'refuelling');
  const later = run(w, 12 * 60);
  const go = later.find((e) => e.type === 'scheduledTakeoff');
  assert.ok(go && go.late, 'it goes, late, once ready');
});

test('a sailing scheduled for an escort group: its route waits in port until the hour', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.id === 'eg1');
  assert.ok(scheduleSail(w, e, at(w, 120)));
  const out = [[-5.0, 54.0], [-5.2, 54.55], [-5.55, 54.85], [-5.97, 55.25], [-6.25, 55.4], [-7.5, 55.62], [-12, 56.8]];
  assert.ok(routeConvoy(w, e, out.map(([lon, lat]) => project(lon, lat))).ok);
  assert.equal(e.state, 'inPort', 'the route waits in port');
  run(w, 100 * 60);
  assert.equal(e.state, 'inPort');
  const ev = run(w, 30 * 60);
  assert.ok(ev.some((x) => x.type === 'scheduledSail'));
  assert.equal(e.state, 'atSea');
  assert.equal(e.schedule, null);
});

test('a wing scheduled to take off together; a squadron scheduled later joins it in the air', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = newFormation(w, 'air', '19', 'Duxford Wing');
  addMember(w, f, '242');
  addMember(w, f, '310');
  const late = w.squadrons.find((x) => x.id === '310');
  scheduleTakeoff(w, late, at(w, 20), { join: f.id });
  scheduleWing(w, f, at(w, 5));
  const ev = run(w, 6 * 60);
  const wing = ev.find((e) => e.type === 'scheduledWing');
  assert.ok(wing, 'the wing goes at its hour');
  assert.equal(wing.n, 2, 'without the squadron that has its own time');
  assert.equal(late.state, 'ready');
  run(w, 15 * 60);
  assert.equal(late.state, 'scrambling', 'the late squadron goes at its own time');
  assert.equal(late.follow, '19', 'to join the leader');
  // A squadron scheduled to join keeps its time when the wing is sent off by hand.
  const g = newFormation(w, 'air', '302', 'Second Wing');
  addMember(w, g, '611');
  const s611 = w.squadrons.find((x) => x.id === '611');
  scheduleTakeoff(w, s611, at(w, 60), { join: g.id });
  assert.equal(scrambleFormation(w, g, { orbit: true }), 1);
  assert.equal(s611.state, 'ready');
});

test('the timetable is saved and restored', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  addRoster(w, s, at(w, 30), 'cockpit', true);
  scheduleTakeoff(w, s, at(w, 45));
  const b = makeKanalkampf('standard', { fatigue: 'on' });
  restore(b, JSON.parse(JSON.stringify(snapshot(w))));
  const t = b.squadrons.find((x) => x.id === '32');
  assert.equal(t.roster.length, 1);
  assert.equal(t.schedule.at, s.schedule.at);
  assert.equal(b.nextTimetableId, w.nextTimetableId);
});
