// What the review of 2.9 by a fresh reader found, each with the test that would have caught
// it: the game's keys alive under the main menu, saves damaged in ways the first validation
// did not see, a journal line that broke a loading half-way, a preset named two ways, tools a
// scenario does not offer still reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { data, getTerrain, makeWorld, run, scenarioData } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { createWorld, step } from '../src/sim/world.js';
import { addMobileRadar, deployMru } from '../src/sim/mru.js';
import { presetStory, setGameSetting } from '../src/sim/gameSettings.js';
import { snapshot, restore, shapeProblem } from '../src/save/game.js';
import { SaveError, readSave, soundJournal, soundMeta } from '../src/save/migrate.js';
import { setCampaignData } from '../src/ui/campaign.js';
import { BEGUN_AFTER_MS, autosave, gameInProgress, resumeRead, saveCurrent, saveErrorText, tickSaves, tryOutSave } from '../src/ui/game.js';
import { advance } from '../src/ui/loop.js';
import { toolOffered, viewOffered } from '../src/ui/offered.js';
import { createSignals } from '../src/ui/watchPanel.js';
import { createPlayClock } from '../src/ui/summary.js';

setDictionary(data.fr);
setCampaignData(JSON.parse(readFileSync(new URL('../data/campaign.json', import.meta.url), 'utf8')));

const IDS = ['m0-july-1940', 'kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique'];
const scenarios = IDS.map((id) => scenarioData(id === 'm0-july-1940' ? 'm0' : id));

/** A page reduced to what the saves and the loop need. */
function fakeApp(world, extra = {}) {
  const calls = { current: 0, auto: 0 };
  const store = {
    current: () => null,
    writeCurrent: () => {
      calls.current++;
      return { ok: true };
    },
    add: async (kind) => {
      calls[kind]++;
      return { ok: true };
    },
  };
  return {
    app: {
      world, store, signals: createSignals(), playClock: createPlayClock(), gameId: 'g1', logEntries: [], autoSlot: null, accumulator: 0, speed: 60, paused: false,
      data: { scenarios, rules: data.rules, presets: data.presets, scenario: world.scenario },
      settings: { ...data.presets.presets.standard, preset: 'standard' },
      terrain: getTerrain(),
      campaign: { results: {}, unlockAll: false },
      addMobileRadar,
      ...extra,
    },
    calls,
  };
}

/** A save as a file gives it: through JSON. */
function fileOf(world, extra = {}) {
  return JSON.parse(JSON.stringify({ game: 'jeu-1940', madeBy: 'test', savedAt: 1, snap: snapshot(world), meta: { gameId: 'g1', playClock: { totalMs: 5000, pausedMs: 0 } }, journal: [], ...extra }));
}

test('under the main menu the game does not move, whatever its speed', () => {
  // (Key 3 on the menu set the game going behind it: the handler of the keys and the loop
  // both let it. The keys are tried in the browser by the smoke test; the loop here.)
  const w = makeWorld('standard', {}, 'adlertag');
  const { app } = fakeApp(w, { speed: 600 });
  app.onMenu = true;
  for (let i = 0; i < 10; i++) advance(app, 0.5);
  assert.equal(w.t, 0, 'not a second of game under the menu');
  assert.equal(app.accumulator, 0, 'and nothing owed for later');
  app.onMenu = false;
  advance(app, 0.5);
  // (Half a second at ×600: 300 steps, or fewer when an event stops the game on the way.)
  assert.ok(w.t > 0 && w.t <= 300, `the game moves once the menu is left (${w.t} s)`);
});

test('a game is in hand once launched and begun; the page behind the menu is not a game', () => {
  const w = makeWorld('standard', {}, 'kanalkampf');
  const { app, calls } = fakeApp(w);
  assert.equal(gameInProgress(app), false, 'the world the page shows before anything is launched');
  app.playClock.totalMs = 10 * 60000;
  assert.equal(gameInProgress(app), false, 'however long the page stays open');
  // Launched, the clock stopped at the first minute while the player prepares his orders.
  app.launched = true;
  app.playClock.totalMs = BEGUN_AFTER_MS - 1;
  assert.equal(gameInProgress(app), false, 'just launched: nothing to keep yet');
  assert.equal(saveCurrent(app).code, 'nothing');
  app.playClock.totalMs = BEGUN_AFTER_MS;
  assert.equal(gameInProgress(app), true, 'a minute spent on it: a game to keep and to ask about');
  assert.equal(saveCurrent(app).ok, true);
  assert.equal(calls.current, 1);
  // Its clock moved: begun, whatever the time spent.
  const w2 = makeWorld('standard', {}, 'kanalkampf');
  const b = fakeApp(w2, { launched: true });
  run(w2, 1);
  assert.equal(gameInProgress(b.app), true);
  w2.ended = true;
  assert.equal(gameInProgress(b.app), false, 'over: nothing in hand');
});

