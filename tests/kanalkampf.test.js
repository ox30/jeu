import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/sim/geo.js';
import { dispatchTrain, railPath } from '../src/sim/logistics.js';
import { damageSite } from '../src/sim/sites.js';
import { scramble } from '../src/sim/orders.js';
import { cargoShare } from '../src/sim/convoy.js';
import { escortStrength } from '../src/sim/naval.js';
import { parseGameDate } from '../src/core/time.js';
import { makeKanalkampf, run, runTo } from './helpers.js';

const at = (world, text) => (parseGameDate(text) - world.startMs) / 1000;

test('the railway links every port to every base and factory', () => {
  const world = makeKanalkampf();
  for (const port of ['port:liverpool', 'port:clyde', 'port:southampton']) {
    for (const s of world.squadrons.filter((q) => q.role === 'fighter')) assert.ok(railPath(world, port, `airfield:${s.home}`), `${port} → ${s.home}`);
    for (const f of world.factories) assert.ok(railPath(world, port, f.key), `${port} → ${f.key}`);
  }
});

test('a train carries fuel from Liverpool to Biggin Hill; a busy line spaces the trains', () => {
  const world = makeKanalkampf();
  const lpool = world.sites.get('port:liverpool');
  const bh = world.sites.get('airfield:biggin_hill');
  const fuel0 = lpool.stocks.fuel;
  const base0 = bh.stocks.fuel;
  const a = dispatchTrain(world, 'port:liverpool', 'airfield:biggin_hill', { fuel: 100 });
  const b = dispatchTrain(world, 'port:liverpool', 'airfield:biggin_hill', { fuel: 20 });
  assert.ok(a.ok && b.ok);
  assert.equal(b.train.amount, 20, 'a small train');
  assert.equal(lpool.stocks.fuel, fuel0 - a.train.amount - b.train.amount);
  const events = run(world, 3 * 86400, (e) => e.type === 'trainArrived' && e.train === b.train.id);
  const arrivals = events.filter((e) => e.type === 'trainArrived');
  assert.equal(arrivals.length, 2);
  const hours = (arrivals[0].t) / 3600;
  assert.ok(hours > 10 && hours < 30, `${hours.toFixed(1)} h`);
  assert.ok(arrivals[1].t - arrivals[0].t >= 86400 / 8 - 60, 'second train waits for a path');
  assert.ok(bh.stocks.fuel > base0 + a.train.amount + b.train.amount - 30);
});

test('a mixed train carries fuel and matériel, within 20 wagons', () => {
  const world = makeKanalkampf();
  const clyde = world.sites.get('port:clyde');
  const soton = world.sites.get('port:southampton');
  const m0 = soton.stocks.materiel;
  assert.equal(dispatchTrain(world, 'port:clyde', 'port:southampton', { fuel: 60, materiel: 72 }).reason, 'tooMuch');
  assert.equal(dispatchTrain(world, 'port:clyde', 'port:southampton', { fuel: 5 }).reason, 'tooLittle');
  const r = dispatchTrain(world, 'port:clyde', 'port:southampton', { fuel: 50, materiel: 60 });
  assert.ok(r.ok, r.reason);
  assert.equal(r.train.wagons, 20);
  assert.equal(r.train.resource, 'mixed');
  assert.equal(clyde.stocks.fuel, 50);
  run(world, 3 * 86400, (e) => e.type === 'trainArrived');
  assert.ok(Math.abs(soton.stocks.materiel - (m0 + 60)) < 1);
});

test('a squadron cannot refuel at a dry aerodrome', () => {
  const world = makeKanalkampf();
  const sq = world.squadrons.find((s) => s.id === '32');
  const field = world.byId.airfield.get(sq.home);
  scramble(world, sq, { vector: 90 });
  run(world, 300);
  field.stocks.fuel = 0;
  sq.state = 'returning';
  sq.returnReason = 'order';
  const events = run(world, 3 * 3600, (e) => e.type === 'noFuel');
  assert.ok(events.some((e) => e.type === 'noFuel'));
  run(world, 3600);
  assert.equal(sq.state, 'refuelling');
  field.stocks.fuel = 30;
  run(world, 120);
  assert.equal(sq.state, 'ready');
});

test('factories build aircraft that replace the squadrons losses', () => {
  const world = makeKanalkampf();
  const sq = world.squadrons.find((s) => s.id === '74');
  sq.aircraft = 6;
  const events = run(world, 2 * 86400);
  assert.ok(events.some((e) => e.type === 'aircraftDelivered' && e.squadronId === '74'));
  assert.ok(sq.aircraft > 6);
  assert.ok(world.stats.aircraftBuilt > 0);
});

