// I3: depth charges. A stock by group, full or light patterns, dry passes when the racks are
// empty, rearming in port, and hunts that end by themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, getTerrain, makeKanalkampf, makeWorld, run } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { project } from '../src/sim/geo.js';
import { canHunt, engage, huntReserve, isSubmerged, patternOf } from '../src/sim/asw.js';
import { escortHome, huntPlot, setEscortBehaviour, setEscortPattern } from '../src/sim/orders.js';
import { restore, snapshot } from '../src/save/game.js';

const H = 3600;

/** Kanalkampf with the dice of the depth-charge passes loaded (`engagement` patches the rules). */
function loadedWorld(engagement, asw = {}) {
  const rules = structuredClone(data.rules);
  Object.assign(rules.asw, asw);
  Object.assign(rules.asw.engagement, engagement);
  return createWorld({
    scenario: structuredClone(data.kanalkampf), rules, settings: { ...data.presets.presets.standard, fatigue: 'off' }, terrain: getTerrain(),
  });
}

/** A group at sea in the open Atlantic, and a U-boat a kilometre from it. */
function groupAndBoat(w, id = 'eg1') {
  const e = w.escorts.find((x) => x.id === id);
  const [x, y] = project(-12, 56);
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], berthed: false });
  const u = w.uboats.find((b) => b.id === 'u1');
  Object.assign(u, { x: x + 1, y, px: x + 1, py: y, state: 'patrol', target: null, submergedUntil: 0, way: null, wx: x + 1, wy: y, hx: x + 1, hy: y });
  // The other boats are kept out of the trial.
  for (const b of w.uboats) if (b !== u) b.state = 'gone';
  return { e, u };
}

/** Keeps the boat under the group (it would crawl away under water) until `stop` is true. */
function holdBoat(w, e, u, seconds, stop = () => false) {
  const events = [];
  for (let s = 0; s < seconds && !stop(events); s += 60) {
    if (u.state !== 'sunk' && u.state !== 'gone') Object.assign(u, { x: e.x + 0.5, y: e.y });
    events.push(...run(w, 60));
  }
  return events;
}

test('forty depth charges a ship: 120 or 160 a group, full patterns by default', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  assert.ok(w.escorts.length >= 4);
  for (const e of w.escorts) {
    assert.equal(e.chargesMax, 40 * e.ships);
    assert.equal(e.charges, e.chargesMax);
    assert.equal(e.pattern, 'full');
    assert.ok([120, 160].includes(e.chargesMax), `${e.name}: ${e.chargesMax}`);
    assert.ok(canHunt(w, e));
    assert.ok(Math.abs(huntReserve(w, e) - e.chargesMax / 3) < 0.1, 'a third is kept for the convoy');
  }
});

test('a full pass throws ten charges, a light one five, with less chance to sink or damage', () => {
  const w = makeKanalkampf();
  const { e } = groupAndBoat(w);
  const full = patternOf(w, e);
  assert.deepEqual(full, { used: 10, kill: 1, damage: 1 });
  assert.ok(setEscortPattern(w, e, 'light'));
  const light = patternOf(w, e);
  assert.equal(light.used, 5);
  assert.ok(light.kill < 1 && light.kill > 0.5 * 0.99, 'less chance a pass, more a charge');
  assert.ok(light.damage < 1 && light.damage >= light.kill);
  assert.ok(!setEscortPattern(w, e, 'plenty'));
  // The last charges of a rack: what is left, for a share of the chance.
  e.pattern = 'full';
  e.charges = 4;
  assert.deepEqual(patternOf(w, e), { used: 4, kill: 0.4, damage: 0.4 });
  e.charges = 0;
  assert.deepEqual(patternOf(w, e), { used: 0, kill: 0, damage: 0 });
});

test('each pass takes its charges from the stock; the events and the report say how many', () => {
  const w = loadedWorld({ pKillPerShip: 0, pDamagePerShip: 0, pLoseBase: 0, pLosePerShip: 0, pLoseMin: 0 });
  const { e, u } = groupAndBoat(w);
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  const events = holdBoat(w, e, u, 35 * 60);
  const passes = events.filter((ev) => ev.type === 'depthChargePass');
  assert.equal(passes.length, 4, 'a pass at once, then every ten minutes');
  assert.deepEqual(passes.map((p) => p.used), [10, 10, 10, 10]);
  assert.deepEqual(passes.map((p) => p.left), [e.chargesMax - 10, e.chargesMax - 20, e.chargesMax - 30, e.chargesMax - 40]);
  assert.equal(e.charges, e.chargesMax - 40);
  assert.deepEqual(w.navalReports[0].passes.map((p) => p.used), [10, 10, 10, 10]);
});

