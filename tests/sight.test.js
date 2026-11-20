import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/sim/geo.js';
import { engage } from '../src/sim/asw.js';
import { escortHome, huntPlot } from '../src/sim/orders.js';
import { isDaylight } from '../src/sim/daylight.js';
import { allViewZones, viewZones } from '../src/sim/sight.js';
import { ALERT_GROUPS, ALERT_TYPES, alertSpeed } from '../src/ui/alertRules.js';
import { data, makeKanalkampf, run } from './helpers.js';

const H = 3600;

function groupAt(world, id, lon, lat, state = 'atSea') {
  const e = world.escorts.find((x) => x.id === id);
  const [x, y] = project(lon, lat);
  Object.assign(e, { state, x, y, px: x, py: y, route: [], plan: [] });
  return e;
}

// Over Kent and out in the north-western approaches: the two places the units of these tests are.
const PLACES = [project(0.5, 51.3), project(-10, 56)];

/** Moves the clock to the next hour of day (or of night) at both places. */
function toLight(world, day) {
  const everywhere = () => PLACES.every(([x, y]) => isDaylight(world, x, y) === day);
  for (let i = 0; i < 48 && !everywhere(); i++) world.t += H;
  assert.ok(everywhere());
}

const km = (zones, kind) => zones.find((z) => z.kind === kind)?.km;

test('what a fighter and an escort group see, by day and by night', () => {
  const w = makeKanalkampf();
  const V = w.rules.visual;
  const A = w.rules.asw;
  const s = w.squadrons.find((x) => x.role !== 'watch' && x.role !== 'coastal');
  const e = groupAt(w, 'eg1', -10, 56);
  assert.deepEqual(viewZones(w, s, 'squadron'), [], 'on the ground, nothing');
  s.state = 'airborne';
  toLight(w, true);
  assert.equal(km(viewZones(w, s, 'squadron'), 'air'), V.airDayKm);
  assert.equal(km(viewZones(w, e, 'escort'), 'surface'), A.lookoutDayKm);
  assert.equal(km(viewZones(w, e, 'escort'), 'submerged'), A.asdicKm);
  toLight(w, false);
  assert.equal(km(viewZones(w, s, 'squadron'), 'air'), V.airNightKm);
  assert.equal(km(viewZones(w, e, 'escort'), 'surface'), A.lookoutNightKm);
  e.radar = true; // a group fitted with one of the first sets (C13: by group, no more by scenario)
  assert.equal(km(viewZones(w, e, 'escort'), 'surface'), A.radar.surfaceKm, 'radar by night');
  assert.ok(A.radar.surfaceKm > A.lookoutNightKm && A.radar.surfaceKm <= 2, 'short range, but better than lookouts at night');
  assert.equal(km(viewZones(w, e, 'escort'), 'submerged'), A.asdicKm, 'it does not see a periscope');
  e.state = 'inPort';
  assert.deepEqual(viewZones(w, e, 'escort'), [], 'in port, no watch');
});

test('zones drawn: none, the units chosen, or all', () => {
  const w = makeKanalkampf();
  toLight(w, true);
  const s = w.squadrons[0];
  s.state = 'airborne';
  const e = groupAt(w, 'eg1', -10, 56);
  assert.deepEqual(allViewZones(w, 'none', [{ unit: s, kind: 'squadron' }]), []);
  assert.equal(allViewZones(w, 'selected', [{ unit: e, kind: 'escort' }]).length, 2);
  const all = allViewZones(w, 'all');
  assert.ok(all.some((z) => z.unit === s) && all.some((z) => z.unit === e));
});

test('a group waiting for orders keeps watch and attacks a U-boat that comes close', () => {
  const w = makeKanalkampf();
  toLight(w, true);
  const e = groupAt(w, 'eg1', -10, 56, 'waiting');
  const u = w.uboats.find((x) => x.id === 'u1');
  Object.assign(u, { x: e.x + 1, y: e.y, px: e.x + 1, py: e.y, state: 'patrol' });
  const events = run(w, H, (ev) => ev.type === 'escortEngaged');
  assert.ok(events.some((ev) => ev.type === 'escortEngaged' && ev.escortId === e.id));
});

test('a group on its way into port that attacks a U-boat then goes on into port', () => {
  const w = makeKanalkampf();
  const e = groupAt(w, 'eg2', -5.9, 55.15);
  assert.ok(escortHome(w, e, 'clyde'));
  const u = w.uboats.find((x) => x.id === 'u1');
  Object.assign(u, { x: e.x + 1, y: e.y, px: e.x + 1, py: e.y, state: 'patrol' });
  engage(w, e, u, 'asdic');
  assert.equal(e.state, 'hunting');
  run(w, 6 * H, (ev) => ev.type === 'escortHuntOver'); // the attack, then at most the hunt hours
  // The U-boat gets clear (otherwise, still within reach, it is attacked again).
  Object.assign(u, { x: u.x + 400, y: u.y + 400, px: u.x + 400, py: u.y + 400, seen: null });
  if (e.state === 'hunting') run(w, 6 * H, (ev) => ev.type === 'escortHuntOver');
  assert.equal(e.state, 'atSea');
  assert.ok(e.homeward && e.destination === 'clyde' && e.route.length > 0, 'back on its way');
  run(w, 30 * H, (ev) => ev.type === 'escortInPort');
  assert.equal(e.portId, 'clyde');
});

test('a new hunt ordered during an attack closes the report of the attack', () => {
  const w = makeKanalkampf();
  const e = groupAt(w, 'eg1', -10, 56);
  const u = w.uboats.find((x) => x.id === 'u1');
  Object.assign(u, { x: e.x + 1, y: e.y, px: e.x + 1, py: e.y, state: 'patrol' });
  engage(w, e, u, 'asdic');
  w.uboatPlots.push({ id: 'P99', uboatId: 'u2', x: e.x + 40, y: e.y + 10, t: w.t, source: 'hfdf', by: 'Admiralty', submerged: false });
  assert.ok(huntPlot(w, e, 'P99'));
  const rep = w.navalReports[0];
  assert.ok(rep.end !== null && rep.result, 'closed');
  assert.equal(e.engage, null);
  assert.equal(e.huntX, e.x + 40);
});

test('at sea, every alert brings the game to ×1 by default; each speed can be set apart', () => {
  const grouped = ALERT_GROUPS.flatMap((g) => Object.keys(g.speeds));
  assert.deepEqual([...grouped].sort(), [...ALERT_TYPES].sort(), 'every alert in one group');
  for (const type of Object.keys(ALERT_GROUPS.find((g) => g.id === 'sea').speeds)) assert.equal(alertSpeed({}, type, 'warning'), 1, type);
  assert.equal(alertSpeed({}, 'raidDetected', 'raid'), 10);
  assert.equal(alertSpeed({ alertSpeeds: { uboatAttack: 60 } }, 'uboatAttack', 'danger'), 60);
  assert.equal(alertSpeed({ alertSpeeds: { uboatAttack: 0 } }, 'uboatAttack', 'danger'), 0, 'no slowing down');
  for (const g of ALERT_GROUPS) assert.ok(data.fr.settings.alertGroups[g.id], g.id);
  for (const tab of ['game', 'time', 'map', 'sound', 'dev']) assert.ok(data.fr.settings.tabs[tab], tab);
});
