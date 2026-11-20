// Radio silence: what a ship on the high seas has been told and does not know yet. The line
// drawn or the legs typed wait for the relief of the watch; until then they stay on the
// table as the route worked on (a second line after the first, a point moved, another leg),
// and what the table shows is what the ship gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run, runTo } from './helpers.js';
import { project } from '../src/sim/geo.js';
import { orderChannel, pendingOrders, sendOrder, shownPosition } from '../src/sim/comms.js';
import { addLeg, planTrack, plannedLegs, removeLeg, updateLeg } from '../src/sim/orders.js';
import { awaited, awaitedLand, plannedPlan, workingRoute } from '../src/ui/awaited.js';
import {
  addTypedLeg, deletePoint, editingLegIndex, extendRoute, insertPoint, movePoint, orderRemoveLeg, shipOrder, startEditLeg,
} from '../src/ui/actions.js';
import { createCamera, toScreen } from '../src/render/camera.js';

const H = 3600;
const atlantic = (overrides = {}) => makeWorld('standard', overrides, 'hiver-atlantique');

/** HX 102 on the high seas at (lon, lat), sailing east in open water, no U-boat; and the page that orders it. */
function game(lon = -25, lat = 55, overrides = {}) {
  const w = atlantic(overrides);
  runTo(w, 6 * H + 60);
  const c = w.convoys.find((x) => x.type === 'ocean');
  const [x, y] = project(lon, lat);
  Object.assign(c, { x, y, px: x, py: y, route: [[x + 300, y], [x + 600, y]], routeLocked: 0, plan: [], est: null, fix: null });
  for (const u of w.uboats) Object.assign(u, { state: 'gone', goneAt: w.t });
  run(w, 600);
  const camera = Object.assign(createCamera(), { cx: c.x + 300, cy: c.y, scale: 0.5, width: 1200, height: 800 });
  return { w, c, app: { world: w, camera } };
}

const names = (w, u) => pendingOrders(w, u).map((s) => s.name);
const xy = (pts) => pts.map((p) => [Math.round(p[0]), Math.round(p[1])]);
const toRelief = (w) => run(w, 4 * H, (e) => e.type === 'orderDelivered' || e.type === 'orderFailed');

test('a line drawn for a ship on the high seas waits for the relief, and is the route worked on', () => {
  const { w, c, app } = game();
  assert.equal(orderChannel(w, c), 'radio');
  const own = c.route.map((p) => [...p]);
  assert.deepEqual(workingRoute(w, c), { points: c.route, pending: null, canExtend: true }, 'nothing waits: its own route');
  const line = [[c.x + 200, c.y - 80], [c.x + 500, c.y - 150]];
  assert.equal(shipOrder(app, c, 'route', line).via, 'radio');
  assert.deepEqual(c.route, own, 'the ship knows nothing yet');
  const wait = awaited(w, c);
  assert.equal(wait.route.name, 'route');
  assert.deepEqual(wait.route.points, line);
  assert.equal(wait.legs, null);
  const work = workingRoute(w, c);
  assert.deepEqual([work.pending, work.canExtend, work.points], ['route', true, line]);
  // At the relief it is the ship's, and nothing waits.
  const events = toRelief(w);
  assert.ok(events.some((e) => e.type === 'orderDelivered' && e.unitId === c.id));
  assert.deepEqual(xy(c.route), xy(line));
  assert.deepEqual(awaited(w, c), { route: null, legs: null });
});

test('a second line then a third are drawn on from its end; points are moved, added, taken away: one order waits', () => {
  const { w, c, app } = game();
  const cam = app.camera;
  shipOrder(app, c, 'route', [[c.x + 200, c.y - 80], [c.x + 500, c.y - 150]]);
  const drawOn = (...more) => {
    const last = workingRoute(w, c).points.at(-1);
    return extendRoute(app, c, [toScreen(cam, last[0], last[1]), ...more.map(([x, y]) => toScreen(cam, x, y))]);
  };
  assert.ok(drawOn([c.x + 560, c.y + 40], [c.x + 620, c.y + 160]), 'a second line from the end of the first');
  assert.equal(workingRoute(w, c).points.length, 4);
  assert.ok(drawOn([c.x + 700, c.y + 80]), 'and a third');
  assert.equal(workingRoute(w, c).points.length, 5);
  assert.ok(movePoint(app, c, 1, c.x + 480, c.y - 220));
  assert.ok(insertPoint(app, c, 1, c.x + 350, c.y - 160));
  assert.ok(deletePoint(app, c, 0));
  assert.deepEqual(names(w, c), ['route'], 'each change takes the place of the order that waited');
  const told = workingRoute(w, c).points.map((p) => [p[0], p[1]]);
  assert.equal(told.length, 5);
  assert.deepEqual(xy(told.slice(0, 2)), [[Math.round(c.x + 350), Math.round(c.y - 160)], [Math.round(c.x + 480), Math.round(c.y - 220)]]);
  assert.equal(c.route.length, 2, 'the ship still follows the route it has');
  toRelief(w);
  assert.deepEqual(xy(c.route), xy(told), 'what the table showed is what the ship got');
});

