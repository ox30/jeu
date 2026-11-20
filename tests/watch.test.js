// The sea at the rhythm of the watches (I2, idea A, N10): reports at every relief, the game
// stopped for a decision or by the setting, and between two reliefs only for the first
// attack on a convoy in the night.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKanalkampf, makeWorld, run, runTo } from './helpers.js';
import { project } from '../src/sim/geo.js';
import { emit } from '../src/sim/events.js';
import { WATCH_S, clockHour, fullReport, markersOnWay, pendingDecisions, watchReport } from '../src/sim/watch.js';
import { joinConvoy, routeConvoy } from '../src/sim/orders.js';
import { alertFor } from '../src/ui/alertRules.js';
import { restore, snapshot } from '../src/save/game.js';

const H = 3600;
const atlantic = (overrides = {}) => makeWorld('standard', overrides, 'hiver-atlantique');

/** An ocean convoy put at sea at (lon, lat), sailing east along a straight way; no U-boat about. */
function convoyAt(w, lon, lat) {
  runTo(w, 6 * H + 60); // HX 102 has sailed (12:00)
  const c = w.convoys.find((x) => x.type === 'ocean');
  const [x, y] = project(lon, lat);
  // (Put there by the test: the table knows it there, as from a sure point.)
  Object.assign(c, { x, y, px: x, py: y, route: [[x + 900, y]], routeLocked: 0, plan: [], est: null, fix: null });
  for (const u of w.uboats) Object.assign(u, { state: 'gone', goneAt: w.t });
  return c;
}

/** A U-boat attack on a convoy, as the simulation reports one during a step. */
function attackOn(w, c, sunk) {
  emit(w, 'uboatAttack', { convoy: c.name, convoyId: c.id, sunk, escorts: 0, x: c.x, y: c.y });
}

test('the rhythm is the scenario\'s: watches in the Atlantic, live alerts elsewhere', () => {
  const a = atlantic();
  const k = makeKanalkampf();
  assert.ok(a.watch, 'the Atlantic keeps watch reports');
  assert.equal(k.watch, null, 'Kanalkampf keeps its live alerts');
  const attack = (w) => {
    const c = w.convoys[0] || { id: 'hx1', name: 'HX 1', x: 0, y: 0 };
    return { type: 'uboatAttack', t: w.t, convoy: c.name, convoyId: c.id, sunk: 1, x: c.x, y: c.y };
  };
  assert.ok(alertFor(k, attack(k), new Map()), 'an attack calls the player in Kanalkampf');
  assert.equal(alertFor(a, attack(a), new Map()), null, 'in the Atlantic it goes to the watch report');
  // Air raids keep their alerts everywhere.
  const raid = { type: 'raidDetected', t: 0, raid: 'H01', raidId: 'r1', count: 20, approx: true, altFt: 15000, location: null };
  assert.ok(alertFor(a, raid, new Map()));
});

test('six reliefs a day, on the hours of the clock, each with its report whether the game stops or not', () => {
  const w = atlantic();
  const events = run(w, 2 * 86400 + 2 * H); // from 06:00 to 08:00 two days later
  const written = events.filter((e) => e.type === 'watchReport');
  assert.equal(written.length, 13, '08:00, then six a day');
  assert.equal(w.watch.reports.length, 13);
  for (const r of w.watch.reports) assert.ok([0, 4, 8, 12, 16, 20].includes(clockHour(w, r.toS)), `relief at ${clockHour(w, r.toS)} h`);
  assert.equal(clockHour(w, w.watch.reports[0].toS), 8);
  for (let i = 1; i < 13; i++) assert.equal(w.watch.reports[i].toS - w.watch.reports[i - 1].toS, WATCH_S);
  const stops = events.filter((e) => e.type === 'seaStop');
  assert.ok(stops.length < written.length, 'most reliefs pass without stopping');
  assert.deepEqual(stops.map((e) => e.reportId), w.watch.reports.filter((r) => r.stop).map((r) => r.id));
});

