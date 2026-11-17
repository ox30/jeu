import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { project } from '../src/sim/geo.js';
import { answerQuestion, setRoe } from '../src/sim/engagement.js';
import { addMember, newFormation } from '../src/sim/formations.js';
import { restore, snapshot } from '../src/save/game.js';

/** A raid of the 15 September put where the test wants it, coming in or going home. */
function placeRaid(w, [lon, lat], phase, [hLon, hLat]) {
  const r = w.raids.find((x) => !x.phantom && x.bombers > 0);
  const [x, y] = project(lon, lat);
  const [hx, hy] = project(hLon, hLat);
  Object.assign(r, { x, y, px: x, py: y, phase, alt: 5000, departure: 0 });
  if (phase === 'outbound') Object.assign(r, { ox: hx, oy: hy });
  else Object.assign(r, { tx: hx, ty: hy });
  return r;
}

/** A squadron in the air at `km` from the raid, at its height. */
function placeSquadron(w, id, r, km = 15) {
  const s = w.squadrons.find((x) => x.id === id);
  Object.assign(s, {
    state: 'airborne', x: r.x - km, y: r.y, px: r.x - km, py: r.y, alt: r.alt, palt: r.alt, targetAlt: r.alt, orbit: true, heading: 90, fuel: 80, ammo: 1,
  });
  return s;
}

const kanalLondon = [0.3, 51.35]; // over Kent, east of London
const france = [2.4, 50.6];

test('a squadron at "attack" leaves a raid going home and asks leave to pursue; no answer is a no', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const r = placeRaid(w, kanalLondon, 'outbound', france);
  const s = placeSquadron(w, '19', r);
  assert.equal(s.roe, 'attack', 'attack is the standing order, as before');
  const ev = run(w, 5);
  const q = ev.find((e) => e.type === 'question');
  assert.ok(q, 'a question is put');
  assert.equal(q.kind, 'pursue');
  assert.equal(w.questions.length, 1);
  const later = run(w, 70);
  assert.ok(later.some((e) => e.type === 'questionExpired'), 'unanswered: no');
  assert.notEqual(s.state, 'combat');
  assert.equal(w.questions.length, 0);
  assert.ok(!run(w, 30).some((e) => e.type === 'question'), 'asked once only');
});

test('leave to pursue: the squadron goes after the raid going home and attacks it', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const r = placeRaid(w, kanalLondon, 'outbound', france);
  const s = placeSquadron(w, '19', r);
  setRoe(w, s, 'attack');
  run(w, 5);
  assert.ok(answerQuestion(w, w.questions[0].id, true));
  assert.equal(s.attackRaid, r.id);
  assert.equal(s.speedMode, 'max');
  run(w, 240, (e) => e.type === 'tallyHo');
  assert.equal(s.state, 'combat', 'it caught the raid');
  assert.equal(s.engagedRaid, r.id);
});

test('a squadron at "defend" asks before engaging a raid coming in', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const r = placeRaid(w, kanalLondon, 'inbound', [-0.1, 51.5]);
  const s = placeSquadron(w, '19', r, 20);
  setRoe(w, s, 'defend');
  s.x = r.x + 4;
  s.px = s.x;
  const ev = run(w, 3);
  const q = ev.find((e) => e.type === 'question');
  assert.ok(q && q.kind === 'engage', 'leave to engage asked');
  assert.notEqual(s.state, 'combat', 'no fight without leave, even within reach');
  answerQuestion(w, q.questionId, true);
  run(w, 120, (e) => e.type === 'tallyHo');
  assert.equal(s.state, 'combat');
});

test('a squadron at "pursue" follows the raid home and asks again at mid-Channel; refused, it goes home', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const r = placeRaid(w, [1.4, 51.03], 'outbound', france);
  const s = placeSquadron(w, '19', r, 3);
  setRoe(w, s, 'pursue');
  const ev = run(w, 30);
  assert.ok(!ev.some((e) => e.type === 'question' && e.kind === 'pursue'), 'no leave needed to pursue');
  assert.equal(s.state, 'combat', 'it attacks the raid going home');
  const more = run(w, 900, (e) => e.type === 'question' && e.kind === 'beyond');
  const beyond = more.find((e) => e.type === 'question' && e.kind === 'beyond');
  assert.ok(beyond, 'leave asked at mid-Channel');
  answerQuestion(w, beyond.questionId, false);
  run(w, 3);
  assert.equal(s.state, 'returning', 'it breaks off and goes home');
});