test('the last point of a line that has not left is taken away: the order is taken back', () => {
  const { w, c, app } = game();
  const own = c.route.map((p) => [...p]);
  shipOrder(app, c, 'route', [[c.x + 200, c.y - 80]]);
  assert.ok(deletePoint(app, c, 0));
  assert.deepEqual(names(w, c), []);
  assert.deepEqual(workingRoute(w, c).pending, null);
  toRelief(w);
  assert.deepEqual(xy(c.route.slice(-1)), xy(own.slice(-1)), 'it goes on as before');
});

test('two changes to its own route before the relief: the second builds on the first (it used to undo it)', () => {
  const { w, c, app } = game();
  assert.ok(movePoint(app, c, 0, c.x + 300, c.y + 150));
  assert.deepEqual(names(w, c), ['editRoute']);
  assert.equal(workingRoute(w, c).pending, 'editRoute');
  assert.ok(movePoint(app, c, 1, c.x + 600, c.y - 200));
  assert.deepEqual(names(w, c), ['editRoute']);
  const told = xy(workingRoute(w, c).points);
  assert.deepEqual(told, [[Math.round(c.x + 300), Math.round(c.y + 150)], [Math.round(c.x + 600), Math.round(c.y - 200)]], 'both moves are in the order that waits');
  toRelief(w);
  assert.deepEqual(xy(c.route), told);
});

test('legs typed for a ship on the high seas are listed as they will be, changed there, and are what it gets', () => {
  const { w, c, app } = game();
  assert.ok(addTypedLeg(app, c, '100', '30'));
  assert.ok(addTypedLeg(app, c, '45', '24'));
  assert.ok(addTypedLeg(app, c, '70', '36'));
  assert.deepEqual(c.plan, [], 'the ship knows nothing yet');
  assert.deepEqual(names(w, c), ['addLeg', 'addLeg', 'addLeg']);
  assert.deepEqual(plannedPlan(w, c).map((l) => [l.heading, l.end.s / H]), [[100, 30], [45, 24], [70, 36]]);
  // The second leg is changed (« Enregistrer »), the third taken away: both count from the list shown.
  startEditLeg(app, c, 1);
  assert.equal(editingLegIndex(app, c), 1, 'a leg on its way can be taken in hand');
  assert.ok(addTypedLeg(app, c, '50', '20'));
  orderRemoveLeg(app, c, 2);
  const told = awaited(w, c).legs.map((l) => [l.heading, l.end.s / H]);
  assert.deepEqual(told, [[100, 30], [50, 20]]);
  assert.equal(awaited(w, c).route, null);
  run(w, 4 * H, (e) => e.type === 'orderDelivered' && e.order === 'removeLeg');
  assert.deepEqual(c.plan.map((l) => [l.heading, l.end.s / H]), told, 'what the table showed is what the ship got');
  assert.equal(c.route.length, 0, 'it dropped its route to steer by its legs');
  assert.deepEqual(awaited(w, c), { route: null, legs: null });
  assert.equal(plannedPlan(w, c), c.plan);
});

test('plannedLegs tells what the leg orders will do, and touches nothing', () => {
  const a = game(-25, 55, { seaComms: 'direct' });
  const b = game(-25, 55, { seaComms: 'direct' });
  const first = { heading: 100, end: { kind: 'duration', s: 30 * H }, speedKn: null };
  const changes = [
    { name: 'addLeg', args: [first] },
    { name: 'addLeg', args: [{ heading: 45, end: { kind: 'duration', s: 24 * H }, speedKn: 6 }] },
    { name: 'addLeg', args: [{ heading: 70, end: null, speedKn: null }] },
    { name: 'addLeg', args: [{ heading: 80, end: { kind: 'duration', s: H }, speedKn: null }] }, // after a leg without end: refused
    { name: 'updateLeg', args: [1, { heading: 50, end: { kind: 'duration', s: 20 * H }, speedKn: null }] },
    { name: 'updateLeg', args: [9, first] }, // no such leg
    { name: 'removeLeg', args: [0] },
  ];
  const events = a.w.events.length;
  const planned = plannedLegs(a.w, a.c, changes);
  assert.deepEqual(a.c.plan, [], 'nothing touched');
  assert.equal(a.c.route.length, 2);
  assert.equal(a.w.events.length, events, 'and nothing said');
  // The same orders carried out, one by one.
  const apply = { addLeg: (leg) => addLeg(b.w, b.c, leg), updateLeg: (i, leg) => updateLeg(b.w, b.c, i, leg), removeLeg: (i) => removeLeg(b.w, b.c, i) };
  for (const ch of changes) apply[ch.name](...ch.args);
  assert.deepEqual(planned, b.c.plan);
  assert.deepEqual(planned.map((l) => l.heading), [50, 70]);
  assert.deepEqual(plannedLegs(a.w, a.c, [{ name: 'clearPlan', args: [] }], planned), []);
});

