// Code 4, N9: the settings of a game belong to the game. Copied into the world when it is
// created, changed only by an order, saved with it; the preset can change on the way, and the
// game remembers the one it began with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, getTerrain, run, scenarioData } from './helpers.js';
import { createWorld } from '../src/sim/world.js';
import { GAME_SETTING_KEYS, applyPreset, canSetGameSetting, copyGameSettings, matchingPreset, presetStory, setGameSetting } from '../src/sim/gameSettings.js';
import { sendOrder } from '../src/sim/comms.js';
import { restore, snapshot } from '../src/save/game.js';
import { project } from '../src/sim/geo.js';

const P = data.presets;

/** The settings a player has: a preset by its name, the options, and what is only display. */
function playerSettings(preset = 'standard') {
  return { preset, ...P.presets[preset], ...P.options, sheetW: 420, volume: 35, scenario: 'adlertag' };
}

function world(scenario, settings) {
  return createWorld({ scenario: structuredClone(scenarioData(scenario)), rules: data.rules, settings, terrain: getTerrain() });
}

test('the world keeps its own copy of the game settings, and nothing of the display', () => {
  const mine = playerSettings('realistic');
  const w = world('adlertag', mine);
  assert.notEqual(w.settings, mine, 'a copy');
  assert.equal(w.settings.preset, 'realistic');
  assert.equal(w.presetStart, 'realistic');
  for (const k of Object.keys(P.presets.realistic)) assert.equal(w.settings[k], P.presets.realistic[k], k);
  assert.equal(w.settings.watchStops, P.options.watchStops);
  for (const k of ['sheetW', 'volume', 'scenario', 'sound', 'nightShadow', 'lowRes']) assert.ok(!(k in w.settings), `${k} is display`);
  // The player changes his own settings afterwards: the game under way is not touched.
  mine.detection = 'exact';
  mine.fatigue = 'off';
  mine.preset = 'custom';
  assert.equal(w.settings.detection, 'delayed');
  assert.equal(w.settings.fatigue, 'losses');
  assert.equal(w.settings.preset, 'realistic');
});

test('every setting the simulation reads is one of the game settings', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/sim/', import.meta.url);
  const used = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/settings\.([a-zA-Z]+)/g)) used.add(m[1]);
  }
  used.delete('preset');
  assert.ok(used.size >= 8, [...used].join(' '));
  for (const k of used) assert.ok(GAME_SETTING_KEYS.includes(k), `${k} is read by the simulation but is not copied into the world`);
  // And every value of a preset is one too.
  for (const k of Object.keys(P.presets.standard)) assert.ok(GAME_SETTING_KEYS.includes(k), k);
  assert.deepEqual(Object.keys(copyGameSettings({})), ['preset']);
});

test('a setting changes by an order: checked, told to the journal, and the preset follows', () => {
  const w = world('adlertag', playerSettings('standard'));
  run(w, 60);
  assert.ok(canSetGameSetting(w, 'fatigue', 'off', P));
  assert.ok(!canSetGameSetting(w, 'fatigue', 'plenty', P), 'not one of the choices');
  assert.ok(!canSetGameSetting(w, 'volume', 10, P), 'display is not the game');
  assert.ok(!canSetGameSetting(w, 'carry', 'full', P), 'what the campaign carried over is fixed at the start');
  assert.equal(setGameSetting(w, 'fatigue', 'plenty', P), false);
  assert.equal(setGameSetting(w, 'fatigue', 'on', P), false, 'the same value: nothing happens');
  assert.equal(w.events.filter((e) => e.type === 'settingChanged').length, 0);
  assert.equal(setGameSetting(w, 'fatigue', 'off', P), true);
  assert.equal(w.settings.fatigue, 'off');
  assert.equal(w.settings.preset, 'custom', 'no longer the Standard preset');
  const ev = w.events.find((e) => e.type === 'settingChanged');
  assert.deepEqual({ key: ev.key, from: ev.from, value: ev.value, preset: ev.preset }, { key: 'fatigue', from: 'on', value: 'off', preset: 'custom' });
  // Back to the value of the preset: it is Standard again.
  assert.equal(setGameSetting(w, 'fatigue', 'on', P), true);
  assert.equal(w.settings.preset, 'standard');
  assert.equal(matchingPreset(w.settings, P), 'standard');
});

