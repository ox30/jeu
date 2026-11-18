// What the review of the M2.8 found, each with its test: radio silence kept inside support
// groups, orders told as carried out, an edited route as a new routing, the signals of a
// group as sure points, an order handed back by a group that no longer joins, the reserve of
// depth charges after a lost contact, the B-Dienst and a route passed off the air, a group
// drawn with its convoy, and the purchases in the watch report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, getTerrain, makeWorld, run, runTo, scenarioData } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { distance, project } from '../src/sim/geo.js';
import { emit } from '../src/sim/events.js';
import { carryByShip, orderChannel, pendingOrders, sendOrder, shownPosition } from '../src/sim/comms.js';
import { addMember, joinProblem, newFormation } from '../src/sim/formations.js';
import { editShipRoute, convoyRemainingKm } from '../src/sim/convoy.js';
import { escortHome, joinConvoy, setEscortBehaviour } from '../src/sim/orders.js';
import { canHunt, engage, huntReserve } from '../src/sim/asw.js';
import { pendingDecisions, watchReport } from '../src/sim/watch.js';
import { buyOffer, offers } from '../src/sim/shipping.js';

const H = 3600;

/** The game time of the next relief of the watch (every four hours of the game clock). */
function nextRelief(w) {
  const off = (((w.startMs / 1000) % (4 * H)) + 4 * H) % (4 * H);
  const t = w.t + 1;
  return t + ((4 * H - ((t + off) % (4 * H))) % (4 * H));
}

const atlantic = (preset = 'standard', overrides = {}) => makeWorld(preset, overrides, 'hiver-atlantique');

/** HX 102 on the high seas at (lon, lat), sailing east; no U-boat about. */
function convoyAt(w, lon, lat) {
  runTo(w, 6 * H + 60);
  const c = w.convoys.find((x) => x.type === 'ocean');
  const [x, y] = project(lon, lat);
  Object.assign(c, { x, y, px: x, py: y, route: [[x + 4000, y]], routeLocked: 0, plan: [], est: null, fix: null });
  for (const u of w.uboats) Object.assign(u, { state: 'gone', goneAt: null });
  return c;
}

/** A group put at sea `km` east of a ship or a place. */
function groupAt(w, id, x, y, state = 'atSea') {
  const e = w.escorts.find((g) => g.id === id);
  Object.assign(e, { state, x, y, px: x, py: y, route: [], plan: [], berthed: false, escorting: null, joinTarget: null, homeward: false, est: null, fix: null });
  return e;
}

test('under radio silence a group on the high seas cannot be put in a support group', () => {
  const w = atlantic();
  const c = convoyAt(w, -30, 54);
  const far = groupAt(w, 'eg2', c.x + 4, c.y, 'escorting');
  far.escorting = c.id;
  run(w, 120);
  assert.equal(orderChannel(w, far), 'radio');
  assert.equal(joinProblem(w, 'naval', far), 'silence');
  const leader = w.escorts.find((g) => g.id === 'eg1');
  assert.equal(leader.state, 'inPort');
  assert.equal(joinProblem(w, 'naval', leader), null, 'in port it can');
  const f = newFormation(w, 'naval', leader.id);
  assert.ok(f, 'a support group led from the port');
  assert.equal(addMember(w, f, far.id), false, 'the group out at sea is refused');
  assert.ok(!f.members.includes(far.id));
  assert.equal(newFormation(w, 'naval', far.id), null, 'nor can it be made the leader of one');
  // With direct communications (Arcade, or the setting) it is taken as before.
  const direct = atlantic('standard', { seaComms: 'direct' });
  const c2 = convoyAt(direct, -30, 54);
  const far2 = groupAt(direct, 'eg2', c2.x + 4, c2.y, 'escorting');
  far2.escorting = c2.id;
  run(direct, 120);
  assert.equal(joinProblem(direct, 'naval', far2), null);
});

