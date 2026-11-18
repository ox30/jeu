import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import {
  addMember, formationById, launchWaiting, leaderOf, membersOf, newFormation, removeMember, scrambleFormation, setLeader,
} from '../src/sim/formations.js';
import { aircraftSpec, squadronSpeed } from '../src/sim/squadron.js';
import { joinConvoy } from '../src/sim/orders.js';
import { sendEscortHome } from '../src/sim/naval.js';
import { restore, snapshot } from '../src/save/game.js';

const sq = (w, id) => w.squadrons.find((s) => s.id === id);

function wing(w) {
  // 19 Sqn (Spitfire) leads four Hurricane squadrons from Duxford.
  const f = newFormation(w, 'air', '19', 'Big Wing de Duxford');
  for (const id of ['242', '310', '302']) assert.ok(addMember(w, f, id));
  return f;
}

test('a big wing scrambles together, gathers over its leader, then flies at the speed of the slowest', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = wing(w);
  assert.equal(membersOf(w, f).length, 4);
  assert.equal(leaderOf(w, f).id, '19');
  assert.equal(scrambleFormation(w, f, { vector: 120 }), 4);
  assert.ok(membersOf(w, f).every((s) => s.state === 'scrambling'));
  assert.ok(sq(w, '19').holdForWing, 'the leader waits for the wing');
  const events = run(w, 1200, (e) => e.type === 'formationGathered');
  const gathered = events.find((e) => e.type === 'formationGathered');
  assert.ok(gathered, 'the wing gathers');
  assert.equal(sq(w, '19').holdForWing, false);
  run(w, 30);
  const leader = sq(w, '19');
  const hurricane = aircraftSpec(w, 'Hurricane');
  assert.ok(leader.wingSlowest, 'slowest known');
  assert.ok(Math.abs(squadronSpeed(w, leader) * 3600 - hurricane.cruiseKmh) < 1e-6, 'Spitfire leader held back to the Hurricanes');
  assert.ok(membersOf(w, f).slice(1).every((s) => s.follow === '19'));
});

test('a member short of fuel drops out; a lost leader hands over to the next', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = wing(w);
  scrambleFormation(w, f, { vector: 120 });
  run(w, 600);
  const s310 = sq(w, '310');
  s310.state = 'returning';
  s310.returnReason = 'fuel';
  const ev = run(w, 10);
  assert.ok(ev.some((e) => e.type === 'formationLeftBy' && e.unitId === '310' && e.reason === 'fuel'));
  assert.ok(!f.members.includes('310'));
  assert.equal(s310.formation, null);
  sq(w, '19').state = 'lost';
  const ev2 = run(w, 10);
  assert.ok(ev2.some((e) => e.type === 'formationLeader'));
  assert.equal(leaderOf(w, f).id, '242');
  assert.ok(membersOf(w, f).slice(1).every((s) => s.follow === '242'));
});

test('formations merge: a squadron moves from one wing to another; the leader can be changed', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const a = newFormation(w, 'air', '242');
  addMember(w, a, '310');
  const b = newFormation(w, 'air', '302');
  addMember(w, b, '19');
  assert.ok(addMember(w, a, '302'));
  assert.deepEqual(a.members, ['242', '310', '302']);
  assert.deepEqual(b.members, ['19']);
  assert.equal(leaderOf(w, b).id, '19', 'the next one leads what is left');
  assert.ok(setLeader(w, a, '310'));
  assert.deepEqual(a.members, ['310', '242', '302']);
  // Members still on the ground take off to join a wing in the air.
  scrambleFormation(w, a, { vector: 90 });
  run(w, 400);
  const b19 = sq(w, '19');
  removeMember(w, b, '19');
  assert.equal(formationById(w, b.id), null, 'empty formation removed');
  assert.ok(addMember(w, a, '19'), 'a ready squadron joins a wing in the air');
  assert.equal(b19.state, 'scrambling');
  assert.equal(b19.follow, '310');
  assert.equal(launchWaiting(w, a), 0);
});

test('a support group sails together and goes home with its shortest group', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 4 * 86400);
  const c = w.convoys.find((x) => x.state === 'atSea');
  assert.ok(c);
  const f = newFormation(w, 'naval', 'eg1');
  assert.ok(joinConvoy(w, w.escorts.find((e) => e.id === 'eg1'), c.id));
  assert.ok(addMember(w, f, 'eg2'));
  const eg2 = w.escorts.find((e) => e.id === 'eg2');
  assert.equal(eg2.joinTarget, c.id, 'the new member meets the same convoy');
  run(w, 2 * 3600); // an hour to cast off, then at sea
  eg2.lowWarned = true;
  sendEscortHome(w, eg2);
  const ev = run(w, 10);
  assert.ok(ev.some((e) => e.type === 'formationHomeward'));
  assert.ok(w.escorts.find((e) => e.id === 'eg1').homeward, 'the leader goes home too');
});

test('formations are saved and restored', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = wing(w);
  scrambleFormation(w, f, { vector: 120 });
  run(w, 300);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const b = makeWorld('standard', {}, 'quinze-septembre');
  restore(b, snap);
  assert.equal(b.formations.length, 1);
  assert.deepEqual(b.formations[0].members, f.members);
  assert.equal(b.squadrons.find((s) => s.id === '242').formation, f.id);
  run(w, 600);
  run(b, 600);
  assert.equal(JSON.stringify(w.squadrons.map((s) => [s.x, s.y, s.state])), JSON.stringify(b.squadrons.map((s) => [s.x, s.y, s.state])));
});

