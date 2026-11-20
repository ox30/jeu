// N1: radio silence at sea. Tracked waters, estimates and sure points, and the three ways of
// passing an order (radio at the next relief, the lamp of an aircraft, a group that joins).
// N4: the coastal radars of Northern Ireland and their surface cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKanalkampf, makeWorld, run, runTo } from './helpers.js';
import { distance, project } from '../src/sim/geo.js';
import {
  aircraftInSight, cancelOrder, carriersFor, carryByShip, inTrackedWaters, isSilent, onHighSeas, orderChannel, pendingOrders, requestPosition,
  sendOrder, shownPosition,
} from '../src/sim/comms.js';
import { joinConvoy } from '../src/sim/orders.js';
import { isRelief, watchReport } from '../src/sim/watch.js';
import { restore, snapshot } from '../src/save/game.js';

const H = 3600;
const atlantic = (preset = 'standard', overrides = {}) => makeWorld(preset, overrides, 'hiver-atlantique');

/** HX 102 put on the high seas at (lon, lat), sailing east, known there as from a sure point; no U-boat. */
function convoyAt(w, lon, lat) {
  runTo(w, 6 * H + 60);
  const c = w.convoys.find((x) => x.type === 'ocean');
  const [x, y] = project(lon, lat);
  // (A long way east: the trials last several days and the convoy must stay at sea.)
  Object.assign(c, { x, y, px: x, py: y, route: [[x + 4000, y]], routeLocked: 0, plan: [], est: null, fix: null });
  for (const u of w.uboats) Object.assign(u, { state: 'gone', goneAt: w.t });
  return c;
}

/** A patrol aircraft in the air at `km` east of a ship. */
function aircraftNear(w, u, km) {
  const s = w.squadrons.find((x) => x.role === 'coastal');
  Object.assign(s, { state: 'airborne', x: u.x + km, y: u.y, px: u.x + km, py: u.y, alt: 600, palt: 600, targetAlt: 600, orbit: true, fuel: 500, route: [], plan: [] });
  return s;
}

test('the setting: direct in Arcade, radio silence in Standard and Réaliste; only where the sea lives by the watches', () => {
  assert.equal(atlantic('arcade').settings.seaComms, 'direct');
  assert.ok(!isSilent(atlantic('arcade')));
  assert.ok(isSilent(atlantic('standard')));
  assert.ok(isSilent(atlantic('realistic')));
  assert.ok(!isSilent(atlantic('standard', { seaComms: 'direct' })));
  // Since 2.12 every scenario with ships lives by the watches: Kanalkampf too, and its
  // ocean convoys are placed by estimate on the high seas. The coastal convoy sails in the
  // waters the headquarters follows: nothing changes for it.
  const k = makeKanalkampf('realistic');
  assert.ok(isSilent(k));
  run(k, 2 * H);
  const hx = k.convoys.find((c) => c.id === 'hx55');
  assert.equal(shownPosition(k, hx).est, true, 'HX 55, at 26° W: an estimate');
  assert.equal(orderChannel(k, hx), 'radio');
  const cw = k.convoys.find((c) => c.type === 'coastal');
  assert.deepEqual(shownPosition(k, cw), { x: cw.x, y: cw.y, est: false });
  assert.equal(orderChannel(k, cw), 'direct');
  // Arcade keeps direct communications there as in the Atlantic.
  const easy = makeKanalkampf('arcade');
  assert.ok(easy.watch && !isSilent(easy));
  // No ship, no watch, no silence: 15 September, whatever the setting.
  const none = makeWorld('realistic', {}, 'quinze-septembre');
  assert.equal(none.settings.seaComms, 'silence');
  assert.ok(!isSilent(none));
});

