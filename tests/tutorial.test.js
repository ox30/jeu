// I10 of the audit: the lessons. A scenario written on another one; a raid held back until
// the instructor releases it; lesson 1 in the simulation (the late scramble of the
// demonstration loses, a scramble at the first plot wins); the conditions and the orders of
// the other lessons on their own scenarios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { data, getTerrain, run, scenarioData } from './helpers.js';
import { resolveScenario } from '../src/core/scenarios.js';
import { createWorld } from '../src/sim/world.js';
import { FOOT_M, distance } from '../src/sim/geo.js';
import { joinConvoy, releaseRaid, scramble, sendTrain, setAlert, setMinStock, setRoute } from '../src/sim/orders.js';
import { contactEstimate } from '../src/sim/query.js';
import { HELD } from '../src/sim/raid.js';
import { restore, snapshot } from '../src/save/game.js';
import { holds, lessonById } from '../src/ui/tutorial.js';

const tutorial = JSON.parse(readFileSync(new URL('../data/tutorial.json', import.meta.url), 'utf8'));

/** The world of a lesson, as the game builds it: Standard, then the lesson's own settings. */
function lessonWorld(id, seed = null) {
  const lesson = lessonById(tutorial, id);
  const scenario = structuredClone(scenarioData(lesson.scenario));
  if (seed !== null) scenario.seed = seed;
  const settings = { ...data.presets.presets.standard, ...data.presets.options, ...lesson.settings, preset: 'standard' };
  return { lesson, w: createWorld({ scenario, rules: data.rules, settings, terrain: getTerrain() }) };
}

/** The state a lesson keeps, as the conditions read it. */
const state = (w) => ({ seen: new Set(), counts: {}, flags: new Set(), raids: new Set(), marks: {}, stepT: w.t });

test('a scenario written on another one takes its base and replaces whole keys', () => {
  const base = { id: 'base', ports: [1, 2], raids: ['a', 'b'], start: 'x', map: { zone: 'z' } };
  const own = { id: 'own', base: 'base', raids: ['c'], start: 'y' };
  const find = (id) => (id === 'base' ? base : null);
  const r = resolveScenario(own, find);
  assert.deepEqual(r, { id: 'own', ports: [1, 2], raids: ['c'], start: 'y', map: { zone: 'z' } });
  r.ports.push(3);
  assert.deepEqual(base.ports, [1, 2], 'the base is not touched');
  assert.equal(resolveScenario(base, find), base, 'a plain scenario is itself');
  assert.throws(() => resolveScenario({ id: 'lost', base: 'nowhere' }, find), /unknown base/);
  assert.throws(() => resolveScenario({ id: 'a', base: 'a' }, () => ({ id: 'a', base: 'a' })), /circle/);
});

