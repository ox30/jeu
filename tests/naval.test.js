import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, project, unproject } from '../src/sim/geo.js';
import { engage, startHunt, stopHunt } from '../src/sim/asw.js';
import {
  escortHome, huntPlot, joinConvoy, routeConvoy, setEscortBehaviour,
} from '../src/sim/orders.js';
import { homeRoute, portChoices, setShipEndAction, shipEndChoices } from '../src/sim/naval.js';
import { seaPath } from '../src/sim/searoute.js';
import { restore, snapshot } from '../src/save/game.js';
import { makeKanalkampf, run } from './helpers.js';

const H = 3600;

/** EG 2 at sea, at a given place (lon, lat). */
function groupAt(world, id, lon, lat) {
  const e = world.escorts.find((x) => x.id === id);
  const [x, y] = project(lon, lat);
  e.state = 'atSea';
  e.x = x;
  e.y = y;
  e.route = [];
  e.plan = [];
  return e;
}

function onLand(world, path, from) {
  return world.terrain.findLandOnRoute([from, ...path], 0, 0, 1);
}

test('sea routes go round the land: west of Ireland to Liverpool Bay, by the North Channel', () => {
  const w = makeKanalkampf();
  const from = project(-11, 53.5);
  const path = seaPath(w, from, project(-3.9, 53.6));
  assert.ok(path && path.length > 1, 'not a straight line');
  assert.equal(onLand(w, path, from), null, 'never over land');
  const [lon, lat] = unproject(...path[1]);
  assert.ok(lat > 54.5 && lon > -8.5, 'round the north of Ireland');
});

test('home from the North Channel: up the Clyde channel from where it is, not back by the north of Ireland', () => {
  const w = makeKanalkampf();
  const e = groupAt(w, 'eg2', -5.9, 55.15);
  const clyde = w.byId.port.get('clyde');
  const way = homeRoute(w, e, clyde);
  assert.ok(way);
  const gate = w.byId.port.get('clyde').approaches[0].points[0];
  assert.ok(way.route.every(([x, y]) => Math.hypot(x - gate[0], y - gate[1]) > 60), 'never back to the channel entrance');
  assert.ok(way.km < 150, `short (${Math.round(way.km)} km)`);
  const choices = portChoices(w, e).map((c) => c.port.id);
  assert.deepEqual(choices.slice(0, 2), ['clyde', 'liverpool'], 'nearest by sea first');
  assert.ok(escortHome(w, e, 'liverpool'));
  assert.equal(e.destination, 'liverpool');
  assert.equal(onLand(w, e.route.slice(0, e.route.length - 1), [e.x, e.y]), null);
  run(w, 30 * H, (ev) => ev.type === 'escortInPort');
  assert.equal(e.state, 'refit');
  assert.equal(e.portId, 'liverpool');
});

// Until 2.7 the player set how many hours a hunt lasted. Since the depth charges (2.8, I3) a
// hunt ends by itself: the way to the plot and a search there, unless a contact is held.
test('a hunt lasts the way to the plot and a search there, any order ends it, and "stop" sends the group back to its convoy', () => {
  const w = makeKanalkampf();
  const hx = w.convoys.find((c) => c.id === 'hx55');
  const e = groupAt(w, 'eg1', 0, 0);
  e.x = hx.x + 5;
  e.y = hx.y;
  e.state = 'escorting';
  e.escorting = hx.id;
  startHunt(w, e, hx.x + 30, hx.y);
  assert.equal(e.state, 'hunting');
  const wayS = distance(e.x, e.y, hx.x + 30, hx.y) / e.speed;
  assert.ok(Math.abs(e.huntUntil - w.t - (wayS * 1.5 + w.rules.asw.engagement.searchS)) < 1, 'the way there with a margin, then the search');
  assert.ok(e.huntUntil - w.t < 3 * H, 'no more the three hours of a hunt by the clock');
  assert.ok(stopHunt(w, e));
  assert.equal(e.state, 'atSea');
  assert.equal(e.joinTarget, hx.id, 'back to its convoy');
  // Hunting again: "Rejoindre" and "Rentrer" are obeyed at once.
  startHunt(w, e, hx.x + 30, hx.y);
  assert.ok(joinConvoy(w, e, hx.id));
  assert.equal(e.state, 'atSea');
  startHunt(w, e, hx.x + 30, hx.y);
  assert.ok(escortHome(w, e));
  assert.ok(e.homeward && e.destination);
  // Told to stay while hunting: back to the convoy.
  e.huntFor = hx.id;
  startHunt(w, e, hx.x + 30, hx.y);
  e.huntFor = hx.id;
  setEscortBehaviour(w, e, 'hunt');
  setEscortBehaviour(w, e, 'stay');
  assert.equal(e.state, 'atSea');
});