test('what happens during a watch is in its report, and only there', () => {
  const w = atlantic();
  run(w, 6 * H); // 12:00: HX 102 sails on the very second of the relief
  const noon = watchReport(w);
  assert.equal(clockHour(w, noon.toS), 12);
  assert.ok(noon.notes.some((n) => n.type === 'convoyDeparted' && n.convoy === 'HX 102'));
  assert.deepEqual(noon.headline[0], { key: 'departed', convoyId: 'hx102' });
  assert.deepEqual(noon.convoys.map((c) => c.id), ['hx102']);
  assert.equal(noon.convoys[0].ships, 38);
  run(w, WATCH_S);
  const next = watchReport(w);
  assert.ok(!next.notes.some((n) => n.type === 'convoyDeparted'));
  assert.deepEqual(next.headline, [{ key: 'quiet' }]);
  // Each escort group has its row: fuel, depth charges, where it is.
  assert.equal(next.escorts.length, 4);
  for (const e of next.escorts) {
    assert.equal(e.state, 'inPort');
    assert.ok(e.days > 6 && e.charges === e.max && e.port);
  }
});

test('a convoy within reach of a group ready in port waits for a decision; the relief stops once for it', () => {
  const w = atlantic();
  const c = convoyAt(w, -25, 55);
  const d = pendingDecisions(w).find((x) => x.kind === 'reach');
  assert.ok(d, 'the decision is there');
  assert.equal(d.unitId, c.id);
  assert.equal(d.groups.length, 4);
  // The nearest group first (the Clyde is nearer to 55° N 25° W than Liverpool).
  assert.equal(w.escorts.find((e) => e.id === d.groups[0]).portId, 'clyde');
  const first = run(w, WATCH_S, (e) => e.type === 'seaStop');
  const stop = first.find((e) => e.type === 'seaStop');
  assert.equal(stop.reason, 'relief');
  assert.equal(stop.why, 'decision');
  const r = watchReport(w, stop.reportId);
  assert.deepEqual(r.fresh, [d.key]);
  assert.ok(r.headline.some((h) => h.key === 'decisions' && h.n === 1));
  // Left unanswered, it stays in the next reports without stopping again.
  const later = run(w, 2 * WATCH_S);
  assert.ok(!later.some((e) => e.type === 'seaStop'), 'no second stop for the same decision');
  assert.ok(watchReport(w).decisions.some((x) => x.key === d.key), 'still listed');
  assert.deepEqual(watchReport(w).fresh, []);
  // Answered: a group is sent, the decision is gone.
  assert.ok(joinConvoy(w, w.escorts.find((e) => e.id === d.groups[0]), c.id));
  assert.ok(!pendingDecisions(w).some((x) => x.kind === 'reach'));
  // Far out in the ocean, beyond the reach of the groups, nothing to decide.
  const far = atlantic();
  convoyAt(far, -55, 45);
  assert.ok(!pendingDecisions(far).some((x) => x.kind === 'reach'));
});

