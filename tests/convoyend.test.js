// The end of a convoy's route (2.10.5). Told nothing, a convoy ends as it always did: a line
// that passes by the entrance of a channel is taken into port by the game, another line ends
// in a stop, legs in a course kept. Told what to do — into a port by the channel chosen, its
// course kept, the Admiralty's route again, a stop — it follows its line or its legs to their
// end and does it there, and nothing by itself before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { data, makeWorld, run, runTo } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { distance, project } from '../src/sim/geo.js';
import {
  admiraltyAhead, admiraltyWay, approachFor, channelWay, convoyEndChoices, routeChannel, routeConvoy, setConvoyEndAction,
} from '../src/sim/convoy.js';
import { addLeg, clearPlan, setConvoySpeed } from '../src/sim/orders.js';
import { orderChannel, pendingOrders, sendOrder } from '../src/sim/comms.js';
import { setShipEndAction } from '../src/sim/naval.js';
import { restore, snapshot } from '../src/save/game.js';
import { addMobileRadar } from '../src/sim/mru.js';
import { inClosedWaters } from '../src/sim/uboatnav.js';
import { eventMessage } from '../src/ui/messages.js';
import { convoyEnd, convoyEndText, endPreview, endValue } from '../src/ui/convoyEnd.js';
import { addTypedLeg, orderAdmiraltyRoute, orderConvoyEnd, shipOrder } from '../src/ui/actions.js';

setDictionary(data.fr);

const H = 3600;
const NORTH = "Nord de l'Irlande";
const SOUTH = 'Canal Saint-Georges';
const LIVERPOOL_SOUTH = { kind: 'port', id: 'liverpool', via: SOUTH };
const LIVERPOOL_NORTH = { kind: 'port', id: 'liverpool', via: NORTH };
const CLYDE = { kind: 'port', id: 'clyde', via: NORTH };
const at = (lon, lat) => project(lon, lat);

/** HX 102 at sea at (lon, lat), nothing to follow, heading east; no U-boat. Orders reach it at once unless told otherwise. */
function sea(lon, lat, overrides = {}) {
  const w = makeWorld('standard', { seaComms: 'direct', ...overrides }, 'hiver-atlantique');
  runTo(w, 6 * H + 60);
  const c = w.convoys.find((x) => x.type === 'ocean');
  const [x, y] = at(lon, lat);
  Object.assign(c, { x, y, px: x, py: y, route: [], routeLocked: 0, destination: null, plan: [], legState: null, heading: 90, course: 90, est: null, fix: null });
  for (const u of w.uboats) Object.assign(u, { state: 'gone', goneAt: w.t });
  return { w, c };
}

/** Runs until the convoy has done what ends its route (or stopped). */
const toEnd = (w, hours = 40) => run(w, hours * H, (e) => e.type === 'convoyEndAction' || e.type === 'convoyWaiting');
const gateOf = (w, portId, name) => w.byId.port.get(portId).approaches.find((a) => a.name === name).points[0];
const through = (route, p) => route.some((q) => distance(q[0], q[1], p[0], p[1]) < 0.5);
const clearOfLand = (w, c) => !w.terrain.findLandOnRoute([[c.x, c.y], ...c.route], 0, w.rules.convoy.harbourMarginKm);
const xy = (pts) => pts.map((p) => [Math.round(p[0]), Math.round(p[1])]);

test('told nothing, a convoy ends as it always did: a line in a stop, legs in a course kept', () => {
  const { w, c } = sea(-14, 50);
  assert.ok(routeConvoy(w, c, [at(-13.6, 50.1)]).ok);
  assert.equal(c.endAction, null);
  const ev = toEnd(w);
  const stop = ev.find((e) => e.type === 'convoyWaiting');
  assert.ok(stop && !stop.after, 'it waits for orders');
  assert.equal(c.state, 'waiting');
  assert.ok(!ev.some((e) => e.type === 'convoyEndAction'));

  const b = sea(-14, 50);
  assert.ok(addLeg(b.w, b.c, { heading: 70, end: { kind: 'duration', s: 2 * H } }).ok);
  const ev2 = run(b.w, 3 * H);
  assert.equal(b.c.plan.length, 0);
  assert.equal(b.c.state, 'atSea');
  assert.ok(Math.abs(b.c.heading - 70) < 1, `still on ${b.c.heading}`);
  assert.ok(!ev2.some((e) => e.type === 'convoyEndAction' || e.type === 'convoyWaiting'));
});

test('the choices are those of its scenario: each port that takes it, by each of its channels', () => {
  const { w, c } = sea(-14, 50);
  assert.deepEqual(convoyEndChoices(w, c), [{ kind: 'stop' }, { kind: 'hold' }, LIVERPOOL_NORTH, LIVERPOOL_SOUTH, CLYDE, { kind: 'admiralty' }]);
  // Kanalkampf: the coastal convoy has the coastal port and its own Admiralty route; the
  // ocean convoys of the same scenario have theirs.
  const k = makeWorld('standard', {}, 'kanalkampf');
  const cw = k.convoys.find((x) => x.type === 'coastal');
  assert.deepEqual(convoyEndChoices(k, cw), [{ kind: 'stop' }, { kind: 'hold' }, { kind: 'port', id: 'southampton', via: 'Spithead' }, { kind: 'admiralty' }]);
  const hx = k.convoys.find((x) => x.type !== 'coastal');
  const ports = convoyEndChoices(k, hx).filter((a) => a.kind === 'port').map((a) => a.id);
  assert.deepEqual([...new Set(ports)], ['liverpool', 'clyde']);
  // No foreign port, and nothing that is not on the list.
  assert.ok(!convoyEndChoices(w, c).some((a) => a.id === 'halifax' || a.id === 'sydney'));
  assert.equal(setConvoyEndAction(k, cw, LIVERPOOL_SOUTH), false, 'Liverpool does not take a coastal convoy');
  assert.equal(setConvoyEndAction(w, c, { kind: 'port', id: 'liverpool' }), false, 'a port with channels is entered by one of them');
  assert.equal(setConvoyEndAction(w, c, { kind: 'port', id: 'liverpool', via: 'Spithead' }), false);
  assert.equal(setConvoyEndAction(w, c, { kind: 'hunt' }), false);
  assert.equal(setConvoyEndAction(w, c, null), false);
  assert.equal(cw.endAction, null);
  assert.equal(c.endAction, null);
});

