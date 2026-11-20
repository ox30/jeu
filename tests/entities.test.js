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

test('squadrons, escort groups, U-boats and raids have every declared field in every scenario', () => {
  for (const id of ['m0', 'kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique']) {
    const w = makeWorld('standard', {}, id);
    for (const [kind, list] of [['squadron', w.squadrons], ['escort', w.escorts], ['uboat', w.uboats], ['raid', w.raids]]) {
      const fields = declaredFields(kind, w);
      assert.ok(fields.length > 0 || list.length === 0 || kind === 'raid', `${id}: ${kind} declares fields`);
      for (const u of list) for (const f of fields) assert.notEqual(u[f], undefined, `${id}: ${kind} ${u.id}.${f}`);
    }
  }
});

test('each subsystem declares what it keeps: alert and roster, formation, engagement, hunts, way of a U-boat', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const squadron = declaredFields('squadron', w);
  for (const f of ['alertAt', 'alertFrom', 'alertLong', 'roster', 'alertManual', 'schedule', 'lateFor', 'rallySlow', 'formation', 'holdForWing',
    'wingSlowest', 'roe', 'cleared', 'letGo', 'clearedBeyond', 'attackRaid', 'breakOff', 'speedPct', 'uboatAttacks']) assert.ok(squadron.includes(f), `squadron.${f}`);
  const escort = declaredFields('escort', w, { ships: 4, state: 'inPort' });
  for (const f of ['berthed', 'leftConvoy', 'exitChannel', 'boost', 'boostKn', 'dry', 'dryKn', 'endAction', 'routeEnded', 'schedule', 'lateFor', 'formation',
    'followEscort', 'followSlot', 'waitForGroup', 'huntPath', 'huntGoal', 'huntStay', 'engage', 'charges', 'chargesMax', 'pattern', 'radar', 'fix', 'est']) assert.ok(escort.includes(f), `escort.${f}`);
  const uboat = declaredFields('uboat', w);
  for (const f of ['deepUntil', 'sunkAt', 'boat', 'way', 'wanderAt']) assert.ok(uboat.includes(f), `uboat.${f}`);
  const raid = declaredFields('raid', w);
  for (const f of ['phase', 'timer', 'engagedBy', 'intercepted', 'repelled', 'bombed', 'destroyed']) assert.ok(raid.includes(f), `raid.${f}`);
});

test('two entities never share a declared value: a set, a roster, an end of route of their own', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const [a, b] = w.squadrons;
  assert.notEqual(a.cleared, b.cleared);
  assert.notEqual(a.roster, b.roster);
  a.cleared.add('R1');
  assert.equal(b.cleared.size, 0);
  const sea = makeWorld('standard', {}, 'hiver-atlantique');
  const [e, f] = sea.escorts;
  assert.notEqual(e.endAction, f.endAction);
});

test('a group and a U-boat of an old save get what they lack: alongside in refit, never gone deep', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const refit = { id: 'old-1', ships: 3, state: 'refit', behaviour: 'hunt' };
  fillMissingFields('escort', refit, w);
  assert.equal(refit.berthed, true, 'a group in refit is alongside');
  assert.equal(refit.behaviour, 'hunt', 'kept');
  assert.equal(refit.charges, 3 * w.rules.asw.engagement.chargesPerShip);
  assert.deepEqual(refit.endAction, { kind: 'stop' });
  const atSea = { id: 'old-2', ships: 4, state: 'escorting', boost: true };
  fillMissingFields('escort', atSea, w);
  assert.equal(atSea.berthed, false, 'a group at sea is not');
  assert.equal(atSea.boost, true, 'kept');
  const boat = { id: 'U-old', state: 'patrol', torpedoes: 2 };
  fillMissingFields('uboat', boat, w);
  assert.equal(boat.deepUntil, 0);
  assert.equal(boat.boat, 1);
  assert.equal(boat.way, null);
  assert.equal(boat.torpedoes, 2);
  const squadron = { id: 'old-sqn', roe: 'defend' };
  fillMissingFields('squadron', squadron, w);
  assert.equal(squadron.roe, 'defend', 'kept');
  assert.ok(squadron.cleared instanceof Set);
  assert.deepEqual(squadron.roster, { daily: [], override: null });
});
