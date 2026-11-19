// M2.10, I5 and I6: what the thresholds measure. The balance itself (ten seeds a conduct) is
// measured by the automatic player (tools/bot/measure.mjs, results in the journal); here, the
// rules that carry it: the hours out of service of the bases and of the radars, the fatigue of
// a week at readiness, and the objectives each battle is judged on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run, scenarioData } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { outOfServiceHours } from '../src/sim/objectives.js';
import { restore, snapshot } from '../src/save/game.js';
import { objectiveText } from '../src/ui/format.js';
import { runAir } from '../tools/bot/air.mjs';
import { CONDUCTS } from '../tools/bot/conducts.mjs';

setDictionary(data.fr);
const H = 3600;

/** An objective of this kind in Adlertag, for the aerodromes or for the radars. */
function outObjective(w, what) {
  return w.objectives.find((o) => o.type === 'outOfServiceBelow' && o[what]);
}

test('Adlertag: the hours out of service of the sector bases add up, and too many lose the objective', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const o = outObjective(w, 'airfields');
  assert.ok(o, 'Adlertag is judged on the hours its sector bases spend out of service');
  assert.equal(outOfServiceHours(o), 0);
  const [a, b] = o.airfields.map((id) => w.byId.airfield.get(id));
  // Two bases knocked out and kept out (the repair crews are fought back every minute).
  const events = [];
  for (let minute = 0; minute < o.hours * 60 && !o.failed; minute++) {
    a.damage = 100;
    b.damage = 100;
    events.push(...run(w, 60));
  }
  assert.ok(o.failed, 'over its hours, the objective is lost at once');
  assert.ok(outOfServiceHours(o) > o.hours && outOfServiceHours(o) < o.hours + 0.1, `${outOfServiceHours(o)} h`);
  assert.ok(events.some((e) => e.type === 'objectiveFailed'));
  assert.ok(w.t < (o.hours / 2) * H + 120, 'two bases out count double');
  // The count stops there, and the page tells it.
  const text = objectiveText(w, o);
  assert.ok(text.includes(`moins de ${o.hours} h`), text);
});

test('an aerodrome repaired within the hour costs that hour only; the count is saved with the game', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const o = outObjective(w, 'airfields');
  const field = w.byId.airfield.get(o.airfields[0]);
  field.damage = 82; // just out (80): back in service after half an hour of repairs
  run(w, 2 * H);
  const hours = outOfServiceHours(o);
  assert.ok(hours > 0.3 && hours < 1, `out for ${hours} h`);
  assert.equal(o.failed, false);
  const again = makeWorld('standard', {}, 'adlertag');
  restore(again, JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(outOfServiceHours(outObjective(again, 'airfields')), hours);
  // The radars have their own count; an installation that is not listed counts for nothing.
  const radars = outObjective(w, 'radars');
  assert.equal(outOfServiceHours(radars), 0);
  w.byId.radar.get(radars.radars[0]).damage = 100;
  const other = w.airfields.find((f) => !o.airfields.includes(f.id));
  other.damage = 100;
  run(w, H);
  assert.ok(outOfServiceHours(radars) > 0.9);
  assert.equal(outOfServiceHours(o), hours);
});

test('a battle held to the end wins the objective of the hours out of service', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  // No raid at all: the week goes by.
  w.raids = [];
  run(w, w.endS + 60);
  assert.ok(w.ended);
  for (const what of ['airfields', 'radars']) assert.equal(outObjective(w, what).done, true, what);
});

test('each battle is judged on what the decisions ask: convoys and aircraft down at Kanalkampf, bases, radars and supply at Adlertag', () => {
  const kk = scenarioData('kanalkampf').objectives;
  const cw = kk.find((o) => o.type === 'convoyDelivered' && o.convoy === 'cw');
  assert.ok(cw.share > 0.5, 'the threshold of the coastal convoy is raised (50 % until 2.9)');
  for (const o of kk.filter((x) => x.type === 'convoyDelivered' && x.convoy !== 'cw')) assert.ok(o.share > 0.6, 'and that of the ocean convoys');
  assert.ok(kk.some((o) => o.type === 'enemyDown' && o.count > 0), 'an objective of enemy aircraft down');
  assert.ok(kk.some((o) => o.type === 'fighterStrength'), 'beside the fighters preserved');
  const ad = scenarioData('adlertag');
  assert.equal(ad.objectives.filter((o) => o.type === 'outOfServiceBelow').length, 2);
  assert.ok(!ad.objectives.some((o) => o.type === 'basesOperational' || o.type === 'radarsOperational'), 'no longer judged on the last evening only');
  // Supply weighs: the bases where squadrons live do not hold the week on their own stocks.
  const L = data.rules.logistics;
  for (const field of ad.airfields) {
    const squadrons = ad.squadrons.filter((s) => s.airfield === field.id).length;
    if (!squadrons) continue;
    const days = (field.stocks.fuel - 2 * squadrons * 12 * L.fuelPerAircraftSortie * 4) / L.baseDailyFuel;
    assert.ok(days < 6.6, `${field.id}: its ${field.stocks.fuel} t would not last the week at two sorties a day (${days.toFixed(1)} days of the base's own needs left)`);
  }
});

test('I6: squadrons left a week at five minutes end tired at Adlertag; rested at night, they stay fresh', () => {
  const tiredAt = data.rules.crews.tiredAt;
  const left = runAir({ ...CONDUCTS.adlertag.simple, scenario: 'adlertag', preset: 'standard', seed: 3 });
  assert.ok(left.endFatigue >= tiredAt, `left at readiness all week: ${left.endFatigue} % at the end (tired from ${tiredAt})`);
  assert.ok(left.tired > 0, 'the player was told so on the way');
  const rested = runAir({ ...CONDUCTS.adlertag.soigne, scenario: 'adlertag', preset: 'standard', seed: 3 });
  assert.ok(rested.endFatigue < tiredAt / 2, `rested at night: ${rested.endFatigue} %`);
  assert.equal(rested.exhausted, 0);
});
