// The tabs of an installation that holds units (asked after play-testing 2.10: « afficher le
// port et les étiquettes d'unités »): an aerodrome and its squadrons on the ground, a port and
// the ships lying there. The module is free of the page; the panel draws what it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { addMember, newFormation } from '../src/sim/formations.js';
import { siteKeyOf, siteOfSelection, siteTabs, tabSelection, unitsIn } from '../src/ui/siteUnits.js';

setDictionary(data.fr);

const labels = (place) => place.tabs.map((x) => `${x.label}${x.active ? '*' : ''}`);

/** The winter in the Atlantic once its first convoy has sailed (six hours in). */
function atlanticWithConvoy() {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 7 * 3600, () => w.convoys.length > 0);
  assert.ok(w.convoys.length > 0, 'a convoy is at sea');
  return w;
}

test('an aerodrome holds its squadrons on the ground, one tab each after its own', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  // An aerodrome with two squadrons or more, as the scenario places them.
  const field = w.airfields.find((f) => w.squadrons.filter((s) => s.airfield === f.id).length >= 2);
  assert.ok(field, 'the scenario has an aerodrome with two squadrons');
  const site = w.sites.get(`airfield:${field.id}`);
  const here = w.squadrons.filter((s) => s.airfield === field.id);
  assert.deepEqual(unitsIn(w, site).map((u) => u.id), here.map((s) => s.id));
  // The aerodrome in hand: its tab first and active, then one a squadron.
  const place = siteTabs(w, { kind: 'site', id: site.key });
  assert.deepEqual(labels(place), [`${field.name}*`, ...here.map((s) => s.name)]);
  assert.deepEqual(tabSelection(place.tabs[0]), { kind: 'site', id: site.key });
  assert.deepEqual(tabSelection(place.tabs[1]), { kind: 'squadron', id: here[0].id });
  // A squadron of it in hand: the same tabs, its own active, the way back to the aerodrome kept.
  const mine = siteTabs(w, { kind: 'squadron', id: here[1].id });
  assert.deepEqual(labels(mine), [field.name, here[0].name, `${here[1].name}*`, ...here.slice(2).map((s) => s.name)]);
  // Called to its aircraft it is still on the ground; in the air it has left; lost it is gone.
  here[0].state = 'scrambling';
  assert.equal(siteKeyOf(w, here[0]), site.key);
  here[0].state = 'airborne';
  assert.equal(siteKeyOf(w, here[0]), null);
  assert.equal(siteTabs(w, { kind: 'squadron', id: here[0].id }), null, 'a squadron in the air has no such tabs');
  assert.equal(unitsIn(w, site).some((u) => u.id === here[0].id), false);
  here[1].state = 'lost';
  assert.equal(unitsIn(w, site).some((u) => u.id === here[1].id), false);
  // Landed elsewhere, it stands where it is, not where it is based.
  const other = w.airfields.find((f) => f.id !== field.id);
  here[0].state = 'refuelling';
  here[0].airfield = other.id;
  assert.equal(siteKeyOf(w, here[0]), `airfield:${other.id}`);
});

test('an installation that holds nothing has no tabs; neither have a radar or a factory', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const field = w.airfields.find((f) => w.squadrons.some((s) => s.airfield === f.id));
  for (const s of w.squadrons) if (s.airfield === field.id) s.state = 'airborne';
  assert.equal(siteTabs(w, { kind: 'site', id: `airfield:${field.id}` }), null);
  assert.equal(siteTabs(w, { kind: 'site', id: w.radars[0].key }), null);
  assert.equal(siteTabs(w, { kind: 'site', id: w.factories[0].key }), null);
  assert.equal(siteTabs(w, { kind: 'raid', id: 'r01' }), null);
  assert.equal(siteTabs(w, null), null);
});