test('a convoy in port unloads into the port stock', () => {
  const world = makeKanalkampf();
  const c = world.convoys.find((x) => x.id === 'hx55');
  const port = world.byId.port.get('liverpool');
  [c.x, c.y] = project(-6.0, 55.3);
  const before = port.stocks.fuel;
  c.route = port.approaches[0].points.slice(3).map(([x, y]) => [x, y]);
  c.destination = 'liverpool';
  const events = run(world, 4 * 86400, (e) => e.type === 'convoyUnloaded');
  assert.ok(events.some((e) => e.type === 'convoyArrived'));
  assert.ok(events.some((e) => e.type === 'convoyUnloaded'));
  assert.ok(port.stocks.fuel > before + 300, `${port.stocks.fuel}`);
});

function nightAttackLosses(withEscort) {
  let lost = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const world = makeKanalkampf();
    const c = world.convoys.find((x) => x.id === 'hx55');
    const u = world.uboats[0];
    // Night of 10-11 July: the convoy steams past the U-boat's patrol area.
    runTo(world, at(world, '1940-07-10T21:00') + seed * 120);
    [c.x, c.y] = [u.x - 8, u.y];
    c.course = 90;
    c.heading = 90;
    if (withEscort) {
      const e = world.escorts[0];
      e.state = 'escorting';
      e.escorting = c.id;
    }
    run(world, 10 * 3600);
    lost += c.shipsStart - c.ships;
  }
  return lost;
}

test('U-boats sink ships at night; an escort cuts the losses', () => {
  const alone = nightAttackLosses(false);
  const escorted = nightAttackLosses(true);
  assert.ok(alone > 0, 'ships lost without escort');
  assert.ok(escorted < alone, `escorted ${escorted} vs alone ${alone}`);
});

test('an escort group meets a convoy and takes station', () => {
  const world = makeKanalkampf();
  const c = world.convoys.find((x) => x.id === 'hx55');
  const e = world.escorts[0];
  e.state = 'atSea';
  [e.x, e.y] = [c.x + 60, c.y];
  e.joinTarget = c.id;
  const events = run(world, 12 * 3600, (ev) => ev.type === 'escortJoined');
  assert.ok(events.some((ev) => ev.type === 'escortJoined'));
  assert.equal(escortStrength(world, c), e.ships);
});

test('the coastal convoy in the Channel by day draws dive-bombers', () => {
  const world = makeKanalkampf();
  const cw = world.convoys.find((x) => x.id === 'cw');
  runTo(world, at(world, '1940-07-11T08:00'));
  cw.state = 'atSea';
  cw.route = cw.admiraltyRoute.slice(4).map(([x, y]) => [x, y]);
  cw.destination = 'southampton';
  [cw.x, cw.y] = cw.admiraltyRoute[3];
  const events = run(world, 10 * 3600, (e) => e.type === 'convoyBombed');
  assert.ok(events.some((e) => e.type === 'convoyRaidPlanned'));
  const raid = world.raids.find((r) => r.target === 'convoy:cw');
  assert.ok(raid, 'raid against the convoy');
  assert.ok(events.some((e) => e.type === 'convoyBombed'), 'convoy bombed when unprotected');
  assert.ok(cargoShare(cw) <= 1);
});

test('in Arcade, standing orders keep the bases supplied', () => {
  const world = makeKanalkampf('arcade');
  const bh = world.sites.get('airfield:biggin_hill');
  bh.stocks.fuel = 5;
  const events = run(world, 2 * 86400);
  assert.ok(events.some((e) => e.type === 'trainDispatched' && e.auto));
  assert.ok(bh.stocks.fuel > 30, `${bh.stocks.fuel}`);
});

test('without fuel anywhere, the scenario is lost', () => {
  const world = makeKanalkampf();
  for (const f of world.airfields) f.stocks.fuel = 0;
  for (const p of world.ports) p.stocks.fuel = 0;
  const events = run(world, 3 * 86400, (e) => e.type === 'scenarioEnd');
  const endEvent = events.find((e) => e.type === 'scenarioEnd');
  assert.ok(endEvent, 'ended');
  assert.equal(endEvent.outcome, 'defeat');
  assert.equal(endEvent.reason, 'fuel');
});

test('bombs on a port destroy part of its stock', () => {
  const world = makeKanalkampf();
  const port = world.sites.get('port:southampton');
  const before = port.stocks.fuel;
  const raid = world.raids.find((r) => r.id === 'h07');
  raid.departure = 60;
  const events = run(world, 3 * 3600, (e) => e.type === 'siteHit' && e.site === 'port:southampton');
  assert.ok(events.some((e) => e.type === 'siteHit'));
  assert.ok(port.stocks.fuel < before);
  assert.ok(damageSite);
});

test('the whole fortnight runs without orders and ends', () => {
  const world = makeKanalkampf('standard');
  const events = run(world, 15 * 86400);
  assert.ok(world.ended);
  assert.ok(events.some((e) => e.type === 'scenarioEnd'));
  assert.ok(['victory', 'defeat'].includes(world.outcome));
});
