import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/sim/geo.js';
import { routeConvoy, scramble, setAltitude, setSpeed, setVector } from '../src/sim/orders.js';
import { solveIntercept } from '../src/sim/intercept.js';
import { contactEstimate } from '../src/sim/query.js';
import { parseGameDate } from '../src/core/time.js';
import { getTerrain, makeWorld, run, runTo } from './helpers.js';

const at = (world, text) => (parseGameDate(text) - world.startMs) / 1000;

test('land and sea', () => {
  const terrain = getTerrain();
  assert.equal(terrain.isLand(...project(-0.128, 51.507)), true, 'London');
  assert.equal(terrain.isLand(...project(-30, 50)), false, 'mid-Atlantic');
  assert.equal(terrain.isLand(...project(1.5, 51.0)), false, 'Strait of Dover');
  assert.equal(terrain.isLand(...project(2.35, 48.85)), true, 'Paris');
  assert.equal(terrain.isOverBritain(...project(0.03, 51.33)), true, 'Biggin Hill');
  assert.equal(terrain.isOverBritain(...project(1.86, 50.95)), false, 'Calais');
});

test('the Admiralty route is clear of land and reaches Liverpool', () => {
  const world = makeWorld();
  const convoy = world.convoys[0];
  const result = routeConvoy(world, convoy, convoy.admiraltyRoute.slice(1));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.destination.id, 'liverpool');
  const events = run(world, 30 * 86400, (e) => e.type === 'convoyArrived');
  const arrived = events.find((e) => e.type === 'convoyArrived');
  assert.ok(arrived, 'convoy arrived');
  const days = world.t / 86400;
  assert.ok(days > 9 && days < 16, `crossing took ${days.toFixed(1)} days`);
  assert.ok(events.some((e) => e.type === 'objectiveDone'));
});

test('a route across Ireland is refused', () => {
  const world = makeWorld();
  const convoy = world.convoys[0];
  const route = [project(-35, 52), project(-12, 53.3), project(-3.0, 53.43)];
  const result = routeConvoy(world, convoy, route);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'land');
});

test('an unopposed raid bombs its target', () => {
  const world = makeWorld('standard');
  const events = runTo(world, at(world, '1940-07-10T14:30'));
  const detected = events.find((e) => e.type === 'raidDetected' && e.raid === 'H01');
  assert.ok(detected, 'H01 detected');
  assert.ok(detected.t < at(world, '1940-07-10T13:20'), 'detected while assembling');
  assert.ok(detected.location && detected.location.place, 'location described');
  const hit = events.find((e) => e.type === 'siteHit' && e.raid === 'H01');
  assert.ok(hit, 'Dover bombed');
  assert.equal(hit.site, 'port:dover');
  assert.ok(world.sites.get('port:dover').damage > 0);
});

function flyInterception(world, squadron, raidId, seconds) {
  const events = [];
  for (let i = 0; i < seconds; i++) {
    if (squadron.state === 'airborne' && i % 20 === 0) {
      const contact = world.contacts.get(raidId);
      const est = contact && contactEstimate(world, contact);
      if (est) {
        const speed = world.rules.fighters[squadron.type].maxKmh / 3600;
        const sol = solveIntercept(squadron.x, squadron.y, speed, est.x, est.y, est.vx, est.vy);
        setVector(world, squadron, sol ? sol.heading : Math.atan2(est.x - squadron.x, est.y - squadron.y) * 180 / Math.PI);
      }
    }
    events.push(...run(world, 1));
  }
  return events;
}

test('a squadron vectored onto a raid intercepts it before the target', () => {
  const world = makeWorld('arcade');
  runTo(world, at(world, '1940-07-10T13:06'));
  const sq = world.squadrons.find((s) => s.id === '32');
  setAltitude(world, sq, 13000);
  setSpeed(world, sq, 'max');
  assert.equal(scramble(world, sq, { vector: 120 }), true);
  const events = flyInterception(world, sq, 'h01', 40 * 60);
  const tally = events.find((e) => e.type === 'tallyHo');
  assert.ok(tally, 'tally-ho');
  const hit = events.find((e) => e.type === 'siteHit' && e.raid === 'H01');
  assert.ok(!hit || hit.t > tally.t, 'intercepted before bombing');
  assert.ok(world.stats.raidsIntercepted >= 1);
  assert.ok(events.some((e) => e.type === 'combatRound'));
});

test('fighters run out of fuel, come home, refuel and are ready again', () => {
  const world = makeWorld('standard');
  const sq = world.squadrons.find((s) => s.id === '43');
  scramble(world, sq, { vector: 200 });
  const events = run(world, 4 * 3600, (e) => e.type === 'ready');
  assert.ok(events.some((e) => e.type === 'bingo'), 'bingo call');
  assert.ok(events.some((e) => e.type === 'landed'), 'landed');
  assert.ok(events.some((e) => e.type === 'ready'), 'ready again');
  assert.equal(sq.state, 'ready');
  assert.equal(sq.aircraft, 12);
});

test('false alarms show a contact with nothing to find', () => {
  const world = makeWorld('standard', { falseAlarms: true });
  const events = runTo(world, at(world, '1940-07-12T10:40'));
  assert.ok(events.some((e) => e.type === 'raidDetected' && e.raid === 'H05'), 'phantom plotted');

  const quiet = makeWorld('standard', { falseAlarms: false });
  const none = runTo(quiet, at(quiet, '1940-07-12T10:40'));
  assert.ok(!none.some((e) => e.type === 'raidDetected' && e.raid === 'H05'), 'no phantom');
});

test('the same seed replays the same battle', () => {
  const outcome = () => {
    const world = makeWorld('arcade');
    runTo(world, at(world, '1940-07-10T13:06'));
    const sq = world.squadrons.find((s) => s.id === '32');
    setAltitude(world, sq, 13000);
    setSpeed(world, sq, 'max');
    scramble(world, sq, { vector: 120 });
    flyInterception(world, sq, 'h01', 40 * 60);
    return JSON.stringify(world.stats);
  };
  assert.equal(outcome(), outcome());
});

test('a rough route drawn north of Ireland follows the charted channel', () => {
  const world = makeWorld();
  const convoy = world.convoys[0];
  // Drawn at the scale of the Atlantic map: far too coarse to thread the North Channel.
  const rough = [[-60, 43.6], [-50, 45.2], [-30, 53], [-12, 56.5], [-6, 54.8], [-3.2, 53.5]].map(([lon, lat]) => project(lon, lat));
  const result = routeConvoy(world, convoy, rough);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.destination.id, 'liverpool');
});

test('a route ending in the Firth of Clyde goes to the Clyde, one south of Ireland to Liverpool', () => {
  const w1 = makeWorld();
  const r1 = routeConvoy(w1, w1.convoys[0], [[-60, 43.6], [-50, 45.2], [-30, 54], [-12, 57], [-5.5, 55.6]].map(([lon, lat]) => project(lon, lat)));
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.destination.id, 'clyde');
  const w2 = makeWorld();
  const r2 = routeConvoy(w2, w2.convoys[0], [[-60, 43.6], [-45, 46], [-20, 50], [-9, 51], [-4.5, 53.2]].map(([lon, lat]) => project(lon, lat)));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.destination.id, 'liverpool');
});