test('without questions, the standing order applies on its own', () => {
  const w = makeWorld('standard', { questions: false }, 'quinze-septembre');
  const r = placeRaid(w, kanalLondon, 'outbound', france);
  const s = placeSquadron(w, '19', r, 2);
  setRoe(w, s, 'attack');
  const ev = run(w, 120);
  assert.ok(!ev.some((e) => e.type === 'question'));
  assert.notEqual(s.state, 'combat');
});

test('a big wing is asked once, for all its squadrons; the question is saved with the game', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = newFormation(w, 'air', '19', 'Duxford Wing');
  addMember(w, f, '242');
  const r = placeRaid(w, kanalLondon, 'outbound', france);
  setRoe(w, placeSquadron(w, '19', r), 'attack');
  setRoe(w, placeSquadron(w, '242', r, 14), 'attack');
  run(w, 5);
  assert.equal(w.questions.length, 1);
  assert.deepEqual(w.questions[0].units, [f.id]);
  const b = makeWorld('standard', {}, 'quinze-septembre');
  restore(b, JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(b.questions.length, 1);
  assert.ok(b.asked.has(`pursue:${r.id}:${f.id}`));
  answerQuestion(b, b.questions[0].id, true);
  assert.ok(b.squadrons.find((s) => s.id === '242').cleared.has(r.id), 'every squadron of the wing has leave');
});

test('leave to pursue, then "defend": the squadron breaks off at its next round and does not attack again', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const r = placeRaid(w, kanalLondon, 'outbound', france);
  const s = placeSquadron(w, '19', r);
  run(w, 5);
  answerQuestion(w, w.questions[0].id, true);
  run(w, 240, (e) => e.type === 'tallyHo');
  assert.equal(s.state, 'combat');
  setRoe(w, s, 'defend');
  assert.equal(s.cleared.size, 0, 'the leave given before is gone');
  const ev = run(w, 300);
  assert.notEqual(s.state, 'combat', 'it broke off');
  assert.ok(!ev.some((e) => e.type === 'tallyHo'), 'and did not attack again');
  assert.ok(!ev.some((e) => e.type === 'question'), 'nor asked again');
});

test('« Désengager H05 »: out of the fight at once, it circles and leaves that raid alone, until sent back', async () => {
  const { breakOffRaid } = await import('../src/sim/combat.js');
  const { authorize } = await import('../src/sim/engagement.js');
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const r = placeRaid(w, kanalLondon, 'inbound', [-0.1, 51.5]);
  const s = placeSquadron(w, '19', r, 3);
  run(w, 120, (e) => e.type === 'tallyHo');
  assert.equal(s.state, 'combat', 'attack: it engages the raid coming in');
  const names = breakOffRaid(w, [s], r.id);
  assert.deepEqual(names, [s.name]);
  assert.equal(s.state, 'airborne');
  assert.ok(s.orbit, 'it circles where it is');
  assert.ok(s.letGo.has(r.id));
  const ev = run(w, 120);
  assert.ok(!ev.some((e) => e.type === 'tallyHo' || e.type === 'question'), 'no new attack, no question, raid still close');
  // A line drawn onto the raid sends it back.
  authorize(s, r.id);
  assert.ok(!s.letGo.has(r.id));
  const saved = makeWorld('standard', {}, 'quinze-septembre');
  breakOffRaid(w, [s], r.id);
  restore(saved, JSON.parse(JSON.stringify(snapshot(w))));
  assert.ok(saved.squadrons.find((x) => x.id === '19').letGo.has(r.id), 'saved with the game');
});

test('a big wing called off a raid: every squadron leaves the fight and the wing gathers on its leader', async () => {
  const { breakOffRaid } = await import('../src/sim/combat.js');
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const f = newFormation(w, 'air', '19', 'Duxford Wing');
  addMember(w, f, '242');
  const r = placeRaid(w, kanalLondon, 'inbound', [-0.1, 51.5]);
  const a = placeSquadron(w, '19', r, 3);
  const b = placeSquadron(w, '242', r, 4);
  run(w, 120, (e) => e.type === 'tallyHo');
  assert.ok([a, b].some((s) => s.state === 'combat'));
  const ev = [];
  const names = breakOffRaid(w, [a, b], r.id);
  assert.ok(names.length >= 1);
  ev.push(...run(w, 90));
  assert.ok([a, b].every((s) => s.state !== 'combat'), 'none fights on');
  assert.ok(!ev.some((e) => e.type === 'tallyHo'));
});
