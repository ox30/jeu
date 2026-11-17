import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeKanalkampf, makeWorld, run, runTo } from './helpers.js';
import { ALERT_SPEED, ALERT_TYPES, alertFor } from '../src/ui/alertRules.js';
import { SPEEDS, enemyAction, requestSpeed } from '../src/ui/actions.js';
import { setDictionary, t } from '../src/core/i18n.js';
import { checkDevPassword, devRaids, passwordHash, raidLine, uboatLine } from '../src/ui/dev.js';

setDictionary(data.fr);

test('every alert has its texts in French', () => {
  for (const type of ALERT_TYPES) {
    if (type === 'raidDetected') continue;
    const a = data.fr.alerts[type];
    assert.ok(a && a.title && a.text, type);
  }
});

test('a convoy attacked twice in the same night calls the player once', () => {
  const w = makeKanalkampf();
  const memory = new Map();
  const c = w.convoys[0];
  const e = { type: 'uboatAttack', convoy: c.name, convoyId: c.id, sunk: 2, x: c.x, y: c.y };
  const a = alertFor(w, e, memory);
  assert.equal(a.level, 'danger');
  assert.equal(a.focus.id, c.id);
  assert.equal(alertFor(w, e, memory), null, 'quiet for a while');
  w.t += 7 * 3600;
  assert.ok(alertFor(w, e, memory), 'the next night calls again');
  assert.ok(ALERT_SPEED.danger <= 60 && ALERT_SPEED.raid <= 10 && ALERT_SPEED.warning <= 600);
});

test('a U-boat seen by an aircraft or an escort calls the player anywhere, once an hour for that boat', () => {
  const w = makeKanalkampf();
  const memory = new Map();
  const c = w.convoys.find((u) => u.state === 'atSea');
  assert.ok(c);
  const near = alertFor(w, { type: 'uboatSighted', by: '502 Sqn', source: 'aircraft', uboatId: 'u1', x: c.x + 40, y: c.y }, memory);
  assert.equal(near.level, 'warning');
  assert.equal(near.variant, 'near');
  assert.equal(near.params.convoy, c.name);
  assert.equal(alertFor(w, { type: 'uboatSighted', by: '502 Sqn', source: 'aircraft', uboatId: 'u1', x: c.x + 50, y: c.y }, memory), null, 'quiet a while');
  const far = alertFor(w, { type: 'uboatSighted', by: '502 Sqn', source: 'asv', uboatId: 'u2', x: c.x + 2000, y: c.y }, memory);
  assert.ok(far, 'far from any convoy too');
  assert.equal(far.variant, 'text');
  assert.equal(alertFor(w, { type: 'uboatSighted', by: 'EG 1', source: 'asdic', uboatId: 'u3', x: c.x, y: c.y, attack: true }, memory), null,
    'a group that attacks at once calls with « Escorte au combat »');
});

test('Atlantic: a coastal patrol that sees a U-boat brings the game down to x1', async () => {
  const { alertSpeed } = await import('../src/ui/alertRules.js');
  const w = makeWorld('standard', { fuel: 'unlimited' }, 'hiver-atlantique');
  const memory = new Map();
  runTo(w, 4 * 3600); // 10:00, broad daylight
  const u = w.uboats.find((x) => x.state !== 'gone' && x.state !== 'sunk');
  u.state = 'patrol';
  u.submergedUntil = 0;
  const s = w.squadrons.find((x) => x.role === 'coastal' && x.asv);
  Object.assign(s, { state: 'airborne', x: u.x + 3, y: u.y, px: u.x + 3, py: u.y, alt: 300, targetAlt: 300, orbit: true, fuel: 100 });
  const events = run(w, 3600, (e) => e.type === 'uboatSighted' && e.unitKind === 'squadron');
  const seen = events.find((e) => e.type === 'uboatSighted' && e.unitKind === 'squadron');
  assert.ok(seen, 'the patrol sees the U-boat');
  const a = alertFor(w, seen, memory);
  assert.ok(a);
  assert.equal(alertSpeed({}, a.type, a.level), 1);
  assert.ok(data.fr.alerts.uboatSighted[a.variant].length > 10);
});

test('an unescorted ocean convoy coming within reach of the escorts calls the player once', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const events = runTo(w, 9 * 86400).filter((e) => e.type === 'convoyInEscortRange');
  assert.ok(events.length >= 1, 'HX 100 comes in range');
  assert.equal(events[0].convoy, 'HX 100');
  assert.equal(events.filter((e) => e.convoyId === events[0].convoyId).length, 1);
  assert.ok(events[0].km <= w.rules.escortGroups.alertKm);
  const hx = w.convoys.find((c) => c.name === 'HX 100');
  assert.ok(hx.rangeAlerted);
});

test('a high speed during a raid is asked first; a low one is not', () => {
  const w = makeKanalkampf();
  const app = { world: w, settings: { confirmSpeed: true }, speed: 10, paused: false, lastNavalAttack: null };
  assert.equal(enemyAction(app), null);
  w.contacts.set('h01', { raidId: 'h01', lost: false, plots: [] });
  assert.equal(enemyAction(app), 'air');
  assert.equal(requestSpeed(app, SPEEDS.indexOf(14400)), false);
  assert.equal(app.speed, 10);
  assert.ok(app.speedConfirm && app.speedConfirm.index === SPEEDS.indexOf(14400));
  assert.equal(requestSpeed(app, SPEEDS.indexOf(60)), true, '×60 is fine during a raid');
  assert.equal(app.speed, 60);
  app.settings.confirmSpeed = false;
  assert.equal(requestSpeed(app, SPEEDS.indexOf(14400)), true, 'the option switched off');
  // A convoy attacked an hour ago: ×600 is fine, ×3600 is asked.
  w.contacts.clear();
  app.settings.confirmSpeed = true;
  app.speed = 60;
  app.lastNavalAttack = w.t - 3600;
  assert.equal(enemyAction(app), 'naval');
  assert.equal(requestSpeed(app, SPEEDS.indexOf(600)), true);
  assert.equal(requestSpeed(app, SPEEDS.indexOf(3600)), false);
});

test('developer mode lines tell the real force, target and state', () => {
  const w = makeKanalkampf();
  run(w, 8 * 3600);
  const r = devRaids(w).find((x) => !x.phantom);
  const line = raidLine(w, r);
  assert.match(line, new RegExp(r.label));
  assert.ok(line.includes(r.bomberType) || r.bombers === 0);
  const u = w.uboats[0];
  assert.match(uboatLine(w, u), /torpilles|au port|coulé/);
  assert.equal(t('dev.badge'), 'DEV');
});

test('developer mode opens with its password only; data/dev.json keeps just its SHA-256', async () => {
  const dev = JSON.parse(readFileSync(new URL('../data/dev.json', import.meta.url), 'utf8'));
  assert.match(dev.passwordSha256, /^[0-9a-f]{64}$/);
  assert.equal(await passwordHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const hash = await passwordHash('Mot de passe');
  assert.equal(await checkDevPassword('mot de passe', hash), true, 'capitals do not count');
  assert.equal(await checkDevPassword('  Mot de passe ', hash), true, 'nor spaces around it');
  assert.equal(await checkDevPassword('mot de pass', hash), false);
  assert.equal(await checkDevPassword('', hash), false);
  assert.equal(await checkDevPassword('mot de passe', ''), false, 'no password set: closed');
});
