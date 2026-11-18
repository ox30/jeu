// The end summary follows the scenario (C2 of the audit), and the clock of real time played (N5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld } from './helpers.js';
import { createPlayClock, endSummaryKeys, tickPlayClock } from '../src/ui/summary.js';

const AIR = ['bombersDown', 'fightersDown', 'rafLost', 'groundLosses', 'raidsIntercepted', 'raidsRepelled', 'targetsHit'];
const SEA = ['shipsSunk', 'uboatsSunk', 'unloaded'];

test('15 September: an air battle lists no ships, no U-boats, no tonnage', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const keys = endSummaryKeys(w);
  for (const k of AIR) assert.ok(keys.includes(k), k);
  for (const k of [...SEA, 'convoysArrived', 'dollars', 'fuelUsed', 'ammoUsed']) assert.ok(!keys.includes(k), `${k} is off the subject`);
});

test('the Atlantic lists convoys, ships, U-boats, tonnage and dollars, and nothing of the air battles', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const keys = endSummaryKeys(w);
  assert.deepEqual(keys, ['shipsSunk', 'uboatsSunk', 'unloaded', 'dollars'], 'no convoy has sailed yet');
  w.convoys.push({ id: 'x' });
  assert.deepEqual(endSummaryKeys(w), ['convoysArrived', 'shipsSunk', 'uboatsSunk', 'unloaded', 'dollars']);
});

test('Kanalkampf and Adlertag: the air battle, the convoys asked for, and the supply that can lose them', () => {
  for (const id of ['kanalkampf', 'adlertag']) {
    const keys = endSummaryKeys(makeWorld('standard', {}, id));
    for (const k of [...AIR, 'convoysArrived', 'shipsSunk', 'unloaded', 'fuelUsed']) assert.ok(keys.includes(k), `${id}: ${k}`);
    assert.ok(!keys.includes('dollars'), `${id}: no dollars`);
    assert.ok(!keys.includes('uboatsSunk'), `${id}: U-boats only once one is sunk`);
  }
  const w = makeWorld('standard', {}, 'adlertag');
  w.stats.uboatsSunk = 1;
  assert.ok(endSummaryKeys(w).includes('uboatsSunk'));
});

test('pilots killed are listed where pilots can be killed', () => {
  assert.ok(!endSummaryKeys(makeWorld('standard', {}, 'adlertag')).includes('pilotsKilled'));
  assert.ok(endSummaryKeys(makeWorld('standard', { fatigue: 'losses' }, 'adlertag')).includes('pilotsKilled'));
});

test('every line of the summary has its text, in every scenario', () => {
  for (const id of ['m0', 'kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique']) {
    const w = makeWorld('realistic', { fatigue: 'losses' }, id);
    w.stats.uboatsSunk = 1;
    w.stats.shipsSunk = 1;
    w.stats.aircraftBuilt = 1;
    for (const k of endSummaryKeys(w)) assert.equal(typeof data.fr.end[k], 'string', `${id}: end.${k}`);
  }
  assert.ok(data.fr.end.played.includes('{total}') && data.fr.end.played.includes('{paused}'));
});

test('the clock counts real time, pauses apart, and a long gap for one second', () => {
  const clock = createPlayClock();
  for (let i = 0; i < 600; i++) tickPlayClock(clock, 16.7, false); // ten seconds at 60 images a second
  for (let i = 0; i < 300; i++) tickPlayClock(clock, 16.7, true); // five seconds paused
  assert.ok(Math.abs(clock.totalMs - 15030) < 1 && Math.abs(clock.pausedMs - 5010) < 1);
  tickPlayClock(clock, 3600000, false); // the tab was hidden for an hour
  assert.ok(Math.abs(clock.totalMs - 16030) < 1);
  // A saved clock goes on; a broken one starts again from zero.
  assert.deepEqual(createPlayClock({ totalMs: 5000, pausedMs: 1000 }), { totalMs: 5000, pausedMs: 1000 });
  assert.deepEqual(createPlayClock({ totalMs: 'x' }), { totalMs: 0, pausedMs: 0 });
  assert.deepEqual(createPlayClock(null), { totalMs: 0, pausedMs: 0 });
});