test('depth-charge passes every ten minutes on a U-boat held, written in a report', () => {
  const w = makeKanalkampf();
  const e = groupAt(w, 'eg1', -10, 56);
  const u = w.uboats.find((x) => x.id === 'u1');
  u.x = e.x + 1;
  u.y = e.y;
  u.state = 'patrol';
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  assert.equal(e.state, 'hunting');
  const events = run(w, 2 * H);
  const passes = events.filter((ev) => ev.type === 'depthChargePass');
  assert.ok(passes.length >= 1, 'at least one pass');
  for (let i = 1; i < passes.length; i++) assert.ok(passes[i].t - passes[i - 1].t >= 600 || passes[i].pass === 1, 'ten minutes apart');
  const rep = w.navalReports[0];
  assert.equal(rep.escortId, e.id);
  assert.ok(rep.passes.length >= 1);
  assert.ok(['sunk', 'damaged', 'lost', null].includes(rep.result));
  if (rep.result === 'damaged') assert.equal(u.state, 'leaving', 'a damaged U-boat goes home');
});

test('many attacks: some sink, some damage, many lose the boat; never all of one kind', () => {
  const tally = { sunk: 0, damaged: 0, lost: 0, nothing: 0 };
  for (let i = 0; i < 40; i++) {
    const w = makeKanalkampf();
    for (let k = 0; k < i; k++) w.rng.next();
    const e = groupAt(w, 'eg1', -10, 56);
    const u = w.uboats.find((x) => x.id === 'u1');
    u.x = e.x + 1;
    u.y = e.y;
    engage(w, e, u, 'asdic');
    run(w, 3 * H);
    const rep = w.navalReports[0];
    for (const p of rep.passes) tally[p.result]++;
  }
  assert.ok(tally.sunk > 0 && tally.damaged > 0 && tally.lost > 0, JSON.stringify(tally));
  assert.ok(tally.sunk < 25, `kills stay rare (${tally.sunk} in 40 attacks)`);
});

test('the end of a route: meet a convoy, hunt, or go into a port; a route ending in a port bubble goes in', () => {
  const w = makeKanalkampf();
  const hx = w.convoys.find((c) => c.id === 'hx55');
  const e = groupAt(w, 'eg2', -12, 57);
  assert.ok(shipEndChoices(w, e).some((a) => a.kind === 'escort' && a.id === hx.id));
  assert.ok(routeConvoy(w, e, [project(-13, 57.2)]).ok);
  assert.ok(setShipEndAction(w, e, { kind: 'escort', id: hx.id }));
  run(w, 3 * H);
  assert.equal(e.joinTarget, hx.id, 'off to meet the convoy');
  const g = groupAt(w, 'eg1', -12, 57);
  routeConvoy(w, g, [project(-12.5, 57.1)]);
  setShipEndAction(w, g, { kind: 'hunt' });
  const started = run(w, 3 * H, (ev) => ev.type === 'escortHunting');
  assert.ok(started.some((ev) => ev.type === 'escortHunting' && ev.escortId === g.id), 'the search begins where the route ends');
  assert.equal(g.state, 'hunting');
  // Since the depth charges (2.8) a search on the spot lasts its time, then the group waits.
  const S = w.rules.asw.engagement.searchS;
  const ended = run(w, S + 120, (ev) => ev.type === 'escortHuntOver');
  assert.ok(ended.some((ev) => ev.type === 'escortHuntOver' && ev.why === 'lost'));
  assert.equal(g.state, 'waiting');
  // The Clyde's bubble: the route goes into port.
  const k = groupAt(w, 'eg1', -5.0, 55.6);
  const clyde = w.byId.port.get('clyde');
  const r = routeConvoy(w, k, [[clyde.x + 4, clyde.y + 6]]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(k.destination, 'clyde');
});

test('a hunt near the coast never takes the ships ashore', () => {
  const w = makeKanalkampf();
  const e = groupAt(w, 'eg2', -6.05, 55.3);
  // A plot inland on the Antrim coast (its error ran ashore).
  const [px, py] = project(-6.3, 55.1);
  w.uboatPlots.push({ id: 'P99', uboatId: 'u1', x: px, y: py, t: w.t, source: 'aircraft', by: 'test', submerged: false });
  assert.ok(huntPlot(w, e, 'P99'));
  for (let i = 0; i < 3 * 60; i++) {
    run(w, 60);
    assert.ok(!w.terrain.isLand(e.x, e.y) || e.state !== 'hunting', `at sea (${unproject(e.x, e.y).map((v) => v.toFixed(3))})`);
  }
});

test('hunts, attacks and their reports are saved', () => {
  const w = makeKanalkampf();
  const e = groupAt(w, 'eg1', -10, 56);
  const u = w.uboats.find((x) => x.id === 'u1');
  u.x = e.x + 1;
  u.y = e.y;
  engage(w, e, u, 'asdic');
  run(w, 15 * 60);
  const b = makeKanalkampf();
  restore(b, JSON.parse(JSON.stringify(snapshot(w))));
  assert.deepEqual(b.navalReports, w.navalReports);
  run(w, H);
  run(b, H);
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(snapshot(w)));
});
