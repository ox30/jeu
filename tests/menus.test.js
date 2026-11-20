// The main menu and the life of a game on the page (M2.9): the action table of the panels,
// the rhythm of the automatic saves, and the texts of the scenario cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { data, makeWorld, run } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { PANEL_ACTIONS, PANEL_CHANGES } from '../src/ui/panelActions.js';
import { autosavePeriodS, autosaveSlot, buildSave, gameInProgress, saveCurrent, tickSaves } from '../src/ui/game.js';
import { playLengthText, scenarioDatesText } from '../src/ui/menu.js';
import { createSignals } from '../src/ui/watchPanel.js';
import { createPlayClock } from '../src/ui/summary.js';
import { readSave } from '../src/save/migrate.js';
import { VERSION } from '../src/core/version.js';

setDictionary(data.fr);
const root = new URL('..', import.meta.url);
const H = 3600;

/** Every action a page writes on a button or a field: { name → files }. */
function written(pattern) {
  const out = new Map();
  const files = [...readdirSync(new URL('src/ui/', root)).filter((f) => f.endsWith('.js')).map((f) => `src/ui/${f}`), 'index.html'];
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const m of text.matchAll(pattern)) {
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1]).add(file);
    }
  }
  return out;
}

test('every button the panels write has its entry in the action table, and no entry is dead', () => {
  const clicks = new Map([...written(/\b(?:button|cmdButton)\(\s*'([a-z0-9-]+)'/g), ...written(/data-action="([a-z0-9-]+)"/g)]);
  assert.ok(clicks.size > 50, 'the buttons were found');
  for (const [name, files] of clicks) assert.ok(PANEL_ACTIONS[name], `no entry for the action « ${name} » (${[...files].join(', ')})`);
  for (const name of Object.keys(PANEL_ACTIONS)) assert.ok(clicks.has(name), `the entry « ${name} » answers no button`);
  const changes = written(/data-change="([a-z0-9-]+)"/g);
  for (const [name, files] of changes) assert.ok(PANEL_CHANGES[name], `no entry for the field « ${name} » (${[...files].join(', ')})`);
  for (const name of Object.keys(PANEL_CHANGES)) assert.ok(changes.has(name), `the entry « ${name} » answers no field`);
});

test('automatic saves: one a game day, every two game hours in a battle of one day', () => {
  // (The training scenario runs on the calendar of Kanalkampf: a long game.)
  const expected = { 'quinze-septembre': 2 * H, m0: 86400, kanalkampf: 86400, adlertag: 86400, 'hiver-atlantique': 86400 };
  for (const [id, period] of Object.entries(expected)) {
    const w = makeWorld('standard', {}, id);
    assert.equal(autosavePeriodS(w), period, id);
  }
  // A long game: the slot turns at midnight of the game clock, and only then.
  const w = makeWorld('standard', {}, 'adlertag');
  const start = new Date(w.startMs);
  const toMidnight = 86400 - (start.getUTCHours() * H + start.getUTCMinutes() * 60 + start.getUTCSeconds());
  const first = autosaveSlot(w);
  w.t = toMidnight - 1;
  assert.equal(autosaveSlot(w), first, 'the same day until midnight');
  w.t = toMidnight;
  assert.equal(autosaveSlot(w), first + 1, 'a new day at midnight');
  w.t = toMidnight + 86399;
  assert.equal(autosaveSlot(w), first + 1);
  // A battle of one day: on the even hours.
  const b = makeWorld('standard', {}, 'quinze-septembre');
  const slots = new Set();
  for (let t = 0; t <= 6 * H; t += 600) {
    b.t = t;
    slots.add(autosaveSlot(b));
  }
  assert.ok(slots.size === 3 || slots.size === 4, `three or four periods in six hours (${slots.size})`);
});

/** A page reduced to what the saves need, with a store that counts. */
function fakeApp(world) {
  const calls = { current: 0, auto: 0, manual: 0, last: null };
  const store = {
    current: () => null,
    writeCurrent: (save) => {
      calls.current++;
      calls.last = save;
      return { ok: true };
    },
    add: async (kind, save) => {
      calls[kind]++;
      calls.last = save;
      return { ok: true };
    },
  };
  return { app: { world, store, signals: createSignals(), playClock: createPlayClock(), gameId: 'g1', logEntries: [{ text: 'line', level: 'info', t: 0, report: null }], autoSlot: null }, calls };
}

test('a game under way is kept every quarter of a game hour, and saved again when the day turns', () => {
  const w = makeWorld('standard', {}, 'kanalkampf');
  const { app, calls } = fakeApp(w);
  assert.equal(gameInProgress(app), false, 'a game not yet begun is not in hand');
  tickSaves(app, 0);
  assert.equal(calls.current, 0, 'nothing to keep yet');
  let now = 0;
  // Two game days, a tick a game minute, five real seconds apart.
  for (let minute = 0; minute < 2 * 24 * 60 && !w.ended; minute++) {
    run(w, 60);
    now += 5000;
    tickSaves(app, now);
  }
  assert.ok(gameInProgress(app));
  assert.ok(calls.current >= 2 * 24 * 4 - 8, `kept every quarter of an hour (${calls.current})`);
  assert.equal(calls.auto, 2, 'two midnights: two automatic saves');
  // What is written is a whole save: the game, its settings, its journal, who made it.
  const save = calls.last;
  assert.equal(save.madeBy, VERSION);
  assert.equal(save.snap.settings.preset, 'custom');
  assert.equal(save.journal.length, 1);
  const read = readSave(JSON.parse(JSON.stringify(save)), ['kanalkampf']);
  assert.equal(read.snap.scenario, 'kanalkampf');
  assert.equal(read.journal[0].text, 'line');
});

test('a game over, or stopped by an error, is no longer written', () => {
  const w = makeWorld('standard', {}, 'm0');
  const { app, calls } = fakeApp(w);
  run(w, 600);
  assert.equal(saveCurrent(app).ok, true);
  assert.equal(calls.current, 1);
  app.crash = { message: 'x' };
  assert.equal(saveCurrent(app).ok, false);
  app.crash = null;
  w.ended = true;
  assert.equal(saveCurrent(app).ok, false);
  tickSaves(app, 1e9);
  assert.equal(calls.current, 1);
  assert.ok(buildSave(app).snap.ended);
});

test('the cards of the scenarios tell their dates and their length in plain words', () => {
  assert.equal(scenarioDatesText({ start: '1940-09-15T06:00', end: '1940-09-15T20:00' }), '15 septembre 1940');
  assert.equal(scenarioDatesText({ start: '1940-08-13T05:00', end: '1940-08-18T21:00' }), '13 – 18 août 1940');
  assert.equal(scenarioDatesText({ start: '1941-01-10T06:00', end: '1941-03-31T06:00' }), '10 janvier – 31 mars 1941');
  assert.equal(playLengthText([15, 25]), '15 à 25 min');
  assert.equal(playLengthText([180, 300]), '3 à 5 h');
  assert.equal(playLengthText([45, 90]), '45 min à 1 h 30');
  assert.equal(playLengthText([90, 180]), '1 h 30 à 3 h');
});