test('« Garder le cap »: at the end of its line it sails on, on the course it had; told once', () => {
  const { w, c } = sea(-14, 50);
  const end = at(-13.6, 50.1);
  routeConvoy(w, c, [end]);
  assert.ok(setShipEndAction(w, c, { kind: 'hold' }), 'the order of the sheet, the same as a group\'s');
  assert.deepEqual(c.endAction, { kind: 'hold' });
  const told = toEnd(w).find((e) => e.type === 'convoyEndAction');
  assert.equal(told.action, 'hold');
  assert.equal(c.state, 'atSea');
  assert.equal(c.endAction, null, 'carried out: forgotten');
  run(w, 2 * H);
  assert.ok(distance(c.x, c.y, end[0], end[1]) > 20, 'it sails on');
  assert.ok(Math.abs(c.heading - told.heading) < 1.5);
  // Told once: the next line ends as lines do.
  routeConvoy(w, c, [[c.x + 20, c.y]]);
  const stop = toEnd(w).find((e) => e.type === 'convoyWaiting');
  assert.ok(stop && !stop.after);
  assert.equal(c.state, 'waiting');
});

test('« Entrer à Liverpool par : Canal Saint-Georges »: by sea to the entrance of that channel, up it, and it arrives', () => {
  const { w, c } = sea(-11, 50.5);
  assert.ok(routeConvoy(w, c, [at(-10.5, 50.6)]).ok);
  assert.equal(c.destination, null, 'a line in the open sea');
  assert.ok(setConvoyEndAction(w, c, LIVERPOOL_SOUTH));
  assert.equal(c.destination, null, 'nothing changes before the end of the line');
  const told = toEnd(w).find((e) => e.type === 'convoyEndAction');
  assert.deepEqual([told.action, told.port, told.channel], ['port', 'Liverpool', SOUTH]);
  const eta = (told.etaMs - w.startMs) / 1000;
  assert.equal(c.destination, 'liverpool');
  assert.equal(routeChannel(w, c), SOUTH);
  assert.ok(through(c.route, gateOf(w, 'liverpool', SOUTH)), 'by the entrance, where the pilot comes aboard');
  assert.ok(!through(c.route, gateOf(w, 'liverpool', NORTH)));
  assert.ok(clearOfLand(w, c));
  assert.equal(c.endAction, null);
  const arrived = run(w, 70 * H, (e) => e.type === 'convoyArrived' || e.type === 'convoyLost').find((e) => e.type === 'convoyArrived');
  assert.ok(arrived, 'it gets there');
  assert.equal(c.portId, 'liverpool');
  assert.ok(Math.abs(arrived.t - eta) < H, `at the hour forecast, within the hour (${Math.round((arrived.t - eta) / 60)} min off)`);
});

test('by the North Channel the port is the one chosen: Liverpool, or the Clyde', () => {
  for (const [action, port] of [[LIVERPOOL_NORTH, 'liverpool'], [CLYDE, 'clyde']]) {
    const { w, c } = sea(-15, 56.6);
    routeConvoy(w, c, [at(-14.5, 56.5)]);
    assert.ok(setConvoyEndAction(w, c, action));
    toEnd(w);
    assert.equal(c.destination, port);
    assert.equal(routeChannel(w, c), NORTH);
    assert.ok(through(c.route, gateOf(w, port, NORTH)));
    assert.ok(clearOfLand(w, c));
    const last = c.route[c.route.length - 1];
    const p = w.byId.port.get(port);
    assert.ok(distance(last[0], last[1], p.x, p.y) < 0.5, 'the route ends in the port');
  }
});

test('the entrance of a channel is reached from the open sea, not through the waters behind it', () => {
  const { w } = sea(-14, 50);
  const liverpool = w.byId.port.get('liverpool');
  const clyde = w.byId.port.get('clyde');
  const bySea = (way) => way.route.slice(0, way.route.length - way.locked);
  const open = (way) => bySea(way).every(([x, y]) => !inClosedWaters(w, x, y));
  // Off the North Channel, told Liverpool by St George's Channel: round the west of Ireland,
  // and not down the Irish Sea to the southern entrance, to go up it again.
  const south = channelWay(w, at(-8.45, 55.87), liverpool, SOUTH);
  assert.ok(through(south.route, gateOf(w, 'liverpool', SOUTH)));
  assert.ok(bySea(south).length >= 3, 'several points by sea');
  assert.ok(open(south), 'not through the Irish Sea');
  assert.ok(bySea(south).every(([x]) => x < at(-9.5, 53)[0]), 'west of Ireland');
  assert.ok(!w.terrain.findLandOnRoute([at(-8.45, 55.87), ...south.route], 0, w.rules.convoy.harbourMarginKm));
  // Off St George's Channel, told the Clyde by the North Channel: the same, northward.
  const north = channelWay(w, at(-7.4, 51.1), clyde, NORTH);
  assert.ok(through(north.route, gateOf(w, 'clyde', NORTH)) && open(north) && bySea(north).length >= 3);
  // From the ocean: straight to the entrance.
  assert.equal(channelWay(w, at(-12, 50.5), liverpool, SOUTH).route.length, liverpool.approaches.find((a) => a.name === SOUTH).points.length);
  // Already in the Irish Sea: the channel is joined where the convoy is, not from its entrance.
  const inside = channelWay(w, at(-5.3, 53.8), liverpool, SOUTH);
  assert.ok(!through(inside.route, gateOf(w, 'liverpool', SOUTH)));
  assert.ok(inside.km < 250, `${Math.round(inside.km)} km to Liverpool`);
  const last = inside.route.at(-1);
  assert.ok(distance(last[0], last[1], liverpool.x, liverpool.y) < 0.5);
});