test('tracked waters: the closed waters (St George\'s Channel included), the approaches of the ports, the radars\' surface cover', () => {
  const w = atlantic();
  const at = (lon, lat) => inTrackedWaters(w, ...project(lon, lat));
  assert.ok(at(-5.2, 53.6), 'the Irish Sea');
  assert.ok(at(-5.9, 52.3), 'St George\'s Channel');
  assert.ok(at(-5.6, 55.2), 'the North Channel');
  assert.ok(at(-2.5, 49.9), 'the Channel');
  assert.ok(at(-63.2, 44.5), 'off Halifax: the approaches of a port');
  assert.ok(!at(-25, 55), 'the open Atlantic');
  assert.ok(!at(-10, 51), 'the south-western approaches');
  // N4: Downhill and Glenarm (Chain Home Low) see ships; Castlerock (Chain Home) only aircraft.
  const byId = Object.fromEntries(w.radars.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ['castlerock', 'downhill', 'glenarm']);
  assert.equal(byId.castlerock.surfaceKm, undefined);
  assert.equal(byId.downhill.surfaceKm, 50);
  assert.equal(byId.glenarm.surfaceKm, 50);
  // North of Inishowen: outside the closed waters, inside Downhill's cover.
  assert.ok(at(-7.3, 55.5), 'tracked by Downhill');
  const noRadar = atlantic();
  noRadar.radars = [];
  assert.ok(!inTrackedWaters(noRadar, ...project(-7.3, 55.5)), 'without the station it would not be');
});

test('on the high seas the table shows an estimate, moved at each relief, with a circle that holds the ship', () => {
  const w = atlantic();
  const c = w.convoys[0] || (runTo(w, 6 * H + 60), w.convoys[0]);
  assert.deepEqual(shownPosition(w, c), { x: c.x, y: c.y, est: false }, 'off Halifax: live');
  // It leaves the approaches: from then on, an estimate.
  run(w, 12 * H, () => Boolean(c.est));
  assert.ok(c.est, 'out of the tracked waters');
  assert.equal(c.fix.how, 'tracked');
  assert.ok(onHighSeas(w, c));
  let moves = 0;
  let last = { ...c.est };
  let widest = 0;
  for (let i = 0; i < 4 * 86400; i += 600) {
    run(w, 600);
    const p = shownPosition(w, c);
    assert.ok(p.est);
    const d = distance(p.x, p.y, c.x, c.y);
    assert.ok(d <= p.radiusKm, `the ship is in its circle (${d.toFixed(1)} km of ${p.radiusKm.toFixed(1)})`);
    widest = Math.max(widest, p.radiusKm);
    if (c.est.x !== last.x || c.est.y !== last.y) {
      moves++;
      assert.ok(isRelief(w) || w.t - c.est.t < 600, 'the marker moves at the reliefs');
      last = { ...c.est };
    }
  }
  assert.ok(moves >= 22 && moves <= 25, `${moves} moves in four days: one a relief`);
  assert.ok(widest > 60 && widest < 250, `the circle grows with the time since the last sure point (${widest.toFixed(0)} km)`);
  assert.equal(c.fix.how, 'tracked', 'no sure point since');
  // The watch report gives the estimate, and says so.
  const row = watchReport(w).convoys.find((x) => x.id === c.id);
  assert.ok(row.est);
  assert.ok(Math.abs(row.x - c.est.x) <= 1 && Math.abs(row.y - c.est.y) <= 1);
});

test('a sure point: an aircraft in sight, an attack, the tracked waters', () => {
  const w = atlantic();
  const c = convoyAt(w, -25, 55);
  run(w, 2 * 86400); // two days of dead reckoning
  assert.ok(c.est && c.fix);
  const old = c.fix.t;
  // An aircraft comes in sight: the place is sure, and stays exact while it is there.
  runTo(w, Math.ceil(w.t / 86400) * 86400 + 6 * H + 600); // 12:10: broad daylight
  const s = aircraftNear(w, c, 10);
  assert.equal(aircraftInSight(w, c), s);
  run(w, 120);
  assert.equal(c.fix.how, 'aircraft');
  assert.equal(c.fix.by, s.name);
  assert.ok(c.fix.t > old);
  assert.ok(distance(c.est.x, c.est.y, c.x, c.y) < 0.6, 'the marker is on the ship');
  assert.ok(shownPosition(w, c).radiusKm < 5);
  // By night an aircraft without radar sees nothing at ten kilometres; one with ASV does.
  s.state = 'ready';
  runTo(w, Math.ceil(w.t / 86400) * 86400 - 3 * H); // 03:00
  Object.assign(s, { state: 'airborne', x: c.x + 10, y: c.y, asv: false });
  assert.equal(aircraftInSight(w, c), null);
  s.asv = true;
  assert.equal(aircraftInSight(w, c), s);
  s.state = 'ready';
  // An attack: the convoy breaks silence (the U-boats know where it is anyway).
  run(w, 86400);
  const before = c.fix.t;
  const u = w.uboats[0];
  Object.assign(u, { state: 'shadow', target: c.id, x: c.x - 10, y: c.y, px: c.x - 10, py: c.y, torpedoes: 5, submergedUntil: 0, lastAttack: -1e9, way: null });
  const events = run(w, 2 * 86400, (e) => e.type === 'uboatAttack');
  assert.ok(events.some((e) => e.type === 'uboatAttack'));
  assert.equal(c.fix.how, 'attack');
  assert.ok(c.fix.t > before && w.t - c.fix.t < 60);
  // Into tracked waters: live again.
  const [x, y] = project(-5.6, 55.2);
  Object.assign(c, { x, y, px: x, py: y, route: [[x + 30, y - 40]] });
  run(w, 120);
  assert.equal(c.est, null);
  assert.equal(c.fix.how, 'tracked');
  assert.deepEqual(shownPosition(w, c), { x: c.x, y: c.y, est: false });
});

