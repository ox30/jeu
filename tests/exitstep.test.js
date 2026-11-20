// The way out of port as the first step of an escort group's orders (asked after play-testing
// 2.10.2: « si je lui dis de sortir par le chenal […] cela devient une étape »), and the two
// faults found on the way: a sailing scheduled for a group with neither line nor legs never
// left, and a group that left port on a line drawn could have neither a point of its route
// moved nor the route drawn longer (the way out was counted at the wrong end of the route).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { distance, project, unproject } from '../src/sim/geo.js';
import { editShipRoute, editablePoints, planExit, plannedExit, routeConvoy } from '../src/sim/convoy.js';
import { addLeg, departConvoy, editableRoute, escortHome, joinConvoy, planTrack, setExitChannel, wayOutEnd } from '../src/sim/orders.js';
import { setShipEndAction } from '../src/sim/naval.js';
import { addMember, newFormation } from '../src/sim/formations.js';
import { scheduleSail } from '../src/sim/timetable.js';
import { restore, snapshot } from '../src/save/game.js';
import { orderDropLine, orderExitChannel, orderSail } from '../src/ui/actions.js';

const H = 3600;
const NORTH = "Nord de l'Irlande";
const SOUTH = 'Canal Saint-Georges';

/** The winter in the Atlantic, with the 1st escort group at its quay in Liverpool. */
function liverpool() {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.id === 'eg1');
  return { w, e, port: w.byId.port.get('liverpool') };
}
const lonLat = (p) => unproject(p[0], p[1]);
const at = (lon, lat) => project(lon, lat);
/** No land under the route from its `from`-th point on (the harbour channel itself is charted). */
const byWater = (w, route, from = 0) => w.terrain.findLandOnRoute(route.slice(from), 0, 0, 1.5) === null;

test('a sailing scheduled for a group with nothing prepared: at its hour it goes out to the roads', () => {
  const { w, e, port } = liverpool();
  assert.ok(scheduleSail(w, e, w.t + 2 * H));
  let ev = run(w, 2 * H - 120);
  assert.equal(e.state, 'inPort', 'not before its hour');
  ev = run(w, 300);
  assert.equal(ev.some((x) => x.type === 'scheduleDelayed'), false, 'no « ni route ni étapes » any more');
  assert.ok(ev.some((x) => x.type === 'scheduledSail' && x.unitId === 'eg1'));
  assert.equal(e.state, 'atSea');
  assert.equal(e.schedule, null);
  assert.equal(e.route.length, 1, 'one point: the roads, as on « Appareiller »');
  run(w, 3 * H);
  assert.equal(e.state, 'waiting', 'it waits there for orders');
  assert.ok(distance(e.x, e.y, port.x, port.y) < 10);
  // A convoy still needs its legs or its route: that order waits, and says so once.
  const k = makeWorld('standard', {}, 'kanalkampf');
  const cw = k.convoys.find((c) => c.state === 'inPort');
  scheduleSail(k, cw, k.t + 600);
  const told = run(k, 1200).filter((x) => x.type === 'scheduleDelayed');
  assert.equal(told.length, 1);
  assert.equal(told[0].reason, 'noRoute');
  assert.equal(cw.state, 'inPort');
});

test('the way out chosen is the first step of the group: the head of a route that waits in port', () => {
  const { w, e } = liverpool();
  assert.equal(plannedExit(e), null, 'nothing planned to begin with');
  assert.deepEqual(planExit(w, e, NORTH), { ok: true, kept: false, dropped: false });
  assert.equal(plannedExit(e), NORTH);
  assert.equal(e.state, 'inPort', 'the step waits for the order to sail');
  assert.equal(e.route.length, 11, 'down the channel to its far end');
  assert.equal(e.routeHead, 11, 'all of it the charted way out');
  assert.equal(e.routeLocked, 0);
  const [lon, lat] = lonLat(e.route[e.route.length - 1]);
  assert.ok(Math.abs(lon + 8.3) < 0.05 && Math.abs(lat - 56.1) < 0.05, `to the pilot's station north of Ireland (${lon.toFixed(2)}, ${lat.toFixed(2)})`);
  assert.deepEqual(editablePoints(e), [], 'no point of it is the player\'s to move');
  assert.equal(editableRoute(e), null);
  assert.deepEqual(wayOutEnd(e), [e.route[10][0], e.route[10][1]], 'but its end is where the route is drawn longer from');
  run(w, 3 * H);
  assert.equal(e.state, 'inPort', 'nothing leaves by itself');
  // At its hour the group follows it, and stops at the far end (« S'arrêter et attendre »).
  scheduleSail(w, e, w.t + H);
  const ev = run(w, H + 120);
  assert.ok(ev.some((x) => x.type === 'scheduledSail'));
  assert.equal(e.state, 'atSea');
  assert.equal(e.route.length, 11);
  const gate = e.route[10];
  run(w, 19 * H);
  assert.equal(e.state, 'waiting');
  assert.ok(distance(e.x, e.y, gate[0], gate[1]) < 2, 'at the far end of the channel');
  assert.equal(e.routeHead, 0, 'the way out is behind it');
});

