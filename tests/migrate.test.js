// I7, Code 7, Code 8: saved games carry a format number; one migration a format brings an
// older game up to date; a file that is not a game, comes from a later version or is damaged
// is refused with a reason before anything is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { data, getTerrain, makeWorld, run, scenarioData } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { SNAP_VERSION, SaveError, migrate, readSave, readSaveText, snapVersion, validate } from '../src/save/migrate.js';
import { exportText, restore, snapshot } from '../src/save/game.js';
import { setAlert } from '../src/sim/orders.js';
import { addDaily, addOverride, startOverride } from '../src/sim/roster.js';

const KNOWN = ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique', 'm0-july-1940'];

function fixture(name) {
  const file = new URL(`./fixtures/save-2.6.1-${name}.json.gz`, import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
}

function code(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof SaveError, `a SaveError, not ${err}`);
    return err.code;
  }
  return null;
}

test('a snapshot is written in the current format, with its number', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 600);
  const snap = snapshot(w);
  assert.equal(snap.version, SNAP_VERSION);
  assert.equal(SNAP_VERSION, 3); // (3 since 2.12: the watches wherever there are ships)
  assert.equal(snapVersion(snap), 3);
  assert.equal(validate(JSON.parse(JSON.stringify(snap)), KNOWN), null, 'sound');
  // The current format is left as it is, but copied: the migration never writes into its input.
  const copy = migrate(snap);
  assert.notEqual(copy, snap);
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(snap)));
});

test('format 1 to 2: the readiness states take their new names wherever a squadron keeps one', () => {
  const old = {
    version: 1,
    squadrons: [
      { id: 'a', alert: 'thirty', alertFrom: 'available', roster: { daily: [{ id: 1, tod: 0, alert: 'available' }, { id: 2, tod: 3600, alert: 'rest' }], override: { entries: [{ id: 3, at: 10, alert: 'thirty' }] } } },
      { id: 'b', alert: 'available', alertFrom: null, roster: { daily: [], override: null } },
      { id: 'c', alert: 'cockpit', roster: [{ at: 100, alert: 'thirty', daily: true }] }, // a roster of 2.3
      { id: 'd' },
    ],
    mru: { available: 2, pending: [] }, // not a readiness state: left alone
  };
  const snap = migrate(old);
  assert.equal(snap.version, SNAP_VERSION, 'brought to the format in use, one step after the other');
  assert.equal(old.version, 1, 'the input is not touched');
  assert.equal(old.squadrons[0].alert, 'thirty');
  const [a, b, c, d] = snap.squadrons;
  assert.deepEqual([a.alert, a.alertFrom], ['min30', 'min5']);
  assert.deepEqual(a.roster.daily.map((e) => e.alert), ['min5', 'rest']);
  assert.deepEqual(a.roster.override.entries.map((e) => e.alert), ['min30']);
  assert.deepEqual([b.alert, b.alertFrom], ['min5', null]);
  assert.equal(c.alert, 'cockpit');
  assert.equal(c.roster[0].alert, 'min30');
  assert.deepEqual(d, { id: 'd' });
  assert.equal(snap.mru.available, 2);
});

test('the names thirty and available are gone from the rules, the texts and the simulation', () => {
  const alert = data.rules.crews.alert;
  assert.deepEqual(Object.keys(alert), ['rest', 'min30', 'min5', 'cockpit']);
  assert.equal(alert.min30.scrambleS, 1800);
  assert.equal(alert.min5.scrambleS, 300);
  for (const group of ['states.alert', 'orders.alertNames', 'orders.alertShort']) {
    const node = group.split('.').reduce((o, k) => o && o[k], data.fr);
    assert.ok(node && node.min30 && node.min5, `${group} has the new names`);
    assert.ok(!('thirty' in node) && !('available' in node), `${group} has dropped the old ones`);
  }
});

test('a game of 2.8 with readiness states and a roster is resumed with the new names and goes on alike', () => {
  // A game of today, written back as format 1 would have written it.
  const w = makeWorld('standard', { fatigue: 'on' }, 'adlertag');
  const [s1, s2] = w.squadrons.filter((s) => s.role === 'fighter');
  setAlert(w, s1, 'min30');
  addDaily(w, s2, 6 * 3600, 'min30');
  addDaily(w, s2, 20 * 3600, 'rest');
  startOverride(w, s1, 12);
  addOverride(w, s1, 2, 'min5');
  run(w, 1800);
  const now = JSON.parse(JSON.stringify(snapshot(w)));
  const old = JSON.parse(JSON.stringify(now).replaceAll('"min30"', '"thirty"').replaceAll('"min5"', '"available"'));
  old.version = 1;
  delete old.settings;
  delete old.presetStart;
  const again = makeWorld('standard', { fatigue: 'on' }, 'adlertag');
  restore(again, old);
  const r1 = again.squadrons.find((s) => s.id === s1.id);
  const r2 = again.squadrons.find((s) => s.id === s2.id);
  assert.equal(r1.alert, s1.alert);
  assert.deepEqual(r2.roster.daily.map((e) => e.alert), ['min30', 'rest']);
  assert.deepEqual(r1.roster.override.entries.map((e) => e.alert), ['min5']);
  run(w, 6 * 3600);
  run(again, 6 * 3600);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(again))), JSON.parse(JSON.stringify(snapshot(w))));
});

