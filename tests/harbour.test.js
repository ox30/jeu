import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { project, unproject } from '../src/sim/geo.js';
import { departConvoy, setExitChannel } from '../src/sim/orders.js';
import { routeConvoy } from '../src/sim/convoy.js';

const H = 3600;

test('a group that sails goes out to the roads, just off the port, and waits there for orders', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.portId === 'clyde');
  assert.ok(departConvoy(w, e));
  assert.equal(e.route.length, 1, 'one point: the roads');
  run(w, 6 * H);
  const [lon, lat] = unproject(e.x, e.y);
  assert.ok(lat > 55.5 && lon > -5.2, `still in the Firth of Clyde (${lon.toFixed(2)}, ${lat.toFixed(2)}), not off Ireland`);
  assert.equal(e.state, 'waiting');
});

test('a channel chosen: the group goes down it to its far end (Liverpool by the St George\'s Channel)', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.portId === 'liverpool');
  assert.equal(setExitChannel(w, e, 'Canal Saint-Georges'), 'Canal Saint-Georges');
  departConvoy(w, e);
  const [lon, lat] = unproject(...e.route[e.route.length - 1]);
  assert.ok(lat < 51.5 && lon < -7, 'to the south entrance');
  assert.equal(setExitChannel(w, e, 'nowhere'), null, 'an unknown channel: the roads');
});

test('a line drawn from the port starts at the roads and goes round the land by sea', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.portId === 'liverpool');
  // Straight to the south-west of Ireland: through Wales and Ireland as the crow flies.
  const target = project(-11, 51);
  const r = routeConvoy(w, e, [target]);
  assert.ok(r.ok, `accepted (${r.reason || ''})`);
  assert.ok(e.route.length >= 3, 'roads, then round the land');
  assert.equal(w.terrain.findLandOnRoute(e.route, 0, 0, 1.5), null, 'never over land from the roads');
  const [lon] = unproject(...e.route[0]);
  assert.ok(lon < -3.5, 'first point: Liverpool Bay');
});