test('the roads asked for as a step: one point off the port, and a line drawn from the group waits and starts there', () => {
  const { w, e, port } = liverpool();
  assert.ok(planExit(w, e, 'roads').ok);
  assert.equal(plannedExit(e), 'roads');
  assert.equal(e.exitChannel, null);
  assert.equal(e.route.length, 1);
  assert.equal(e.routeHead, 1);
  const roads = [...e.route[0]];
  assert.ok(distance(roads[0], roads[1], port.x, port.y) < 10, 'just off the port');
  // South-west of Ireland: with no step the line would take a channel as far as it serves.
  const r = routeConvoy(w, e, [at(-11, 51)]);
  assert.ok(r.ok, `accepted (${r.reason || ''})`);
  assert.equal(e.state, 'inPort', 'a step is planned: the line waits with it');
  assert.deepEqual(e.route[0], roads, 'it starts at the roads');
  assert.equal(e.routeHead, 1);
  assert.ok(e.route.length >= 3, 'then round the land by sea');
  assert.ok(byWater(w, e.route), 'never over land');
  // With no step given, the same line is an order to go now (as before).
  const other = liverpool();
  assert.ok(routeConvoy(other.w, other.e, [at(-11, 51)]).ok);
  assert.equal(other.e.state, 'atSea');
});

test('the step is changed or taken away: the line after it follows, or goes with it', () => {
  const { w, e } = liverpool();
  planExit(w, e, NORTH);
  assert.ok(editShipRoute(w, e, [at(-12, 57)]).ok, 'a line drawn longer from the end of the way out');
  assert.equal(e.state, 'inPort');
  assert.equal(e.routeHead, 11);
  assert.equal(e.route.length, 12);
  // Another way out: the line is kept, joined by sea from the new one.
  assert.deepEqual(planExit(w, e, SOUTH), { ok: true, kept: true, dropped: false });
  assert.equal(plannedExit(e), SOUTH);
  assert.equal(e.routeHead, 8, 'the St George\'s Channel has eight points out');
  const [lon, lat] = lonLat(e.route[e.route.length - 1]);
  assert.ok(Math.abs(lon + 12) < 0.01 && Math.abs(lat - 57) < 0.01, 'the line still ends where it was drawn to');
  assert.ok(byWater(w, e.route, e.routeHead - 1), 'round Ireland by sea from the south entrance');
  // Taken away: the line that started at its end goes with it.
  assert.deepEqual(planExit(w, e, null), { ok: true, kept: false, dropped: true });
  assert.equal(plannedExit(e), null);
  assert.deepEqual(e.route, []);
  assert.equal(e.routeHead, 0);
  assert.equal(e.exitChannel, null);
  // An unknown channel is no step; the old order keeps its meaning (a name, or null).
  assert.equal(planExit(w, e, 'nowhere').ok, false);
  assert.equal(setExitChannel(w, e, 'nowhere'), null);
  assert.deepEqual(e.route, []);
  assert.equal(setExitChannel(w, e, SOUTH), SOUTH);
  assert.equal(e.routeHead, 8);
  // Nothing of this for a group at sea.
  departConvoy(w, e);
  assert.equal(planExit(w, e, NORTH).ok, false);
  assert.equal(plannedExit(e), null);
});

