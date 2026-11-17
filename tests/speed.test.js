import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { aircraftSpec, squadronSpeed, throttle } from '../src/sim/squadron.js';
import { setShipBoost, setShipSpeedPct, setSpeed, setSpeedPct } from '../src/sim/orders.js';
import { currentSpeed, fullKnots, shipThrottle } from '../src/sim/convoy.js';
import { KNOT_KMH } from '../src/sim/geo.js';

test("a squadron's throttle: 50 to 100 % of cruising speed, the boost at full speed; slower burns less", () => {
  const w = makeWorld('standard', {}, 'kanalkampf');
  const s = w.squadrons[0];
  const type = aircraftSpec(w, s.type);
  s.state = 'airborne';
  assert.equal(Math.round(squadronSpeed(w, s) * 3600), type.cruiseKmh, '100 % by default');
  assert.equal(setSpeedPct(w, s, 72), 70, 'by steps of 5 %');
  assert.equal(Math.round(squadronSpeed(w, s) * 3600), Math.round(type.cruiseKmh * 0.7));
  assert.equal(setSpeedPct(w, s, 10), 50, 'never below half');
  setSpeed(w, s, 'max');
  assert.deepEqual(throttle(s), { max: true, pct: 100 });
  assert.equal(Math.round(squadronSpeed(w, s) * 3600), type.maxKmh);
  // Fuel: half speed for an hour burns less than cruising for an hour.
  const fuel = (pct) => {
    const x = makeWorld('standard', {}, 'kanalkampf');
    const q = x.squadrons[0];
    Object.assign(q, { state: 'airborne', orbit: true, fuel: 120 });
    setSpeedPct(x, q, pct);
    run(x, 1800);
    return 120 - q.fuel;
  };
  assert.ok(fuel(50) < fuel(100), 'slower: a little less fuel');
});

test("ships: a group's sea speed is its 100 %, its boost +15 % at a cost; a convoy's 100 % keeps it together", () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts[0];
  assert.deepEqual(shipThrottle(w, e), { pct: 100, boost: false });
  setShipSpeedPct(w, e, 50);
  assert.equal(Math.round(currentSpeed(e) * 3600 / KNOT_KMH), Math.round(e.speedKn / 2));
  setShipBoost(w, e, true);
  assert.equal(shipThrottle(w, e).boost, true);
  assert.ok(Math.abs(currentSpeed(e) * 3600 / KNOT_KMH - e.speedKn * 1.15) < 0.01);
  const k = makeWorld('standard', {}, 'kanalkampf');
  const c = k.convoys.find((x) => (x.type || 'ocean') === 'ocean' && !x.straggler);
  assert.equal(shipThrottle(k, c).pct, 100, 'an ocean convoy sails at the speed that keeps it together');
  assert.ok(fullKnots(k, c) < c.speedKn);
  setShipBoost(k, c, true);
  assert.equal(c.orderedKn, c.speedKn, 'boost: its best speed (some ships may fall behind)');
  setShipSpeedPct(k, c, 80);
  assert.equal(shipThrottle(k, c).boost, false);
  assert.equal(shipThrottle(k, c).pct, 80);
});
