// The campaign in Réaliste (I1 of the audit): the squadrons start a battle short of the
// aircraft lost in the one before, and the objective of fighter strength is measured on the
// fighters present that morning. Measured on the establishment, 15 September could not be won.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { drainEvents } from '../src/sim/events.js';
import { step } from '../src/sim/world.js';
import { restore, snapshot } from '../src/save/game.js';
import { checkDefeat, fighterCount, fighterEstablishmentShare, fighterShare, finalize } from '../src/sim/objectives.js';
import { readFileSync } from 'node:fs';
import { carryFor, recordResult, setCampaignData } from '../src/ui/campaign.js';
import { objectiveText } from '../src/ui/format.js';
import { eventMessage } from '../src/ui/messages.js';
import { runAir } from '../tools/bot/air.mjs';
import { CONDUCTS } from '../tools/bot/conducts.mjs';

setDictionary(data.fr);

// The chain of the campaign is data since 2.9: given to the module as the page does.
setCampaignData(JSON.parse(readFileSync(new URL('../data/campaign.json', import.meta.url), 'utf8')));

const fighters = (w) => w.squadrons.filter((s) => s.role === 'fighter');

test('the fighter objective is measured on the fighters present when the scenario begins', () => {
  const carry = { fighterShare: 0.6, from: 'adlertag' };
  const w = makeWorld('realistic', {}, 'quinze-septembre', carry);
  const { now, establishment } = fighterCount(w);
  assert.ok(now < establishment, 'the squadrons start short of aircraft');
  assert.equal(w.fightersAtStart, now);
  assert.equal(fighterShare(w), 1, 'nothing lost yet today');
  assert.ok(Math.abs(fighterEstablishmentShare(w) - 0.6) < 0.03, 'about 60 % of the establishment');

  // A day without a loss: the objective of 70 % holds, which the establishment never allowed.
  const objective = w.objectives.find((o) => o.type === 'fighterStrength');
  assert.equal(objective.share, 0.7);
  for (const o of w.objectives) if (o !== objective) o.done = true;
  finalize(w);
  assert.equal(objective.done, true);
  assert.equal(w.outcome, 'victory');
});

test('losses of the day count against the fighters of the morning, for the objective and the defeat', () => {
  const w = makeWorld('realistic', {}, 'quinze-septembre', { fighterShare: 0.6, from: 'adlertag' });
  const start = w.fightersAtStart;
  // A third of the fighters of the morning are lost: 67 % left, under the 70 % asked.
  let toLose = Math.ceil(start / 3);
  for (const s of fighters(w)) {
    const n = Math.min(s.aircraft, toLose);
    s.aircraft -= n;
    toLose -= n;
  }
  assert.ok(fighterShare(w) < 0.7 && fighterShare(w) > 0.6);
  assert.equal(checkDefeat(w), null, 'not bled white: the defeat is at 35 % of the morning');
  const objective = w.objectives.find((o) => o.type === 'fighterStrength');
  finalize(w);
  assert.equal(objective.done, false);
  // Down to a third of the morning: Fighter Command is bled white.
  const w2 = makeWorld('realistic', {}, 'quinze-septembre', { fighterShare: 0.6, from: 'adlertag' });
  for (const s of fighters(w2)) s.aircraft = Math.floor(s.aircraft * 0.3);
  assert.equal(checkDefeat(w2), 'fighters');
});

test('without a campaign the measure is the one of before: the establishment', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  assert.equal(w.carry, null);
  assert.equal(w.fightersAtStart, fighterCount(w).establishment);
  assert.equal(fighterShare(w), fighterEstablishmentShare(w));
});

test('the campaign carries the share of the establishment, not the share of the morning', () => {
  const c = { results: {}, unlockAll: false };
  const w = makeWorld('realistic', {}, 'adlertag', { fighterShare: 0.6, from: 'kanalkampf' });
  w.outcome = 'victory';
  // The game records what is left of the establishment (main.js): the next battle starts from it.
  recordResult(c, w, fighterEstablishmentShare(w));
  const next = carryFor(c, 'quinze-septembre', 'full');
  assert.ok(next && Math.abs(next.fighterShare - 0.6) < 0.03, 'Réaliste: all the losses, at least 60 %');
});