test('what an order would overwrite no longer waits: a line replaces the legs, a leg replaces the line', () => {
  const { w, c, app } = game();
  addTypedLeg(app, c, '100', '30');
  addTypedLeg(app, c, '45', '24');
  movePoint(app, c, 0, c.x + 400, c.y + 100);
  assert.deepEqual(names(w, c), ['addLeg', 'addLeg', 'editRoute']);
  shipOrder(app, c, 'route', [[c.x + 200, c.y - 80], [c.x + 500, c.y - 150]]);
  assert.deepEqual(names(w, c), ['route'], 'the line drawn from the ship is all that waits');
  assert.equal(awaited(w, c).legs, null);
  addTypedLeg(app, c, '90', '12');
  assert.deepEqual(names(w, c), ['addLeg'], 'a leg: the ship will drop the line to steer by it');
  const wait = awaited(w, c);
  assert.equal(wait.route, null);
  assert.deepEqual(wait.legs.map((l) => l.heading), [90]);
  // An order a group carries is handed over at another time: it is left alone.
  shipOrder(app, c, 'route', [[c.x + 200, c.y - 80]]);
  pendingOrders(w, c).find((s) => s.name === 'route').via = 'ship';
  addTypedLeg(app, c, '80', '6');
  assert.deepEqual(names(w, c), ['route', 'addLeg']);
});

test('an order carried out at once takes the place of the same order that still waited for the relief', () => {
  const { w, c, app } = game(-30, 55);
  runTo(w, Math.ceil(w.t / 86400) * 86400 + 7 * H); // 13:00: daylight for the lamp
  const old = [[c.x + 200, c.y - 300], [c.x + 600, c.y - 500]];
  assert.equal(shipOrder(app, c, 'route', old).via, 'radio');
  // One of our aircraft comes in sight: the next order goes by its lamp, at once.
  const s = w.squadrons.find((x) => x.role === 'coastal');
  Object.assign(s, { state: 'airborne', x: c.x + 8, y: c.y, px: c.x + 8, py: c.y, alt: 600, palt: 600, targetAlt: 600, orbit: true, fuel: 500, route: [], plan: [] });
  assert.equal(orderChannel(w, c), 'lamp');
  const now = [[c.x + 300, c.y + 200], [c.x + 900, c.y + 300]];
  const sent = shipOrder(app, c, 'route', now);
  assert.deepEqual([sent.via, sent.ok], ['lamp', true]);
  assert.deepEqual(xy(c.route), xy(now));
  assert.deepEqual(names(w, c), [], 'the line that waited is no longer on its way');
  const told = xy(c.route.slice(-1));
  run(w, 4 * H + 600);
  assert.deepEqual(xy(c.route.slice(-1)), told, 'the relief does not bring the old line back');
});

test('the track of legs can start where the table holds the ship, not where it is', () => {
  const { w, c } = game();
  const legs = plannedLegs(w, c, [{ name: 'addLeg', args: [{ heading: 90, end: { kind: 'duration', s: 10 * H }, speedKn: null }] }]);
  const own = planTrack(w, c, legs);
  assert.deepEqual([own[0].x, own[0].y], [c.x, c.y]);
  const from = { x: c.x - 40, y: c.y + 25, t: w.t };
  const shown = planTrack(w, c, legs, from);
  assert.deepEqual([shown[0].x, shown[0].y, shown[0].t], [from.x, from.y, from.t]);
  assert.ok(Math.abs((shown[1].x - shown[0].x) - (own[1].x - own[0].x)) < 2, 'the same leg, from another start');
});

test('seen from where the table holds the ship, a line or legs that touch land are told before they leave', () => {
  const { w, c, app } = game(-14, 55);
  assert.equal(awaitedLand(w, c), null, 'nothing waits');
  shipOrder(app, c, 'route', [[c.x + 150, c.y], [c.x + 300, c.y - 40]]);
  assert.equal(awaitedLand(w, c), null, 'open sea');
  // Across Ireland, to the Irish Sea.
  const [ix, iy] = project(-5.2, 53.6);
  shipOrder(app, c, 'route', [[ix, iy]]);
  const land = awaitedLand(w, c);
  assert.ok(land && w.terrain.isLand(land[0], land[1]), 'the place where it runs aground');
  const p = shownPosition(w, c);
  assert.ok(land[0] > p.x, 'east of the ship');
  // The order still leaves as it is: at the relief the ship refuses it, as before.
  const events = toRelief(w);
  assert.ok(events.some((e) => e.type === 'orderFailed' && e.unitId === c.id));
  // Legs: due east for four days, into Ireland.
  addTypedLeg(app, c, '90', '96');
  assert.ok(awaitedLand(w, c));
  sendOrder(w, c, 'clearPlan');
  assert.equal(awaitedLand(w, c), null, 'the legs taken back: nothing to run aground');
});
