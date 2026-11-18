// Escort groups at the end of their legs, and their fuel: home while they can, and a crawl
// into port when the bunkers are empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { KNOT_KMH, distance, project } from '../src/sim/geo.js';
import { addLeg, joinConvoy, setShipBoost } from '../src/sim/orders.js';
import { setShipEndAction } from '../src/sim/naval.js';

const H = 3600;
const DAY = 86400;

function atSea(e, lon, lat) {
  const [x, y] = project(lon, lat);
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], legState: null, course: 270, heading: 270, berthed: false, underwayAt: null, homeward: false, destination: null, joinTarget: null });
}

function oceanConvoy(w) {
  run(w, 7 * H);
  return w.convoys.find((c) => c.state === 'atSea' && c.type !== 'coastal');
}

test('at the end of its legs a group does what it was told: meet a convoy, go into port, or stop', () => {
  for (const kind of ['escort', 'port', 'stop', 'hold']) {
    const w = makeWorld('standard', {}, 'hiver-atlantique');
    const c = oceanConvoy(w);
    const e = w.escorts[0];
    atSea(e, -20, 56);
    assert.ok(addLeg(w, e, { heading: 270, end: { kind: 'duration', s: H } }).ok);
    const id = kind === 'escort' ? c.id : kind === 'port' ? 'clyde' : null;
    assert.ok(setShipEndAction(w, e, { kind, id }), kind);
    const events = run(w, 2 * H);
    assert.equal(e.plan.length, 0, 'legs done');
    if (kind === 'escort') assert.equal(e.joinTarget, c.id, 'off to meet the convoy');
    if (kind === 'port') {
      assert.ok(e.homeward, 'homeward');
      assert.equal(e.destination, 'clyde');
    }
    if (kind === 'stop') assert.equal(e.state, 'waiting', 'stopped, waiting for orders');
    if (kind === 'hold') {
      assert.equal(e.state, 'atSea');
      assert.ok(Math.abs(e.course - 270) < 1, 'on along its heading');
    }
    const said = events.find((x) => x.type === 'legsEnded');
    if (kind === 'stop') assert.ok(events.some((x) => x.type === 'convoyWaiting'), 'reported waiting');
    else assert.equal(said && said.action, kind, `reported (${kind})`);
  }
});

test('a group far out turns for home while it still has the fuel to get there', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts[0];
  atSea(e, -35, 57); // some 2 000 km from the Clyde: three days at 16 knots
  e.endurance = 5 * DAY;
  run(w, 1200);
  assert.ok(!e.lowWarned && !e.homeward, 'five days: enough, it goes on');
  e.endurance = 3.5 * DAY;
  const events = run(w, 1200);
  assert.ok(e.lowWarned && e.homeward, 'three and a half days: home now');
  assert.ok(events.some((x) => x.type === 'escortLowFuel'));
});

test('bunkers empty: the group leaves its convoy and crawls home; no other order until it has refuelled', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const c = oceanConvoy(w);
  const e = w.escorts[0];
  atSea(e, -20, 56);
  [c.x, c.y] = [e.x, e.y];
  run(w, 60);
  assert.equal(e.state, 'escorting', 'with the convoy');
  e.endurance = 30;
  e.lowWarned = true;
  const events = run(w, 120);
  assert.ok(e.dry, 'out of fuel');
  assert.ok(e.homeward, 'on its way into port');
  assert.notEqual(e.state, 'escorting', 'the convoy left behind');
  assert.ok(events.some((x) => x.type === 'escortDry'));
  const [x0, y0] = [e.x, e.y];
  run(w, H);
  const kn = distance(x0, y0, e.x, e.y) / KNOT_KMH;
  assert.ok(kn <= w.rules.escortGroups.dryKn + 0.1, `a crawl (${kn.toFixed(1)} kn)`);
  assert.equal(joinConvoy(w, e, c.id), false, 'no convoy');
  assert.equal(addLeg(w, e, { heading: 90, end: { kind: 'duration', s: H } }).reason, 'dry', 'no legs');
  assert.equal(setShipBoost(w, e, true), false, 'no sprint');
  // In port and refitted: a group like the others again.
  Object.assign(e, { state: 'refit', timer: 1 });
  run(w, 5);
  assert.equal(e.state, 'inPort');
  assert.ok(!e.dry && e.endurance > 0, 'refuelled');
});