test('support group members put to sea and keep station astern of their leader', async () => {
  const { routeConvoy } = await import('../src/sim/convoy.js');
  const { project } = await import('../src/sim/geo.js');
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const f = newFormation(w, 'naval', 'eg1');
  assert.ok(addMember(w, f, 'eg3'));
  const eg1 = w.escorts.find((e) => e.id === 'eg1');
  const eg3 = w.escorts.find((e) => e.id === 'eg3');
  const out = [[-5.0, 54.0], [-5.2, 54.55], [-5.55, 54.85], [-5.97, 55.25], [-6.25, 55.4], [-7.5, 55.62], [-12, 56.8]];
  const res = routeConvoy(w, eg1, out.map(([lon, lat]) => project(lon, lat)));
  assert.ok(res.ok, 'route accepted');
  run(w, 20 * 3600);
  assert.equal(eg3.state, 'atSea', 'the member left port');
  assert.equal(eg3.followEscort, 'eg1');
  const d = Math.hypot(eg3.x - eg1.x, eg3.y - eg1.y);
  assert.ok(d < 5, `in station (${d.toFixed(1)} km)`);
});

test('when the leader goes home short of fuel, the next one carries on with its mission', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = wing(w);
  scrambleFormation(w, f, { vector: 120 });
  run(w, 1200, (e) => e.type === 'formationGathered');
  run(w, 30);
  const leader = sq(w, '19');
  assert.equal(leader.holdForWing, false);
  assert.equal(leader.vector, 120);
  // The leader turns back short of fuel (as updateFuel would do it).
  leader.state = 'returning';
  leader.returnReason = 'fuel';
  leader.vector = null;
  const ev = run(w, 10);
  assert.ok(ev.some((e) => e.type === 'formationLeader'));
  assert.ok(!ev.some((e) => e.type === 'formationBroken'), 'no "formation broken" message in a managed wing');
  const next = leaderOf(w, f);
  assert.notEqual(next.id, '19');
  assert.equal(next.vector, 120, 'same heading as before');
  assert.ok(!f.members.includes('19'));
  assert.ok(membersOf(w, f).slice(1).every((s) => s.follow === next.id));
});

test('two wings merge into one', async () => {
  const { mergeFormations } = await import('../src/sim/formations.js');
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const a = newFormation(w, 'air', '19');
  addMember(w, a, '242');
  const b = newFormation(w, 'air', '310');
  addMember(w, b, '302');
  scrambleFormation(w, a, { vector: 90 });
  scrambleFormation(w, b, { vector: 90 });
  run(w, 300);
  const ev = [];
  assert.ok(mergeFormations(w, a, b));
  ev.push(...run(w, 10));
  assert.deepEqual(a.members, ['19', '242', '310', '302']);
  assert.equal(formationById(w, b.id), null);
  assert.ok(ev.some((e) => e.type === 'formationMerged'));
  for (const id of ['242', '310', '302']) {
    assert.equal(sq(w, id).follow, '19', `${id} follows the leader`);
    assert.equal(sq(w, id).formation, a.id);
  }
});

test('arcade: a wing on the ground is guided onto a raid and takes off together', async () => {
  const { interceptFormation } = await import('../src/sim/formations.js');
  const w = makeWorld('arcade', {}, 'quinze-septembre');
  const f = wing(w);
  // Wait for a raid on the table that the controller can give.
  let raidId = null;
  for (let i = 0; i < 12 * 3600 && !raidId; i += 60) {
    run(w, 60);
    for (const c of w.contacts.values()) {
      const r = w.raids.find((x) => x.id === c.raidId);
      if (r && !r.phantom && r.phase !== 'outbound') {
        raidId = c.raidId;
        break;
      }
    }
  }
  assert.ok(raidId, 'a raid appears');
  const p = interceptFormation(w, f, raidId);
  assert.ok(p !== null && p > 0, 'the controller gives the wing a chance');
  const leader = leaderOf(w, f);
  assert.ok(leader.intercept && leader.intercept.raidId === raidId, 'the leader is guided');
  assert.ok(membersOf(w, f).every((s) => s.state === 'scrambling' || s.state === 'airborne'));
  assert.ok(leader.holdForWing, 'it gathers first');
});

test('a support group follows its leader onto a convoy, and leaves it with it', async () => {
  const { leaveConvoy } = await import('../src/sim/orders.js');
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 4 * 86400);
  const c = w.convoys.find((x) => x.state === 'atSea' && x.type !== 'coastal');
  assert.ok(c);
  const eg1 = w.escorts.find((e) => e.id === 'eg1');
  const eg2 = w.escorts.find((e) => e.id === 'eg2');
  const f = newFormation(w, 'naval', 'eg1');
  addMember(w, f, 'eg2');
  // An order given to the leader alone is carried out by the whole group.
  assert.ok(joinConvoy(w, eg1, c.id));
  run(w, 10);
  assert.equal(eg2.joinTarget, c.id, 'the member meets the same convoy');
  // The convoy is some 3,000 km out: about three days to meet it.
  for (let h = 0; h < 120 && !(eg1.state === 'escorting' && eg2.state === 'escorting'); h++) run(w, 3600);
  assert.equal(eg1.state, 'escorting', 'the leader takes station');
  assert.equal(eg2.state, 'escorting', 'and so does the member');
  assert.ok(leaveConvoy(w, eg1));
  run(w, 10);
  assert.equal(eg2.state, 'atSea', 'the member leaves with the leader');
  assert.equal(eg2.followEscort, 'eg1');
});