test('a member out of touch hears its leader only at a relief; in company it follows at once', () => {
  const w = atlantic();
  const c = convoyAt(w, -30, 54);
  const leader = w.escorts.find((g) => g.id === 'eg1');
  const member = w.escorts.find((g) => g.id === 'eg2');
  const f = newFormation(w, 'naval', leader.id);
  assert.ok(addMember(w, f, member.id), 'both in port: the group is formed');
  // The member is then far out on its own (as after a hunt), the leader still in port.
  groupAt(w, 'eg2', c.x - 300, c.y, 'waiting');
  run(w, 120);
  assert.equal(orderChannel(w, member), 'radio');
  // The leader is told to meet the convoy. The member, out of touch, goes on as it was…
  const relief = nextRelief(w) + 4 * H;
  runTo(w, relief - 2 * H); // two hours before a relief
  assert.ok(joinConvoy(w, leader, c.id));
  runTo(w, relief - 60);
  assert.equal(member.joinTarget, null, 'not told yet, a minute before the relief');
  assert.notEqual(member.escorting, c.id);
  // … and hears of it at the relief.
  runTo(w, relief + 60);
  assert.equal(member.joinTarget, c.id, 'told by radio at the relief');
  // In company with its leader on the high seas (by lamp): at once.
  const w2 = atlantic();
  const c2 = convoyAt(w2, -30, 54);
  const l2 = w2.escorts.find((g) => g.id === 'eg1');
  const m2 = w2.escorts.find((g) => g.id === 'eg2');
  const f2 = newFormation(w2, 'naval', l2.id);
  addMember(w2, f2, m2.id);
  groupAt(w2, 'eg1', c2.x - 300, c2.y, 'waiting');
  groupAt(w2, 'eg2', c2.x - 305, c2.y, 'waiting');
  run(w2, 120);
  runTo(w2, nextRelief(w2) + 2 * H); // well between two reliefs
  l2.joinTarget = c2.id; // (the leader's own order has reached it)
  l2.state = 'atSea';
  run(w2, 60);
  assert.equal(m2.joinTarget, c2.id, 'in company: it follows at once');
});

test('an order carried out is told as carried out, whatever the order gives back', () => {
  const w = atlantic('standard', { seaComms: 'direct' });
  const c = convoyAt(w, -30, 54);
  c.zigzag = true;
  for (const [name, args] of [['zigzag', [false]], ['zigzag', [true]], ['convoySpeed', [7]], ['speedPct', [80]], ['boost', [true]], ['boost', [false]]]) {
    const r = sendOrder(w, c, name, ...args);
    assert.equal(r.ok, true, `${name}(${args}) is done`);
  }
  assert.equal(c.zigzag, true);
  // By radio: delivered at the relief, and the journal says « reçu », never « n'a pas pu ».
  const s = atlantic();
  const c2 = convoyAt(s, -30, 54);
  run(s, 120);
  c2.zigzag = true;
  s.events.length = 0;
  for (const [name, args] of [['zigzag', [false]], ['convoySpeed', [7]], ['speedPct', [80]], ['boost', [false]]]) assert.equal(sendOrder(s, c2, name, ...args).via, 'radio');
  const events = run(s, 4 * H + 60);
  const told = events.filter((e) => e.unitId === c2.id && (e.type === 'orderDelivered' || e.type === 'orderFailed'));
  assert.equal(told.length, 4);
  assert.deepEqual(told.map((e) => e.type), ['orderDelivered', 'orderDelivered', 'orderDelivered', 'orderDelivered']);
  assert.equal(c2.zigzag, false);
  // A sprint asked of a group out of fuel is the one that fails.
  const g = groupAt(w, 'eg2', c.x + 5, c.y);
  g.dry = true;
  assert.equal(sendOrder(w, g, 'boost', true).ok, false);
});