test('a lesson of the tutorial is in hand but is never written in the browser', async () => {
  const w = makeWorld('standard', {}, 'm0');
  const { app, calls } = fakeApp(w, { launched: true, tutorial: { index: 2, steps: [] } });
  run(w, 3600);
  assert.equal(gameInProgress(app), true, '« Continuer » goes back to it while the page is open');
  assert.equal(saveCurrent(app).code, 'nothing');
  assert.equal((await autosave(app)).code, 'nothing');
  let now = 0;
  for (let i = 0; i < 26; i++) {
    run(w, 3600);
    now += 60000;
    tickSaves(app, now);
  }
  assert.deepEqual(calls, { current: 0, auto: 0 }, 'a whole game day of a lesson: nothing written');
  // The lesson over, the game goes on as any other and is kept.
  app.tutorial = null;
  run(w, 900);
  tickSaves(app, now + 60000);
  assert.equal(calls.current, 1);
});

test('the journal and the notes of a file are cleaned before anything is done with them', () => {
  // (A journal with a null line made the loading stop half-way, the game in hand already gone.)
  const lines = soundJournal([
    { text: 'Prise de service.', level: 'info', t: 0, report: null },
    null,
    'a line as text',
    { level: 'alert', t: 5 },
    { text: 'Raid H01', level: 7, t: 'soon', report: { id: 1 } },
    { text: 'Rapport', level: 'alert', t: 120, report: 'H01' },
    { text: 'Grenadage', level: 'info', t: 300, report: 4 },
  ]);
  assert.deepEqual(lines, [
    { text: 'Prise de service.', level: 'info', t: 0, report: null },
    { text: 'Raid H01', level: 'info', t: 0, report: null },
    { text: 'Rapport', level: 'alert', t: 120, report: 'H01' },
    { text: 'Grenadage', level: 'info', t: 300, report: 4 },
  ]);
  assert.deepEqual(soundJournal('not a list'), []);
  assert.deepEqual(soundJournal(undefined), []);
  assert.equal(soundMeta(null), null);
  assert.equal(soundMeta([1, 2]), null);
  assert.deepEqual(soundMeta({ signalsRead: 5, playClock: 'long', gameId: 12, gameMs: 'x', tutorial: true }), { playClock: null, gameId: null, signalsRead: [], gameMs: null });
  assert.deepEqual(soundMeta({ signalsRead: ['w1', null, { a: 1 }, 3], playClock: { totalMs: -5, pausedMs: 'x' }, gameId: 'g7', gameMs: 99, preset: 'standard' }),
    { playClock: { totalMs: 0, pausedMs: 0 }, gameId: 'g7', signalsRead: ['w1', 3], gameMs: 99, preset: 'standard' });
  // readSave gives them clean.
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 600);
  const read = readSave(fileOf(w, { journal: [null, { text: 'ok' }], meta: { signalsRead: 5 } }), IDS);
  assert.deepEqual(read.journal, [{ text: 'ok', level: 'info', t: 0, report: null }]);
  assert.deepEqual(read.meta.signalsRead, []);
});

test('a save that cannot be put in place leaves the game in hand exactly as it was', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 7200);
  const { app } = fakeApp(w, { launched: true, logEntries: [{ text: 'a', level: 'info', t: 0, report: null }] });
  const before = JSON.stringify(snapshot(app.world));
  const other = makeWorld('standard', {}, 'quinze-septembre');
  run(other, 600);
  for (const [why, spoil] of [
    ['a part of the wrong kind', (f) => { f.snap.formations = null; }],
    ['a counter missing', (f) => { delete f.snap.stats.bombersDown; }],
    ['a scenario the game does not know', (f) => { f.snap.scenario = 'stalingrad'; }],
    ['a position that is not a number', (f) => { f.snap.squadrons[0].x = 'east'; }],
  ]) {
    const file = fileOf(other);
    spoil(file);
    let r;
    try {
      r = resumeRead(app, readSave(file, IDS));
    } catch (err) {
      r = { ok: false, code: err.code };
    }
    assert.equal(r.ok, false, why);
    assert.equal(app.world, w, `${why}: the world in hand is the same`);
    assert.equal(JSON.stringify(snapshot(app.world)), before, `${why}: and nothing in it has changed`);
    assert.equal(app.logEntries.length, 1, `${why}: its journal too`);
    assert.equal(app.data.scenario, w.scenario);
  }
});