test('the save keeps the strength of the morning and what the campaign brought', () => {
  const carry = { fighterShare: 0.6, from: 'adlertag' };
  const w = makeWorld('realistic', {}, 'quinze-septembre', carry);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  // Restored onto a world built without the campaign (its results may have changed since).
  const back = restore(makeWorld('realistic', {}, 'quinze-septembre'), snap);
  assert.equal(back.fightersAtStart, w.fightersAtStart);
  assert.deepEqual(back.carry, w.carry);
  assert.equal(fighterShare(back), 1);
  // And the other way round: a game begun without the campaign stays so, whatever came since.
  const plain = JSON.parse(JSON.stringify(snapshot(makeWorld('realistic', {}, 'quinze-septembre'))));
  const again = restore(makeWorld('realistic', {}, 'quinze-septembre', carry), plain);
  assert.equal(again.carry, null);
  assert.equal(again.fightersAtStart, fighterCount(again).establishment);
});

test('15 September can be won in Réaliste with the losses of the campaign (gate of M2.7)', () => {
  // The automatic player in mass (six squadrons a raid, pursuit allowed), 60 % of the fighters.
  const carry = { fighterShare: 0.6, from: 'adlertag' };
  const outcomes = [];
  for (let seed = 1; seed <= 6 && !outcomes.includes('victory'); seed++) {
    const r = runAir({ ...CONDUCTS['quinze-septembre'].masse, scenario: 'quinze-septembre', preset: 'realistic', seed, carry });
    outcomes.push(r.outcome);
    assert.ok(r.objectives.some((o) => o.type === 'fighterStrength'), 'the objective is still asked');
  }
  assert.ok(outcomes.includes('victory'), `no victory in ${outcomes.length} games: ${outcomes.join(', ')}`);
});

test('a relief squadron arriving during the scenario joins the fighters the objective is measured on', () => {
  // Adlertag: 266 Sqn arrives on the third day with twelve Spitfires.
  const w = makeWorld('standard', {}, 'adlertag');
  const before = w.fightersAtStart;
  assert.equal(fighterShare(w), fighterEstablishmentShare(w));
  for (let i = 0; i < 2 * 86400 + 12.5 * 3600; i++) step(w, 1);
  const relief = w.squadrons.find((s) => s.id === '266');
  assert.ok(relief && relief.role === 'fighter', 'the relief has arrived');
  assert.equal(w.fightersAtStart, before + relief.aircraftStart);
  // Without a campaign the measure stays the one of 2.6.1 all along: the establishment.
  assert.equal(w.fightersAtStart, fighterCount(w).establishment);
  assert.equal(fighterShare(w), fighterEstablishmentShare(w));
  // With the campaign's losses the relief counts the same way, on top of the fighters of the morning.
  const c = makeWorld('realistic', {}, 'adlertag', { fighterShare: 0.6, from: 'kanalkampf' });
  const morning = c.fightersAtStart;
  for (let i = 0; i < 2 * 86400 + 12.5 * 3600; i++) step(c, 1);
  assert.equal(c.fightersAtStart, morning + 12);
});

test('a save made before 2.7 takes the fighters of the start from the world it is restored onto', () => {
  // The same game saved without the two new values, as 2.6.1 did.
  const w = makeWorld('standard', {}, 'adlertag');
  for (let i = 0; i < 2 * 86400 + 12.5 * 3600; i++) step(w, 1);
  const old = JSON.parse(JSON.stringify(snapshot(w)));
  delete old.fightersAtStart;
  delete old.carry;
  // (With the number of its format: a save of the current one that lacked a part would be refused.)
  old.version = 1;
  const back = restore(makeWorld('standard', {}, 'adlertag'), old);
  assert.equal(back.fightersAtStart, w.fightersAtStart, 'the relief arrived since is counted');
  assert.equal(fighterShare(back), fighterShare(w));
});