test('a route changed by its points is a new routing: the plot on the new way is asked about', () => {
  const w = atlantic('standard', { seaComms: 'direct' });
  const c = convoyAt(w, -30, 54);
  c.destination = w.ports[0].id;
  c.routeLocked = 1;
  c.route = [[c.x + 400, c.y], [c.x + 900, c.y]];
  const before = c.routeVersion || 0;
  const keyBefore = `marker:${c.id}:${before}`;
  const r = editShipRoute(w, c, [[c.x + 300, c.y + 120]]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(c.routeVersion, before + 1, 'a new routing');
  // A plot on the new way: the decision carries the new version, so it is asked again.
  w.uboatPlots.push({ id: 'P900', uboatId: 'ghost', x: c.x + 150, y: c.y + 60, t: w.t, source: 'aircraft', by: 'test', submerged: false });
  const d = pendingDecisions(w).find((x) => x.kind === 'marker' && x.unitId === c.id);
  assert.ok(d, 'the plot on the way is a decision');
  assert.notEqual(d.key, keyBefore);
  assert.equal(d.key, `marker:${c.id}:${before + 1}`);
});

test('what a group signals gives a sure point: its attack is known where it is, and its convoy with it', () => {
  const rules = structuredClone(data.rules);
  Object.assign(rules.asw.engagement, { pKillPerShip: 0, pDamagePerShip: 0, pLoseBase: 0, pLosePerShip: 0, pLoseMin: 0 });
  const w = createWorld({ scenario: structuredClone(scenarioData('hiver-atlantique')), rules, settings: { ...data.presets.presets.standard, fatigue: 'off' }, terrain: getTerrain() });
  const c = convoyAt(w, -30, 54);
  const e = groupAt(w, 'eg1', c.x + 3, c.y, 'escorting');
  e.escorting = c.id;
  // Two days without a sure point: both are estimates, some way from where they are.
  run(w, 48 * H);
  const pe = shownPosition(w, e);
  const pc = shownPosition(w, c);
  assert.ok(pe.est && pc.est);
  assert.ok(distance(pe.x, pe.y, e.x, e.y) > 8, 'the estimate has drifted');
  // The group is drawn with its convoy: the same doubt, its own place around it.
  const gap = distance(e.x, e.y, c.x, c.y);
  assert.ok(Math.abs(distance(pe.x, pe.y, pc.x, pc.y) - gap) < 1, `drawn ${distance(pe.x, pe.y, pc.x, pc.y).toFixed(1)} km apart for ${gap.toFixed(1)} km`);
  // A U-boat under the group: it attacks, and says so.
  const u = w.uboats[0];
  Object.assign(u, { state: 'patrol', target: null, x: e.x + 1, y: e.y, px: e.x + 1, py: e.y, submergedUntil: 0, way: null, wx: e.x + 1, wy: e.y, hx: e.x + 1, hy: e.y });
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  run(w, 90);
  assert.equal(e.fix.how, 'signal');
  const after = shownPosition(w, e);
  assert.ok(distance(after.x, after.y, e.x, e.y) < 2, 'known where it fights');
  assert.ok(after.radiusKm < 10);
});

test('the remaining distance of an estimated convoy is counted from its estimated place', () => {
  const w = atlantic();
  const c = convoyAt(w, -30, 54);
  run(w, 48 * H);
  const p = shownPosition(w, c);
  assert.ok(p.est);
  const truth = convoyRemainingKm(c);
  const shown = convoyRemainingKm(c, p);
  assert.ok(Math.abs(shown - truth) > 1 && Math.abs(shown - truth) < 80, `${shown.toFixed(0)} km shown, ${truth.toFixed(0)} km true`);
  assert.equal(convoyRemainingKm(c, { x: c.x, y: c.y }), truth);
});

test('an order given to a group that no longer joins the convoy goes back to the radio', () => {
  const w = atlantic();
  const c = convoyAt(w, -30, 54);
  run(w, 120);
  const e = w.escorts.find((g) => g.state === 'inPort');
  assert.ok(joinConvoy(w, e, c.id));
  const sent = sendOrder(w, c, 'zigzag', true);
  assert.equal(sent.via, 'radio');
  assert.ok(carryByShip(w, sent.signalId, e.id));
  assert.equal(pendingOrders(w, c)[0].via, 'ship');
  // The group is recalled before it has joined.
  run(w, 2 * H);
  assert.ok(escortHome(w, e));
  const events = run(w, 10 * 60);
  const back = events.find((x) => x.type === 'orderHandedBack');
  assert.ok(back, 'the order is handed back');
  assert.equal(back.unitId, c.id);
  assert.equal(pendingOrders(w, c)[0].via, 'radio');
  assert.equal(pendingOrders(w, c)[0].carrier, null);
  // It goes out at the next relief.
  const later = run(w, 4 * H + 60);
  assert.ok(later.some((x) => x.type === 'orderDelivered' && x.unitId === c.id && x.via === 'radio'));
  assert.equal(c.zigzag, true);
  assert.equal(pendingOrders(w, c).length, 0);
});

test('the reserve of depth charges holds through a contact lost and found again', () => {
  // Every pass loses the contact, every search finds it again: the group must still stop at
  // its reserve, not throw its last charges.
  const rules = structuredClone(data.rules);
  Object.assign(rules.asw.engagement, { pKillPerShip: 0, pDamagePerShip: 0, pLoseBase: 1, pLosePerShip: 0, pLoseMin: 1, pRegain: 1 });
  rules.asw.pAsdic = 1;
  const w = createWorld({ scenario: structuredClone(data.kanalkampf), rules, settings: { ...data.presets.presets.standard, fatigue: 'off' }, terrain: getTerrain() });
  const e = w.escorts.find((g) => g.id === 'eg1');
  const [x, y] = project(-12, 56);
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], berthed: false });
  const u = w.uboats.find((b) => b.id === 'u1');
  Object.assign(u, { x: x + 1, y, px: x + 1, py: y, state: 'patrol', target: null, submergedUntil: 0, way: null, wx: x + 1, wy: y, hx: x + 1, hy: y });
  for (const b of w.uboats) if (b !== u) b.state = 'gone';
  setEscortBehaviour(w, e, 'hunt');
  engage(w, e, u, 'asdic');
  const events = [];
  for (let m = 0; m < 12 * 60 && !events.some((ev) => ev.type === 'escortHuntOver'); m++) {
    Object.assign(u, { x: e.x + 0.5, y: e.y });
    events.push(...run(w, 60));
  }
  const over = events.find((ev) => ev.type === 'escortHuntOver');
  assert.ok(over, 'the hunt ends');
  assert.equal(over.why, 'charges');
  assert.ok(e.charges > 0, `it keeps charges (${e.charges})`);
  assert.ok(e.charges >= huntReserve(w, e) - w.rules.asw.engagement.patternFull, `no deeper than a pass under its reserve: ${e.charges} of ${e.chargesMax}`);
  assert.ok(!canHunt(w, e));
  assert.equal(events.filter((ev) => ev.type === 'depthChargePass' && ev.used === 0).length, 0, 'no dry pass');
});