test('the games saved by 2.6.1 are format 1: they load, with the new names', () => {
  for (const name of ['adlertag', 'quinze-septembre-campagne', 'hiver-atlantique']) {
    const saved = fixture(name);
    assert.equal(saved.snap.version, 1, name);
    const read = readSave(saved, KNOWN);
    assert.equal(read.snap.version, SNAP_VERSION);
    assert.equal(read.madeBy, '2.6.1');
    for (const s of read.snap.squadrons) assert.ok(['rest', 'min30', 'min5', 'cockpit', undefined].includes(s.alert), `${name} ${s.id}: ${s.alert}`);
    assert.equal(saved.snap.version, 1, 'the file read is not changed');
  }
});

test('what is not a game, or comes from a later version, is refused with its reason', () => {
  assert.equal(code(() => readSaveText('this is not JSON', KNOWN)), 'notAGame');
  assert.equal(code(() => readSaveText('{"hello":1}', KNOWN)), 'notAGame');
  assert.equal(code(() => readSaveText('null', KNOWN)), 'notAGame');
  assert.equal(code(() => readSaveText('[1,2,3]', KNOWN)), 'notAGame');
  assert.equal(code(() => readSaveText(JSON.stringify({ game: 'another-game', snap: { version: 1 } }), KNOWN)), 'notAGame');
  assert.equal(code(() => readSaveText(JSON.stringify({ game: 'jeu-1940', snap: {} }), KNOWN)), 'notAGame');
  assert.equal(code(() => readSaveText(JSON.stringify({ game: 'jeu-1940', snap: { version: 'two' } }), KNOWN)), 'notAGame');
  assert.equal(code(() => migrate({ version: SNAP_VERSION + 1 })), 'tooNew');
  const w = makeWorld('standard', {}, 'adlertag');
  const later = JSON.parse(exportText(w));
  later.snap.version = 99;
  assert.equal(code(() => readSave(later, KNOWN)), 'tooNew');
});

test('a damaged game is refused before the world is touched', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 600);
  const good = JSON.parse(exportText(w));
  assert.equal(code(() => readSave(good, KNOWN)), null, 'the file as exported loads');
  const broken = (change) => {
    const copy = structuredClone(good);
    change(copy.snap);
    return code(() => readSave(copy, KNOWN));
  };
  assert.equal(broken((s) => { delete s.squadrons; }), 'damaged');
  assert.equal(broken((s) => { s.convoys = 'none'; }), 'damaged');
  assert.equal(broken((s) => { s.t = null; }), 'damaged');
  assert.equal(broken((s) => { s.t = -5; }), 'damaged');
  assert.equal(broken((s) => { delete s.rng; }), 'damaged');
  assert.equal(broken((s) => { s.squadrons[0].x = null; }), 'damaged');
  assert.equal(broken((s) => { s.squadrons[3] = 'oops'; }), 'damaged');
  assert.equal(broken((s) => { delete s.stats; }), 'damaged');
  assert.equal(broken((s) => { s.scenario = 'stalingrad'; }), 'unknownScenario');
  assert.equal(broken((s) => { delete s.scenario; }), 'damaged');
  // Restoring a damaged snapshot throws, and leaves the world as it was.
  const target = makeWorld('standard', {}, 'adlertag');
  const before = JSON.stringify(snapshot(target));
  const bad = structuredClone(good.snap);
  delete bad.raids;
  assert.equal(code(() => restore(target, bad)), 'damaged');
  assert.equal(JSON.stringify(snapshot(target)), before, 'untouched');
  // A game of another scenario is not restored onto this one.
  const other = createWorld({ scenario: structuredClone(scenarioData('kanalkampf')), rules: data.rules, settings: { ...data.presets.presets.standard }, terrain: getTerrain() });
  assert.equal(code(() => restore(other, good.snap)), 'wrongScenario');
});

test('every reason a game can be refused for has its sentence', () => {
  for (const c of ['notAGame', 'tooNew', 'damaged', 'unknownScenario', 'wrongScenario', 'storage', 'missing']) {
    const text = data.fr.save.errors[c];
    assert.ok(typeof text === 'string' && text.length > 20, `save.errors.${c}`);
  }
});

// ---- format 3 (2.12): the watches wherever there are ships ----

test('format 2 to 3: a game that kept no watch lets the world it is restored onto keep its own', () => {
  // Kanalkampf or Adlertag saved before 2.12: the sea lived as it came, `watch` was nothing.
  const before = { version: 2, t: 3600, watch: null, squadrons: [], signals: [] };
  const snap = migrate(before);
  assert.equal(snap.version, 3);
  assert.ok(!('watch' in snap), 'left out: the new world has the watch of a game with ships');
  assert.equal(before.watch, null, 'the input is not touched');
  // The Atlantic, which lived by the watches already: its reports come back as they were.
  const atlantic = { version: 2, t: 3600, watch: { notes: [], reports: [{ id: 'W1', toS: 7200 }], nextId: 2, asked: [], told: [], nights: {} }, squadrons: [] };
  assert.deepEqual(migrate(atlantic).watch, atlantic.watch);
  // A save of 2.6 goes through both steps.
  const old = migrate({ version: 1, watch: null, squadrons: [{ id: 'a', alert: 'thirty' }] });
  assert.equal(old.version, 3);
  assert.equal(old.squadrons[0].alert, 'min30');
  assert.ok(!('watch' in old));
});