test('each part of a save is of the kind the game keeps there, or the save is refused', () => {
  for (const id of ['adlertag', 'hiver-atlantique', 'kanalkampf']) {
    const w = makeWorld('standard', { fatigue: 'on' }, id);
    const fresh = JSON.parse(JSON.stringify(snapshot(makeWorld('standard', { fatigue: 'on' }, id))));
    // A sound game, at several moments, through JSON as a file gives it.
    for (let i = 0; i < 4; i++) {
      run(w, 6 * 3600);
      const snap = JSON.parse(JSON.stringify(snapshot(w)));
      assert.equal(shapeProblem(fresh, snap, true), null, `${id} after ${(i + 1) * 6} h`);
    }
    const good = JSON.parse(JSON.stringify(snapshot(w)));
    const spoilt = (change) => {
      const s = structuredClone(good);
      change(s);
      return shapeProblem(fresh, s, true);
    };
    for (const [k, v] of Object.entries(good)) {
      if (k === 'version' || k === 'scenario') continue;
      const removed = spoilt((s) => { delete s[k]; });
      assert.ok(removed instanceof SaveError && removed.code === 'damaged' && removed.detail === k, `${id}: « ${k} » removed`);
      if (fresh[k] !== null) {
        const nulled = spoilt((s) => { s[k] = null; });
        assert.ok(nulled instanceof SaveError && nulled.detail === k, `${id}: « ${k} » set to nothing`);
      }
      if (Array.isArray(v) || (v && v.__map) || (v && v.__set)) {
        assert.ok(spoilt((s) => { s[k] = {}; }) instanceof SaveError, `${id}: « ${k} » made a plain record`);
      } else if (typeof v === 'number') {
        assert.ok(spoilt((s) => { s[k] = 'x'; }) instanceof SaveError, `${id}: « ${k} » made a text`);
      }
    }
    // The records with fixed entries: an entry missing or of another kind.
    assert.equal(spoilt((s) => { s.stats = {}; }).detail, 'stats.bombersDown');
    assert.equal(spoilt((s) => { s.stats.shipsSunk = '3'; }).detail, 'stats.shipsSunk');
    assert.equal(spoilt((s) => { s.settings = {}; }).detail, 'settings.preset');
    assert.equal(spoilt((s) => { s.pilots.pending = 4; }).detail, 'pilots.pending');
    // An older format may lack what was added since (it stays as the new world has it), but
    // never what every format has had, and never with a part of the wrong kind.
    const old = structuredClone(good);
    for (const k of ['watch', 'signals', 'nextSignalId', 'settings', 'presetStart', 'navalReports']) delete old[k];
    delete old.stats.pilotsKilled;
    assert.equal(shapeProblem(fresh, old, false), null, `${id}: an older save without the parts added since`);
    delete old.contacts;
    assert.equal(shapeProblem(fresh, old, false).detail, 'contacts');
  }
});