test('the B-Dienst does not read off the air: a routing by lamp cancels the read of the signal before', () => {
  const w = atlantic('standard', { bdienst: '100' });
  const c = convoyAt(w, -30, 54);
  for (const u of w.uboats.slice(0, 2)) Object.assign(u, { state: 'patrol', goneAt: null, x: c.x + 600, y: c.y + 100, px: c.x + 600, py: c.y + 100, wx: c.x + 600, wy: c.y + 100, hx: c.x + 600, hy: c.y + 100 });
  run(w, 3 * H);
  // A routing by radio: the B-Dienst will read it some hours later…
  c.routeVersion = (c.routeVersion || 0) + 1;
  c.quietRoute = null;
  run(w, 2 * H);
  assert.ok(c.bdienst && c.bdienst.read && !c.bdienst.done, 'a read is on its way');
  // … but before it does, the route is changed off the air (an aircraft's lamp).
  c.route = [[c.x + 200, c.y + 300], [c.x + 4000, c.y + 300]];
  c.routeVersion += 1;
  c.quietRoute = c.routeVersion;
  const events = run(w, 30 * H);
  assert.ok(!events.some((e) => e.type === 'bdienstRead' && e.convoyId === c.id), 'nothing read of the new route');
  assert.equal(c.bdienst.done, true);
});

test('what an order emits between two steps is in the watch report: an aircraft bought', () => {
  const w = atlantic();
  runTo(w, 6 * H + 60);
  const offer = offers(w)[0];
  assert.ok(offer, 'an offer to buy');
  w.events.length = 0;
  assert.ok(buyOffer(w, offer.id));
  assert.ok(w.events.some((e) => e.type === 'offerBought'));
  // The page takes the events away before the next step, as it does every frame when paused.
  w.events = [];
  const events = run(w, 4 * H);
  const rep = events.find((e) => e.type === 'watchReport');
  assert.ok(rep);
  const full = watchReport(w, rep.reportId);
  assert.ok((full.notes || []).some((n) => n.type === 'offerBought'), 'the purchase is in the report of its watch');
  // And an event emitted by hand, outside any step, is noted the same way.
  emit(w, 'escortRadar', { escort: 'EG 1', escortId: 'eg1' });
  w.events = [];
  const next = run(w, 4 * H).find((e) => e.type === 'watchReport');
  assert.ok((watchReport(w, next.reportId).notes || []).some((n) => n.type === 'escortRadar'));
});