test('a hunt stops by itself when the stock is down to the third kept for the convoy', () => {
  const w = loadedWorld({ pKillPerShip: 0, pDamagePerShip: 0, pLoseBase: 0, pLosePerShip: 0, pLoseMin: 0 });
  const { e, u } = groupAndBoat(w);
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  assert.ok(!e.huntStay, 'a hunt, not a counter-attack');
  const events = holdBoat(w, e, u, 6 * H, (ev) => ev.some((x) => x.type === 'escortHuntOver'));
  const over = events.find((ev) => ev.type === 'escortHuntOver');
  assert.ok(over, 'the hunt ended');
  assert.equal(over.why, 'charges');
  assert.ok(e.charges <= huntReserve(w, e) && e.charges > huntReserve(w, e) - 10, `${e.charges} left of ${e.chargesMax}`);
  assert.ok(!canHunt(w, e));
  // With its reserve only, it no longer leaves for a plot...
  w.uboatPlots.push({ id: 'P99', uboatId: 'u1', x: e.x + 20, y: e.y, t: w.t, source: 'seen', by: 'x' });
  assert.ok(!huntPlot(w, e, 'P99'), 'no hunt on the reserve');
  // ...but still counter-attacks what comes close, as a group told to stay does.
  Object.assign(u, { x: e.x + 0.5, y: e.y, state: 'patrol' });
  e.state = 'atSea';
  engage(w, e, u, 'asdic');
  assert.ok(e.huntStay, 'a short counter-attack');
});

test('a hunt ends when the U-boat is damaged: it makes for home, the group goes back', () => {
  const w = loadedWorld({ pKillPerShip: 0, pDamagePerShip: 1, pLoseBase: 0, pLosePerShip: 0, pLoseMin: 0 });
  const { e, u } = groupAndBoat(w);
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  const events = holdBoat(w, e, u, 3 * H, (ev) => ev.some((x) => x.type === 'escortHuntOver'));
  const passes = events.filter((ev) => ev.type === 'depthChargePass');
  const hit = passes.findIndex((p) => p.result === 'damaged');
  assert.ok(hit >= 0, 'a pass damaged it');
  assert.equal(hit, passes.length - 1, 'no pass after the hit');
  assert.equal(events.find((ev) => ev.type === 'escortHuntOver').why, 'damaged');
  assert.equal(u.state, 'leaving');
  assert.ok(u.damaged);
  assert.notEqual(e.state, 'hunting');
  // Hit and going home, it is let go: no new attack, even right under the group.
  const after = holdBoat(w, e, u, 30 * 60);
  assert.ok(!after.some((ev) => ev.type === 'depthChargePass' || ev.type === 'escortEngaged'), 'no attack on a boat that broke off');
  assert.notEqual(u.state, 'sunk');
});

test('contact lost: a search where it was held, then the hunt is over', () => {
  // The ASDIC that would find it again at once is switched off for the trial.
  const w = loadedWorld({ pKillPerShip: 0, pDamagePerShip: 0, pLoseBase: 1, pLosePerShip: 0, pLoseMin: 1 }, { pAsdic: 0 });
  const { e, u } = groupAndBoat(w);
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  const t0 = w.t;
  const first = run(w, 120, (ev) => ev.type === 'depthChargePass');
  assert.equal(first.find((ev) => ev.type === 'depthChargePass').result, 'lost');
  assert.equal(e.state, 'hunting', 'it searches');
  assert.equal(e.engage, null);
  const S = w.rules.asw.engagement.searchS;
  assert.ok(e.huntUntil - w.t <= S && e.huntUntil - w.t > S - 180, 'for the time of a search');
  // The boat slipped away: nothing found.
  Object.assign(u, { x: e.x + 60, y: e.y });
  const events = run(w, S + 120, (ev) => ev.type === 'escortHuntOver');
  const over = events.find((ev) => ev.type === 'escortHuntOver');
  assert.ok(over && over.why === 'lost');
  assert.ok(w.t - t0 <= S + 300, 'not the three hours of before');
});