test('a port holds the groups lying there and the convoys at its quays', () => {
  const w = atlanticWithConvoy();
  const port = w.sites.get('port:liverpool');
  const [eg1, eg3] = ['eg1', 'eg3'].map((id) => w.escorts.find((e) => e.id === id));
  assert.deepEqual(labels(siteTabs(w, { kind: 'site', id: port.key })), ['Liverpool*', 'EG 1', 'EG 3']);
  assert.deepEqual(labels(siteTabs(w, { kind: 'escort', id: 'eg3' })), ['Liverpool', 'EG 1', 'EG 3*']);
  // Refitting it is still there; raising steam too (an hour alongside); at sea it has left.
  eg1.state = 'refit';
  assert.equal(siteKeyOf(w, eg1), port.key);
  eg1.state = 'atSea';
  eg1.underwayAt = w.t + 3600;
  assert.equal(siteKeyOf(w, eg1), port.key, 'casting off: still alongside');
  eg1.underwayAt = w.t;
  assert.equal(siteKeyOf(w, eg1), null);
  assert.deepEqual(labels(siteTabs(w, { kind: 'site', id: port.key })), ['Liverpool*', 'EG 3']);
  assert.equal(siteTabs(w, { kind: 'escort', id: 'eg1' }), null);
  // A convoy unloading at the quays has its tab; once unloaded, or still at sea, it has none.
  const c = w.convoys[0];
  Object.assign(c, { state: 'arrived', portId: 'liverpool', unloading: true });
  assert.deepEqual(labels(siteTabs(w, { kind: 'convoy', id: c.id })), ['Liverpool', 'EG 3', `${c.name}*`]);
  c.unloading = false;
  assert.equal(siteTabs(w, { kind: 'convoy', id: c.id }), null);
  Object.assign(c, { state: 'atSea', portId: null });
  assert.equal(siteKeyOf(w, c), null);
  // The only group gone, the port is a port again: no tab.
  eg3.state = 'escorting';
  assert.equal(siteTabs(w, { kind: 'site', id: port.key }), null);
});

test('a foreign port has no sheet, and so no tabs for the convoy that waits there', () => {
  const w = atlanticWithConvoy();
  const halifax = w.ports.find((p) => p.foreign);
  const c = w.convoys[0];
  Object.assign(c, { state: 'inPort', portId: halifax.id });
  assert.equal(siteKeyOf(w, c), `port:${halifax.id}`);
  assert.equal(siteOfSelection(w, { kind: 'convoy', id: c.id }), null);
  assert.equal(siteTabs(w, { kind: 'convoy', id: c.id }), null);
  assert.equal(siteTabs(w, { kind: 'site', id: `port:${halifax.id}` }), null);
});

test('the groups of a support group are one tab, which selects the group', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const f = newFormation(w, 'naval', 'eg1', 'Groupe A');
  // (A group joins a support group in port or in tracked waters; EG 2 is brought to Liverpool.)
  Object.assign(w.escorts.find((e) => e.id === 'eg2'), { portId: 'liverpool', x: w.byId.port.get('liverpool').x, y: w.byId.port.get('liverpool').y });
  assert.ok(addMember(w, f, 'eg2'));
  const place = siteTabs(w, { kind: 'site', id: 'port:liverpool' });
  assert.deepEqual(labels(place), ['Liverpool*', 'Groupe A', 'EG 3']);
  assert.deepEqual(tabSelection(place.tabs[1]), { kind: 'formation', id: f.id });
  // The support group in hand, or one of its groups: its tab is the active one.
  assert.deepEqual(labels(siteTabs(w, { kind: 'formation', id: f.id })), ['Liverpool', 'Groupe A*', 'EG 3']);
  assert.deepEqual(labels(siteTabs(w, { kind: 'escort', id: 'eg2' })), ['Liverpool', 'Groupe A*', 'EG 3']);
  // A wing has no one place: its squadrons keep a tab each on their aerodromes.
  const air = makeWorld('standard', {}, 'adlertag');
  const [a, b] = air.squadrons.filter((s) => s.role === 'fighter');
  const wing = newFormation(air, 'air', a.id, 'Wing');
  addMember(air, wing, b.id);
  assert.equal(siteTabs(air, { kind: 'formation', id: wing.id }), null);
  const mine = siteTabs(air, { kind: 'squadron', id: a.id });
  assert.ok(mine.tabs.some((x) => x.active && x.kind === 'squadron' && x.id === a.id));
});

test('a unit stacked with them on the map, but standing elsewhere, keeps its tab', () => {
  const w = atlanticWithConvoy();
  const c = w.convoys[0];
  // (As findStacks gives it: the two groups of the port and a convoy passing off it.)
  const stack = { family: 'sea', members: [
    { kind: 'escort', id: 'eg1', label: 'EG 1', formation: null },
    { kind: 'escort', id: 'eg3', label: 'EG 3', formation: null },
    { kind: 'convoy', id: c.id, label: c.name, formation: null },
  ] };
  assert.deepEqual(labels(siteTabs(w, { kind: 'escort', id: 'eg1' }, stack)), ['Liverpool', 'EG 1*', 'EG 3', c.name]);
  // With the convoy itself in hand (at sea), the tabs are the stack's own: none from here.
  assert.equal(siteTabs(w, { kind: 'convoy', id: c.id }, stack), null);
});