test('the preset can change during the game, and the game remembers how it began', () => {
  const w = world('adlertag', playerSettings('realistic'));
  run(w, 60);
  assert.deepEqual(presetStory(w), { start: 'realistic', end: 'realistic', changed: false });
  assert.equal(applyPreset(w, 'nonsense', P), false);
  assert.equal(applyPreset(w, 'realistic', P), false, 'already there');
  assert.equal(applyPreset(w, 'standard', P), true);
  for (const [k, v] of Object.entries(P.presets.standard)) if (k !== 'carry') assert.equal(w.settings[k], v, k);
  assert.equal(w.settings.carry, 'full', 'what was carried over stays as it began');
  const ev = w.events.find((e) => e.type === 'presetChanged');
  assert.equal(ev.from, 'realistic');
  // The carry-over, fixed at the start, does not count in the name: the game is Standard now.
  assert.equal(w.settings.preset, 'standard');
  assert.deepEqual(presetStory(w), { start: 'realistic', end: 'standard', changed: true });
  // One setting changed after that: a preset of its own.
  assert.ok(setGameSetting(w, 'fuel', 'unlimited', P));
  assert.equal(w.settings.preset, 'custom');
  assert.ok(applyPreset(w, 'realistic', P));
  assert.deepEqual(presetStory(w), { start: 'realistic', end: 'realistic', changed: false });
});

test('the settings and the first preset are saved with the game, not taken from the player', () => {
  const w = world('adlertag', playerSettings('realistic'));
  run(w, 600);
  setGameSetting(w, 'detection', 'exact', P);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  assert.equal(snap.settings.detection, 'exact');
  assert.equal(snap.presetStart, 'realistic');
  // Resumed by a player whose own settings are Arcade today.
  const again = world('adlertag', playerSettings('arcade'));
  restore(again, snap);
  assert.deepEqual(again.settings, w.settings);
  assert.equal(again.presetStart, 'realistic');
  assert.equal(again.settings.fatigue, 'losses');
  run(w, 3600);
  run(again, 3600);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(again))), JSON.parse(JSON.stringify(snapshot(w))), 'the same game goes on');
});

test('a game saved before 2.9 takes the settings of the player who resumes it', () => {
  const w = world('adlertag', playerSettings('standard'));
  run(w, 600);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  delete snap.settings;
  delete snap.presetStart;
  snap.version = 1;
  const again = world('adlertag', playerSettings('realistic'));
  restore(again, snap);
  assert.equal(again.settings.preset, 'realistic');
  assert.equal(again.presetStart, 'realistic');
});

test('communications set back to direct: the orders waiting go at once, the ships are followed again', () => {
  const w = world('hiver-atlantique', playerSettings('standard'));
  assert.equal(w.settings.seaComms, 'silence');
  // A convoy in mid-ocean, out of the tracked waters.
  run(w, 6 * 86400, (e) => e.type === 'convoyDeparted');
  const c = w.convoys.find((x) => x.type === 'ocean') || w.convoys[0];
  assert.ok(c, 'a convoy has sailed');
  const [x, y] = project(-30, 54);
  Object.assign(c, { state: 'atSea', x, y, px: x, py: y, route: [[x + 900, y]], plan: [], zigzag: false });
  run(w, 120);
  w.events.length = 0;
  const sent = sendOrder(w, c, 'zigzag', true);
  assert.equal(sent.via, 'radio', 'under silence it waits for the relief');
  assert.equal(c.zigzag, false);
  assert.equal(w.signals.length, 1);
  assert.ok(setGameSetting(w, 'seaComms', 'direct', P));
  assert.equal(w.signals.length, 0);
  assert.equal(c.zigzag, true, 'passed at once');
  assert.ok(w.events.some((e) => e.type === 'orderDelivered' && e.unitId === c.id));
  assert.equal(c.est, null, 'no estimate any more');
  // And a new order is carried out at once.
  assert.equal(sendOrder(w, c, 'zigzag', false).via, 'direct');
  assert.equal(c.zigzag, false);
  // Back under silence: within the minute the ship has a sure point, then an estimate.
  assert.ok(setGameSetting(w, 'seaComms', 'silence', P));
  run(w, 120);
  assert.ok(c.fix && c.est, 'a sure point and an estimate again');
});

test('same seed, same orders, a preset changed on the way, a save resumed by another player: the same game', () => {
  const play = (resume) => {
    let w = world('hiver-atlantique', playerSettings('standard'));
    run(w, 30 * 3600);
    assert.ok(applyPreset(w, 'realistic', P));
    run(w, 6 * 3600);
    assert.ok(setGameSetting(w, 'watchStops', 'twice', P));
    if (resume) {
      const snap = JSON.parse(JSON.stringify(snapshot(w)));
      w = world('hiver-atlantique', playerSettings('arcade'));
      restore(w, snap);
    }
    run(w, 36 * 3600);
    // (The stops at the reliefs are an option, not part of a preset: the game is still Réaliste.)
    assert.equal(w.settings.preset, 'realistic');
    assert.equal(w.settings.watchStops, 'twice');
    assert.equal(w.presetStart, 'standard');
    return JSON.stringify(snapshot(w));
  };
  const once = play(false);
  assert.equal(play(false), once, 'played twice');
  assert.equal(play(true), once, 'saved and resumed on the way');
});