test('after the step: a line whose points are the player\'s, taken away without the step', () => {
  const { w, e } = liverpool();
  planExit(w, e, NORTH);
  const a = at(-11, 56.6);
  const b = at(-14, 57);
  assert.ok(editShipRoute(w, e, [a, b]).ok);
  assert.equal(e.state, 'inPort');
  const mine = editableRoute(e);
  assert.equal(mine.length, e.route.length - 11, 'every point after the way out');
  assert.deepEqual(mine[mine.length - 1].slice(0, 2), b);
  assert.equal(wayOutEnd(e), null, 'the ring is now at the end of the line');
  // A point moved: the way out is not touched.
  const head = e.route.slice(0, 11).map((p) => [...p]);
  const moved = mine.map((p) => [p[0], p[1]]);
  moved[moved.length - 1] = at(-15, 57.5);
  assert.ok(editShipRoute(w, e, moved).ok);
  assert.deepEqual(e.route.slice(0, 11), head);
  assert.equal(e.routeHead, 11);
  // The line taken away (the cross beside it): the step stays, and ends the route again.
  assert.equal(orderDropLine({ world: w }, e), true);
  assert.equal(e.route.length, 11);
  assert.equal(e.routeHead, 11);
  assert.equal(e.state, 'inPort');
  assert.equal(plannedExit(e), NORTH);
});

test('after the step: legs start at its end, and the group sails the way out then its legs', () => {
  const { w, e } = liverpool();
  planExit(w, e, NORTH);
  editShipRoute(w, e, [at(-12, 57)]);
  // Legs take the place of the line, not of the step.
  assert.ok(addLeg(w, e, { heading: 270, end: { kind: 'duration', s: 6 * H }, speedKn: e.speedKn }).ok);
  assert.equal(e.route.length, 11, 'the line gives way to the legs, the way out stays');
  assert.equal(e.routeHead, 11);
  assert.equal(e.plan.length, 1);
  const gate = e.route[10];
  const track = planTrack(w, e);
  assert.ok(distance(track[0].x, track[0].y, gate[0], gate[1]) < 0.1, 'the legs are reckoned from the end of the way out');
  assert.ok(departConvoy(w, e));
  assert.equal(e.route.length, 11, 'it sails the way out it was given');
  // Half way down the channel the legs are still reckoned from its end, not from the ship.
  run(w, 8 * H);
  assert.ok(e.route.length > 0 && e.plan.length === 1);
  const later = planTrack(w, e);
  assert.ok(distance(later[0].x, later[0].y, gate[0], gate[1]) < 0.1);
  run(w, 12 * H);
  assert.equal(e.route.length, 0, 'out of the channel');
  assert.equal(e.state, 'atSea');
  run(w, 3 * H);
  const [lon] = lonLat([e.x, e.y]);
  assert.ok(lon < -9, `west of the pilot's station on its leg (${lon.toFixed(2)})`);
});

test('the end of the step: what the group does at the far end of its way out', () => {
  // Hold on: it keeps its course beyond the channel instead of stopping there.
  const a = liverpool();
  planExit(a.w, a.e, NORTH);
  assert.ok(setShipEndAction(a.w, a.e, { kind: 'hold' }));
  const gate = a.e.route[10];
  departConvoy(a.w, a.e);
  run(a.w, 21 * H);
  assert.equal(a.e.state, 'atSea');
  assert.ok(distance(a.e.x, a.e.y, gate[0], gate[1]) > 40, 'on along its course');
  // Into another port: out by the roads, then home to the Clyde.
  const b = liverpool();
  planExit(b.w, b.e, 'roads');
  assert.ok(setShipEndAction(b.w, b.e, { kind: 'port', id: 'clyde' }));
  departConvoy(b.w, b.e);
  run(b.w, 3 * H);
  assert.equal(b.e.homeward, true);
  assert.equal(b.e.destination, 'clyde');
  // Meet a convoy: at the end of the way out the group steers for it.
  const c = liverpool();
  run(c.w, 7 * H, () => c.w.convoys.length > 0);
  const convoy = c.w.convoys[0];
  planExit(c.w, c.e, 'roads');
  assert.ok(setShipEndAction(c.w, c.e, { kind: 'escort', id: convoy.id }));
  departConvoy(c.w, c.e);
  run(c.w, 3 * H);
  assert.equal(c.e.joinTarget, convoy.id);
  assert.equal(c.e.state, 'atSea');
});