test('a U-boat marker on the way of a convoy within a day is asked once for each routing', () => {
  const w = atlantic();
  const c = convoyAt(w, -30, 55);
  for (const e of w.escorts) e.state = 'refit'; // no group free: nothing else to decide
  assert.deepEqual(markersOnWay(w, c), []);
  assert.deepEqual(pendingDecisions(w), []);
  // A plot 30 km off its way, 150 km ahead: within a day at 9 knots (some 400 km).
  w.uboatPlots.push({ id: 'P1', uboatId: 'u1', x: c.x + 150, y: c.y + 30, t: w.t, source: 'aircraft', by: 'x' });
  // Another one 700 km ahead: more than a day away, even four hours later.
  w.uboatPlots.push({ id: 'P2', uboatId: 'u2', x: c.x + 700, y: c.y, t: w.t, source: 'aircraft', by: 'x' });
  // A third one well off the way.
  w.uboatPlots.push({ id: 'P0', uboatId: 'u0', x: c.x + 150, y: c.y + 120, t: w.t, source: 'aircraft', by: 'x' });
  // And a radio fix whose zone the way crosses.
  w.dfZones.push({ x: c.x + 250, y: c.y - 40, r: 70, t: w.t });
  const markers = markersOnWay(w, c);
  assert.deepEqual(markers.map((m) => m.kind).sort(), ['df', 'plot']);
  const d = pendingDecisions(w).find((x) => x.kind === 'marker');
  assert.equal(d.plots, 1);
  assert.equal(d.fixes, 1);
  assert.equal(d.unitId, c.id);
  const stop = run(w, WATCH_S, (e) => e.type === 'seaStop').find((e) => e.type === 'seaStop');
  assert.ok(stop && stop.why === 'decision');
  assert.equal(watchReport(w, stop.reportId).convoys[0].markers, 2);
  // The markers are still there, new ones come: the route was kept, the answer is given.
  w.uboatPlots.push({ id: 'P3', uboatId: 'u3', x: c.x + 100, y: c.y + 10, t: w.t, source: 'seen', by: 'x' });
  w.dfZones.push({ x: c.x + 200, y: c.y, r: 70, t: w.t });
  assert.ok(!run(w, 3 * WATCH_S).some((e) => e.type === 'seaStop'), 'asked once for this routing');
  // The markers go, others come later on the same route: still no new question.
  w.uboatPlots = [];
  w.dfZones = [];
  run(w, WATCH_S);
  w.uboatPlots.push({ id: 'P4', uboatId: 'u4', x: c.x + 120, y: c.y, t: w.t, source: 'seen', by: 'x' });
  assert.ok(!run(w, WATCH_S).some((e) => e.type === 'seaStop'));
  // A new routing is a new question.
  const res = routeConvoy(w, c, [[c.x + 300, c.y + 5], [c.x + 900, c.y]]);
  assert.ok(res.ok, JSON.stringify(res));
  w.uboatPlots.push({ id: 'P5', uboatId: 'u5', x: c.x + 150, y: c.y, t: w.t, source: 'seen', by: 'x' });
  const again = run(w, WATCH_S, (e) => e.type === 'seaStop').find((e) => e.type === 'seaStop');
  assert.ok(again, 'the new route gets its question');
});

test('a group that has finished its orders, and a group with empty racks, wait for a decision', () => {
  const w = atlantic();
  runTo(w, 2 * H + 60);
  const [x, y] = project(-15, 56);
  const g = w.escorts[0];
  Object.assign(g, { state: 'waiting', x, y, px: x, py: y, berthed: false, route: [], plan: [] });
  const h = w.escorts[1];
  Object.assign(h, { state: 'atSea', x: x + 50, y, px: x + 50, py: y, berthed: false, route: [[x + 400, y]], plan: [], charges: 0, chargesOut: true });
  const kinds = pendingDecisions(w).map((d) => `${d.kind}:${d.unitId}`).sort();
  assert.deepEqual(kinds, [`charges:${h.id}`, `waiting:${g.id}`]);
  const stop = run(w, WATCH_S, (e) => e.type === 'seaStop').find((e) => e.type === 'seaStop');
  assert.equal(stop.decisions, 2);
  // Sent home to rearm, the group with empty racks no longer asks.
  h.homeward = true;
  assert.ok(!pendingDecisions(w).some((d) => d.kind === 'charges'));
});

