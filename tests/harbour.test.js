import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { distance, project, unproject } from '../src/sim/geo.js';
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
  const port = w.byId.port.get('liverpool');
  assert.ok(distance(e.route[0][0], e.route[0][1], port.x, port.y) < 10, 'first point: the roads, close to the port');
  assert.equal(w.terrain.findLandOnRoute([[port.x, port.y], ...e.route], 0, 0, 0.3), null, 'out of the Mersey by water');
});

test('a group that sails stays alongside an hour, then leaves the Clyde by water', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.portId === 'clyde');
  const port = w.byId.port.get('clyde');
  assert.ok(departConvoy(w, e));
  run(w, 1800);
  assert.ok(distance(e.x, e.y, port.x, port.y) < 0.1, 'still alongside after half an hour');
  run(w, 2 * 3600);
  assert.ok(distance(e.x, e.y, port.x, port.y) > 1, 'under way after the hour');
  assert.equal(w.terrain.findLandOnRoute([[port.x, port.y], [e.x, e.y]], 0, 0, 0.3), null, 'out by the firth, not over the hills');
});

test('a line drawn from a group at the roads goes down the firth first', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts.find((x) => x.portId === 'clyde');
  departConvoy(w, e);
  run(w, 3 * 3600);
  const target = project(-8, 56.6);
  const r = routeConvoy(w, e, [target]);
  assert.ok(r.ok, `accepted (${r.reason || ''})`);
  assert.equal(w.terrain.findLandOnRoute([[e.x, e.y], ...e.route], 0, 0, 0.5), null, 'never over land');
});