test('a group that left port on a line drawn: the points of the line are the player\'s, not the channel\'s', () => {
  const { w, e } = liverpool();
  const drawn = [at(-11, 56.5), at(-14, 57), at(-17, 57.5)];
  assert.ok(routeConvoy(w, e, drawn).ok);
  assert.equal(e.state, 'atSea', 'no step given: the line is an order to go');
  const head = e.routeHead;
  assert.ok(head >= 1 && head === e.route.length - 3, `the way out is the head of the route (${head} of ${e.route.length})`);
  assert.equal(e.routeLocked, 0, 'and no longer counted as a channel into port, at the wrong end');
  assert.deepEqual(editablePoints(e).map((p) => [p[0], p[1]]), drawn);
  run(w, 2 * H);
  // Under way in the channel: the three points drawn can still be moved, and the route drawn longer.
  const mine = editableRoute(e);
  assert.equal(mine.length, 3, 'until 2.10.2 none of them could be moved');
  const before = e.route.slice(0, e.routeHead).map((p) => [...p]);
  assert.ok(before.length > 0, 'still on its way out');
  const longer = [...mine.map((p) => [p[0], p[1]]), at(-20, 58)];
  assert.ok(editShipRoute(w, e, longer).ok, 'drawn longer from its end');
  assert.deepEqual(e.route.slice(0, e.routeHead), before, 'the channel it is going down is kept as it was');
  const [lon, lat] = lonLat(e.route[e.route.length - 1]);
  assert.ok(Math.abs(lon + 20) < 0.01 && Math.abs(lat - 58) < 0.01);
  // The way out is consumed point by point; once past it the whole route is the player's.
  run(w, 16 * H);
  assert.equal(e.routeHead, 0);
  assert.equal(editablePoints(e).length, e.route.length);
});

test('back in port, the step of the sortie is forgotten; an order to go now takes its place', () => {
  const { w, e } = liverpool();
  planExit(w, e, 'roads');
  departConvoy(w, e);
  run(w, 3 * H);
  assert.equal(e.state, 'waiting');
  assert.ok(escortHome(w, e, 'liverpool'));
  run(w, 3 * H);
  assert.equal(e.state, 'refit');
  assert.equal(e.exitPlanned, false);
  assert.equal(e.exitChannel, null);
  assert.equal(e.routeHead, 0);
  assert.deepEqual(e.route, []);
  // « Rejoindre » from port is an order to go now, by the channel that leads to the convoy:
  // what was prepared gives way to it.
  const b = liverpool();
  run(b.w, 7 * H, () => b.w.convoys.length > 0);
  planExit(b.w, b.e, SOUTH);
  assert.ok(joinConvoy(b.w, b.e, b.w.convoys[0].id));
  assert.equal(b.e.state, 'atSea');
  assert.equal(b.e.exitPlanned, false);
  assert.equal(b.e.exitChannel, null);
  assert.equal(b.e.routeHead, b.e.route.length, 'its route is the channel out, all of it');
  const [, lat] = lonLat(b.e.route[b.e.route.length - 1]);
  assert.ok(lat > 53.4, 'north about, toward the convoy: not the St George\'s Channel prepared before');
});

test('a game saved before 2.10.3: the channel chosen becomes the step, and the sailing that waited leaves', () => {
  const { w, e } = liverpool();
  // As 2.10.2 left it: the channel chosen in the list, the hour past, « ni route ni étapes ».
  e.exitChannel = NORTH;
  e.schedule = { id: 'T1', at: w.t - 600, delayed: true };
  delete e.exitPlanned;
  delete e.routeHead;
  const back = restore(makeWorld('standard', {}, 'hiver-atlantique'), JSON.parse(JSON.stringify(snapshot(w))));
  const g = back.escorts.find((x) => x.id === 'eg1');
  assert.equal(g.exitPlanned, false, 'the fields of 2.10.3 come with their defaults');
  assert.equal(g.routeHead, 0);
  const ev = run(back, 120);
  assert.equal(g.exitPlanned, true);
  assert.ok(ev.some((x) => x.type === 'scheduledSail' && x.late), 'it leaves, late, as the alert said it would');
  assert.equal(g.state, 'atSea');
  assert.equal(g.route.length, 11, 'down the channel chosen then');
  assert.equal(g.routeHead, 11);
});

test('a game saved before 2.10.3: a line that waited in port behind its channel is read as the step and its line', () => {
  const { w, e } = liverpool();
  const drawn = [at(-11, 56.5), at(-14, 57)];
  planExit(w, e, NORTH);
  scheduleSail(w, e, w.t + 2 * H);
  assert.ok(routeConvoy(w, e, drawn).ok);
  assert.equal(e.state, 'inPort');
  const head = e.routeHead;
  const route = e.route.map((p) => [...p]);
  // As 2.10.2 wrote it: the way out counted in `routeLocked`, the channel a bare name.
  e.routeLocked = head;
  delete e.routeHead;
  delete e.exitPlanned;
  const back = restore(makeWorld('standard', {}, 'hiver-atlantique'), JSON.parse(JSON.stringify(snapshot(w))));
  const g = back.escorts.find((x) => x.id === 'eg1');
  assert.equal(g.routeHead, 0);
  assert.equal(editablePoints(g).length, g.route.length - head, 'as 2.10.2 read it: the last points locked, not the first');
  run(back, 60);
  assert.equal(g.state, 'inPort', 'it still waits for its hour');
  assert.equal(plannedExit(g), NORTH);
  assert.equal(g.routeHead, head);
  assert.equal(g.routeLocked, 0);
  assert.deepEqual(g.route, route, 'not a point of the route has moved');
  assert.deepEqual(editablePoints(g).slice(-2).map((p) => [p[0], p[1]]), drawn, 'the points drawn are the player\'s again');
  const ev = run(back, 2 * H);
  assert.ok(ev.some((x) => x.type === 'scheduledSail' && !x.late));
  assert.equal(g.state, 'atSea');
});