test('a raid held back waits until the instructor releases it; the save keeps it held', () => {
  const { w } = lessonWorld('intercept');
  const held = w.raids.find((r) => r.id === 'd02');
  assert.equal(held.held, true);
  assert.equal(held.departure, HELD);
  run(w, 3600);
  assert.equal(held.phase, 'pending', 'an hour later it has not left');
  const again = lessonWorld('intercept').w;
  restore(again, JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(again.raids.find((r) => r.id === 'd02').held, true);
  assert.equal(releaseRaid(w, 'd02', 120), true);
  assert.equal(held.departure, w.t + 120);
  assert.equal(releaseRaid(w, 'd02', 0), false, 'released once');
  assert.equal(releaseRaid(w, 'd01', 0), false, 'a raid of the timetable is not held');
  run(w, 130);
  assert.notEqual(held.phase, 'pending', 'two minutes later it assembles');
});

test('lesson 1: the scramble of the demonstration, when the raid crosses the coast, is too late; at the first plot it wins', () => {
  for (const seed of [11, 4]) {
    const { lesson, w } = lessonWorld('intercept', seed);
    const demo = lesson.steps.find((s) => s.id === 'demo');
    const when = demo.do[0].when;
    const order = demo.do[0].order;
    const target = w.sites.get(order.toSite);
    const app = { world: w };
    let first = null;
    let ordered = null;
    let bombed = null;
    while (w.t < 3600 && bombed === null) {
      for (const e of run(w, 10)) {
        if (e.type === 'raidDetected' && first === null) first = w.t;
        if (e.type === 'siteHit') bombed = w.t;
      }
      if (ordered === null && holds(app, when, state(w))) {
        ordered = w.t;
        scramble(w, w.squadrons.find((s) => s.id === order.scramble), { route: [[target.x, target.y, order.altitudeFt * FOOT_M]] });
      }
    }
    assert.ok(first !== null && ordered !== null && bombed !== null, `seed ${seed}: seen, ordered, bombed`);
    assert.ok(ordered - first > 10 * 60, `seed ${seed}: the radar gave more than ten minutes (${ordered - first} s)`);
    assert.ok(bombed - ordered < 8 * 60, `seed ${seed}: the order left less than eight minutes (${bombed - ordered} s)`);
    assert.equal(w.stats.raidsIntercepted, 0, `seed ${seed}: the raid of the demonstration is not intercepted`);
    // The pupil's raid: released two minutes after the briefing, met by a squadron sent at the first plot.
    const pupil = lesson.steps.find((s) => s.id === 'watch').do[0].order;
    assert.equal(releaseRaid(w, pupil.releaseRaid, pupil.inS), true);
    const sq = w.squadrons.find((s) => s.id === '111');
    const end = w.t + 2 * 3600;
    let up = false;
    let over = false;
    while (w.t < end && !over) {
      over = run(w, 10).some((e) => e.type === 'raidReport' && e.raidId === pupil.releaseRaid);
      const c = w.contacts.get(pupil.releaseRaid);
      const est = c && !c.lost ? contactEstimate(w, c) : null;
      if (!est) continue;
      const route = [[est.x, est.y, (est.altFt + 2000) * FOOT_M]];
      if (!up) up = scramble(w, sq, { route });
      else if (sq.state === 'airborne' && w.t % 60 === 0) setRoute(w, sq, route);
    }
    assert.ok(up && over, `seed ${seed}: the pupil's raid is over`);
    assert.equal(w.stats.raidsIntercepted, 1, `seed ${seed}: the pupil's raid is intercepted`);
    assert.ok(distance(sq.x, sq.y, target.x, target.y) < 400);
    // The step of the lesson that waits for the end of this raid reads its report.
    const tu = state(w);
    assert.equal(holds({ world: w }, lesson.steps.find((s) => s.id === 'combat').done, tu), false);
    tu.raids.add(pupil.releaseRaid);
    assert.equal(holds({ world: w }, lesson.steps.find((s) => s.id === 'combat').done, tu), true);
  }
});

test('lesson 2: a train to the base, a minimum stock, and the fuel arrives', () => {
  const { lesson, w } = lessonWorld('supply');
  const app = { world: w };
  const key = 'airfield:biggin_hill';
  const base = w.sites.get(key);
  assert.ok(base.stocks.fuel < 6, 'the base is nearly dry');
  const step = (id) => lesson.steps.find((s) => s.id === id);
  assert.equal(holds(app, step('train').done, state(w)), false);
  const sent = sendTrain(w, 'port:southampton', key, { fuel: 20 });
  assert.ok(sent && sent.ok !== false, 'the train of the lesson can be sent');
  assert.equal(holds(app, step('train').done, state(w)), true);
  assert.equal(holds(app, step('minimum').done, state(w)), false);
  setMinStock(w, base, 'fuel', 30);
  assert.equal(holds(app, step('minimum').done, state(w)), true);
  assert.equal(holds(app, step('wait').done, state(w)), false);
  run(w, 14 * 3600);
  assert.equal(holds(app, step('wait').done, state(w)), true, `the fuel is there within the day (${base.stocks.fuel} t)`);
});

test('lesson 3: the first relief stops for the convoy in reach; a group sent, the lesson goes on', () => {
  const { lesson, w } = lessonWorld('escort');
  const app = { world: w };
  const step = (id) => lesson.steps.find((s) => s.id === id);
  const events = run(w, 3 * 3600);
  const stop = events.find((e) => e.type === 'seaStop' && e.reason === 'relief');
  assert.ok(stop, 'the relief of 8 o\'clock stops the game');
  const report = w.watch.reports[w.watch.reports.length - 1];
  assert.ok(report.decisions.some((d) => d.kind === 'reach'), 'a convoy in reach of a free group');
  const convoy = w.convoys.find((c) => c.state === 'atSea');
  assert.ok(convoy, 'the convoy of the lesson is at sea');
  assert.equal(holds(app, step('send').done, state(w)), false);
  assert.ok(joinConvoy(w, w.escorts[0], convoy.id));
  assert.equal(holds(app, step('send').done, state(w)), true);
  const tu = state(w);
  assert.equal(holds(app, step('orders').done, tu), false);
  tu.flags.add('action:escort-pattern');
  assert.equal(holds(app, step('orders').done, tu), true);
  // Within the forty hours the last step allows, the group is with its convoy.
  const t0 = w.t;
  while (w.t < t0 + 40 * 3600 && !holds(app, { escorting: true }, state(w))) run(w, 600);
  assert.ok(holds(app, { escorting: true }, state(w)), `the group has joined after ${((w.t - t0) / 3600).toFixed(0)} h`);
});

test('lesson 4: a tired squadron stood down rests in a night; the fresh one is recalled', () => {
  const { lesson, w } = lessonWorld('alert');
  const app = { world: w };
  const step = (id) => lesson.steps.find((s) => s.id === id);
  const tired = w.squadrons.find((s) => s.id === '32');
  const fresh = w.squadrons.find((s) => s.id === '111');
  assert.ok(tired.fatigue >= data.rules.crews.tiredAt && fresh.alert === 'rest');
  assert.equal(holds(app, step('rest').done, state(w)), false);
  setAlert(w, tired, 'rest');
  assert.equal(holds(app, step('rest').done, state(w)), true);
  setAlert(w, fresh, 'min5');
  assert.equal(holds(app, step('ready').done, state(w)), true);
  assert.equal(holds(app, step('night').done, state(w)), false);
  run(w, 6 * 3600);
  assert.equal(holds(app, step('night').done, state(w)), true, `rested (${tired.fatigue})`);
});
