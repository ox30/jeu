// The campaign in Réaliste (I1 of the audit): the squadrons start a battle short of the
// aircraft lost in the one before, and the objective of fighter strength is measured on the
// fighters present that morning. Measured on the establishment, 15 September could not be won.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';
import { restore, snapshot } from '../src/save/game.js';
import { checkDefeat, fighterCount, fighterEstablishmentShare, fighterShare, finalize } from '../src/sim/objectives.js';
import { carryFor, recordResult } from '../src/ui/campaign.js';
import { runAir } from '../tools/bot/air.mjs';
import { CONDUCTS } from '../tools/bot/conducts.mjs';

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
