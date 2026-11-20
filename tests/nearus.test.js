// The alerts of the sea near us (2.12, decision of 20 November 2026). At the rhythm of the
// watches — every scenario with ships — an event of the high seas waits for the report of the
// relief. A ship in the waters the headquarters follows (those closed to the U-boats, the
// approaches of the ports, the surface cover of the coastal radars) or under one of the
// player's aircraft keeps its alerts as they come, as without the watches. Either way the
// report notes the event: it stays complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeKanalkampf, makeWorld, run, runTo } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { project } from '../src/sim/geo.js';
import { drainEvents, emit } from '../src/sim/events.js';
import { happensNearUs, watchReport } from '../src/sim/watch.js';
import { aircraftInSight, followedLive, inTrackedWaters, sendOrder } from '../src/sim/comms.js';
import { isDaylight } from '../src/sim/daylight.js';
import { alertFor, alertSpeed } from '../src/ui/alertRules.js';

setDictionary(data.fr);
const H = 3600;

/** Puts a ship at a place of the map. */
function place(u, lon, lat) {
  const [x, y] = project(lon, lat);
  Object.assign(u, { x, y, px: x, py: y });
}

/** A U-boat attack on a convoy, as the simulation reports one: the events it made. */
function attack(w, c, sunk = 1) {
  emit(w, 'uboatAttack', { convoy: c.name, convoyId: c.id, sunk, escorts: 0, x: c.x, y: c.y });
  return drainEvents(w);
}

/** One of the player's patrols in the air over a place. */
function fly(w, s, x, y) {
  Object.assign(s, { state: 'airborne', x, y, px: x, py: y, alt: 300, targetAlt: 300, orbit: true, fuel: 100 });
}

test('on the high seas an attack waits for the report and stops the game once; near us it calls the player as it comes', () => {
  const w = makeKanalkampf();
  drainEvents(w);
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  const hx57 = w.convoys.find((c) => c.id === 'hx57');
  // HX 55 at 26° W: nobody near.
  assert.ok(!followedLive(w, hx55));
  const far = attack(w, hx55);
  assert.deepEqual(far.map((e) => e.type), ['uboatAttack', 'seaStop'], 'the first attack of the night stops the game');
  assert.ok(!far[0].live);
  assert.equal(alertFor(w, far[0], new Map()), null, 'no alert: the report tells it');
  // HX 57 in the Irish Sea, waters closed to the U-boats that the headquarters follows.
  place(hx57, -5.2, 53.6);
  assert.ok(inTrackedWaters(w, hx57.x, hx57.y) && followedLive(w, hx57));
  const near = attack(w, hx57, 2);
  assert.deepEqual(near.map((e) => e.type), ['uboatAttack'], 'no stop of the watch: the alert does the calling');
  assert.equal(near[0].live, true);
  const a = alertFor(w, near[0], new Map());
  assert.ok(a && a.level === 'danger' && a.focus.id === 'hx57');
  assert.equal(alertSpeed({}, a.type, a.level), 1, 'at ×1, as without the watches');
  // The alert counted for the night: back on the high seas, a second attack goes to the report.
  place(hx57, -30, 50);
  assert.deepEqual(attack(w, hx57).map((e) => e.type), ['uboatAttack']);
  // Either way the report notes it: it stays complete.
  run(w, 2 * H, (e) => e.type === 'watchReport');
  const r = watchReport(w);
  assert.equal(r.notes.filter((n) => n.type === 'uboatAttack').length, 3);
  assert.equal(r.convoys.find((c) => c.id === 'hx57').attacks, 2);
  assert.equal(r.convoys.find((c) => c.id === 'hx55').attacks, 1);
  assert.ok(r.notes.every((n) => !('live' in n)), 'the mark is the event\'s, not the report\'s');
});

test('one of our aircraft in sight of a ship: its alerts as they come, on the high seas too', () => {
  const w = makeKanalkampf();
  runTo(w, 8 * H); // 14:00 by the clock: day at 26° W
  drainEvents(w);
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  assert.ok(isDaylight(w, hx55.x, hx55.y) && !inTrackedWaters(w, hx55.x, hx55.y));
  const patrol = w.squadrons.find((s) => s.role === 'coastal' && s.airfield === 'aldergrove');
  // Too far to see it: the report.
  fly(w, patrol, hx55.x + 60, hx55.y);
  assert.equal(aircraftInSight(w, hx55), null);
  emit(w, 'convoySighted', { convoy: hx55.name, convoyId: hx55.id });
  assert.ok(!drainEvents(w)[0].live);
  // Over the convoy: the headquarters is with it.
  fly(w, patrol, hx55.x + 10, hx55.y);
  assert.equal(aircraftInSight(w, hx55), patrol);
  assert.ok(followedLive(w, hx55));
  emit(w, 'convoySighted', { convoy: hx55.name, convoyId: hx55.id });
  const [seen] = drainEvents(w);
  assert.equal(seen.live, true);
  assert.ok(alertFor(w, seen, new Map()), 'a U-boat shadows the convoy: the player is told at once');
  // And with direct communications (Arcade) the rule is the same: it is not the silence's.
  const easy = makeKanalkampf('arcade');
  drainEvents(easy);
  const c = easy.convoys.find((x) => x.id === 'hx55');
  assert.deepEqual(attack(easy, c).map((e) => e.type), ['uboatAttack', 'seaStop']);
});

