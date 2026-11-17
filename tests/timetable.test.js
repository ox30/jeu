import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKanalkampf, makeWorld, run } from './helpers.js';
import { planGroundRoute, setAlert } from '../src/sim/orders.js';
import { effectiveAlert } from '../src/sim/crews.js';
import {
  cancelTakeoff, scheduleSail, scheduleTakeoff, scheduleWing,
} from '../src/sim/timetable.js';
import {
  addDaily, addOverride, endOverride, normalizeRoster, overrideOf, removeRosterEntry, startOverride, timeOfDay,
} from '../src/sim/roster.js';
import { routeConvoy } from '../src/sim/convoy.js';
import { project } from '../src/sim/geo.js';
import { addMember, newFormation, scrambleFormation } from '../src/sim/formations.js';
import { restore, snapshot } from '../src/save/game.js';

const at = (w, minutes) => w.t + minutes * 60;

const H = 3600;
/** Seconds after midnight, `minutes` from now on the game clock. */
const todIn = (w, minutes) => (timeOfDay(w) + minutes * 60) % 86400;

test('duty roster: the daily plan changes the state at its hours, every day', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  setAlert(w, s, 'rest');
  addDaily(w, s, todIn(w, 10), 'thirty');
  const evening = addDaily(w, s, todIn(w, 20), 'cockpit');
  assert.equal(s.roster.daily.length, 2);
  let ev = run(w, 11 * 60);
  assert.ok(ev.some((e) => e.type === 'rosterApplied' && e.alert === 'thirty'));
  assert.equal(s.alert, 'thirty');
  assert.equal(effectiveAlert(w, s), 'rest', 'the recall from rest takes its time');
  ev = run(w, 10 * 60);
  assert.equal(s.alert, 'cockpit');
  assert.ok(removeRosterEntry(w, s, evening.id));
  setAlert(w, s, 'rest');
  ev = run(w, 24 * H);
  assert.equal(ev.filter((e) => e.type === 'rosterApplied').length, 1, 'the next day, the same hour again, and only that one');
  assert.equal(s.alert, 'thirty');
});

test('a plan for the coming hours, from H0: it replaces the daily plan, then the daily plan comes back', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  setAlert(w, s, 'available');
  addDaily(w, s, todIn(w, 3 * 60), 'cockpit'); // daily: cockpit three hours from now
  const o = startOverride(w, s, 24);
  assert.equal(o.until - o.from, 24 * H);
  // H0 to H+6 at rest, H+6 to H+9 on alert, H+9 to H+20 cockpit, H+20 to H+24 on alert.
  assert.ok(addOverride(w, s, 0, 'rest'));
  assert.equal(s.alert, 'rest', 'H+0 is now: at once');
  addOverride(w, s, 6 * H, 'available');
  addOverride(w, s, 9 * H, 'cockpit');
  addOverride(w, s, 20 * H, 'available');
  assert.equal(addOverride(w, s, 25 * H, 'rest'), null, 'after the end of the plan');
  run(w, 5 * H);
  assert.equal(s.alert, 'rest', 'the daily cockpit at H+3 waits');
  run(w, 2 * H);
  assert.equal(s.alert, 'available');
  run(w, 3 * H);
  assert.equal(s.alert, 'cockpit');
  run(w, 11 * H);
  assert.equal(s.alert, 'available');
  const ev = run(w, 3 * H + 120);
  assert.equal(overrideOf(w, s), null, 'over after 24 hours');
  assert.ok(ev.some((e) => e.type === 'rosterResumed' && e.alert === 'cockpit'), 'back to the daily plan, with its state for this hour');
  assert.equal(s.alert, 'cockpit');
});

test('unticking the plan for the coming hours brings the daily plan back at once; an M2.3 roster becomes a daily plan', () => {
  const w = makeKanalkampf('standard', { fatigue: 'on' });
  const s = w.squadrons.find((x) => x.id === '32');
  setAlert(w, s, 'available');
  addDaily(w, s, todIn(w, -60), 'thirty'); // daily: disponible since an hour ago
  startOverride(w, s, 12);
  addOverride(w, s, 0, 'cockpit');
  assert.equal(s.alert, 'cockpit');
  assert.ok(endOverride(w, s));
  assert.equal(s.alert, 'thirty');
  const old = w.squadrons.find((x) => x.id === '43');
  old.roster = [{ id: 'T1', at: w.t + 600, alert: 'cockpit', daily: true }, { id: 'T2', at: w.t + 1200, alert: 'rest', daily: false }];
  normalizeRoster(w, old);
  assert.equal(old.roster.daily.length, 1);
  assert.equal(old.roster.daily[0].tod, todIn(w, 10));
  assert.equal(old.roster.override, null);
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
  addDaily(w, s, todIn(w, 30), 'cockpit');
  startOverride(w, s, 24);
  addOverride(w, s, 2 * H, 'rest');
  scheduleTakeoff(w, s, at(w, 45));
  const b = makeKanalkampf('standard', { fatigue: 'on' });
  restore(b, JSON.parse(JSON.stringify(snapshot(w))));
  const t = b.squadrons.find((x) => x.id === '32');
  assert.deepEqual(t.roster, s.roster);
  assert.equal(t.schedule.at, s.schedule.at);
  assert.equal(b.nextTimetableId, w.nextTimetableId);
});