test('an order by radio takes effect at the next relief; in tracked waters and in port, at once', () => {
  const w = atlantic();
  const c = convoyAt(w, -25, 55);
  run(w, 600);
  assert.equal(orderChannel(w, c), 'radio');
  assert.equal(c.zigzag, false);
  const sent = sendOrder(w, c, 'zigzag', true);
  assert.deepEqual({ ok: sent.ok, via: sent.via }, { ok: true, via: 'radio' });
  assert.equal(c.zigzag, false, 'not yet');
  assert.deepEqual(pendingOrders(w, c).map((s) => s.name), ['zigzag']);
  const events = run(w, 4 * H, (e) => e.type === 'orderDelivered');
  assert.ok(isRelief(w), 'delivered on the relief');
  assert.ok(events.some((e) => e.type === 'orderDelivered' && e.unitId === c.id && e.via === 'radio'));
  assert.equal(c.zigzag, true);
  assert.deepEqual(pendingOrders(w, c), []);
  // A waiting order can be cancelled; the same order sent twice goes once.
  sendOrder(w, c, 'zigzag', false);
  const again = sendOrder(w, c, 'zigzag', false);
  assert.equal(pendingOrders(w, c).length, 1);
  assert.ok(cancelOrder(w, again.signalId));
  run(w, 4 * H);
  assert.equal(c.zigzag, true, 'cancelled before the relief');
  // A group in port obeys at once.
  const e = w.escorts.find((x) => x.state === 'inPort');
  assert.equal(orderChannel(w, e), 'direct');
  const res = sendOrder(w, e, 'join', c.id);
  assert.deepEqual({ ok: res.ok, via: res.via }, { ok: true, via: 'direct' });
  assert.equal(e.joinTarget, c.id);
  // With direct communications nothing waits, anywhere.
  const d = atlantic('standard', { seaComms: 'direct' });
  const dc = convoyAt(d, -25, 55);
  run(d, 600);
  assert.equal(sendOrder(d, dc, 'zigzag', true).via, 'direct');
  assert.equal(dc.zigzag, true);
});

test('a new route by radio: from the relief on, and the B-Dienst may read it; by lamp it cannot', () => {
  const routed = (lamp) => {
    const w = atlantic('standard', { bdienst: '100' });
    const c = convoyAt(w, -30, 55);
    run(w, 2 * H); // the B-Dienst has had its look at the routing the convoy sailed with
    run(w, 4 * H, () => isRelief(w));
    run(w, 600);
    runTo(w, Math.ceil(w.t / 86400) * 86400 + 7 * H); // 13:00: daylight for the lamp
    if (lamp) aircraftNear(w, c, 8);
    const version = c.routeVersion;
    const res = sendOrder(w, c, 'route', [[c.x + 300, c.y + 120], [c.x + 900, c.y]]);
    return { w, c, res, version };
  };
  const radio = routed(false);
  assert.equal(radio.res.via, 'radio');
  assert.equal(radio.c.routeVersion, radio.version, 'the old route until the relief');
  const got = run(radio.w, 4 * H, (e) => e.type === 'orderDelivered');
  assert.ok(got.some((e) => e.type === 'orderDelivered' && e.order === 'route'));
  assert.equal(radio.c.routeVersion, radio.version + 1);
  assert.notEqual(radio.c.quietRoute, radio.c.routeVersion);
  const read = run(radio.w, 3 * 86400, (e) => e.type === 'bdienstRead' && e.convoyId === radio.c.id);
  assert.ok(read.some((e) => e.type === 'bdienstRead' && e.convoyId === radio.c.id), 'a radio routing is a signal the B-Dienst reads');
  const lamp = routed(true);
  assert.equal(lamp.res.via, 'lamp');
  assert.ok(lamp.res.ok);
  assert.equal(lamp.c.routeVersion, lamp.version + 1, 'at once');
  assert.equal(lamp.c.quietRoute, lamp.c.routeVersion);
  assert.equal(lamp.c.fix.how, 'aircraft', 'and the aircraft gives a sure point');
  lamp.w.squadrons.find((s) => s.state === 'airborne').state = 'ready';
  const unread = run(lamp.w, 3 * 86400);
  assert.ok(!unread.some((e) => e.type === 'bdienstRead' && e.convoyId === lamp.c.id), 'nothing on the air: nothing to read');
});