test('a U-boat seen by an aircraft: near us in the waters followed, or when the aircraft watches over one of our ships', () => {
  const w = makeKanalkampf();
  runTo(w, 8 * H);
  drainEvents(w);
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  const patrol = w.squadrons.find((s) => s.role === 'coastal' && s.airfield === 'aldergrove');
  const sighting = (x, y) => ({ type: 'uboatSighted', by: patrol.name, byId: patrol.id, source: 'aircraft', unitKind: 'squadron', uboatId: 'u1', x, y, attack: false });
  // Alone over the ocean: nothing of ours near, the sighting waits for the relief.
  const [ox, oy] = project(-20, 50);
  fly(w, patrol, ox, oy);
  assert.equal(happensNearUs(w, sighting(ox + 5, oy)), false);
  // In the North Channel: waters the headquarters follows.
  const [nx, ny] = project(-5.6, 55.2);
  fly(w, patrol, nx, ny);
  assert.equal(happensNearUs(w, sighting(nx + 3, ny)), true);
  // Over HX 55, on the high seas: what the escorting aircraft sees is told at once.
  fly(w, patrol, hx55.x + 8, hx55.y);
  assert.equal(happensNearUs(w, sighting(hx55.x + 20, hx55.y)), true);
  // Seen by a group: the group's own place decides.
  const group = w.escorts[0];
  Object.assign(group, { state: 'atSea' });
  place(group, -22, 52);
  assert.equal(happensNearUs(w, { ...sighting(group.x, group.y), unitKind: 'escort', byId: group.id }), false);
  place(group, -5.2, 53.6);
  assert.equal(happensNearUs(w, { ...sighting(group.x, group.y), unitKind: 'escort', byId: group.id }), true);
  // What a group signals about itself.
  assert.equal(happensNearUs(w, { type: 'escortChargesOut', escort: group.name, escortId: group.id, convoy: '', convoyId: null, x: group.x, y: group.y }), true);
});

test('CW 7 on the Admiralty\'s route never leaves the waters followed: its bombings call the player, and the report has them', () => {
  const w = makeKanalkampf();
  const cw = w.convoys.find((c) => c.type === 'coastal');
  assert.equal(cw.name, 'CW 7');
  assert.ok(sendOrder(w, cw, 'route', cw.admiraltyRoute.slice(1)).ok);
  const bombed = [];
  let fixes = 0;
  let tracked = 0;
  while (cw.state !== 'arrived' && cw.state !== 'lost' && w.t < 30 * H) {
    for (const e of run(w, 600)) if (e.type === 'convoyBombed' && e.convoyId === cw.id) bombed.push(e);
    if (cw.state === 'atSea') {
      fixes++;
      if (inTrackedWaters(w, cw.x, cw.y)) tracked++;
    }
  }
  assert.ok(fixes > 40, `${fixes} fixes on its way`);
  assert.equal(tracked, fixes, 'in the waters followed from the Thames to the Solent');
  assert.ok(bombed.length >= 1, `${bombed.length} bombing(s) by the raids on the convoy`);
  const memory = new Map();
  for (const e of bombed) assert.equal(e.live, true);
  assert.ok(alertFor(w, bombed[0], memory), 'the first calls the player (the next ones within two hours stay quiet, as ever)');
  const notes = w.watch.reports.flatMap((r) => r.notes || []).concat(w.watch.notes);
  assert.equal(notes.filter((n) => n.type === 'convoyBombed' && n.convoyId === cw.id).length, bombed.length, 'every bombing is in a report');
  // (Point 4.) The coastal convoy has its row in the reports of the watches it sailed in.
  const rows = w.watch.reports.filter((r) => (r.convoys || []).some((c) => c.id === cw.id));
  assert.ok(rows.length >= 2, `${rows.length} reports list CW 7`);
});

test('a decision the player was called for as it came is not asked again at the relief', () => {
  const w = makeKanalkampf();
  drainEvents(w);
  const cw = w.convoys.find((c) => c.type === 'coastal');
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  // Both stopped: CW 7 off the Thames (near us), HX 55 at 26° W.
  for (const c of [cw, hx55]) {
    c.state = 'waiting';
    emit(w, 'convoyStopped', { convoy: c.name, convoyId: c.id, x: c.x, y: c.y, unitKind: 'convoy' });
  }
  const [near, far] = drainEvents(w);
  assert.equal(near.live, true);
  assert.ok(!far.live);
  assert.ok(alertFor(w, near, new Map()).decision, 'the alert asks for the order, and stays until it is given');
  run(w, 2 * H, (e) => e.type === 'watchReport');
  const r = watchReport(w);
  const keys = r.decisions.map((d) => d.key);
  assert.ok(keys.includes(`waiting:${cw.id}`) && keys.includes(`waiting:${hx55.id}`), 'both are in « À décider »');
  assert.ok(!r.fresh.includes(`waiting:${cw.id}`), 'CW 7: asked already, the relief does not stop for it');
  assert.ok(r.fresh.includes(`waiting:${hx55.id}`), 'HX 55: the relief asks');
});

test('the raids and the questions of the squadrons keep their alerts, watches or not', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  assert.ok(w.watch);
  const raid = { type: 'raidDetected', t: 0, raid: 'H01', raidId: 'r1', count: 20, approx: true, altFt: 15000, location: null };
  assert.equal(alertFor(w, raid, new Map()).level, 'raid');
  const out = { type: 'siteOut', site: 'airfield:kenley', siteName: 'Kenley' };
  assert.ok(alertFor(w, out, new Map()), 'what happens ashore is not the sea\'s');
});
