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

test('a U-boat contact calls the player only near a convoy at sea', () => {
  const w = makeKanalkampf();
  const memory = new Map();
  const c = w.convoys.find((u) => u.state === 'atSea');
  assert.ok(c);
  const near = alertFor(w, { type: 'uboatPlot', by: 'EG 1', x: c.x + 40, y: c.y }, memory);
  assert.equal(near.level, 'warning');
  assert.equal(near.params.convoy, c.name);
  assert.equal(alertFor(w, { type: 'uboatPlot', by: 'EG 1', x: c.x + 2000, y: c.y }, new Map()), null);
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