test('a game saved before 2.10.3 with a group going down its channel: its line can be changed again', () => {
  const { w, e } = liverpool();
  const drawn = [at(-11, 56.5), at(-14, 57), at(-17, 57.5)];
  assert.ok(routeConvoy(w, e, drawn).ok);
  const wayOut = e.routeHead;
  run(w, 4 * H);
  const left = e.routeHead;
  assert.ok(left > 0 && left < wayOut, `part of the way out is behind it (${left} of ${wayOut})`);
  // As 2.10.2 kept it: the count of the way out, never brought down, only held to the route.
  e.routeLocked = Math.min(wayOut, e.route.length);
  delete e.routeHead;
  const back = restore(makeWorld('standard', {}, 'hiver-atlantique'), JSON.parse(JSON.stringify(snapshot(w))));
  const g = back.escorts.find((x) => x.id === 'eg1');
  assert.equal(editablePoints(g).length < 3, true, 'as 2.10.2 read it: points drawn that could not be moved');
  run(back, 1);
  assert.equal(g.routeHead, left, 'the points of the channel still ahead, and no other');
  assert.equal(g.routeLocked, 0);
  assert.deepEqual(editablePoints(g).map((p) => [p[0], p[1]]), drawn);
  assert.ok(editShipRoute(back, g, [...drawn, at(-20, 58)]).ok, 'and the route is drawn longer');
});

test('what waits in port is saved, and goes on the same after a restore', () => {
  const { w, e } = liverpool();
  planExit(w, e, NORTH);
  editShipRoute(w, e, [at(-12, 57)]);
  setShipEndAction(w, e, { kind: 'hold' });
  scheduleSail(w, e, w.t + 2 * H);
  run(w, H);
  const back = restore(makeWorld('standard', {}, 'hiver-atlantique'), JSON.parse(JSON.stringify(snapshot(w))));
  const g = back.escorts.find((x) => x.id === 'eg1');
  assert.equal(plannedExit(g), NORTH);
  assert.equal(g.routeHead, 11);
  assert.deepEqual(g.route, e.route);
  assert.deepEqual(g.endAction, { kind: 'hold' });
  assert.equal(g.state, 'inPort');
  run(w, 30 * H);
  run(back, 30 * H);
  assert.equal(g.state, e.state);
  assert.ok(e.state === 'atSea' && distance(g.x, g.y, e.x, e.y) < 1e-6, 'the same sortie, to the metre');
});

test('a support group: the step is given to each of its groups, and they sail it together', () => {
  const { w, e } = liverpool();
  const f = newFormation(w, 'naval', 'eg1', 'Groupe A');
  assert.ok(addMember(w, f, 'eg3'));
  const other = w.escorts.find((x) => x.id === 'eg3');
  const app = { world: w };
  orderExitChannel(app, e, NORTH);
  assert.equal(plannedExit(e), NORTH);
  assert.equal(plannedExit(other), NORTH, 'the order goes to the whole support group');
  assert.equal(other.routeHead, 11);
  orderSail(app, e);
  assert.equal(e.state, 'atSea');
  assert.equal(other.state, 'atSea');
  run(w, 6 * H);
  assert.ok(other.route.length > 0 && other.routeHead === other.route.length, 'the other group keeps its way out, behind its leader');
  assert.ok(distance(other.x, other.y, e.x, e.y) < 15);
  // Taken away for all of them.
  const b = liverpool();
  const g = newFormation(b.w, 'naval', 'eg1', 'Groupe B');
  addMember(b.w, g, 'eg3');
  orderExitChannel({ world: b.w }, b.e, 'roads');
  orderExitChannel({ world: b.w }, b.e, '');
  assert.equal(plannedExit(b.w.escorts.find((x) => x.id === 'eg3')), null);
});
