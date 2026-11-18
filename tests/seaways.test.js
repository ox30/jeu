// The ways by sea: the distance home from each port's field, and the U-boats going round the
// land and keeping out of the waters closed to them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { distance, project, unproject } from '../src/sim/geo.js';
import { homeRoute, portChoices } from '../src/sim/naval.js';
import { updateBdu, callBoats } from '../src/sim/bdu.js';
import { inClosedWaters, openForUboat, uboatPath } from '../src/sim/uboatnav.js';
import { restore, snapshot } from '../src/save/game.js';

const H = 3600;

function atSea(e, lon, lat) {
  const [x, y] = project(lon, lat);
  Object.assign(e, { state: 'atSea', x, y, px: x, py: y, route: [], plan: [], legState: null, course: 270, heading: 270, berthed: false, underwayAt: null, homeward: false, destination: null });
}

/** The first ocean convoy, put at sea at (lon, lat) with the route given ([lon, lat] points). */
function convoyAt(w, lon, lat, route) {
  run(w, 7 * H);
  const c = w.convoys.find((x) => x.state === 'atSea' && x.type !== 'coastal');
  [c.x, c.y] = project(lon, lat);
  c.route = route.map(([lo, la]) => project(lo, la));
  c.heading = 90;
  c.routeVersion = (c.routeVersion || 0) + 1;
  return c;
}

/** Every 5 km along the points: none ashore nor in closed waters. */
function staysOpen(w, pts) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(distance(ax, ay, bx, by) / 5));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const y = ay + ((by - ay) * k) / n;
      if (inClosedWaters(w, x, y)) return `closed waters at ${unproject(x, y).map((v) => v.toFixed(2))}`;
    }
  }
  const land = w.terrain.findLandOnRoute(pts, 0, 0, 1.5);
  return land ? `land at ${unproject(...land).map((v) => v.toFixed(2))}` : null;
}

test('the distance home shown for each port is the length of the way the group will take, and costs next to nothing', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const e = w.escorts[0];
  for (const [lon, lat] of [[-10.5, 54.6], [-12, 58], [-6, 50.5], [-4, 59.3], [-30, 57]]) {
    atSea(e, lon, lat);
    const list = portChoices(w, e);
    assert.ok(list.length >= 2, 'Liverpool and the Clyde');
    assert.ok(list[0].km <= list[1].km, 'nearest first');
    for (const c of list) {
      const way = homeRoute(w, e, c.port);
      assert.ok(way, `a way to ${c.port.id}`);
      assert.ok(Math.abs(c.km - way.km) / way.km < 0.06, `${c.port.id} from ${lon},${lat}: ${Math.round(c.km)} km shown, ${Math.round(way.km)} km sailed`);
      assert.equal(w.terrain.findLandOnRoute([[e.x, e.y], ...way.route], 0, 3, 1.5), null, `by sea to ${c.port.id}`);
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) portChoices(w, e);
  assert.ok(performance.now() - t0 < 400, 'two thousand sheets redrawn in a blink');
});

test('U-boats keep out of the Irish Sea and go round Ireland by the west', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  assert.ok(inClosedWaters(w, ...project(-5.2, 54.0)), 'the Irish Sea is closed to them');
  assert.ok(inClosedWaters(w, ...project(-5.9, 55.2)), 'the North Channel too');
  assert.ok(!inClosedWaters(w, ...project(-8.3, 56.1)), 'not its approaches');
  assert.ok(!inClosedWaters(w, ...project(-7.2, 51.2)), 'nor the entrance of St George\'s Channel');
  // From the Biscay bases to the north of Ireland.
  const from = project(-3.4, 47.6);
  assert.ok(openForUboat(w, ...from), 'Lorient\'s roads are open sea');
  const path = uboatPath(w, from, project(-8.5, 56.3));
  assert.ok(path, 'a way');
  assert.equal(staysOpen(w, [from, ...path]), null);
  assert.ok(path.some(([x, y]) => unproject(x, y)[0] < -10), 'west of Ireland');
});

