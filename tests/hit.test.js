// The click test (C9 of the audit, first part): where plaques overlap, the unit in hand wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHit, unitsUnder } from '../src/ui/hit.js';

const UNITS = new Set(['squadron', 'convoy', 'airfield', 'escort', 'rally']);
// Two squadrons whose plaques overlap over Kent, an aerodrome under them, a raid close by.
const a = { kind: 'squadron', id: '601', x: 100, y: 100, r: 14, priority: 0, box: { x: 90, y: 80, w: 70, h: 30 } };
const b = { kind: 'squadron', id: '615', x: 120, y: 104, r: 14, priority: 0, box: { x: 110, y: 84, w: 70, h: 30 } };
const field = { kind: 'airfield', id: 'kenley', x: 112, y: 108, r: 14, priority: 2 };
const raid = { kind: 'raid', id: 'h05', x: 118, y: 100, r: 14, priority: 3, box: { x: 108, y: 110, w: 60, h: 24 } };
const hits = [a, b, field, raid];
const selected = (kind, id) => (h) => h.kind === kind && h.id === id;

test('without a selection the nearest unit wins, as before', () => {
  assert.equal(pickHit(hits, 121, 104, 6).id, '615');
  assert.equal(pickHit(hits, 99, 101, 6).id, '601');
});

test('the unit in hand wins over its neighbours when it is under the pointer', () => {
  // The pointer is right on 615, inside the plaque of 601: the drag starts from 601.
  assert.equal(pickHit(hits, 121, 104, 6, selected('squadron', '601')).id, '601');
  // Right on 601, within reach of the symbol of 615: with 615 in hand, the drag starts from 615.
  assert.equal(pickHit(hits, 101, 100, 6, selected('squadron', '615')).id, '615');
  assert.equal(pickHit(hits, 101, 100, 6).id, '601', 'and from 601 with nothing in hand');
  // An aerodrome in hand wins over the squadrons flying over it.
  assert.equal(pickHit(hits, 112, 108, 6, selected('airfield', 'kenley')).kind, 'airfield');
});

test('the unit in hand does not win where it is not', () => {
  assert.equal(pickHit(hits, 175, 100, 6, selected('squadron', '601')).id, '615', 'only the plaque of 615 is there');
  assert.equal(pickHit(hits, 400, 400, 6, selected('squadron', '601')), null);
});

test('the handles of a route and the cross of the ruler still come first', () => {
  const point = { kind: 'routePoint', unitKind: 'squadron', id: '601', index: 0, x: 104, y: 100, r: 8, priority: -2 };
  const extend = { kind: 'routeExtend', unitKind: 'squadron', id: '601', x: 104, y: 100, r: 8, priority: -1 };
  const cross = { kind: 'rulerClose', x: 104, y: 100, r: 8, priority: -3 };
  assert.equal(pickHit([...hits, extend], 103, 100, 6, selected('squadron', '601')).kind, 'routeExtend');
  assert.equal(pickHit([...hits, extend, point], 103, 100, 6, selected('squadron', '601')).kind, 'routePoint');
  assert.equal(pickHit([...hits, extend, point, cross], 103, 100, 6, selected('squadron', '601')).kind, 'rulerClose');
});

test('units under the pointer are counted once each; a formation counts for one', () => {
  assert.equal(unitsUnder(hits, 121, 104, 6, UNITS), 3, '601 (plaque), 615 and the aerodrome');
  assert.equal(unitsUnder(hits, 175, 100, 6, UNITS), 1);
  assert.equal(unitsUnder(hits, 400, 400, 6, UNITS), 0);
  const wing = [
    { kind: 'squadron', id: '242', formation: 'F1', x: 300, y: 300, r: 14, priority: 0 },
    { kind: 'squadron', id: '310', formation: 'F1', x: 305, y: 300, r: 8, priority: 0 },
    { kind: 'rally', id: 'F1', x: 302, y: 302, r: 12, priority: 1 },
  ];
  assert.equal(unitsUnder(wing, 302, 300, 6, UNITS), 1, 'one wing');
  assert.equal(unitsUnder([...wing, a].map((h) => (h === a ? { ...a, x: 303, y: 301 } : h)), 302, 300, 6, UNITS), 2);
});