test('« Reprendre la route de l\'Amirauté »: from the nearest point ahead, round the land if need be, into port', () => {
  const { w, c } = sea(-30, 52);
  const adm = c.admiraltyRoute;
  routeConvoy(w, c, [[c.x + 30, c.y]]);
  assert.ok(setConvoyEndAction(w, c, { kind: 'admiralty' }));
  const told = toEnd(w).find((e) => e.type === 'convoyEndAction');
  assert.equal(told.action, 'admiralty');
  const i = admiraltyAhead(c, adm);
  assert.deepEqual(xy([c.route[0]]), xy([adm[i]]), 'straight to the nearest point ahead');
  assert.equal(c.destination, 'liverpool');
  assert.equal(routeChannel(w, c), NORTH, 'the channel the Admiralty planned');
  // South of Ireland the nearest point ahead is in the Irish Sea, behind the land: by sea.
  const s = sea(-8.5, 50.8);
  const way = admiraltyWay(s.w, s.c);
  assert.ok(way && way.length > 2);
  assert.ok(!s.w.terrain.findLandOnRoute([[s.c.x, s.c.y], ...way], 0, s.w.rules.convoy.harbourMarginKm), 'no land on the way');
  routeConvoy(s.w, s.c, [[s.c.x + 15, s.c.y]]);
  setConvoyEndAction(s.w, s.c, { kind: 'admiralty' });
  const ev = toEnd(s.w);
  assert.ok(ev.some((e) => e.type === 'convoyEndAction' && e.action === 'admiralty'));
  assert.ok(!ev.some((e) => e.type === 'convoyRouteRejected'));
  assert.equal(s.c.destination, 'liverpool');
  assert.ok(clearOfLand(s.w, s.c));
});

test('« S\'arrêter et attendre » at the end of its legs, which told nothing would have ended in a course kept', () => {
  const { w, c } = sea(-14, 50);
  addLeg(w, c, { heading: 70, end: { kind: 'duration', s: 2 * H } });
  assert.ok(setConvoyEndAction(w, c, { kind: 'stop' }));
  const ev = toEnd(w, 4);
  const stop = ev.find((e) => e.type === 'convoyWaiting');
  assert.ok(stop && !stop.after);
  assert.equal(c.state, 'waiting');
  assert.equal(c.endAction, null);
  assert.ok(w.t - (6 * H + 60) >= 2 * H - 60, 'at the end of the legs, not before');
  const [x, y] = [c.x, c.y];
  run(w, H);
  assert.ok(distance(c.x, c.y, x, y) < 0.1, 'stopped');
});

test('with nothing left to follow, the order is carried out at once', () => {
  // Stopped at the end of a line: told to enter Liverpool, it sets off.
  const { w, c } = sea(-11, 50.5);
  routeConvoy(w, c, [[c.x + 10, c.y]]);
  toEnd(w);
  assert.equal(c.state, 'waiting');
  assert.ok(setConvoyEndAction(w, c, LIVERPOOL_SOUTH));
  assert.equal(c.state, 'atSea');
  assert.equal(c.destination, 'liverpool');
  assert.equal(c.endAction, null);
  // Keeping its course: told to stop, it stops.
  const b = sea(-14, 50);
  run(b.w, 600);
  assert.equal(b.c.state, 'atSea');
  assert.ok(setConvoyEndAction(b.w, b.c, { kind: 'stop' }));
  assert.equal(b.c.state, 'waiting');
  assert.equal(b.c.endAction, null);
  // Stopped: told to keep its course, it sails again on the heading it had.
  assert.ok(setConvoyEndAction(b.w, b.c, { kind: 'hold' }));
  assert.equal(b.c.state, 'atSea');
  const [x, y] = [b.c.x, b.c.y];
  run(b.w, H);
  assert.ok(distance(b.c.x, b.c.y, x, y) > 8);
});

