// Games saved by version 2.6.1 (tests/fixtures, made by make-saves.mjs from a checkout of that
// version) are restored by the current code and go on: no error, the fields added since are
// there, and the measure of the fighter objective is the right one. And games saved by 2.9.0,
// the first version of format 2: a version that adds a part to the world without a new
// format and its migration would refuse them (save/game.js, shapeProblem), and fail here.
// And a game saved by 2.10.2 (make-save-2.10.2.mjs), whose escort groups are in the states
// version 2.10.3 keeps otherwise: a channel chosen as a bare name, a way out of port counted
// at the wrong end of the route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { data, getTerrain, scenarioData } from './helpers.js';
import { createWorld, step } from '../src/sim/world.js';
import { drainEvents } from '../src/sim/events.js';
import { restore, snapshot } from '../src/save/game.js';
import { SNAP_VERSION, readSave } from '../src/save/migrate.js';
import { addMobileRadar } from '../src/sim/mru.js';
import { fighterCount, fighterEstablishmentShare, fighterShare } from '../src/sim/objectives.js';
import { chartedRun, editShipRoute, editablePoints, plannedExit } from '../src/sim/convoy.js';
import { project } from '../src/sim/geo.js';

function load(name, version = '2.6.1') {
  const file = new URL(`./fixtures/save-${version}-${name}.json.gz`, import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
}

/** As the game resumes a save: a new world of the scenario, then the snapshot onto it. */
function resume(saved, preset, carry = null) {
  const w = createWorld({
    scenario: structuredClone(scenarioData(saved.snap.scenario)), rules: data.rules,
    settings: { ...data.presets.presets[preset] }, terrain: getTerrain(), carry,
  });
  drainEvents(w);
  restore(w, saved.snap, addMobileRadar);
  return w;
}

function play(w, seconds) {
  for (let i = 0; i < seconds && !w.ended; i++) {
    step(w, 1);
    w.events.length = 0;
  }
}

test('a game of Adlertag saved by 2.6.1, with a mobile station on its way, goes on for a day', () => {
  const saved = load('adlertag');
  assert.equal(saved.madeBy, '2.6.1');
  assert.equal(saved.snap.fightersAtStart, undefined, 'the old save knows nothing of the new measure');
  const w = resume(saved, 'standard');
  assert.ok(w.squadrons.some((s) => s.id === '266'), 'the relief squadron is there');
  assert.ok(w.mru.pending.length === 1, 'the station is on its way');
  assert.ok(w.formations.length === 1, 'the wing is there');
  // The fighters of the start: those of a new game and the relief arrived since, so that the
  // measure is the one this game had (the establishment).
  assert.equal(w.fightersAtStart, fighterCount(w).establishment);
  assert.equal(fighterShare(w), fighterEstablishmentShare(w));
  play(w, 86400); // the station is installed after six hours: the crash of 2.6.1 came then
  assert.ok(w.radars.some((r) => r.mobile), 'the station is in the chain');
  assert.equal(w.ended, false);
  // And the game saved now is restored exactly.
  const text = JSON.stringify(snapshot(w));
  const again = resume({ snap: JSON.parse(text) }, 'standard');
  assert.equal(JSON.stringify(snapshot(again)), text);
});

test('a campaign game of 15 September saved by 2.6.1 gets a fighter objective it can meet', () => {
  const saved = load('quinze-septembre-campagne');
  // The game resumes it with what the campaign carries over (main.js: carryFor).
  const carry = { fighterShare: 0.6, from: 'adlertag' };
  const w = resume(saved, 'realistic', carry);
  const { now, establishment } = fighterCount(w);
  assert.equal(w.fightersAtStart, 133, 'seven aircraft a squadron, as the campaign left them');
  assert.equal(establishment, 228);
  // Nothing lost yet that morning, and a few aircraft from the factories: above the 70 % asked.
  assert.ok(now >= 133 && fighterShare(w) >= 1, `${now} fighters now, share ${fighterShare(w).toFixed(2)}`);
  assert.ok(fighterEstablishmentShare(w) < 0.62, 'measured on the establishment it never was');
  play(w, 6 * 3600);
  assert.equal(Number.isFinite(fighterShare(w)), true);
});

test('a game of the Atlantic saved by 2.6.1 keeps its convoys, its numbers and its squadrons', () => {
  const saved = load('hiver-atlantique');
  const w = resume(saved, 'standard');
  const stragglers = w.convoys.filter((c) => c.straggler);
  assert.ok(stragglers.length > 0, 'stragglers at sea');
  // The fields 2.6.1 forgot on stragglers are filled in.
  for (const c of w.convoys) {
    assert.equal(c.schedule, null, `${c.name}: schedule`);
    assert.equal(typeof c.rangeAlerted, 'boolean', `${c.name}: rangeAlerted`);
  }
  // Escort groups saved before the depth charges (2.8): full racks, full patterns, and the
  // length of a hunt, which the player set then, is gone.
  assert.ok(saved.snap.escorts.every((e) => 'huntHours' in e && !('charges' in e)), 'a save of before the depth charges');
  for (const e of w.escorts) {
    assert.equal(e.chargesMax, 40 * e.ships, `${e.name}: stock`);
    assert.equal(e.charges, e.chargesMax, `${e.name}: full racks`);
    assert.equal(e.pattern, 'full');
    assert.equal(e.chargesOut, false);
    assert.ok(!('huntHours' in e), `${e.name}: no hunt hours`);
    if (e.state === 'hunting' && !e.huntStay) assert.ok(e.huntUntil - w.t <= w.rules.asw.engagement.searchS, 'a hunt under way ends with a search');
  }
  // The game keeps what it was begun with: HX 100 and the Anson of 502 Sqn, at Aldergrove.
  assert.ok(w.convoys.some((c) => c.name === 'HX 100'), 'HX 100 is still HX 100');
  assert.equal(w.squadrons.find((s) => s.id === '502').type, 'Anson');
  assert.equal(w.squadrons.find((s) => s.id === '10 RAAF').airfield, 'pembroke_dock');
  const names = () => w.convoys.filter((c) => !c.straggler).map((c) => c.name);
  const before = names().length;
  play(w, 6 * 86400);
  assert.ok(names().length > before, 'new convoys have sailed');
  assert.equal(new Set(w.convoys.map((c) => c.id)).size, w.convoys.length, 'no two convoys with the same id');
  assert.equal(new Set(names()).size, names().length, 'no two convoys with the same name');
  const text = JSON.stringify(snapshot(w));
  assert.equal(JSON.stringify(snapshot(resume({ snap: JSON.parse(text) }, 'standard'))), text);
});

test('the games saved by 2.9.0 (format 2) load with every part in its place, and go on', () => {
  const ids = ['m0-july-1940', 'kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique'];
  for (const [name, carry] of [['adlertag', null], ['quinze-septembre-campagne', { fighterShare: 0.6, from: 'adlertag' }], ['hiver-atlantique', null]]) {
    const saved = load(name, '2.9.0');
    assert.equal(saved.madeBy, '2.9.0');
    assert.equal(saved.snap.version, 2, `${name}: format 2`);
    // Read as a file is: the format, the validation, the journal and the notes.
    const read = readSave(structuredClone(saved), ids);
    assert.equal(read.complete, SNAP_VERSION === 2, `${name}: a save of the format in use has every part`);
    // Restored with the settings of another player (Arcade): the game keeps its own.
    const w = resume(saved, 'arcade', carry);
    assert.equal(w.settings.preset, saved.snap.settings.preset, `${name}: its preset`);
    assert.equal(w.presetStart, saved.snap.presetStart);
    assert.equal(w.t, saved.snap.t);
    play(w, 86400);
    assert.ok(w.t > saved.snap.t, `${name}: the game goes on`);
    for (const [k, v] of Object.entries(w.stats)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}: stats.${k}`);
    // Saved by this version, it comes back exactly.
    const text = JSON.stringify(snapshot(w));
    assert.equal(JSON.stringify(snapshot(resume({ snap: JSON.parse(text) }, 'realistic', carry))), text, `${name}: saved again and restored`);
  }
  // What each fixture was made to hold.
  const a = resume(load('adlertag', '2.9.0'), 'standard');
  assert.ok(a.squadrons.some((s) => s.id === '266') && a.mru.pending.length === 1 && a.formations.length === 1, 'Adlertag: the relief, the station on its way, the wing');
  const s = resume(load('hiver-atlantique', '2.9.0'), 'standard');
  assert.ok(s.watch && s.watch.reports.length > 20 && s.signals.length >= 0, 'the Atlantic: its watch reports');
  assert.ok(s.escorts.every((e) => Number.isFinite(e.charges)), 'its depth charges');
});

test('a game of the Atlantic saved by 2.10.2: the group that waited sails, the ways out of port are read as steps', () => {
  const saved = load('hiver-atlantique-sorties', '2.10.2');
  assert.equal(saved.madeBy, '2.10.2');
  const was = (id) => saved.snap.escorts.find((e) => e.id === id);
  // What 2.10.2 wrote: no field of 2.10.3, an order that waits past its hour, locks at the wrong end.
  assert.ok(saved.snap.escorts.every((e) => !('routeHead' in e) && !('exitPlanned' in e)));
  assert.equal(was('eg1').schedule.delayed, true, 'EG 1: its sailing waited (« ni route ni étapes »)');
  assert.equal(was('eg1').route.length, 0);
  assert.equal(was('eg2').routeLocked, was('eg2').route.length, 'EG 2: every point of its route locked');
  assert.equal(was('eg3').routeLocked, 8, 'EG 3: its channel counted as the end of its route');
  const read = readSave(structuredClone(saved), ['hiver-atlantique']);
  assert.equal(read.complete, SNAP_VERSION === 2, 'a save of format 2 (the format in use until 2.12)');
  const w = resume(saved, 'standard');
  const group = (id) => w.escorts.find((e) => e.id === id);
  const events = [];
  const play2 = (seconds) => {
    for (let i = 0; i < seconds; i++) {
      step(w, 1);
      events.push(...w.events);
      w.events.length = 0;
    }
  };
  play2(120);
  // EG 1: its channel becomes its exit step, and the sailing that waited leaves, late.
  const eg1 = group('eg1');
  assert.equal(eg1.state, 'atSea');
  assert.equal(eg1.schedule, null);
  assert.equal(eg1.exitPlanned, true);
  assert.equal(eg1.routeHead, eg1.route.length);
  assert.equal(chartedRun(w, eg1.route), eg1.route.length, 'down the channel chosen in 2.10.2');
  assert.ok(events.some((e) => e.type === 'scheduledSail' && e.unitId === 'eg1' && e.late));
  // EG 3: still in port until its hour, with its step and its line told apart.
  const eg3 = group('eg3');
  assert.equal(eg3.state, 'inPort');
  assert.equal(plannedExit(eg3), 'Canal Saint-Georges');
  assert.equal(eg3.routeHead, 8);
  assert.equal(eg3.routeLocked, 0);
  assert.deepEqual(eg3.route, was('eg3').route, 'not a point of its route has moved');
  assert.equal(editablePoints(eg3).length, 2, 'the two points drawn are the player\'s');
  // EG 2: going down its channel, its line can be changed again and drawn longer.
  const eg2 = group('eg2');
  assert.equal(eg2.routeLocked, 0);
  assert.equal(eg2.routeHead, chartedRun(w, eg2.route));
  const mine = editablePoints(eg2).map((p) => [p[0], p[1]]);
  assert.equal(mine.length, eg2.route.length - eg2.routeHead);
  assert.ok(mine.length >= 3, `the points drawn (${mine.length}) can be moved; in 2.10.2 none could`);
  assert.ok(editShipRoute(w, eg2, [...mine, project(-20, 58)]).ok);
  // EG 4 waited at the roads and still does. And at its hour EG 3 sails, on time.
  assert.equal(group('eg4').state, 'waiting');
  play2(was('eg3').schedule.at - w.t + 60);
  assert.equal(eg3.state, 'atSea');
  assert.ok(events.some((e) => e.type === 'scheduledSail' && e.unitId === 'eg3' && !e.late));
  // The game goes on, and saved by this version it comes back exactly.
  play(w, 86400);
  assert.equal(w.ended, false);
  const text = JSON.stringify(snapshot(w));
  assert.equal(JSON.stringify(snapshot(resume({ snap: JSON.parse(text) }, 'standard'))), text);
});

// ---- 2.12: the watches wherever there are ships ----

test('a game of Kanalkampf saved by 2.11.1, when its sea was lived as it came, goes on at the rhythm of the watches', async () => {
  const { isSilent, shownPosition } = await import('../src/sim/comms.js');
  const { clockHour, pendingDecisions, watchReport } = await import('../src/sim/watch.js');
  const saved = load('kanalkampf', '2.11.1');
  assert.equal(saved.madeBy, '2.11.1');
  assert.equal(saved.snap.version, 2);
  assert.equal(saved.snap.watch, null, 'it kept no watch');
  const read = readSave(structuredClone(saved), ['kanalkampf']);
  assert.equal(read.complete, false, 'an older format: brought to the one in use');
  const w = resume(saved, 'standard');
  assert.equal(w.t, saved.snap.t);
  // The watch of a game that begins: nothing written, nothing asked.
  assert.deepEqual(w.watch, { notes: [], reports: [], nextId: 1, asked: [], told: [], nights: {} });
  assert.ok(isSilent(w), 'Standard: radio silence, from now on');
  // What it was doing goes on: HX 55 on the Admiralty's route with EG 1 on its way, HX 57 left to itself.
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  const hx57 = w.convoys.find((c) => c.id === 'hx57');
  assert.ok(hx55.route.length > 0 && w.escorts.some((e) => e.joinTarget === 'hx55' || e.escorting === 'hx55'));
  assert.equal(hx57.route.length, 0);
  assert.ok(pendingDecisions(w).some((d) => d.key === 'adrift:hx57'), 'the convoy nobody routed is asked about at last');
  const events = [];
  for (let i = 0; i < 5 * 3600; i++) {
    step(w, 1);
    events.push(...w.events);
    w.events.length = 0;
  }
  // The relief that follows the loading writes the first report, and stops for what waits.
  const first = watchReport(w, w.watch.reports[0].id);
  assert.equal(clockHour(w, first.toS), 12, 'saved at 08:00: the relief of noon');
  assert.equal(first.stop, 'decision');
  assert.ok(first.fresh.includes('adrift:hx57'));
  assert.ok(first.convoys.some((c) => c.id === 'hx55') && first.convoys.some((c) => c.id === 'hx57'));
  assert.ok(events.some((e) => e.type === 'seaStop' && e.reason === 'relief'));
  // Its ships on the high seas are placed by estimate, from where they were met.
  assert.equal(shownPosition(w, hx57).est, true);
  assert.ok(hx57.fix && hx57.est);
  play(w, 2 * 86400);
  assert.equal(w.ended, false);
  for (const [k, v] of Object.entries(w.stats)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `stats.${k}`);
  // Saved by this version, it comes back exactly, with its reports.
  const text = JSON.stringify(snapshot(w));
  assert.equal(JSON.parse(text).version, SNAP_VERSION);
  assert.ok(JSON.parse(text).watch.reports.length >= 12);
  assert.equal(JSON.stringify(snapshot(resume({ snap: JSON.parse(text) }, 'standard'))), text);
});

test('a game of Adlertag saved before 2.12 keeps what it was begun with, at the rhythm of the watches', () => {
  const saved = load('adlertag', '2.9.0');
  const w = resume(saved, 'standard');
  assert.ok(w.watch, 'HX 62 and EG 1: ships, so the watches');
  // Aldergrove is on the map of 2.12, but its two squadrons were not in that game.
  assert.ok(w.byId.airfield.get('aldergrove'));
  assert.ok(!w.squadrons.some((s) => s.id === '502' || s.id === '233'));
  play(w, 86400);
  assert.ok(w.watch.reports.length >= 6, 'six reliefs a day');
  assert.equal(w.ended, false);
});
