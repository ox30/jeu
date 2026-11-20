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
  // Near us again within the hour: the page keeps the alert quiet (as ever), and still no stop.
  assert.deepEqual(attack(w, hx57).map((e) => e.type), ['uboatAttack']);
  // The alert does not count for the night (whether it was shown is the page's business):
  // back on the high seas, the first attack there stops the game — and only the first.
  place(hx57, -30, 50);
  assert.deepEqual(attack(w, hx57).map((e) => e.type), ['uboatAttack', 'seaStop']);
  assert.deepEqual(attack(w, hx57).map((e) => e.type), ['uboatAttack']);
  // Either way the report notes it: it stays complete.
  run(w, 2 * H, (e) => e.type === 'watchReport');
  const r = watchReport(w);
  assert.equal(r.notes.filter((n) => n.type === 'uboatAttack').length, 5);
  assert.equal(r.convoys.find((c) => c.id === 'hx57').attacks, 4);
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

test('the ship of the event decides: a U-boat seen by a patrol waits for the report, seen by a group near us it calls the player', () => {
  const w = makeKanalkampf();
  runTo(w, 8 * H);
  drainEvents(w);
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  const patrol = w.squadrons.find((s) => s.role === 'coastal' && s.airfield === 'aldergrove');
  const sighting = (x, y) => ({ type: 'uboatSighted', by: patrol.name, byId: patrol.id, source: 'aircraft', unitKind: 'squadron', uboatId: 'u1', x, y, attack: false });
  // The patrols of Coastal Command follow the rhythm of the watches, wherever they fly:
  // alone over the ocean, in the North Channel, over a convoy — what they see has no ship.
  const [ox, oy] = project(-20, 50);
  fly(w, patrol, ox, oy);
  assert.equal(happensNearUs(w, sighting(ox + 5, oy)), false);
  const [nx, ny] = project(-5.6, 55.2);
  fly(w, patrol, nx, ny);
  assert.equal(happensNearUs(w, sighting(nx + 3, ny)), false);
  fly(w, patrol, hx55.x + 8, hx55.y);
  assert.equal(happensNearUs(w, sighting(hx55.x + 20, hx55.y)), false);
  // … but the convoy it watches over is followed: what happens to the convoy is told at once.
  assert.equal(happensNearUs(w, { type: 'uboatAttack', convoy: hx55.name, convoyId: hx55.id, sunk: 0, x: hx55.x, y: hx55.y }), true);
  // Seen by a group: the group's own place decides.
  const group = w.escorts[0];
  Object.assign(group, { state: 'atSea' });
  place(group, -22, 52);
  assert.equal(happensNearUs(w, { ...sighting(group.x, group.y), unitKind: 'escort', byId: group.id }), false);
  place(group, -5.2, 53.6);
  assert.equal(happensNearUs(w, { ...sighting(group.x, group.y), unitKind: 'escort', byId: group.id }), true);
  // On the high seas under one of our aircraft: followed too.
  place(group, -22, 52);
  fly(w, patrol, group.x + 5, group.y);
  assert.equal(happensNearUs(w, { ...sighting(group.x, group.y), unitKind: 'escort', byId: group.id }), true);
  // What a group signals about itself; an event that names a group and a convoy follows the group.
  assert.equal(happensNearUs(w, { type: 'escortChargesOut', escort: group.name, escortId: group.id, convoy: '', convoyId: null, x: group.x, y: group.y }), true);
  fly(w, patrol, ox, oy);
  assert.equal(happensNearUs(w, { type: 'escortEngaged', escort: group.name, escortId: group.id, convoy: hx55.name, convoyId: hx55.id, x: group.x, y: group.y }), false);
  // An event without a ship, or about a ship that is no more: the report.
  assert.equal(happensNearUs(w, { type: 'dfFix', x: nx, y: ny }), false);
  assert.equal(happensNearUs(w, { type: 'uboatAttack', convoy: 'HX 0', convoyId: 'none', sunk: 1 }), false);
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

test('a decision left unanswered is asked at the relief, whether its alert came or not', () => {
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
  assert.ok(alertFor(w, near, new Map()).decision, 'near us: the alert asks for the order');
  assert.equal(alertFor(w, far, new Map()), null, 'on the high seas: nothing before the relief');
  // The relief asks for both. (The alert may have been closed, kept quiet, or told with the
  // game left at its speed: only the order given answers a decision.)
  run(w, 2 * H, (e) => e.type === 'watchReport');
  const r = watchReport(w);
  assert.equal(r.stop, 'decision');
  assert.ok(r.fresh.includes(`waiting:${cw.id}`) && r.fresh.includes(`waiting:${hx55.id}`));
  assert.deepEqual(w.watch.asked.filter((k) => k.startsWith('waiting:')).sort(), [`waiting:${cw.id}`, `waiting:${hx55.id}`].sort());
});

test('the raids and the questions of the squadrons keep their alerts, watches or not', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  assert.ok(w.watch);
  const raid = { type: 'raidDetected', t: 0, raid: 'H01', raidId: 'r1', count: 20, approx: true, altFt: 15000, location: null };
  assert.equal(alertFor(w, raid, new Map()).level, 'raid');
  const out = { type: 'siteOut', site: 'airfield:kenley', siteName: 'Kenley' };
  assert.ok(alertFor(w, out, new Map()), 'what happens ashore is not the sea\'s');
});