test('a file damaged in one of its parts is refused in plain French, or loads and plays', () => {
  // (Each part of a real save removed, emptied or made a plain record: 19 to 21 of those
  // variants loaded and then stopped the game on an error.)
  const outcome = { refused: 0, played: 0 };
  for (const id of ['adlertag', 'hiver-atlantique']) {
    const w = makeWorld('standard', { fatigue: 'on' }, id);
    if (id === 'adlertag') deployMru(w, w.airfields[0].x + 20, w.airfields[0].y + 20, 90);
    run(w, id === 'adlertag' ? 30 * 3600 : 6 * 86400);
    const { app } = fakeApp(w);
    const good = fileOf(w);
    const variants = [];
    for (const k of Object.keys(good.snap)) {
      variants.push([`${k} removed`, (f) => { delete f.snap[k]; }]);
      variants.push([`${k} = null`, (f) => { f.snap[k] = null; }]);
      variants.push([`${k} = {}`, (f) => { f.snap[k] = {}; }]);
      variants.push([`${k} = []`, (f) => { f.snap[k] = []; }]);
    }
    for (const [name, spoil] of variants) {
      const file = structuredClone(good);
      spoil(file);
      let read = null;
      try {
        read = readSave(file, IDS);
        tryOutSave(app, read);
      } catch (err) {
        assert.ok(err instanceof SaveError, `${id}, ${name}: refused with a reason of the game, not a raw error (${err.message})`);
        const said = saveErrorText({ ok: false, code: err.code, detail: err.detail });
        assert.ok(said.length > 30 && !/undefined|Cannot|TypeError|null|\{detail\}|save\./.test(said), `${id}, ${name}: ${said}`);
        outcome.refused++;
        continue;
      }
      // Accepted: it must then be a game that plays (two game hours here).
      const again = makeWorld('standard', { fatigue: 'on' }, id);
      restore(again, read.snap, addMobileRadar);
      assert.doesNotThrow(() => {
        for (let i = 0; i < 7200 && !again.ended; i++) step(again, 1);
      }, `${id}, ${name}: accepted, then stops on an error`);
      outcome.played++;
    }
    // Damage inside a part, which its kind does not show: the trial (ten game minutes on a
    // world of its own) stops the file before it replaces anything.
    const quiet = console.warn;
    console.warn = () => {};
    try {
      for (const [name, spoil] of [
        ['a convoy without its route', (f) => { for (const c of f.snap.convoys) c.route = null; }],
        ['objectives that are nothing', (f) => { f.snap.objectives = f.snap.objectives.map(() => null); }],
        ['a formation that is nothing', (f) => { f.snap.formations = [null]; }],
        ['a timetable entry that is nothing', (f) => { f.snap.scheduled = [null]; }],
      ]) {
        const file = structuredClone(good);
        spoil(file);
        assert.throws(() => tryOutSave(app, readSave(file, IDS)), (err) => err instanceof SaveError && err.code === 'damaged' && err.detail === 'trial', `${id}: ${name}`);
      }
    } finally {
      console.warn = quiet;
    }
    // The file as it was loads, and plays on exactly as the game it was taken from.
    const sound = readSave(structuredClone(good), IDS);
    tryOutSave(app, sound);
    const again = makeWorld('standard', { fatigue: 'on' }, id);
    restore(again, sound.snap, addMobileRadar);
    run(w, 3600);
    run(again, 3600);
    assert.equal(JSON.stringify(snapshot(again)), JSON.stringify(snapshot(w)), `${id}: the sound file plays on alike (the trial touched nothing)`);
  }
  assert.ok(outcome.refused > 300, `most variants are refused (${outcome.refused} refused, ${outcome.played} still games)`);
});

