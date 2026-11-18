// Games saved by version 2.6.1 (tests/fixtures, made by make-saves.mjs from a checkout of that
// version) are restored by the current code and go on: no error, the fields added since are
// there, and the measure of the fighter objective is the right one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { data, getTerrain, scenarioData } from './helpers.js';
import { createWorld, step } from '../src/sim/world.js';
import { drainEvents } from '../src/sim/events.js';
import { restore, snapshot } from '../src/save/game.js';
import { addMobileRadar } from '../src/sim/mru.js';
import { fighterCount, fighterEstablishmentShare, fighterShare } from '../src/sim/objectives.js';

function load(name) {
  const file = new URL(`./fixtures/save-2.6.1-${name}.json.gz`, import.meta.url);
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