test('between two reliefs the game stops for the first attack on a convoy in the night, once', () => {
  const w = atlantic();
  const c = convoyAt(w, -20, 56);
  for (const e of w.escorts) e.state = 'refit';
  runTo(w, 16 * H + 600); // 22:10, between the reliefs of 20:00 and 00:00
  const attack = (sunk, convoy = c) => attackOn(w, convoy, sunk);
  attack(1);
  const first = run(w, 5);
  const stop = first.find((e) => e.type === 'seaStop');
  assert.ok(stop, 'the first attack stops the game at once');
  assert.equal(stop.reason, 'attack');
  assert.equal(stop.convoyId, c.id);
  assert.equal(stop.sunk, 1);
  // The same night, the next torpedoes go to the report.
  run(w, 30 * 60);
  attack(2);
  attack(0);
  const more = run(w, 5);
  assert.ok(!more.some((e) => e.type === 'seaStop'), 'no stop for the following attacks');
  const r = (() => {
    run(w, 2 * H, (e) => e.type === 'watchReport');
    return watchReport(w);
  })();
  assert.equal(clockHour(w, r.toS), 0);
  const row = r.convoys.find((x) => x.id === c.id);
  assert.equal(row.attacks, 3);
  assert.equal(row.lost, 3);
  assert.deepEqual(r.headline[0], { key: 'attackedLost', convoyId: c.id, n: 3 });
  assert.equal(r.notes.filter((n) => n.type === 'uboatAttack').length, 3);
  // After midnight it is the same night; the next evening is another one.
  runTo(w, 22 * H);
  attack(1);
  assert.ok(!run(w, 5).some((e) => e.type === 'seaStop'), '04:00: still the same night');
  runTo(w, 40 * H);
  attack(1);
  assert.ok(run(w, 5).some((e) => e.type === 'seaStop' && e.reason === 'attack'), 'the next night stops again');
  // A straggler attacked counts with its convoy.
  const stray = { ...c, id: `${c.id}-s1`, name: `${c.name}·1`, parentId: c.id, straggler: true, children: [] };
  w.convoys.push(stray);
  attack(1, stray);
  assert.ok(!run(w, 5).some((e) => e.type === 'seaStop'), 'one stop a convoy and a night, its stragglers included');
});

test('the stops at the reliefs are a setting: on a decision, morning and evening too, or every relief', () => {
  const count = (watchStops) => {
    const w = atlantic({ watchStops });
    for (const e of w.escorts) e.state = 'refit'; // nothing to decide
    const stops = run(w, 86400 + 2 * H).filter((e) => e.type === 'seaStop');
    return { n: stops.length, hours: stops.map((e) => clockHour(w, e.t)), why: [...new Set(stops.map((e) => e.why))] };
  };
  assert.equal(count('decision').n, 0);
  assert.equal(count(undefined).n, 0, 'on a decision only, by default');
  const twice = count('twice');
  assert.deepEqual(twice.hours, [8, 20, 8]);
  assert.deepEqual(twice.why, ['fixed']);
  const every = count('every');
  assert.deepEqual(every.hours, [8, 12, 16, 20, 0, 4, 8]);
});

test('the reports are saved with the game, the watch under way too; the game goes on alike', () => {
  const a = atlantic();
  const c = convoyAt(a, -25, 55);
  a.uboatPlots.push({ id: 'P1', uboatId: 'u1', x: c.x + 150, y: c.y + 20, t: a.t, source: 'aircraft', by: 'x' });
  runTo(a, 21 * H); // 03:00: in the middle of a watch
  attackOn(a, c, 1);
  run(a, 10);
  assert.ok(a.watch.notes.length > 0, 'notes of the watch under way');
  const snap = JSON.parse(JSON.stringify(snapshot(a)));
  const b = atlantic();
  restore(b, snap);
  assert.deepEqual(b.watch, a.watch);
  const ea = run(a, 2 * 86400).filter((e) => e.type === 'seaStop' || e.type === 'watchReport');
  const eb = run(b, 2 * 86400).filter((e) => e.type === 'seaStop' || e.type === 'watchReport');
  assert.deepEqual(eb, ea);
  assert.deepEqual(JSON.parse(JSON.stringify(b.watch)), JSON.parse(JSON.stringify(a.watch)));
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(snapshot(a)));
});

test('a report read back has every part, even those left out to keep the saves small', () => {
  const w = atlantic();
  run(w, 2 * H);
  const raw = w.watch.reports[0];
  assert.equal(raw.notes, undefined, 'nothing happened: no notes kept');
  assert.equal(raw.air, undefined);
  const r = fullReport(w, raw);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.air, { sorties: 0, sightings: 0, attacks: 0, sunk: 0, lost: 0 });
  assert.deepEqual(r.intel, { plots: 0, fixes: 0, shadowed: [], condors: [] });
  assert.deepEqual(r.decisions, []);
  assert.equal(r.stop, null);
  assert.equal(r.fromS, 0, 'the first watch began with the game');
  assert.equal(r.escorts[0].hunt, false);
  assert.equal(r.escorts[0].max, w.escorts[0].chargesMax);
});