test('an order carried by a group: told in port, handed over when it joins the convoy', () => {
  const w = atlantic();
  const c = convoyAt(w, -18, 56);
  run(w, 600);
  const sent = sendOrder(w, c, 'zigzag', true);
  assert.equal(sent.via, 'radio');
  const e = w.escorts.find((x) => x.state === 'inPort' && x.portId === 'clyde');
  assert.deepEqual(carriersFor(w, c.id), [], 'no group bound for it yet');
  assert.ok(joinConvoy(w, e, c.id));
  assert.deepEqual(carriersFor(w, c.id).map((x) => x.id), [e.id]);
  assert.ok(carryByShip(w, sent.signalId, e.id));
  assert.equal(pendingOrders(w, c)[0].via, 'ship');
  // The reliefs pass: nothing goes on the air.
  const events = run(w, 6 * 86400, (ev) => ev.type === 'orderDelivered');
  const delivered = events.find((ev) => ev.type === 'orderDelivered');
  assert.ok(delivered, 'handed over');
  assert.equal(delivered.via, 'ship');
  assert.equal(delivered.by, e.name);
  assert.equal(e.escorting, c.id, 'on joining');
  assert.equal(c.zigzag, true);
  assert.ok(events.filter((ev) => ev.type === 'escortJoined').length === 1);
  // A group already far out at sea cannot be told.
  const other = w.escorts.find((x) => x.id !== e.id);
  const [x, y] = project(-22, 55);
  Object.assign(other, { state: 'atSea', x, y, px: x, py: y, berthed: false, joinTarget: c.id, route: [], plan: [] });
  assert.ok(!carriersFor(w, c.id).some((g) => g.id === other.id));
});

test('asking a ship for its position: a sure point at the relief, and a bearing for the U-boat command', () => {
  const w = atlantic();
  const c = convoyAt(w, -25, 55);
  run(w, 86400);
  const u = w.uboats[0];
  Object.assign(u, { state: 'patrol', x: c.x + 100, y: c.y, px: c.x + 100, py: c.y, hx: c.x + 100, hy: c.y, wx: c.x + 100, wy: c.y, target: null, way: null, submergedUntil: 0, goneAt: null });
  const seenBefore = w.bdu.seen.length;
  const res = requestPosition(w, c);
  assert.equal(res.via, 'radio');
  const events = run(w, 4 * H, (e) => e.type === 'positionReported');
  assert.ok(events.some((e) => e.type === 'positionReported' && e.unitId === c.id));
  assert.equal(c.fix.how, 'signal');
  assert.ok(distance(c.est.x, c.est.y, c.x, c.y) < 0.6);
  assert.ok(w.bdu.seen.length > seenBefore, 'the U-boat command notes where the convoy is');
  assert.equal(u.state, 'closing', 'a boat on patrol within reach closes in');
  assert.equal(u.target, c.id);
});

test('the estimates, the sure points and the orders on their way are saved; the game goes on alike', () => {
  const a = atlantic();
  const c = convoyAt(a, -25, 55);
  run(a, 30 * H);
  sendOrder(a, c, 'zigzag', true);
  sendOrder(a, c, 'route', [[c.x + 300, c.y + 80], [c.x + 900, c.y]]);
  run(a, 900);
  const snap = JSON.parse(JSON.stringify(snapshot(a)));
  const b = atlantic();
  restore(b, snap);
  const cb = b.convoys.find((x) => x.id === c.id);
  assert.deepEqual(cb.est, c.est);
  assert.deepEqual(cb.fix, c.fix);
  assert.deepEqual(b.signals, a.signals);
  assert.equal(b.signals.length, 2);
  run(a, 86400);
  run(b, 86400);
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(snapshot(a)));
  assert.equal(c.zigzag, true);
});
