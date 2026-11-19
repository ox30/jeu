// Everything that flies tires, so everything that flies has its alert state and its plan
// (asked after play-testing 2.10 in « Hiver dans l'Atlantique »: the patrols came back tired
// from one sortie and could not be put at rest, the buttons and the Effectifs page being the
// fighters' only). The simulation never made the difference; the interface no longer does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { data, makeWorld, run } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { scrambleSeconds } from '../src/sim/crews.js';
import { scramble, setAlert } from '../src/sim/orders.js';
import { addDaily, copyDaily, timeOfDay } from '../src/sim/roster.js';
import { eventMessage } from '../src/ui/messages.js';
import { rosterFields, rosterSquadrons } from '../src/ui/rosterPage.js';

setDictionary(data.fr);

const atlantic = () => makeWorld('standard', { fatigue: 'on' }, 'hiver-atlantique');
/** Seconds after midnight, `minutes` from now on the game clock. */
const todIn = (w, minutes) => (timeOfDay(w) + minutes * 60) % 86400;

test('a Coastal Command squadron rests and is recalled like a fighter one', () => {
  const w = atlantic();
  const s = w.squadrons.find((x) => x.role === 'coastal');
  assert.equal(s.alert, 'min5', 'at five minutes when the game begins');
  // Left at five minutes it does not recover: this is what the player saw.
  s.fatigue = 70;
  run(w, 8 * 3600);
  assert.ok(s.fatigue >= 70, `eight hours at five minutes rest nothing (${s.fatigue})`);
  // At rest it does, eight points an hour, and its crews are two hours away.
  assert.equal(setAlert(w, s, 'rest'), true);
  assert.equal(s.alert, 'rest');
  assert.equal(scrambleSeconds(w, s), 7200);
  const before = s.fatigue;
  run(w, 8 * 3600);
  assert.ok(Math.abs(before - s.fatigue - 64) < 1.5, `a night at rest gives back 64 points (${before - s.fatigue})`);
  // Recalled to five minutes: 1 h 55, the player told when it is over.
  setAlert(w, s, 'min5');
  assert.equal(s.alertAt, w.t + 6900);
  const ev = run(w, 6900 + 60);
  assert.ok(ev.some((e) => e.type === 'alertReached' && e.squadronId === s.id));
  assert.equal(scrambleSeconds(w, s), 300);
});

test('a patrol flown from rest leaves two hours after the order', () => {
  const w = atlantic();
  const s = w.squadrons.find((x) => x.role === 'coastal');
  setAlert(w, s, 'rest');
  assert.equal(scramble(w, s, { orbit: true }), true);
  assert.equal(s.state, 'scrambling');
  run(w, 7200 - 120);
  assert.equal(s.state, 'scrambling', 'not yet in the air');
  run(w, 240);
  assert.equal(s.state, 'airborne');
});

test('the daily plan of a patrol: at rest in the evening, available in the morning', () => {
  const w = atlantic();
  const [a, b] = w.squadrons.filter((x) => x.role === 'coastal');
  a.fatigue = 70;
  addDaily(w, a, todIn(w, 30), 'rest');
  addDaily(w, a, todIn(w, 10 * 60), 'min30');
  let ev = run(w, 45 * 60);
  assert.ok(ev.some((e) => e.type === 'rosterApplied' && e.squadronId === a.id && e.alert === 'rest'));
  assert.equal(a.alert, 'rest');
  ev = run(w, 10 * 3600);
  assert.ok(ev.some((e) => e.type === 'rosterApplied' && e.squadronId === a.id && e.alert === 'min30'));
  assert.ok(a.fatigue < 5, `rested by the morning (${a.fatigue})`);
  // The plan copies to another patrol squadron (« Copier ce plan vers »).
  assert.equal(copyDaily(w, a, b), true);
  assert.deepEqual(b.roster.daily.map((e) => [e.tod, e.alert]), a.roster.daily.map((e) => [e.tod, e.alert]));
});

test('the Effectifs page lists every squadron, whatever its role', () => {
  const sea = atlantic();
  const fields = rosterFields(sea);
  assert.ok(fields.length > 0, 'the aerodromes of the patrols are on the page');
  const listed = fields.flatMap((f) => rosterSquadrons(sea, f.id));
  assert.deepEqual([...new Set(listed.map((s) => s.id))].sort(), sea.squadrons.map((s) => s.id).sort());
  assert.ok(listed.every((s) => s.role === 'coastal'));
  // Over Britain: the fighters, the spotter section and Coastal Command, each at its aerodrome.
  const air = makeWorld('standard', { fatigue: 'on' }, 'adlertag');
  const roles = new Set(rosterFields(air).flatMap((f) => rosterSquadrons(air, f.id)).map((s) => s.role));
  assert.deepEqual([...roles].sort(), ['coastal', 'fighter', 'watch']);
  // A squadron lost has no plan to make.
  const lost = air.squadrons.find((s) => s.role === 'watch');
  lost.state = 'lost';
  assert.equal(rosterFields(air).flatMap((f) => rosterSquadrons(air, f.id)).includes(lost), false);
  // No limit to the fighters left in the page, the sheet or the copy of a plan.
  const read = (f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
  assert.equal(/role [!=]== 'fighter'/.test(read('rosterPage.js')), false);
  const panels = read('panels.js');
  for (const name of ['tiredText', 'alertBlock', 'rosterTab']) {
    const from = panels.indexOf(`function ${name}(`);
    assert.ok(from > 0, name);
    assert.equal(/role [!=]== 'fighter'/.test(panels.slice(from, panels.indexOf('\n}\n', from))), false, `${name} is for every squadron`);
  }
  const copy = read('actions.js');
  const at = copy.indexOf('export function orderRosterCopy(');
  assert.equal(/role [!=]== 'fighter'/.test(copy.slice(at, copy.indexOf('\n}\n', at))), false);
});

test('the journal tells a tired patrol how to rest, not that it fights less well', () => {
  const w = makeWorld('standard', { fatigue: 'on' }, 'adlertag');
  const fighter = w.squadrons.find((s) => s.role === 'fighter');
  const patrol = w.squadrons.find((s) => s.role === 'coastal');
  const say = (type, s) => eventMessage(w, { type, t: 0, squadron: s.name, squadronId: s.id, n: 63 });
  const tiredFighter = say('squadronTired', fighter);
  assert.match(tiredFighter.text, /se bat moins bien/);
  assert.equal(tiredFighter.level, 'warning');
  const tiredPatrol = say('squadronTired', patrol);
  assert.match(tiredPatrol.text, new RegExp(`^${patrol.name} est fatiguée \\(63 %\\)`));
  assert.match(tiredPatrol.text, /Repos/);
  assert.doesNotMatch(tiredPatrol.text, /se bat|pertes/);
  assert.equal(tiredPatrol.level, 'warning');
  // Exhausted: an alarm for a fighter squadron (heavier losses), a notice for a patrol.
  assert.equal(say('squadronExhausted', fighter).level, 'alert');
  const spent = say('squadronExhausted', patrol);
  assert.equal(spent.level, 'warning');
  assert.match(spent.text, /épuisée \(63 %\)/);
  assert.doesNotMatch(spent.text, /pertes|efficacité/);
});
