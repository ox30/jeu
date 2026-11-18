// The entity factory (Code 1 of the audit): whoever creates an installation or a convoy, at
// the start of a game or in the middle of one, it has every field its kind has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, runTo } from './helpers.js';
import { declaredFields, fillMissingFields } from '../src/sim/entities.js';
import { deployMru } from '../src/sim/mru.js';
import { setShipBoost } from '../src/sim/orders.js';

test('the subsystems declare their fields on installations and convoys', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const site = declaredFields('site', w);
  for (const f of ['damage', 'attacks', 'wasOut', 'stocks', 'minStock', 'progress', 'starved', 'dryHours', 'lowWarned']) assert.ok(site.includes(f), `site.${f}`);
  const convoy = declaredFields('convoy', w);
  for (const f of ['schedule', 'rangeAlerted']) assert.ok(convoy.includes(f), `convoy.${f}`);
});

test('every installation of every scenario has every declared field, a mobile station included', () => {
  for (const id of ['m0', 'kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique']) {
    const w = makeWorld('standard', {}, id);
    const fields = declaredFields('site', w);
    for (const site of w.sites.values()) for (const f of fields) assert.notEqual(site[f], undefined, `${id}: ${site.key}.${f}`);
  }
  const w = makeWorld('standard', {}, 'adlertag');
  runTo(w, 8 * 3600); // the mobile station becomes available at 13:30
  const field = w.byId.airfield.get('tangmere');
  assert.ok(deployMru(w, field.x, field.y - 6, 180).ok);
  runTo(w, 16 * 3600); // installed after six hours
  const mobile = w.radars.find((r) => r.mobile);
  assert.ok(mobile, 'the station is installed');
  for (const f of declaredFields('site', w)) assert.notEqual(mobile[f], undefined, `mobile station: ${f}`);
});

test('every convoy has every declared field, a straggler included', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  // Convoys driven at their best speed drop stragglers.
  for (let day = 1; day <= 12; day++) {
    runTo(w, day * 86400);
    for (const c of w.convoys) if (c.state === 'atSea' && !c.straggler && !c.boost) setShipBoost(w, c, true);
  }
  assert.ok(w.convoys.some((c) => c.straggler), 'a straggler at sea');
  const fields = declaredFields('convoy', w);
  for (const c of w.convoys) for (const f of fields) assert.notEqual(c[f], undefined, `${c.name}: ${f}`);
});

test('an entity restored from an older save gets the fields it lacks and keeps the others', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const old = { key: 'radar:old', kind: 'radar', damage: 35, stocks: { fuel: 4 } };
  fillMissingFields('site', old, w);
  assert.equal(old.damage, 35, 'kept');
  assert.deepEqual(old.stocks, { fuel: 4 }, 'kept as it was');
  assert.deepEqual(old.minStock, { fuel: null, materiel: null, ammo: null }, 'filled');
  assert.equal(old.lowWarned, false);
  const convoy = { id: 'x', schedule: { at: 100 } };
  fillMissingFields('convoy', convoy, w);
  assert.deepEqual(convoy.schedule, { at: 100 });
  assert.equal(convoy.rangeAlerted, false);
});