test('racks empty: dry passes keep the U-boat down and can neither sink nor damage it', () => {
  // Loaded so that any pass with charges would sink it at once.
  const w = loadedWorld({ pKillPerShip: 1, pDamagePerShip: 1, pLoseBase: 0, pLosePerShip: 0, pLoseMin: 0 });
  const { e, u } = groupAndBoat(w);
  e.charges = 0;
  setEscortBehaviour(w, e, 'stay');
  engage(w, e, u, 'asdic');
  const events = holdBoat(w, e, u, 25 * 60);
  const passes = events.filter((ev) => ev.type === 'depthChargePass');
  assert.ok(passes.length >= 2);
  assert.ok(passes.every((p) => p.used === 0 && p.result === 'nothing'), 'dry passes');
  assert.equal(u.state, 'patrol', 'neither sunk nor damaged');
  assert.ok(!u.damaged);
  assert.ok(isSubmerged(w, u), 'but kept under water: it loses the convoy');
  assert.equal(e.charges, 0);
  const told = events.filter((ev) => ev.type === 'escortChargesOut');
  assert.equal(told.length, 1, 'said once');
  // No forced return: the group stays where it is until the player decides.
  assert.ok(!e.homeward);
});

test('a group told to stay spends charges too, half an hour at most', () => {
  const w = loadedWorld({ pKillPerShip: 0, pDamagePerShip: 0, pLoseBase: 0, pLosePerShip: 0, pLoseMin: 0 });
  const { e, u } = groupAndBoat(w);
  setEscortBehaviour(w, e, 'stay');
  engage(w, e, u, 'asdic');
  assert.ok(e.huntStay);
  const events = holdBoat(w, e, u, H, (ev) => ev.some((x) => x.type === 'escortHuntOver'));
  const over = events.find((ev) => ev.type === 'escortHuntOver');
  assert.equal(over.why, 'time');
  assert.equal(events.filter((ev) => ev.type === 'depthChargePass').length, 3, 'at 0, 10 and 20 minutes');
  assert.equal(e.charges, e.chargesMax - 30);
});

test('in port the racks are filled with the bunkers, at no extra delay', () => {
  const w = makeKanalkampf();
  const e = w.escorts.find((x) => x.id === 'eg1');
  const [x, y] = project(-5.5, 53.6); // the Irish Sea, a few hours from Liverpool
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], berthed: false, charges: 0, chargesOut: true, endurance: 3 * 86400 });
  assert.ok(escortHome(w, e, 'liverpool'));
  run(w, 30 * H, (ev) => ev.type === 'escortInPort');
  assert.equal(e.state, 'refit');
  assert.equal(e.charges, 0, 'not yet');
  const refit = w.rules.escortGroups.refitHours * H;
  const events = run(w, refit + 60, (ev) => ev.type === 'escortReady');
  assert.ok(events.some((ev) => ev.type === 'escortReady'));
  assert.equal(e.charges, e.chargesMax);
  assert.ok(!e.chargesOut);
  assert.equal(e.endurance, e.enduranceMax, 'with the fuel');
});

test('the stock and the pattern are saved with the game; the same orders give the same game', () => {
  const play = (w) => {
    const { e, u } = groupAndBoat(w);
    setEscortBehaviour(w, e, 'hunt');
    setEscortPattern(w, e, 'light');
    engage(w, e, u, 'asdic');
    return { e, u };
  };
  const a = makeKanalkampf();
  const pa = play(a);
  holdBoat(a, pa.e, pa.u, 40 * 60);
  const snap = JSON.parse(JSON.stringify(snapshot(a)));
  const b = makeKanalkampf();
  restore(b, snap);
  const eb = b.escorts.find((x) => x.id === 'eg1');
  assert.equal(eb.charges, pa.e.charges);
  assert.equal(eb.pattern, 'light');
  assert.equal(eb.chargesMax, pa.e.chargesMax);
  // Both go on alike.
  run(a, 2 * H);
  run(b, 2 * H);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(b))), JSON.parse(JSON.stringify(snapshot(a))));
});