test('the order goes with what it was the end of: legs erased, a line drawn into a port', () => {
  const { w, c } = sea(-14, 50);
  addLeg(w, c, { heading: 70, end: { kind: 'duration', s: 6 * H } });
  setConvoyEndAction(w, c, LIVERPOOL_SOUTH);
  run(w, 600);
  assert.deepEqual(c.endAction, LIVERPOOL_SOUTH, 'kept while there are legs');
  clearPlan(w, c);
  const ev = run(w, 600);
  assert.equal(c.endAction, null, 'the legs are gone, and their end with them');
  assert.equal(c.destination, null);
  assert.ok(!ev.some((e) => e.type === 'convoyEndAction'), 'it is not carried out behind the player\'s back');
  // A line replaced by legs, legs by a line: there is still an end to come, the order stays.
  const b = sea(-14, 50);
  routeConvoy(b.w, b.c, [at(-13.6, 50.1)]);
  setConvoyEndAction(b.w, b.c, { kind: 'hold' });
  addLeg(b.w, b.c, { heading: 70, end: { kind: 'duration', s: 2 * H } });
  run(b.w, 60);
  assert.deepEqual(b.c.endAction, { kind: 'hold' });
  routeConvoy(b.w, b.c, [[b.c.x + 25, b.c.y]]);
  assert.deepEqual(b.c.endAction, { kind: 'hold' });
  // A line that ends in a port goes in: there is no "after", the order is dropped.
  const k = makeWorld('standard', {}, 'kanalkampf');
  const cw = k.convoys.find((x) => x.type === 'coastal');
  routeConvoy(k, cw, cw.admiraltyRoute.slice(1, 5));
  assert.ok(setConvoyEndAction(k, cw, { kind: 'hold' }));
  assert.ok(routeConvoy(k, cw, cw.admiraltyRoute.slice(1)).ok, 'the whole run to Southampton');
  assert.equal(cw.destination, 'southampton');
  assert.equal(cw.endAction, null);
  assert.equal(cw.routeLocked, 6, 'by the charted channel, as without the order');
  // Sent into a port by the order of the groups (no button gives it to a convoy, but the
  // signals carry it): the same. The random orders found this one.
  const h = sea(-14, 50);
  routeConvoy(h.w, h.c, [at(-13.6, 50.1)]);
  setConvoyEndAction(h.w, h.c, { kind: 'hold' });
  assert.ok(sendOrder(h.w, h.c, 'home', 'clyde').ok);
  assert.equal(h.c.destination, 'clyde');
  assert.equal(h.c.endAction, null);
});