test('in a campaign the aircraft to shoot down follow the fighters carried over (2.10.2)', () => {
  // 15 September asks 32 aircraft of a Fighter Command at full strength.
  const alone = makeWorld('realistic', {}, 'quinze-septembre');
  const full = alone.objectives.find((o) => o.type === 'enemyDown');
  assert.equal(full.count, 32);
  assert.equal(full.full, undefined, 'outside a campaign the objective is the scenario\'s own');
  // With 60 % of its fighters (the most a campaign in Réaliste takes away), 60 % of the count.
  const w = makeWorld('realistic', {}, 'quinze-septembre', { fighterShare: 0.6, from: 'adlertag' });
  const { now, establishment } = fighterCount(w);
  const asked = w.objectives.find((o) => o.type === 'enemyDown');
  assert.equal(asked.count, Math.round((32 * now) / establishment));
  assert.ok(asked.count >= 18 && asked.count <= 20, `about 19 aircraft (${asked.count})`);
  assert.equal(asked.full, 32);
  // The share is the one really present, squadron by squadron: the same as the briefing tells.
  assert.equal(now, w.carry.aircraft);
  // Standard carries half the losses, 75 % at least: 24 aircraft at the lowest.
  const light = makeWorld('standard', {}, 'quinze-septembre', { fighterShare: 0.75, from: 'adlertag' });
  const lightAsked = light.objectives.find((o) => o.type === 'enemyDown');
  assert.ok(lightAsked.count >= 23 && lightAsked.count <= 25, `about 24 aircraft (${lightAsked.count})`);
  // The same rule for every battle of the chain: Adlertag after Kanalkampf.
  const adler = makeWorld('standard', {}, 'adlertag');
  const base = adler.objectives.find((o) => o.type === 'enemyDown').count;
  const after = makeWorld('standard', {}, 'adlertag', { fighterShare: 0.8, from: 'kanalkampf' });
  const cut = after.objectives.find((o) => o.type === 'enemyDown');
  const f = fighterCount(after);
  assert.equal(cut.count, Math.round((base * f.now) / f.establishment));
  assert.ok(cut.count < base && cut.full === base);
  // A carry that takes nothing away changes nothing.
  const whole = makeWorld('standard', {}, 'quinze-septembre', { fighterShare: 1, from: 'adlertag' });
  assert.equal(whole.objectives.find((o) => o.type === 'enemyDown').count, 32);
  assert.equal(whole.carry, null);
});

test('the count cut by the campaign is the one judged, told and saved', () => {
  const carry = { fighterShare: 0.6, from: 'adlertag' };
  const w = makeWorld('realistic', {}, 'quinze-septembre', carry);
  const asked = w.objectives.find((o) => o.type === 'enemyDown');
  // One aircraft short: not done. The count reached: done at the next minute.
  w.stats.bombersDown = asked.count - 1;
  for (let i = 0; i < 120; i++) step(w, 1);
  assert.equal(asked.done, false);
  w.stats.fightersDown = 1;
  for (let i = 0; i < 120; i++) step(w, 1);
  assert.equal(asked.done, true, 'the count of the campaign is the one that wins');
  assert.ok(asked.count < 32);
  // The save brings the objective back as it was: the count cut, and the scenario's own.
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const back = restore(makeWorld('realistic', {}, 'quinze-septembre'), snap);
  const again = back.objectives.find((o) => o.type === 'enemyDown');
  assert.equal(again.count, asked.count);
  assert.equal(again.full, 32);
  // A relief that arrives later joins the fighters of the morning, but the count stays.
  const adler = makeWorld('realistic', {}, 'adlertag', { fighterShare: 0.6, from: 'kanalkampf' });
  const before = adler.objectives.find((o) => o.type === 'enemyDown').count;
  for (let i = 0; i < 2 * 86400 + 12.5 * 3600; i++) step(adler, 1);
  assert.ok(adler.squadrons.some((s) => s.id === '266'), 'the relief has arrived');
  assert.equal(adler.objectives.find((o) => o.type === 'enemyDown').count, before);
});

test('the objective and the journal say the count of the campaign and the scenario\'s own', () => {
  const w = makeWorld('realistic', {}, 'quinze-septembre', { fighterShare: 0.6, from: 'adlertag' });
  const asked = w.objectives.find((o) => o.type === 'enemyDown');
  assert.equal(objectiveText(w, asked), `Abattre au moins ${asked.count} avions ennemis (aujourd'hui 0) ; 32 à effectif complet`);
  const told = drainEvents(w).find((e) => e.type === 'carryApplied');
  assert.equal(told.down, asked.count);
  assert.equal(told.downFull, 32);
  const line = eventMessage(w, told).text;
  assert.match(line, /la chasse commence à \d+ % de ses avions/);
  assert.ok(line.endsWith(`Le nombre d'avions à abattre suit la même proportion : ${asked.count} au lieu de 32.`), line);
  // Outside a campaign: the sentence of before, and no word of a carry.
  const alone = makeWorld('realistic', {}, 'quinze-septembre');
  assert.equal(objectiveText(alone, alone.objectives.find((o) => o.type === 'enemyDown')), "Abattre au moins 32 avions ennemis (aujourd'hui 0)");
  assert.equal(drainEvents(alone).some((e) => e.type === 'carryApplied'), false);
});