test('every refusal has its sentence, in plain words', () => {
  assert.match(saveErrorText({ ok: false, code: 'nothing' }), /arrêtée par une erreur/);
  assert.match(saveErrorText({ ok: false, code: 'damaged', detail: 'trial' }), /abîmée \(elle s'arrête sur une erreur dès qu'on la joue\)/);
  assert.match(saveErrorText({ ok: false, code: 'damaged', detail: 'restore' }), /abîmée \(elle ne se laisse pas remettre en place\)/);
  assert.match(saveErrorText({ ok: false, code: 'damaged', detail: 'stats.bombersDown' }), /abîmée \(la partie « stats\.bombersDown » manque/);
  assert.match(saveErrorText({ ok: false, code: 'unknownScenario', detail: 'stalingrad' }), /\(stalingrad\)/);
  for (const code of ['notAGame', 'tooNew', 'damaged', 'unknownScenario', 'wrongScenario', 'storage', 'missing', 'nothing']) {
    assert.ok(typeof data.fr.save.errors[code] === 'string' && data.fr.save.errors[code].length > 20, code);
  }
});

test('the preset a game begins with is named as it will be all along', () => {
  // (A player on Standard who carries nothing over in the campaign: « custom » at the start,
  // then « standard » after any order on a setting, with the very same settings.)
  const mine = { ...data.presets.presets.standard, carry: 'none', preset: 'custom' };
  const worldWith = (settings, presets) => createWorld({ scenario: structuredClone(scenarioData('adlertag')), rules: data.rules, settings, terrain: getTerrain(), presets });
  const w = worldWith(mine, data.presets);
  assert.equal(w.settings.preset, 'standard');
  assert.equal(w.presetStart, 'standard');
  assert.equal(w.settings.carry, 'none', 'what the player chose is kept');
  assert.ok(setGameSetting(w, 'falseAlarms', true, data.presets));
  assert.equal(w.settings.preset, 'custom');
  assert.ok(setGameSetting(w, 'falseAlarms', false, data.presets));
  assert.deepEqual(presetStory(w), { start: 'standard', end: 'standard', changed: false });
  // A preset as it is, and settings that are none of the three.
  assert.equal(worldWith({ ...data.presets.presets.realistic, preset: 'realistic' }, data.presets).presetStart, 'realistic');
  assert.equal(worldWith({ ...data.presets.presets.standard, fuel: 'unlimited', preset: 'standard' }, data.presets).presetStart, 'custom');
  // Without the table (the tools, the tests) the name given is kept.
  assert.equal(worldWith(mine, null).presetStart, 'custom');
});

test('a tool or a view a scenario does not offer cannot be reached', () => {
  // (15 September: Adlertag has the Atlantic view since 2.12, for its convoy HX 62.)
  const w = makeWorld('standard', { fatigue: 'on' }, 'quinze-septembre');
  const app = { world: w };
  assert.equal(viewOffered({ world: makeWorld('standard', {}, 'adlertag') }, 'atlantic'), true, 'Adlertag: HX 62 comes from 21° W');
  // As the scenario is written: Britain and England, every tool.
  assert.equal(viewOffered(app, 'atlantic'), false);
  assert.equal(viewOffered(app, 'england'), true);
  for (const tool of ['ruler', 'radarCover', 'reports', 'formations', 'roster', 'cards']) assert.equal(toolOffered(app, tool), true, tool);
  // A scenario that declares less.
  w.scenario.map = { ...w.scenario.map, tools: ['formations', 'cards'], views: ['england'] };
  assert.deepEqual(['ruler', 'radarCover', 'reports', 'formations', 'roster', 'cards'].filter((x) => toolOffered(app, x)), ['formations', 'cards']);
  assert.deepEqual(['atlantic', 'britain', 'england'].filter((x) => viewOffered(app, x)), ['england']);
  // One that declares nothing offers everything; the radar cover needs a radar, and the
  // duty rosters a game where the pilots tire (I6: « bouton Effectifs masqué sans fatigue »).
  delete w.scenario.map;
  assert.equal(toolOffered(app, 'roster'), true);
  assert.equal(viewOffered(app, 'atlantic'), true);
  w.radars.length = 0;
  assert.equal(toolOffered(app, 'radarCover'), false);
  assert.equal(toolOffered({ world: makeWorld('standard', { fatigue: 'off' }, 'adlertag') }, 'roster'), false);
  assert.equal(toolOffered({ world: makeWorld('standard', { fatigue: 'losses' }, 'adlertag') }, 'roster'), true);
  // … and a squadron to put on them, whatever its role. The review of 2.10 hid the page in the
  // Atlantic (no fighter there: it opened empty); play-testing showed the other half of the
  // fault: the patrols tire and could not be rested. Since 2.10.2 everything that flies has
  // its alert state and its plan, so the page is offered there, with the patrols on it.
  const sea = makeWorld('standard', { fatigue: 'on' }, 'hiver-atlantique');
  assert.equal(sea.squadrons.some((s) => s.role === 'fighter'), false);
  assert.equal(toolOffered({ world: sea }, 'roster'), true);
  assert.equal(toolOffered({ world: makeWorld('standard', { fatigue: 'off' }, 'hiver-atlantique') }, 'roster'), false);
  sea.squadrons.length = 0; // nobody to plan for: no page
  assert.equal(toolOffered({ world: sea }, 'roster'), false);
  // The lesson of the escort has a patrol squadron, but it is played without fatigue (its own
  // settings: the alert states are lesson 4's), so the page stays away there.
  const lesson = JSON.parse(readFileSync(new URL('../data/tutorial.json', import.meta.url), 'utf8')).lessons.find((l) => l.id === 'escort');
  assert.equal(lesson.settings.fatigue, 'off');
  assert.equal(toolOffered({ world: makeWorld('standard', lesson.settings, 'lecon-escorter') }, 'roster'), false);
  assert.equal(toolOffered({ world: makeWorld('standard', { fatigue: 'on' }, 'lecon-alerte') }, 'roster'), true);
  // The keys, the top bar and the sheets all ask there.
  const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  assert.match(read('ui/input.js'), /views\[name\]\.key\.toLowerCase\(\) === key\.toLowerCase\(\) && viewOffered\(app, name\)/);
  assert.match(read('main.js'), /tool === 'ruler' && !toolOffered\(app, 'ruler'\)/);
  for (const [file, tool] of [['ui/rosterPage.js', 'roster'], ['ui/formationsPage.js', 'formations'], ['ui/pages.js', 'reports'], ['ui/pages.js', 'cards']]) {
    assert.ok(read(file).includes(`if (!toolOffered(app, '${tool}')) return;`), `${file}: the page of « ${tool} »`);
  }
});