test('a line the game took into port can be told to end otherwise: the line stays, the way in goes', () => {
  // A line that ends at the entrance of the North Channel: the game takes it to the Clyde
  // (the port nearest the end of the line), as it always did.
  const drawn = () => {
    const g = sea(-12, 56.4);
    assert.ok(routeConvoy(g.w, g.c, [at(-9.5, 56.2), at(-8.4, 56.1)]).ok);
    assert.equal(g.c.destination, 'clyde');
    assert.equal(routeChannel(g.w, g.c), NORTH);
    return g;
  };
  // Told the very port and channel it was going to: nothing changes.
  const same = drawn();
  const before = xy(same.c.route);
  assert.ok(setConvoyEndAction(same.w, same.c, CLYDE));
  assert.deepEqual(xy(same.c.route), before);
  assert.equal(same.c.destination, 'clyde');
  assert.equal(same.c.endAction, null);
  // Told Liverpool by the same channel: the line is the player's again, and ends as told.
  const { w, c } = drawn();
  const version = c.routeVersion;
  run(w, 1);
  assert.ok(setConvoyEndAction(w, c, LIVERPOOL_NORTH));
  // The journal had said « route accepted to the Clyde »: it says what the route ends in now.
  const said = run(w, 1).filter((e) => e.type === 'convoyRouted');
  assert.equal(said.length, 1);
  assert.deepEqual([said[0].destination, said[0].then], [null, LIVERPOOL_NORTH]);
  assert.match(eventMessage(w, said[0]).text, /En fin de tracé : « Entrer à Liverpool par : Nord de l'Irlande »/);
  assert.equal(c.destination, null);
  assert.equal(c.routeLocked, 0);
  assert.equal(c.route.length, 2, 'the two points drawn');
  assert.deepEqual(xy(c.route.slice(-1)), xy([at(-8.4, 56.1)]));
  assert.equal(c.routeVersion, version + 1, 'a new routing');
  assert.deepEqual(c.endAction, LIVERPOOL_NORTH);
  toEnd(w);
  assert.equal(c.destination, 'liverpool');
  assert.equal(routeChannel(w, c), NORTH);
  // Told to stop: it stops at the end of the line drawn.
  const s = drawn();
  assert.ok(setConvoyEndAction(s.w, s.c, { kind: 'stop' }));
  const stop = toEnd(s.w).find((e) => e.type === 'convoyWaiting');
  assert.ok(stop && !stop.after);
  const [ex, ey] = at(-8.4, 56.1);
  assert.ok(distance(s.c.x, s.c.y, ex, ey) < 1, 'at the last point drawn');
});

test('told how its route ends, a convoy is not taken into port by the game: neither its line, nor by the pilot', () => {
  // A new line through the entrance of the channel: as drawn.
  const { w, c } = sea(-12, 56.4);
  routeConvoy(w, c, [[c.x + 40, c.y]]);
  setConvoyEndAction(w, c, { kind: 'hold' });
  assert.ok(routeConvoy(w, c, [at(-9.5, 56.2), at(-8.4, 56.1)]).ok);
  assert.equal(c.destination, null);
  assert.equal(c.route.length, 2);
  assert.deepEqual(c.endAction, { kind: 'hold' });
  // Legs through the pilot's station of St George's Channel. Told nothing: the pilot boards.
  const legs = (action) => {
    const g = sea(-8.2, 51.15);
    addLeg(g.w, g.c, { heading: 85, end: { kind: 'duration', s: 6 * H } });
    if (action) assert.ok(setConvoyEndAction(g.w, g.c, action));
    const ev = run(g.w, 7 * H, (e) => e.type === 'convoyWaiting');
    return { ...g, ev };
  };
  const free = legs(null);
  assert.ok(free.ev.some((e) => e.type === 'pilotAboard'));
  assert.equal(free.c.destination, 'liverpool');
  // Told to stop at the end of its legs: it goes on to that end, through the station.
  const told = legs({ kind: 'stop' });
  assert.ok(!told.ev.some((e) => e.type === 'pilotAboard'));
  assert.equal(told.c.destination, null);
  assert.equal(told.c.state, 'waiting');
  assert.ok(told.w.t - (6 * H + 60) >= 6 * H - 60, 'at the end of its legs');
  // In the channel, the pilot aboard, it is too late to choose.
  const route = xy(free.c.route);
  assert.equal(setConvoyEndAction(free.w, free.c, { kind: 'stop' }), false);
  assert.deepEqual(xy(free.c.route), route);
  assert.equal(free.c.endAction, null);
});

test('where there is no way by sea, it waits and says what it could not do', () => {
  for (const action of [LIVERPOOL_SOUTH, { kind: 'admiralty' }]) {
    const { w, c } = sea(34, 43); // the Black Sea: waters of the map with no way out
    assert.equal(channelWay(w, [c.x, c.y], w.byId.port.get('liverpool'), SOUTH), null);
    assert.ok(routeConvoy(w, c, [[c.x + 15, c.y]]).ok);
    assert.ok(setConvoyEndAction(w, c, action));
    const ev = toEnd(w);
    const stop = ev.find((e) => e.type === 'convoyWaiting');
    assert.equal(stop.after, action.kind);
    assert.equal(c.state, 'waiting');
    assert.equal(c.endAction, null);
    assert.ok(!ev.some((e) => e.type === 'convoyEndAction'));
    const said = eventMessage(w, stop);
    assert.match(said.text, /ne peut pas être exécuté/);
  }
});

test('a ship that falls behind is told what its convoy was told', () => {
  const { w, c } = sea(-30, 52);
  // (Driven at its best speed, where the slow ships drop out; and for the trial, at once.)
  w.rules = structuredClone(w.rules);
  w.rules.asw.stragglerPerHour = 1000;
  setConvoySpeed(w, c, c.speedKn);
  routeConvoy(w, c, [[c.x + 400, c.y]]);
  setConvoyEndAction(w, c, LIVERPOOL_SOUTH);
  const ev = run(w, 6 * H, (e) => e.type === 'straggler');
  const fell = ev.find((e) => e.type === 'straggler');
  assert.ok(fell, 'a straggler');
  const s = w.convoys.find((x) => x.straggler && x.parentId === c.id);
  assert.deepEqual(s.endAction, LIVERPOOL_SOUTH);
  assert.notEqual(s.endAction, c.endAction, 'its own copy');
  assert.ok(convoyEndChoices(w, s).some((a) => a.kind === 'admiralty'), 'and its convoy\'s Admiralty route to take again');
});

test('the order is kept in a save, and carried out the same after it', () => {
  const play = (saved) => {
    const g = sea(-11, 50.5);
    routeConvoy(g.w, g.c, [at(-10.5, 50.6)]);
    setConvoyEndAction(g.w, g.c, LIVERPOOL_SOUTH);
    run(g.w, 600);
    let w = g.w;
    if (saved) {
      const snap = JSON.parse(JSON.stringify(snapshot(g.w)));
      w = makeWorld('standard', { seaComms: 'direct' }, 'hiver-atlantique');
      restore(w, snap);
    }
    const c = w.convoys.find((x) => x.id === g.c.id);
    assert.deepEqual(c.endAction, LIVERPOOL_SOUTH);
    const told = toEnd(w).find((e) => e.type === 'convoyEndAction');
    return { t: told.t, route: xy(c.route), destination: c.destination };
  };
  assert.deepEqual(play(true), play(false));
});

test('a game saved before 2.10.5 has no end order: its convoys go on as they did, and can be told one', () => {
  const file = new URL('./fixtures/save-2.9.0-hiver-atlantique.json.gz', import.meta.url); // a real game of 2.9.0, convoys at sea
  const saved = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  assert.ok(saved.snap.convoys.length > 0 && saved.snap.convoys.every((c) => !('endAction' in c) && !('routeEnded' in c)), 'written without the fields');
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  restore(w, saved.snap, addMobileRadar);
  for (const c of w.convoys) assert.deepEqual([c.endAction, c.routeEnded], [null, false], c.id);
  const c = w.convoys.find((x) => x.state === 'atSea' && x.destination && x.route.length > x.routeLocked);
  assert.ok(c, 'a convoy at sea on the Admiralty\'s route');
  const before = { destination: c.destination, route: c.route.length };
  run(w, 600);
  assert.deepEqual({ destination: c.destination, route: c.route.length }, before, 'as it was saved');
  assert.deepEqual(convoyEnd(w, c).current, { kind: 'port', id: c.destination, via: routeChannel(w, c) });
  assert.ok(setConvoyEndAction(w, c, { kind: 'stop' }));
  assert.equal(c.destination, null);
  assert.deepEqual(c.endAction, { kind: 'stop' });
});

// ---- under radio silence ---------------------------------------------------------------

const names = (w, u) => pendingOrders(w, u).map((s) => s.name);
const toRelief = (w) => run(w, 4 * H, (e) => e.type === 'orderDelivered' || e.type === 'orderFailed');
// A line that passes the entrance of the North Channel and goes on: told nothing, the game
// cuts it there and takes the convoy to the Clyde.
const PAST_THE_GATE = [at(-12, 56.2), at(-8.6, 56.05), at(-7.0, 55.6)];

test('by radio the order waits for the relief; with a line given in the same watch, the line is followed as drawn, then the order', () => {
  const silent = () => {
    const g = sea(-25, 55, { seaComms: 'silence' });
    g.c.route = [[g.c.x + 4000, g.c.y]];
    run(g.w, 600);
    assert.equal(orderChannel(g.w, g.c), 'radio');
    return g;
  };
  // Told nothing: the game takes the line into the Clyde.
  const plain = silent();
  sendOrder(plain.w, plain.c, 'route', PAST_THE_GATE);
  toRelief(plain.w);
  assert.equal(plain.c.destination, 'clyde');
  // The line, then the order.
  const a = silent();
  assert.equal(sendOrder(a.w, a.c, 'route', PAST_THE_GATE).via, 'radio');
  assert.equal(sendOrder(a.w, a.c, 'endAction', { kind: 'stop' }).via, 'radio');
  assert.equal(a.c.endAction, null, 'the convoy knows nothing yet');
  assert.deepEqual(names(a.w, a.c), ['route', 'endAction']);
  // The order, then the line: it is read after the line all the same.
  const b = silent();
  sendOrder(b.w, b.c, 'endAction', { kind: 'stop' });
  sendOrder(b.w, b.c, 'route', PAST_THE_GATE);
  assert.deepEqual(names(b.w, b.c), ['route', 'endAction']);
  for (const g of [a, b]) {
    const got = toRelief(g.w);
    assert.equal(got.filter((e) => e.type === 'orderDelivered').length, 2);
    assert.equal(g.c.destination, null, 'not taken into port by the game');
    assert.deepEqual(xy(g.c.route), xy(PAST_THE_GATE), 'the whole line, as drawn');
    assert.deepEqual(g.c.endAction, { kind: 'stop' });
  }
  assert.deepEqual(xy(a.c.route), xy(b.c.route));
  // A second choice takes the place of the first one waiting.
  const d = silent();
  sendOrder(d.w, d.c, 'endAction', { kind: 'hold' });
  sendOrder(d.w, d.c, 'endAction', LIVERPOOL_NORTH);
  assert.deepEqual(pendingOrders(d.w, d.c).map((s) => s.args[0]), [LIVERPOOL_NORTH]);
});

test('by radio, a convoy that waits at sea is told at the relief, and does it then', () => {
  const { w, c } = sea(-25, 55, { seaComms: 'silence' });
  c.state = 'waiting';
  run(w, 600);
  assert.equal(sendOrder(w, c, 'endAction', { kind: 'hold' }).via, 'radio');
  run(w, 60);
  assert.equal(c.state, 'waiting');
  const ev = toRelief(w);
  assert.ok(ev.some((e) => e.type === 'orderDelivered' && e.order === 'endAction'));
  assert.ok(ev.some((e) => e.type === 'convoyEndAction' && e.action === 'hold'));
  assert.equal(c.state, 'atSea');
  assert.equal(c.endAction, null);
});

test('the way it takes at the end is a new routing: read by the B-Dienst unless the order came by lamp', () => {
  /** A patrol aircraft in the air at `km` east of a ship. */
  const aircraftNear = (w, u, km) => {
    const s = w.squadrons.find((x) => x.role === 'coastal');
    Object.assign(s, { state: 'airborne', x: u.x + km, y: u.y, px: u.x + km, py: u.y, alt: 600, palt: 600, targetAlt: 600, orbit: true, fuel: 500, route: [], plan: [] });
    return s;
  };
  const told = (lamp) => {
    const g = sea(-25, 55, { seaComms: 'silence' });
    runTo(g.w, 13 * H); // daylight for the lamp
    routeConvoy(g.w, g.c, [[g.c.x + 100, g.c.y]]); // (a line it will end after the next relief)
    if (lamp) aircraftNear(g.w, g.c, 8);
    const res = sendOrder(g.w, g.c, 'endAction', { kind: 'admiralty' });
    if (lamp) g.w.squadrons.find((s) => s.state === 'airborne').state = 'ready';
    const version = g.c.routeVersion;
    const done = run(g.w, 12 * H, (e) => e.type === 'convoyEndAction');
    assert.ok(done.some((e) => e.type === 'convoyEndAction' && e.action === 'admiralty'));
    assert.equal(g.c.routeVersion, version + 1, 'a new routing');
    return { ...g, res };
  };
  const radio = told(false);
  assert.equal(radio.res.via, 'radio');
  assert.notEqual(radio.c.quietRoute, radio.c.routeVersion, 'on the air: the B-Dienst may read it');
  const lamp = told(true);
  assert.equal(lamp.res.via, 'lamp');
  assert.equal(lamp.c.quietRoute, lamp.c.routeVersion, 'by lamp: nothing to read');
});

// ---- the sheet, the map, the journal ---------------------------------------------------

test('the sheet: what the convoy does by itself is the choice shown, and every other is offered', () => {
  // On the Admiralty's route: into Liverpool by the North Channel.
  const adm = sea(-30, 54);
  routeConvoy(adm.w, adm.c, adm.c.admiraltyRoute.slice(5));
  let e = convoyEnd(adm.w, adm.c);
  assert.equal(e.mode, 'choose');
  assert.equal(e.after, 'route');
  assert.deepEqual(e.current, LIVERPOOL_NORTH);
  assert.equal(e.auto, true);
  assert.deepEqual(e.choices.map(endValue), ['stop', 'hold', `port:liverpool:${NORTH}`, `port:liverpool:${SOUTH}`, `port:clyde:${NORTH}`, 'admiralty']);
  assert.equal(endPreview(adm.w, adm.c), null, 'its route says it all');
  // A line in the open sea: a stop. Legs: the course kept.
  const { w, c } = sea(-11, 50.5);
  routeConvoy(w, c, [at(-10.5, 50.6)]);
  e = convoyEnd(w, c);
  assert.deepEqual([e.after, e.current, e.auto], ['route', { kind: 'stop' }, true]);
  const legs = sea(-14, 50);
  addLeg(legs.w, legs.c, { heading: 70, end: { kind: 'duration', s: 2 * H } });
  e = convoyEnd(legs.w, legs.c);
  assert.deepEqual([e.after, e.current, e.auto], ['legs', { kind: 'hold' }, true]);
  // The order of the sheet, as its list gives it.
  const app = { world: w };
  orderConvoyEnd(app, c, `port:liverpool:${SOUTH}`);
  assert.deepEqual(c.endAction, LIVERPOOL_SOUTH);
  e = convoyEnd(w, c);
  assert.deepEqual([e.current, e.auto], [LIVERPOOL_SOUTH, false]);
  assert.equal(convoyEndText(w, e.current), 'Entrer à Liverpool par : Canal Saint-Georges');
  // The map: from the end of the line to the port, by the entrance of the channel.
  const p = endPreview(w, c);
  assert.deepEqual(xy([p.from]), xy([at(-10.5, 50.6)]));
  assert.ok(through(p.points, gateOf(w, 'liverpool', SOUTH)));
  const port = w.byId.port.get('liverpool');
  assert.ok(distance(...p.points[p.points.length - 1], port.x, port.y) < 0.5);
  orderConvoyEnd(app, c, 'hold');
  assert.deepEqual(c.endAction, { kind: 'hold' });
  assert.deepEqual(endPreview(w, c).points, null, 'a course kept: a word on the map, no way to draw');
  // With nothing to follow: an order for now, and what it does already is not on the list.
  const idle = sea(-14, 50);
  run(idle.w, 60);
  e = convoyEnd(idle.w, idle.c);
  assert.deepEqual([e.after, e.current], ['now', null]);
  assert.ok(!e.choices.some((a) => a.kind === 'hold') && e.choices.some((a) => a.kind === 'stop'));
  idle.c.state = 'waiting';
  e = convoyEnd(idle.w, idle.c);
  assert.ok(e.choices.some((a) => a.kind === 'hold') && !e.choices.some((a) => a.kind === 'stop'));
  // In the channel, the pilot aboard: nothing left to choose.
  const piloted = sea(-8.2, 51.15);
  addLeg(piloted.w, piloted.c, { heading: 85, end: { kind: 'duration', s: 6 * H } });
  run(piloted.w, 5 * H, (ev) => ev.type === 'pilotAboard');
  assert.deepEqual(convoyEnd(piloted.w, piloted.c), { mode: 'port', port: 'Liverpool', channel: SOUTH });
  // In port with nothing prepared, or arrived: nothing to say.
  const k = makeWorld('standard', {}, 'kanalkampf');
  const cw = k.convoys.find((x) => x.type === 'coastal');
  assert.equal(convoyEnd(k, cw), null);
  addLeg(k, cw, { heading: 90, end: { kind: 'duration', s: H } });
  assert.equal(convoyEnd(k, cw).after, 'legs', 'legs prepared in port: their end can be chosen before sailing');
});

test('the sheet under radio silence: the choice on its way is the one shown, and a line on its way gets its own end', () => {
  const { w, c } = sea(-25, 55, { seaComms: 'silence' });
  c.route = [[c.x + 4000, c.y]];
  run(w, 600);
  const app = { world: w };
  // A line that waits for the relief: what the game will do with it, told nothing.
  shipOrder(app, c, 'route', PAST_THE_GATE);
  let e = convoyEnd(w, c);
  assert.deepEqual([e.after, e.current, e.auto, e.waiting], ['route', CLYDE, true, null]);
  assert.deepEqual(approachFor(w, c, [c.est.x, c.est.y], PAST_THE_GATE).port.id, 'clyde');
  orderConvoyEnd(app, c, `port:liverpool:${NORTH}`);
  e = convoyEnd(w, c);
  assert.deepEqual(e.waiting, LIVERPOOL_NORTH);
  assert.equal(c.endAction, null);
  const p = endPreview(w, c);
  assert.equal(p.waiting, true);
  assert.deepEqual(xy([p.from]), xy(PAST_THE_GATE.slice(-1)), 'from the end of the line on its way');
  assert.deepEqual(p.action, LIVERPOOL_NORTH);
  toRelief(w);
  assert.deepEqual(xy(c.route), xy(PAST_THE_GATE));
  assert.deepEqual(c.endAction, LIVERPOOL_NORTH);
  e = convoyEnd(w, c);
  assert.deepEqual([e.current, e.auto, e.waiting], [LIVERPOOL_NORTH, false, null]);
  // Legs on their way take the place of its route at the relief: the end shown is theirs.
  const g = sea(-25, 55, { seaComms: 'silence' });
  g.c.route = [[g.c.x + 4000, g.c.y]];
  run(g.w, 600);
  assert.equal(convoyEnd(g.w, g.c).after, 'route');
  assert.ok(addTypedLeg({ world: g.w }, g.c, '80', '10'));
  e = convoyEnd(g.w, g.c);
  assert.deepEqual([e.after, e.current, e.auto], ['legs', { kind: 'hold' }, true]);
  orderConvoyEnd({ world: g.w }, g.c, 'stop');
  const far = endPreview(g.w, g.c);
  assert.deepEqual(far.action, { kind: 'stop' });
  assert.ok(distance(far.from[0], far.from[1], g.c.est.x, g.c.est.y) > 100, 'at the end of the legs to be, ten hours on');
  toRelief(g.w);
  assert.equal(g.c.plan.length, 1);
  assert.deepEqual(g.c.endAction, { kind: 'stop' });
});

test('the journal says what the convoy does at the end of its route, and what a line accepted will end in', () => {
  const { w, c } = sea(-11, 50.5);
  const say = (e) => eventMessage(w, { t: w.t, convoy: c.name, convoyId: c.id, unitKind: 'convoy', ...e }).text;
  assert.match(say({ type: 'convoyEndAction', action: 'hold', heading: 72 }), /garde le cap 072/);
  assert.match(say({ type: 'convoyEndAction', action: 'port', port: 'Liverpool', channel: SOUTH, etaMs: w.startMs + 5 * 86400000 }),
    /vers Liverpool par l'entrée du chenal \(Canal Saint-Georges\), arrivée prévue le 15 janvier à \d\d:\d\d\.$/);
  assert.match(say({ type: 'convoyEndAction', action: 'port', port: 'Douvres', channel: '', etaMs: w.startMs }), /fait route vers Douvres, arrivée prévue le /);
  assert.match(say({ type: 'convoyEndAction', action: 'admiralty' }), /reprend la route de l'Amirauté/);
  assert.equal(say({ type: 'convoyWaiting' }), `Convoi ${c.name} en attente d'ordres en mer.`);
  // A line accepted with an end of its own says so, in the words of the sheet.
  setConvoyEndAction(w, c, { kind: 'hold' }); // (nothing to follow: carried out at once)
  routeConvoy(w, c, [[c.x + 40, c.y]]);
  setConvoyEndAction(w, c, LIVERPOOL_SOUTH);
  run(w, 1);
  const routed = [];
  routeConvoy(w, c, [at(-10.5, 50.6)]);
  routed.push(...run(w, 1).filter((e) => e.type === 'convoyRouted'));
  assert.equal(routed.length, 1);
  assert.deepEqual(routed[0].then, LIVERPOOL_SOUTH);
  assert.match(eventMessage(w, routed[0]).text, /En fin de tracé : « Entrer à Liverpool par : Canal Saint-Georges »/);
});

// ---- the coastal convoy, and the way in the game works out itself ----------------------

test('the game takes a line into port only where the way to the entrance is by sea (lines of the coastal convoy were refused for it)', () => {
  const coastal = () => {
    const k = makeWorld('standard', {}, 'kanalkampf');
    return { k, cw: k.convoys.find((x) => x.type === 'coastal') };
  };
  // Out of the Thames and round the North Foreland, to stop off Dover or off Dungeness:
  // Spithead is less than 160 km away as the crow flies, across Kent and Sussex. Until
  // 2.10.4 such a line was cut and sent straight there, and refused for the land.
  for (const n of [3, 4, 5, 6]) {
    const { k, cw } = coastal();
    const line = cw.admiraltyRoute.slice(1, n);
    const res = routeConvoy(k, cw, line);
    assert.ok(res.ok, `a line of ${n - 1} points along the Admiralty's own route`);
    assert.equal(cw.destination, null);
    assert.deepEqual(xy(cw.route), xy(line), 'as drawn');
    assert.ok(!run(k, 1).some((e) => e.type === 'convoyRouteRejected'));
  }
  // Round Beachy Head the way to the entrance is clear: taken in, as before.
  const { k, cw } = coastal();
  assert.ok(routeConvoy(k, cw, cw.admiraltyRoute.slice(1, 7)).ok);
  assert.equal(cw.destination, 'southampton');
  assert.equal(routeChannel(k, cw), 'Spithead');
  // A line that crosses the land itself is still refused.
  const bad = coastal();
  const res = routeConvoy(bad.k, bad.cw, [at(0.9, 51.0)]);
  assert.deepEqual([res.ok, res.reason], [false, 'land']);
});

test('the coastal convoy: « Entrer à Southampton par : Spithead » from a line that stops off Dover, round the land by sea', () => {
  const k = makeWorld('standard', {}, 'kanalkampf');
  const cw = k.convoys.find((x) => x.type === 'coastal');
  const line = cw.admiraltyRoute.slice(1, 5);
  assert.ok(routeConvoy(k, cw, line).ok);
  let e = convoyEnd(k, cw);
  assert.deepEqual([e.after, e.current], ['route', { kind: 'stop' }]);
  assert.deepEqual(e.choices.map((a) => convoyEndText(k, a)), ["S'arrêter et attendre", 'Garder le cap', 'Entrer à Southampton par : Spithead', "Reprendre la route de l'Amirauté"]);
  assert.ok(setConvoyEndAction(k, cw, { kind: 'port', id: 'southampton', via: 'Spithead' }));
  const told = run(k, 24 * H, (ev) => ev.type === 'convoyEndAction' || ev.type === 'convoyLost').find((ev) => ev.type === 'convoyEndAction');
  assert.deepEqual([told.action, told.port, told.channel], ['port', 'Southampton', 'Spithead']);
  assert.equal(cw.destination, 'southampton');
  assert.ok(through(cw.route, gateOf(k, 'southampton', 'Spithead')));
  assert.ok(cw.route.length > cw.routeLocked, 'a point or more by sea before the channel: round Beachy Head');
  assert.ok(!k.terrain.findLandOnRoute([[cw.x, cw.y], ...cw.route], 0, k.rules.convoy.harbourMarginKm, 1), 'no land on the way');
  e = convoyEnd(k, cw);
  assert.deepEqual([e.current, e.auto], [{ kind: 'port', id: 'southampton', via: 'Spithead' }, true]);
  // The Admiralty's button uses the same nearest point ahead as the end order.
  const b = makeWorld('standard', {}, 'kanalkampf');
  const c2 = b.convoys.find((x) => x.type === 'coastal');
  orderAdmiraltyRoute({ world: b }, c2);
  assert.equal(c2.destination, 'southampton');
});