test('the B-Dienst sends a boat on the route ahead of the convoy, out at sea: never inland past the end of the route', () => {
  for (const [lon, lat, label] of [[-14, 55.6, 'far out'], [-7.0, 55.55, 'at the North Channel']]) {
    const w = makeWorld('standard', { bdienst: '100' }, 'hiver-atlantique');
    w.rules = { ...w.rules, bdu: { ...w.rules.bdu, readDelayH: 0 } };
    const c = convoyAt(w, lon, lat, [[-8.3, 56.1], [-7.5, 55.62], [-6.25, 55.4], [-5.97, 55.25], [-5.55, 54.85], [-5.0, 54.0], [-3.9, 53.6], [-3.0, 53.41]].filter(([lo]) => lo > lon));
    const u = w.uboats[0];
    [u.x, u.y] = project(-11, 56.6);
    Object.assign(u, { state: 'patrol', target: null, task: null, way: null });
    for (const o of w.uboats) if (o !== u) o.state = 'gone';
    w.t = Math.ceil(w.t / H) * H;
    c.bdienst = null;
    updateBdu(w);
    assert.ok(c.bdienst && c.bdienst.read, `${label}: read`);
    if (u.task && u.task.kind === 'route') {
      assert.ok(openForUboat(w, u.hx, u.hy), `${label}: waits at open sea (${unproject(u.hx, u.hy).map((v) => v.toFixed(2))})`);
      assert.ok(unproject(u.hx, u.hy)[0] < -5.5, `${label}: not past the North Channel`);
    } else {
      assert.equal(label, 'at the North Channel', 'far out, a boat is sent');
    }
  }
});

test('a convoy in waters closed to them: no boat called, and a shadowing boat lets it go', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const c = convoyAt(w, -6.6, 55.45, [[-6.25, 55.4], [-5.97, 55.25], [-5.55, 54.85], [-5.0, 54.0]]);
  const u = w.uboats[0];
  [u.x, u.y] = project(-6.8, 55.5);
  Object.assign(u, { state: 'shadow', target: c.id, way: null, submergedUntil: 0 });
  for (const o of w.uboats) if (o !== u) o.state = 'gone';
  // Into the North Channel.
  [c.x, c.y] = project(-5.9, 55.2);
  c.route = [project(-5.55, 54.85), project(-5.0, 54.0)];
  assert.equal(callBoats(w, c, 500), 0, 'no boat called into the North Channel');
  run(w, 120);
  assert.equal(u.state, 'patrol', 'the shadower gives up');
  assert.equal(u.target, null);
});

test('a U-boat called to a convoy beyond a headland goes round it, never over the land', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  // A convoy off Malin Head; the boat west of Donegal: as the crow flies, over Donegal.
  const c = convoyAt(w, -7.6, 55.55, [[-7.5, 55.62], [-6.25, 55.4]]);
  c.speedKn = 0.1;
  c.orderedKn = 0.1;
  const u = w.uboats[0];
  [u.x, u.y] = project(-9.0, 54.6);
  Object.assign(u, { state: 'closing', target: c.id, way: null, submergedUntil: 0, closeLimitKm: 600 });
  for (const o of w.uboats) if (o !== u) o.state = 'gone';
  const track = [[u.x, u.y]];
  for (let i = 0; i < 30; i++) {
    run(w, 1200);
    track.push([u.x, u.y]);
    if (u.state !== 'closing') break;
  }
  assert.equal(w.terrain.findLandOnRoute(track, 0, 0, 1), null, 'by sea all the way');
  assert.ok(distance(u.x, u.y, c.x, c.y) < 40, 'and it got there');
});

test('a game saved with a U-boat ashore (an earlier version) gets it back to sea on loading', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  [u.x, u.y] = project(-2.0, 53.5); // the Pennines
  [u.hx, u.hy] = project(-1.5, 54.5);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const twin = makeWorld('standard', {}, 'hiver-atlantique');
  restore(twin, snap);
  const v = twin.uboats.find((x) => x.id === u.id);
  assert.ok(openForUboat(twin, v.x, v.y), `at sea (${unproject(v.x, v.y).map((n) => n.toFixed(2))})`);
  assert.ok(openForUboat(twin, v.hx, v.hy), 'its station too');
  run(twin, 2 * H);
  assert.ok(!twin.terrain.isLand(v.x, v.y), 'and it stays there');
});
